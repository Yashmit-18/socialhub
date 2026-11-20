import { api, ApiError } from '../../../lib/api.js';
import { requireCapability } from './capabilities.js';

/**
 * HTTP client for the composer's backend contract (docs/COMPOSER_API_CONTRACT.md).
 *
 * NONE of these endpoints exist in the API yet. Every function first checks its capability
 * flag (services/capabilities.js) and rejects with `CapabilityUnavailableError` without
 * making a request while the flag is off (all functions are async, so it is always a
 * rejected promise, never a synchronous throw). The composer never fabricates a response: every value a
 * function resolves with came from the server.
 *
 * All SocialHub calls go through `lib/api.js` (bearer token in memory, transparent refresh,
 * uniform ApiError). Only the storage PUT in `uploadFileToStorage` bypasses it, because it
 * goes to a pre-signed object-storage URL and must not carry SocialHub credentials.
 */

const ws = (workspaceId) => `/workspaces/${encodeURIComponent(workspaceId)}`;
const id = (value) => encodeURIComponent(value);

/* ---------------------------------------------------------------- §3 media */

/**
 * Step 1: ask the API for an upload slot.
 * POST /workspaces/:id/media/uploads  { fileName, mimeType, sizeBytes, kind }
 * → 201 { media: { id, status: 'PENDING_UPLOAD' }, upload: { url, method, headers, expiresAt } }
 */
export async function createMediaUpload(
  workspaceId,
  { fileName, mimeType, sizeBytes, kind },
  options,
) {
  requireCapability('mediaUpload');
  return api.post(
    `${ws(workspaceId)}/media/uploads`,
    { fileName, mimeType, sizeBytes, kind },
    options,
  );
}

/**
 * Step 2: send the bytes straight to object storage with the pre-signed request from step 1.
 * Uses XMLHttpRequest because fetch() cannot report upload progress.
 * Resolves with nothing; rejects with ApiError('UPLOAD_FAILED' | 'NETWORK_ERROR') or an
 * AbortError when `signal` aborts.
 */
export async function uploadFileToStorage(upload, file, { onProgress, signal } = {}) {
  requireCapability('mediaUpload');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(upload?.method ?? 'PUT', upload.url);
    for (const [name, value] of Object.entries(upload?.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new ApiError(
            xhr.status,
            'UPLOAD_FAILED',
            `The file could not be uploaded (storage answered ${xhr.status}).`,
          ),
        );
    };
    xhr.onerror = () => {
      done();
      reject(
        new ApiError(0, 'NETWORK_ERROR', 'The upload was interrupted. Check your connection.'),
      );
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    xhr.send(file);
  });
}

/**
 * Step 3: tell the API the bytes are in storage.
 * POST /workspaces/:id/media/:mediaId/complete → 200 { media: MediaAsset }
 * MediaAsset.status is PROCESSING (poll getMedia) | READY | FAILED.
 */
export async function completeMediaUpload(workspaceId, mediaId, options) {
  requireCapability('mediaUpload');
  return api.post(`${ws(workspaceId)}/media/${id(mediaId)}/complete`, undefined, options);
}

/** GET /workspaces/:id/media/:mediaId → { media: MediaAsset } */
export async function getMedia(workspaceId, mediaId, options) {
  requireCapability('mediaUpload');
  return api.get(`${ws(workspaceId)}/media/${id(mediaId)}`, options);
}

/** DELETE /workspaces/:id/media/:mediaId → 204 */
export async function deleteMedia(workspaceId, mediaId, options) {
  requireCapability('mediaUpload');
  return api.delete(`${ws(workspaceId)}/media/${id(mediaId)}`, undefined, options);
}

/* ---------------------------------------------------- §4 drafts (content packages) */

/** GET /workspaces/:id/content-packages?status=DRAFT&cursor&limit → { items, nextCursor } */
export async function listDrafts(workspaceId, { cursor, limit = 20, signal } = {}) {
  requireCapability('serverDrafts');
  return api.get(`${ws(workspaceId)}/content-packages`, {
    query: { status: 'DRAFT', cursor, limit },
    signal,
  });
}

/** GET /workspaces/:id/content-packages/:packageId → { contentPackage } */
export async function getDraft(workspaceId, packageId, options) {
  requireCapability('serverDrafts');
  return api.get(`${ws(workspaceId)}/content-packages/${id(packageId)}`, options);
}

/** POST /workspaces/:id/content-packages  ContentPackageInput → 201 { contentPackage } */
export async function createDraft(workspaceId, input, options) {
  requireCapability('serverDrafts');
  return api.post(`${ws(workspaceId)}/content-packages`, input, options);
}

/**
 * PATCH /workspaces/:id/content-packages/:packageId  { ...ContentPackageInput, version }
 * → 200 { contentPackage }. 409 CONFLICT when `version` is stale (someone else saved).
 */
export async function updateDraft(workspaceId, packageId, input, version, options) {
  requireCapability('serverDrafts');
  return api.patch(
    `${ws(workspaceId)}/content-packages/${id(packageId)}`,
    { ...input, version },
    options,
  );
}

/** DELETE /workspaces/:id/content-packages/:packageId → 204 */
export async function deleteDraft(workspaceId, packageId, options) {
  requireCapability('serverDrafts');
  return api.delete(`${ws(workspaceId)}/content-packages/${id(packageId)}`, undefined, options);
}

/* --------------------------------------------------------------- §5 presets */

/** GET /workspaces/:id/account-presets → { items: AccountPreset[] } */
export async function listAccountPresets(workspaceId, options) {
  requireCapability('serverPresets');
  return api.get(`${ws(workspaceId)}/account-presets`, options);
}

/** POST /workspaces/:id/account-presets  { name, socialAccountIds } → 201 { preset } */
export async function createAccountPreset(workspaceId, { name, socialAccountIds }, options) {
  requireCapability('serverPresets');
  return api.post(`${ws(workspaceId)}/account-presets`, { name, socialAccountIds }, options);
}

/** DELETE /workspaces/:id/account-presets/:presetId → 204 */
export async function deleteAccountPreset(workspaceId, presetId, options) {
  requireCapability('serverPresets');
  return api.delete(`${ws(workspaceId)}/account-presets/${id(presetId)}`, undefined, options);
}

/* ------------------------------------------------------------ §6 publishing */

/**
 * POST /workspaces/:id/posts  { contentPackageId, destinations: [{ socialAccountId }], scheduledAt }
 * → 202 { post: { id, status, jobs: [{ id, socialAccountId, status: 'PENDING' }] } }
 *
 * The publishing engine does not exist: the `publishing` capability is hard-wired off, so
 * this always throws CapabilityUnavailableError and no request is sent.
 */
export async function submitPost(workspaceId, input, options) {
  requireCapability('publishing');
  return api.post(`${ws(workspaceId)}/posts`, input, options);
}
