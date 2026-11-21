import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS, CONTENT_PACKAGE_STATUS, MEDIA_STATUS } from '@socialhub/shared';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { ContentPackage, MediaAsset, SocialAccount } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { mediaView } from '../media/media.service.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';

/**
 * Composer drafts (docs/COMPOSER_API_CONTRACT.md §4). A draft is a ContentPackage in status
 * DRAFT.
 *
 * Rules:
 *  - Every query is scoped to the workspace.
 *  - A draft can only target accounts its author can use (accessibleAccountFilter).
 *  - A draft that targets an account the caller cannot use can be read (with that account
 *    left out of the answer) but not changed or deleted by that caller.
 *  - Updates are full saves guarded by `version`: a stale version answers 409 and writes
 *    nothing, so two people can never silently overwrite each other.
 */

/** "Updated" activity entries are written at most this often per draft (autosave is frequent). */
export const UPDATE_LOG_INTERVAL_MS = 10 * 60 * 1000;

const ids = (list) => list.map(String);

/** Ids, out of `candidates`, of accounts in the workspace the member may use. */
async function accessibleAmong(membership, candidates) {
  if (candidates.length === 0) return new Set();
  const rows = await SocialAccount.find({
    $and: [accessibleAccountFilter(membership), { _id: { $in: candidates } }],
  }).select('_id');
  return new Set(rows.map((row) => String(row._id)));
}

/** Ids, out of `candidates`, of accounts that still exist in the workspace. */
async function existingAmong(workspaceId, candidates) {
  if (candidates.length === 0) return new Set();
  const rows = await SocialAccount.find({
    workspace: workspaceId,
    _id: { $in: candidates },
  }).select('_id');
  return new Set(rows.map((row) => String(row._id)));
}

function encodeCursor(doc) {
  return Buffer.from(`${doc.updatedAt.getTime()}.${doc._id}`).toString('base64url');
}

function decodeCursor(cursor) {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('.');
  const at = new Date(Number(time));
  if (!Number.isFinite(at.getTime()) || !mongoose.isValidObjectId(id)) {
    throw validationError({ fields: { cursor: 'This page link is not valid' } });
  }
  return { at, id: new mongoose.Types.ObjectId(id) };
}

const person = (user) => (user?._id ? { id: String(user._id), name: user.name } : null);

function view(pkg, visibleAccounts, assets) {
  const platformCaptions = {};
  for (const [platform, caption] of Object.entries(pkg.platformCaptions?.toObject?.() ?? {})) {
    if (typeof caption === 'string') platformCaptions[platform] = caption;
  }
  return {
    id: String(pkg._id),
    status: pkg.status,
    version: pkg.version,
    caption: pkg.caption,
    platformCaptions,
    hashtags: [...pkg.hashtags],
    hashtagPlacement: pkg.hashtagPlacement,
    keywords: [...pkg.keywords],
    firstComment: pkg.firstComment,
    media: pkg.media
      .filter((entry) => assets.has(String(entry.media)))
      .map((entry) => ({
        mediaId: String(entry.media),
        altText: entry.altText,
        media: mediaView(assets.get(String(entry.media))),
      })),
    // Never reveals accounts the reader cannot use.
    targetAccountIds: ids(pkg.targetAccounts).filter((id) => visibleAccounts.has(id)),
    createdBy: person(pkg.createdBy),
    updatedBy: person(pkg.updatedBy),
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

async function present(packages, membership) {
  const accountIds = [...new Set(packages.flatMap((p) => ids(p.targetAccounts)))];
  const mediaIds = [...new Set(packages.flatMap((p) => p.media.map((m) => String(m.media))))];
  const [visible, assets] = await Promise.all([
    accessibleAmong(membership, accountIds),
    mediaIds.length ? MediaAsset.find({ _id: { $in: mediaIds } }) : [],
  ]);
  const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
  return packages.map((pkg) => view(pkg, visible, byId));
}

const withPeople = (query) => query.populate('createdBy', 'name').populate('updatedBy', 'name');

async function load(workspace, packageId) {
  const pkg = mongoose.isValidObjectId(packageId)
    ? await withPeople(ContentPackage.findOne({ _id: packageId, workspace: workspace._id }))
    : null;
  if (!pkg) throw notFound('Draft not found');
  return pkg;
}

/** Checks the body against the workspace: account access and usable media. */
async function resolveInput(workspace, membership, input) {
  const fields = {};
  const allowed = await accessibleAmong(membership, input.targetAccountIds);
  if (input.targetAccountIds.some((id) => !allowed.has(id.toLowerCase()))) {
    fields.targetAccountIds =
      'One or more selected accounts are not available to you in this workspace';
  }
  const mediaIds = input.media.map((m) => m.mediaId);
  if (mediaIds.length) {
    const usable = await MediaAsset.countDocuments({
      workspace: workspace._id,
      _id: { $in: mediaIds },
      status: { $in: [MEDIA_STATUS.READY, MEDIA_STATUS.PROCESSING] },
    });
    if (usable !== mediaIds.length) {
      fields.media = 'One or more attached files are missing or were not uploaded successfully';
    }
  }
  if (Object.keys(fields).length) throw validationError({ fields });
  return {
    caption: input.caption,
    platformCaptions: input.platformCaptions,
    hashtags: input.hashtags,
    hashtagPlacement: input.hashtagPlacement,
    keywords: input.keywords,
    firstComment: input.firstComment,
    media: input.media.map((m) => ({ media: m.mediaId, altText: m.altText })),
    targetAccounts: input.targetAccountIds,
  };
}

/** A member may change a draft only if they can use every account it still targets. */
async function assertCanModify(workspace, membership, pkg) {
  const targets = ids(pkg.targetAccounts);
  const [existing, allowed] = await Promise.all([
    existingAmong(workspace._id, targets),
    accessibleAmong(membership, targets),
  ]);
  // Accounts that were removed from the workspace no longer restrict anyone.
  if (targets.some((id) => existing.has(id) && !allowed.has(id))) {
    throw forbidden('This draft targets accounts you do not have access to.');
  }
}

const logMeta = (pkg) => ({
  mediaCount: pkg.media.length,
  accountCount: pkg.targetAccounts.length,
});

export async function listDrafts(workspace, membership, { status, cursor, limit }) {
  const filter = { workspace: workspace._id, status };
  if (cursor) {
    const { at, id } = decodeCursor(cursor);
    filter.$or = [{ updatedAt: { $lt: at } }, { updatedAt: at, _id: { $lt: id } }];
  }
  const rows = await withPeople(
    ContentPackage.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  return {
    items: await present(page, membership),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null,
  };
}

export async function getDraft(workspace, membership, packageId) {
  const [contentPackage] = await present([await load(workspace, packageId)], membership);
  return { contentPackage };
}

export async function createDraft(workspace, membership, actor, input, context) {
  const data = await resolveInput(workspace, membership, input);
  const pkg = await ContentPackage.create({
    ...data,
    workspace: workspace._id,
    status: CONTENT_PACKAGE_STATUS.DRAFT,
    createdBy: actor._id,
    updatedBy: actor._id,
  });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.CONTENT_PACKAGE_CREATED,
    target: { type: 'content_package', id: pkg._id },
    metadata: logMeta(pkg),
    context,
  });
  return getDraft(workspace, membership, pkg._id);
}

export async function updateDraft(workspace, membership, actor, packageId, body, context) {
  const { version, ...input } = body;
  const current = await load(workspace, packageId);
  await assertCanModify(workspace, membership, current);
  const data = await resolveInput(workspace, membership, input);

  const now = new Date();
  const logIt = !current.updateLoggedAt || now - current.updateLoggedAt >= UPDATE_LOG_INTERVAL_MS;
  // The version is part of the filter, so the check and the write are one atomic step.
  const updated = await ContentPackage.findOneAndUpdate(
    { _id: current._id, workspace: workspace._id, version },
    {
      $set: { ...data, updatedBy: actor._id, ...(logIt ? { updateLoggedAt: now } : {}) },
      $inc: { version: 1 },
    },
    { new: true },
  );
  if (!updated) {
    const latest = await ContentPackage.findOne({ _id: current._id }).select('version');
    if (!latest) throw notFound('Draft not found');
    throw conflict('Someone else saved this draft. Reload it to see their changes.', {
      currentVersion: latest.version,
    });
  }
  if (logIt) {
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.CONTENT_PACKAGE_UPDATED,
      target: { type: 'content_package', id: updated._id },
      metadata: logMeta(updated),
      context,
    });
  }
  return getDraft(workspace, membership, updated._id);
}

export async function deleteDraft(workspace, membership, actor, packageId, context) {
  const pkg = await load(workspace, packageId);
  await assertCanModify(workspace, membership, pkg);
  await ContentPackage.deleteOne({ _id: pkg._id, workspace: workspace._id });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.CONTENT_PACKAGE_DELETED,
    target: { type: 'content_package', id: pkg._id },
    metadata: logMeta(pkg),
    context,
  });
}
