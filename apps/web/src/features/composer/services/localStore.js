/**
 * Device-local persistence for the composer (localStorage), scoped per user and workspace so
 * another person signing in on the same browser never sees it.
 *
 * This is genuine storage on this device only. The UI always labels it that way. It is not
 * shared with the team and is not a server draft. Media files are never stored here: only
 * their names and types, so the person can be told which files to add again.
 */

const DRAFT_PREFIX = 'sh-composer-draft:v1';
const PRESETS_PREFIX = 'sh-composer-presets:v1';

export const LOCAL_DRAFT_VERSION = 1;

export function localDraftKey(userId, workspaceId) {
  return `${DRAFT_PREFIX}:${userId}:${workspaceId}`;
}

export function localPresetsKey(userId, workspaceId) {
  return `${PRESETS_PREFIX}:${userId}:${workspaceId}`;
}

const PROBE_KEY = '__sh_probe__';

/** The Storage object, or null when the browser denies access to it (e.g. blocked site data). */
function getStorage() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isQuotaError(err) {
  return (
    err?.name === 'QuotaExceededError' ||
    err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err?.code === 22 ||
    err?.code === 1014
  );
}

/**
 * Whether this browser lets SocialHub keep data on the device (false when storage is blocked).
 * A FULL storage still counts as available: existing data can be read, and writes report
 * 'quota' so the UI can say "storage is full" rather than "blocked".
 */
export function isLocalStorageAvailable() {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch (err) {
    return isQuotaError(err);
  }
}

function readJson(key) {
  const storage = getStorage();
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    remove(key);
    return null;
  }
}

/** Returns `{ ok: true }` or `{ ok: false, reason: 'unavailable' | 'quota' | 'error' }`. */
function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) return { ok: false, reason: 'quota' };
    // A write that fails for another reason while the probe fails too means the browser
    // refuses storage (e.g. blocked site data), not a one-off error.
    return { ok: false, reason: isLocalStorageAvailable() ? 'error' : 'unavailable' };
  }
}

function remove(key) {
  try {
    getStorage()?.removeItem(key);
  } catch {
    /* nothing to clean up */
  }
}

/* ------------------------------------------------------------------ drafts */

/**
 * Reads this person's device draft for the workspace.
 * Returns `{ savedAt, data }` or null (missing, corrupted or from an unknown version).
 */
export function readLocalDraft(userId, workspaceId) {
  const record = readJson(localDraftKey(userId, workspaceId));
  if (
    !record ||
    record.version !== LOCAL_DRAFT_VERSION ||
    typeof record.savedAt !== 'string' ||
    typeof record.data !== 'object' ||
    record.data === null
  ) {
    return null;
  }
  return { savedAt: record.savedAt, data: record.data };
}

/** Saves `data` (see model/serialize.js → toLocalDraft). Returns `{ ok, savedAt?, reason? }`. */
export function writeLocalDraft(userId, workspaceId, data, savedAt = new Date().toISOString()) {
  const result = writeJson(localDraftKey(userId, workspaceId), {
    version: LOCAL_DRAFT_VERSION,
    savedAt,
    data,
  });
  return result.ok ? { ok: true, savedAt } : result;
}

export function clearLocalDraft(userId, workspaceId) {
  remove(localDraftKey(userId, workspaceId));
}

/* ----------------------------------------------------------------- presets */

const isPreset = (p) =>
  p &&
  typeof p.id === 'string' &&
  typeof p.name === 'string' &&
  Array.isArray(p.socialAccountIds) &&
  p.socialAccountIds.every((id) => typeof id === 'string');

/** Custom account presets saved on this device: `[{ id, name, socialAccountIds, createdAt }]`. */
export function readLocalPresets(userId, workspaceId) {
  const list = readJson(localPresetsKey(userId, workspaceId));
  return Array.isArray(list) ? list.filter(isPreset) : [];
}

export function writeLocalPresets(userId, workspaceId, presets) {
  return writeJson(localPresetsKey(userId, workspaceId), presets);
}
