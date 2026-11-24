import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INSPECTION_STATUS,
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  composerActions,
  createMediaItem,
} from '../model/composerState.js';
import { createClientId } from '../model/ids.js';
import { checkFileAcceptable } from '../model/media.js';
import { getComposerCapabilities } from '../services/capabilities.js';
import {
  completeMediaUpload,
  createMediaUpload,
  deleteMedia,
  getMedia,
  uploadFileToStorage,
} from '../services/composerApi.js';
import { inspectMediaFile } from '../services/mediaInspector.js';

/**
 * Owns the `File` objects behind the composer's media items (composer state only holds
 * serializable metadata) and everything that happens to them:
 *
 *  - accepting or rejecting picked/dropped files (model/media.js `checkFileAcceptable`),
 *  - object URLs for previews (revoked when an item is removed, when the composer drops it
 *    through load/reset, and on unmount),
 *  - reading dimensions / duration in the browser (services/mediaInspector.js),
 *  - uploading through the media API (docs/COMPOSER_API_CONTRACT.md §3) — ONLY when
 *    `getComposerCapabilities().mediaUpload` is on. While it is off, items stay LOCAL
 *    ("in this browser"), no request of any kind is made, and nothing is ever reported as
 *    uploaded. An item becomes UPLOADED only after the API itself answers READY.
 */

/** Poll interval while the media API reports PROCESSING. */
export const UPLOAD_POLL_INTERVAL_MS = 3000;
/** After this many polls the composer keeps waiting, but checks less often. */
export const UPLOAD_MAX_POLLS = 20;
/** Poll interval once processing has taken longer than UPLOAD_MAX_POLLS polls. */
export const UPLOAD_SLOW_POLL_INTERVAL_MS = 15000;
/** How many "couldn't add" messages are kept (most recent last). */
export const MAX_REJECTIONS = 5;

const SERVER_STATUS = Object.freeze({
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
});

function createPreviewUrl(file) {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(file) || null;
    }
  } catch {
    /* this browser can't make object URLs: no preview, and details can't be read */
  }
  return null;
}

function revokePreviewUrl(url) {
  if (!url) return;
  try {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  } catch {
    /* nothing left to release */
  }
}

const abortError = () => new DOMException('Upload cancelled', 'AbortError');

/** setTimeout as a promise that rejects (and clears its timer) when `signal` aborts. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let timer = null;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortError();
}

/** Stops one in-flight upload (request, storage transfer or polling). */
function abortUpload(uploads, id) {
  const job = uploads.get(id);
  if (!job) return false;
  uploads.delete(id);
  job.abort();
  return true;
}

/** Forgets a file: stops its upload and releases its object URL. */
function releaseFile(files, uploads, id) {
  abortUpload(uploads, id);
  const entry = files.get(id);
  if (!entry) return;
  files.delete(id);
  revokePreviewUrl(entry.url);
}

function inspect(files, dispatch, id) {
  const entry = files.get(id);
  if (!entry) return;
  if (!entry.url) {
    dispatch(composerActions.updateMedia(id, { inspection: INSPECTION_STATUS.FAILED }));
    return;
  }
  const stillAttached = () => files.get(id) === entry;
  Promise.resolve()
    .then(() => inspectMediaFile(entry.file, { kind: entry.kind, url: entry.url }))
    .then(
      (info) => {
        if (!stillAttached()) return;
        dispatch(
          composerActions.updateMedia(id, {
            width: info?.width ?? null,
            height: info?.height ?? null,
            durationSec: info?.durationSec ?? null,
            inspection: INSPECTION_STATUS.DONE,
          }),
        );
      },
      () => {
        if (!stillAttached()) return;
        dispatch(composerActions.updateMedia(id, { inspection: INSPECTION_STATUS.FAILED }));
      },
    );
}

function failureMessage(error) {
  if (error?.name === 'AbortError') return 'The upload was interrupted. Try again.';
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const requestId = typeof error?.requestId === 'string' ? error.requestId : '';
  const text = message || 'The upload failed. Try again.';
  // The request id lets the server log be matched to what the person saw.
  return requestId ? `${text} (request ${requestId})` : text;
}

/** A slot from an earlier attempt that can still be used (at least a minute left). */
const SLOT_MARGIN_MS = 60 * 1000;
function usableSlot(slot) {
  const expires = Date.parse(slot?.upload?.expiresAt ?? '');
  return slot?.media?.id && slot?.upload?.url && expires - Date.now() > SLOT_MARGIN_MS
    ? slot
    : null;
}

/** The server record of an upload that never finished: removed so it leaves nothing behind. */
function discardSlot(workspaceId, slot) {
  const mediaId = slot?.media?.id;
  if (mediaId) deleteMedia(workspaceId, mediaId).catch(() => {});
}

/**
 * The contract's three steps (create slot → PUT to storage → complete), then polling while
 * the API reports PROCESSING. Resolves with the server media id once the API says READY.
 */
async function uploadToServer({ id, entry, workspaceId, dispatch, signal }) {
  const { file, fileName, mimeType, sizeBytes, kind } = entry;
  // A retry reuses the slot of the attempt that failed while it is still valid, so retrying
  // never leaves another unused file record behind. An expired one is discarded.
  let slot = usableSlot(entry.slot);
  if (!slot) {
    const previous = entry.slot;
    entry.slot = null;
    if (previous) discardSlot(workspaceId, previous);
    slot = await createMediaUpload(
      workspaceId,
      { fileName, mimeType, sizeBytes, kind },
      { signal },
    );
    entry.slot = slot;
  }
  throwIfAborted(signal);
  const mediaId = slot?.media?.id;
  if (!mediaId || !slot?.upload?.url) {
    throw new Error("SocialHub's media API didn't return an upload address for this file.");
  }

  let lastPercent = -1;
  try {
    await uploadFileToStorage(slot.upload, file, {
      signal,
      onProgress: (fraction) => {
        const percent = Math.floor(fraction * 100);
        if (signal.aborted || percent === lastPercent) return;
        lastPercent = percent;
        dispatch(composerActions.mediaUploadProgress(id, fraction));
      },
    });
  } catch (error) {
    // 409: an earlier attempt with this slot already delivered the bytes; only the
    // confirmation below is missing.
    if (error?.status !== 409) {
      // The storage refused this link itself (expired, not valid, file mismatch): a retry
      // needs a new one. A dropped connection or a server error keeps it for the retry.
      if (error?.status >= 400 && error?.status < 500) {
        entry.slot = null;
        discardSlot(workspaceId, slot);
      }
      throw error;
    }
  }
  throwIfAborted(signal);

  let asset = (await completeMediaUpload(workspaceId, mediaId, { signal }))?.media;
  throwIfAborted(signal);
  // The bytes are stored: the file stays PROCESSING with its server id (so a team draft can
  // already reference it) until the API says READY or FAILED. Long transcodes are not treated
  // as failures: after UPLOAD_MAX_POLLS the composer simply checks less often.
  for (let polls = 0; asset?.status === SERVER_STATUS.PROCESSING; polls += 1) {
    if (polls === 0) {
      dispatch(
        composerActions.updateMedia(id, {
          upload: { status: UPLOAD_STATUS.PROCESSING, mediaId, progress: 1, error: null },
        }),
      );
    }
    await wait(
      polls < UPLOAD_MAX_POLLS ? UPLOAD_POLL_INTERVAL_MS : UPLOAD_SLOW_POLL_INTERVAL_MS,
      signal,
    );
    asset = (await getMedia(workspaceId, mediaId, { signal }))?.media;
    throwIfAborted(signal);
  }

  if (asset?.status === SERVER_STATUS.READY) {
    entry.slot = null;
    return asset.id || mediaId;
  }
  if (asset?.status === SERVER_STATUS.FAILED) {
    throw new Error(asset.failureReason || "SocialHub couldn't process this file.");
  }
  throw new Error("SocialHub's media API returned an unexpected status for this file.");
}

function startUpload({ files, uploads, dispatch, workspaceId }, id) {
  const entry = files.get(id);
  if (!entry) return false;
  abortUpload(uploads, id);
  const controller = new AbortController();
  const job = { abort: () => controller.abort() };
  uploads.set(id, job);
  const current = () => !controller.signal.aborted && files.get(id) === entry;

  dispatch(
    composerActions.updateMedia(id, {
      upload: { status: UPLOAD_STATUS.UPLOADING, progress: 0, mediaId: null, error: null },
    }),
  );
  uploadToServer({ id, entry, workspaceId, dispatch, signal: controller.signal })
    .then(
      (mediaId) => {
        if (!current()) return;
        dispatch(
          composerActions.updateMedia(id, {
            upload: { status: UPLOAD_STATUS.UPLOADED, mediaId, progress: 1, error: null },
          }),
        );
      },
      (error) => {
        if (!current()) return;
        dispatch(
          composerActions.updateMedia(id, {
            upload: {
              status: UPLOAD_STATUS.FAILED,
              mediaId: null,
              progress: 0,
              error: failureMessage(error),
            },
          }),
        );
      },
    )
    .finally(() => {
      if (uploads.get(id) === job) uploads.delete(id);
    });
  return true;
}

const fileLabel = (file) => (typeof file?.name === 'string' && file.name) || 'Unnamed file';

/** One message for every file that didn't fit, instead of one per file. */
function overflowReason(files) {
  const first = fileLabel(files[0]);
  const rest = files.length - 1;
  const limit = `You can attach up to ${MEDIA_MAX_ITEMS} files to one post.`;
  if (rest === 0) return `${first} wasn't added. ${limit}`;
  return `${first} and ${rest} more ${rest === 1 ? 'file' : 'files'} weren't added. ${limit}`;
}

/**
 * useMediaManager({ media, dispatch, workspaceId })
 *
 * `media` is `state.media`, `dispatch` the composer reducer's dispatch. Returns
 * `{ addFiles, removeMedia, retryUpload, cancelUpload, getFile, rejections, dismissRejection,
 *    clearRejections, uploadAvailable }` (see each function below).
 */
export function useMediaManager({ media, dispatch, workspaceId }) {
  /** id → { file, url, kind, mimeType, fileName, sizeBytes, seen } */
  const filesRef = useRef(new Map());
  /** id → { abort() } for uploads in flight */
  const uploadsRef = useRef(new Map());
  const [rejections, setRejections] = useState([]);
  const uploadAvailable = getComposerCapabilities().mediaUpload;

  // Items that leave `media` without removeMedia (draft restored, composer reset) release
  // their files too. Only items that have been seen in `media` are released, so a file added
  // a moment ago is never dropped before its item reaches the state.
  useEffect(() => {
    const files = filesRef.current;
    const uploads = uploadsRef.current;
    const present = new Set(media.map((item) => item.id));
    for (const [id, entry] of [...files]) {
      if (present.has(id)) entry.seen = true;
      else if (entry.seen) releaseFile(files, uploads, id);
    }
  }, [media]);

  useEffect(() => {
    const files = filesRef.current;
    const uploads = uploadsRef.current;
    return () => {
      for (const id of [...uploads.keys()]) abortUpload(uploads, id);
      for (const id of [...files.keys()]) releaseFile(files, uploads, id);
    };
  }, []);

  /**
   * Event handler: adds picked/dropped files. Returns `{ added: MediaItem[], rejected:
   * [{ fileName, reason }] }` synchronously; dimensions are read (and, when the media API is
   * available, uploads start) in the background.
   */
  const addFiles = useCallback(
    (fileList) => {
      const files = filesRef.current;
      const candidates = Array.from(fileList ?? []).filter(Boolean);
      const present = new Set(media.map((item) => item.id));
      let count = present.size;
      for (const [id, entry] of files) {
        if (!entry.seen && !present.has(id)) count += 1;
      }

      const added = [];
      const rejected = [];
      const messages = [];
      const overflow = [];
      for (const file of candidates) {
        const check = checkFileAcceptable(file, { existingCount: count });
        if (!check.ok) {
          rejected.push({ fileName: fileLabel(file), reason: check.reason });
          if (count >= MEDIA_MAX_ITEMS) overflow.push(file);
          else messages.push({ fileName: fileLabel(file), reason: check.reason });
          continue;
        }
        const id = createClientId('media');
        const url = createPreviewUrl(file);
        const fileName = fileLabel(file);
        const item = createMediaItem({
          id,
          kind: check.kind,
          fileName,
          mimeType: check.mimeType,
          sizeBytes: file.size,
          previewUrl: url,
        });
        files.set(id, {
          file,
          url,
          kind: check.kind,
          mimeType: check.mimeType,
          fileName,
          sizeBytes: file.size,
          seen: false,
        });
        added.push(item);
        count += 1;
      }
      if (overflow.length > 0) {
        messages.push({ fileName: fileLabel(overflow[0]), reason: overflowReason(overflow) });
      }

      if (added.length > 0) dispatch(composerActions.addMedia(added));
      if (messages.length > 0) {
        const entries = messages.map((m) => ({ id: createClientId('rejection'), ...m }));
        setRejections((previous) => [...previous, ...entries].slice(-MAX_REJECTIONS));
      }

      const uploading = getComposerCapabilities().mediaUpload;
      const context = { files, uploads: uploadsRef.current, dispatch, workspaceId };
      for (const item of added) {
        inspect(files, dispatch, item.id);
        if (uploading) startUpload(context, item.id);
      }
      return { added, rejected };
    },
    [media, dispatch, workspaceId],
  );

  /** Removes an item: aborts its upload, revokes its preview URL and drops it from the state. */
  const removeMedia = useCallback(
    (id) => {
      // An upload that never finished leaves a server record behind: discard it.
      const unfinished = filesRef.current.get(id)?.slot;
      releaseFile(filesRef.current, uploadsRef.current, id);
      if (unfinished && getComposerCapabilities().mediaUpload) discardSlot(workspaceId, unfinished);
      dispatch(composerActions.removeMedia(id));
    },
    [dispatch, workspaceId],
  );

  /** (Re)starts an upload. No-op (false) when the media API is off or the file isn't here. */
  const retryUpload = useCallback(
    (id) => {
      if (!getComposerCapabilities().mediaUpload) return false;
      return startUpload(
        { files: filesRef.current, uploads: uploadsRef.current, dispatch, workspaceId },
        id,
      );
    },
    [dispatch, workspaceId],
  );

  /** Aborts an upload in flight; the item goes back to LOCAL (in this browser). */
  const cancelUpload = useCallback(
    (id) => {
      if (!abortUpload(uploadsRef.current, id)) return false;
      dispatch(
        composerActions.updateMedia(id, {
          upload: { status: UPLOAD_STATUS.LOCAL, progress: 0, mediaId: null, error: null },
        }),
      );
      return true;
    },
    [dispatch],
  );

  /** The `File` behind an item, or null (items restored from the server have none). */
  const getFile = useCallback((id) => filesRef.current.get(id)?.file ?? null, []);

  const dismissRejection = useCallback(
    (id) => setRejections((previous) => previous.filter((r) => r.id !== id)),
    [],
  );
  const clearRejections = useCallback(() => setRejections([]), []);

  return {
    addFiles,
    removeMedia,
    retryUpload,
    cancelUpload,
    getFile,
    rejections,
    dismissRejection,
    clearRejections,
    uploadAvailable,
  };
}
