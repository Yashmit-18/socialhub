import mongoose from 'mongoose';
import {
  ACTIVITY_ACTIONS,
  COMPOSER_LIMITS,
  ERROR_CODES,
  MEDIA_KINDS,
  MEDIA_MIME_TYPES,
  MEDIA_STATUS,
  PERMISSIONS,
  hasPermission,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { randomToken } from '../../lib/crypto.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ContentPackage, MediaAsset } from '../../models/index.js';
import { getStorage, requireStorage } from '../../storage/index.js';
import { probeMedia } from '../../storage/mediaProbe.js';
import { recordActivity } from '../activity/activity.service.js';

/**
 * Media uploads for the composer (docs/COMPOSER_API_CONTRACT.md §5).
 *
 *   1. createUpload   issues a short-lived upload slot bound to a server-generated upload
 *                     key, the declared type and the declared size. Nothing is "uploaded" yet.
 *   2. (browser)      PUTs the bytes straight to storage, at the upload key.
 *   3. completeUpload copies the object to its final key (which no link can write to) and
 *                     verifies the copy: declared size, real type, dimensions. Only then is
 *                     the asset READY, and from then on its bytes cannot be changed.
 */

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** How long one completion request may hold an asset before another may take over. */
export const VERIFY_CLAIM_MS = 2 * 60 * 1000;
/** Unfinished uploads are kept this long after their slot expired, then removed. */
export const ABANDONED_UPLOAD_GRACE_MS = 60 * 60 * 1000;
/** Verified or failed files that no draft references are removed after this long. */
export const UNREFERENCED_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

/** API shape of an asset (contract §5.2). `url` is only present for verified files. */
export function mediaView(asset, storage = getStorage()) {
  const servable =
    asset.status === MEDIA_STATUS.READY && storage && storage.name === asset.storageDriver;
  const url = servable ? storage.publicUrl(asset.storageKey) : null;
  return {
    id: String(asset._id),
    kind: asset.kind,
    status: asset.status,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationSec: asset.durationSec ?? null,
    url,
    // No thumbnails are generated yet: images are their own thumbnail, videos have none.
    thumbnailUrl: asset.kind === MEDIA_KINDS.IMAGE ? url : null,
    failureReason: asset.failureReason ?? null,
    createdAt: asset.createdAt,
  };
}

async function findAsset(workspace, mediaId) {
  const asset = mongoose.isValidObjectId(mediaId)
    ? await MediaAsset.findOne({ _id: mediaId, workspace: workspace._id })
    : null;
  // Unknown and other-workspace ids look the same, so ids cannot be probed.
  if (!asset) throw notFound('File not found');
  return asset;
}

export async function createUpload(workspace, actor, { fileName, mimeType, sizeBytes, kind }) {
  const storage = requireStorage();
  const now = new Date();
  const ttl = config.storage.uploadTtlSeconds;
  const id = new mongoose.Types.ObjectId();
  const extension = EXTENSIONS[mimeType];
  // Both keys are generated here: the client can never choose where a file is written.
  // The upload link is signed for `uploadKey` only. `storageKey` is where the verified
  // file will live; nothing outside this API can write to it.
  const uploadKey = `uploads/${workspace._id}/${id}/${randomToken(18)}.${extension}`;
  const storageKey = `workspaces/${workspace._id}/media/${id}/${randomToken(18)}.${extension}`;
  const upload = storage.createUpload({
    key: uploadKey,
    contentType: mimeType,
    sizeBytes,
    expiresInSeconds: ttl,
    now,
  });
  const asset = await MediaAsset.create({
    _id: id,
    workspace: workspace._id,
    kind,
    fileName,
    mimeType,
    sizeBytes,
    storageKey,
    uploadKey,
    storageDriver: storage.name,
    uploadedBy: actor._id,
    uploadExpiresAt: new Date(now.getTime() + ttl * 1000),
  });
  return { media: { id: String(asset._id), status: asset.status }, upload };
}

/** Removes everything this asset may have in storage (best effort). */
async function removeObjects(asset, storage) {
  for (const key of new Set([asset.uploadKey, asset.storageKey].filter(Boolean))) {
    await storage.remove(key).catch((err) => {
      logger.warn({ err, mediaId: String(asset._id) }, 'Could not remove a stored file');
    });
  }
}

async function fail(asset, storage, reason) {
  // A file that failed verification must not stay in storage, under either key.
  await removeObjects(asset, storage);
  const failed = await MediaAsset.findOneAndUpdate(
    { _id: asset._id },
    {
      $set: { status: MEDIA_STATUS.FAILED, failureReason: reason, completedAt: new Date() },
      $unset: { verifyingAt: 1, uploadKey: 1 },
    },
    { returnDocument: 'after' },
  );
  return { media: mediaView(failed, storage) };
}

const releaseClaim = (asset) =>
  MediaAsset.updateOne({ _id: asset._id }, { $unset: { verifyingAt: 1 } });

const notArrived = () =>
  new AppError(
    409,
    ERROR_CODES.UPLOAD_INCOMPLETE,
    'The file has not arrived in storage yet. Upload it again.',
  );

/** Checks the bytes stored at `key`. Returns `{ reason }` on failure or `{ probe }`. */
async function inspect(asset, storage, key) {
  const stored = await storage.stat(key);
  if (!stored || stored.sizeBytes !== asset.sizeBytes) {
    return { reason: 'The stored file is not the size that was announced.' };
  }
  const probe = await probeMedia(
    (start, length) => storage.read(key, start, length),
    stored.sizeBytes,
  );
  // Images must be exactly the declared format. MP4 and MOV share one container family,
  // so for videos any supported video container is accepted.
  const matches =
    asset.kind === MEDIA_KINDS.IMAGE
      ? probe.mimeType === asset.mimeType
      : MEDIA_MIME_TYPES[MEDIA_KINDS.VIDEO].includes(probe.mimeType);
  if (!matches) return { reason: 'The file content does not match its type.' };
  if (asset.kind === MEDIA_KINDS.IMAGE && !(probe.width && probe.height)) {
    return { reason: 'The image could not be read. It may be damaged.' };
  }
  if (Math.max(probe.width ?? 0, probe.height ?? 0) > COMPOSER_LIMITS.DIMENSION_MAX) {
    return {
      reason: `The file is larger than ${COMPOSER_LIMITS.DIMENSION_MAX.toLocaleString('en-US')} pixels on one side.`,
    };
  }
  return { probe };
}

/**
 * Verifies an upload and makes it permanent.
 *
 *  1. Claim: only one completion request works on an asset at a time.
 *  2. Copy the uploaded object to the asset's final key, which no upload link can write to.
 *  3. Verify the bytes AT THE FINAL KEY (size, real type, dimensions). What becomes READY is
 *     therefore exactly what was checked, whatever happens to the upload object meanwhile.
 *  4. READY is terminal: the final object is never copied over again.
 *
 * Reusing the upload link afterwards can only rewrite the upload object, which nothing
 * refers to any more and which the clean-up removes.
 */
export async function completeUpload(workspace, actor, mediaId, context) {
  const found = await findAsset(workspace, mediaId);
  const storage = requireStorage();
  // Completing twice is harmless: the outcome of the first verification stands.
  if (found.status !== MEDIA_STATUS.PENDING_UPLOAD) return { media: mediaView(found, storage) };
  if (found.storageDriver !== storage.name) {
    throw conflict('This upload was started with a different storage configuration.');
  }

  const now = new Date();
  const asset = await MediaAsset.findOneAndUpdate(
    {
      _id: found._id,
      status: MEDIA_STATUS.PENDING_UPLOAD,
      $or: [
        { verifyingAt: null },
        // A claim left behind by a crashed request stops counting after a while.
        { verifyingAt: { $lt: new Date(now.getTime() - VERIFY_CLAIM_MS) } },
      ],
    },
    { $set: { verifyingAt: now } },
    { returnDocument: 'after' },
  );
  if (!asset) {
    const current = await findAsset(workspace, mediaId);
    if (current.status !== MEDIA_STATUS.PENDING_UPLOAD) {
      return { media: mediaView(current, storage) };
    }
    throw conflict('This file is being verified. Try again in a moment.');
  }

  let outcome;
  try {
    // Assets created before uploads had their own key are verified in place.
    const uploadKey = asset.uploadKey ?? asset.storageKey;
    const arrived = await storage.stat(uploadKey);
    if (!arrived) throw notArrived();
    if (uploadKey !== asset.storageKey && !(await storage.copy(uploadKey, asset.storageKey))) {
      throw notArrived();
    }
    outcome = await inspect(asset, storage, asset.storageKey);
  } catch (err) {
    // Not arrived yet, or a storage outage: the upload stays pending and can be retried.
    await releaseClaim(asset).catch(() => {});
    throw err;
  }

  if (outcome.reason) return fail(asset, storage, outcome.reason);

  const { probe } = outcome;
  const ready = await MediaAsset.findOneAndUpdate(
    { _id: asset._id, status: MEDIA_STATUS.PENDING_UPLOAD },
    {
      $set: {
        status: MEDIA_STATUS.READY,
        completedAt: new Date(),
        ...(probe.width ? { width: probe.width } : {}),
        ...(probe.height ? { height: probe.height } : {}),
        ...(probe.durationSec ? { durationSec: probe.durationSec } : {}),
      },
      $unset: { verifyingAt: 1, failureReason: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!ready) return { media: mediaView(await findAsset(workspace, mediaId), storage) };

  // The upload object has served its purpose. If this fails, the clean-up removes it later.
  if (asset.uploadKey && asset.uploadKey !== asset.storageKey) {
    await storage.retireUpload(asset.uploadKey).catch((err) => {
      logger.warn({ err, mediaId: String(asset._id) }, 'Could not retire an upload object');
    });
  }
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.MEDIA_UPLOADED,
    target: { type: 'media', id: ready._id, label: ready.fileName },
    metadata: { kind: ready.kind, sizeBytes: ready.sizeBytes },
    context,
  });
  return { media: mediaView(ready, storage) };
}

export async function getMedia(workspace, mediaId) {
  return { media: mediaView(await findAsset(workspace, mediaId)) };
}

export async function deleteMedia(workspace, membership, actor, mediaId, context) {
  const asset = await findAsset(workspace, mediaId);
  const own = String(asset.uploadedBy) === String(actor._id);
  if (!own && !hasPermission(membership.role, PERMISSIONS.MEMBERS_MANAGE)) {
    throw forbidden('Only the person who uploaded this file, or an admin, can delete it.');
  }
  if (await ContentPackage.exists({ workspace: workspace._id, 'media.media': asset._id })) {
    throw conflict('This file is used by a draft. Remove it from the draft first.');
  }
  const storage = getStorage();
  if (storage && storage.name === asset.storageDriver) {
    await storage.remove(asset.storageKey);
    if (asset.uploadKey) await storage.remove(asset.uploadKey);
  }
  await MediaAsset.deleteOne({ _id: asset._id });
  if (asset.status === MEDIA_STATUS.READY) {
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.MEDIA_DELETED,
      target: { type: 'media', id: asset._id, label: asset.fileName },
      metadata: { kind: asset.kind },
      context,
    });
  }
}

/**
 * Removes uploads that were never finished, and verified or failed files that no draft
 * uses. Run it on a schedule (`npm run media:cleanup -w @socialhub/api`).
 * Returns counts; a storage failure for one file leaves that file for the next run.
 */
export async function cleanupMedia({ now = new Date(), limit = 500 } = {}) {
  const storage = getStorage();
  const result = { abandoned: 0, unreferenced: 0, uploadObjects: 0, failed: 0 };
  const usable = (asset) => storage && storage.name === asset.storageDriver;

  // Upload objects of finished assets: their links have expired, so nothing can write to
  // them any more (a link reused before it expired may have left an object behind).
  const finished = await MediaAsset.find({
    status: { $ne: MEDIA_STATUS.PENDING_UPLOAD },
    uploadKey: { $exists: true },
    uploadExpiresAt: { $lt: now },
  })
    .sort({ _id: 1 })
    .limit(limit);
  for (const asset of finished) {
    try {
      if (usable(asset)) await storage.remove(asset.uploadKey);
      await MediaAsset.updateOne({ _id: asset._id }, { $unset: { uploadKey: 1 } });
      result.uploadObjects += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, mediaId: String(asset._id) }, 'Could not remove an upload object');
    }
  }

  const candidates = await MediaAsset.find({
    $or: [
      {
        status: MEDIA_STATUS.PENDING_UPLOAD,
        uploadExpiresAt: { $lt: new Date(now.getTime() - ABANDONED_UPLOAD_GRACE_MS) },
      },
      {
        status: { $ne: MEDIA_STATUS.PENDING_UPLOAD },
        completedAt: { $lt: new Date(now.getTime() - UNREFERENCED_MEDIA_TTL_MS) },
      },
    ],
  })
    .sort({ _id: 1 })
    .limit(limit);

  for (const asset of candidates) {
    const pending = asset.status === MEDIA_STATUS.PENDING_UPLOAD;
    if (!pending && (await ContentPackage.exists({ 'media.media': asset._id }))) continue;
    try {
      // A late upload to an expired slot may have left an object behind: remove it too.
      if (usable(asset)) {
        await storage.remove(asset.storageKey);
        if (asset.uploadKey) await storage.remove(asset.uploadKey);
      }
      await MediaAsset.deleteOne({ _id: asset._id });
      result[pending ? 'abandoned' : 'unreferenced'] += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, mediaId: String(asset._id) }, 'Media clean-up failed for one file');
    }
  }
  return result;
}

/** Removes every stored object of a workspace (called before the workspace is deleted). */
export async function removeWorkspaceObjects(workspaceId) {
  const storage = getStorage();
  if (!storage) return;
  const assets = await MediaAsset.find({ workspace: workspaceId }).select(
    'storageKey uploadKey storageDriver',
  );
  for (const asset of assets) {
    if (asset.storageDriver === storage.name) await removeObjects(asset, storage);
  }
}
