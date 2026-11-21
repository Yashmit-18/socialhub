import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPOSER_LIMITS } from '@socialhub/shared';
import { useState } from 'react';
import { createClientId } from '../model/ids.js';
import { getComposerCapabilities } from '../services/capabilities.js';
import {
  createAccountPreset,
  deleteAccountPreset,
  listAccountPresets,
} from '../services/composerApi.js';
import {
  isLocalStorageAvailable,
  readLocalPresets,
  writeLocalPresets,
} from '../services/localStore.js';

/**
 * Custom account presets: named sets of social accounts that replace the composer's selection
 * in one step. (Built-in presets such as "All Facebook Pages" need no storage; see
 * model/accounts.js → BUILT_IN_PRESETS.)
 *
 * The storage mode is decided once per mount:
 *  - 'server'      getComposerCapabilities().serverPresets is on: presets are shared with the
 *                  workspace through the presets API (docs/COMPOSER_API_CONTRACT.md §5).
 *  - 'device'      otherwise: presets live in this browser's localStorage, scoped to the person
 *                  and the workspace. Nothing is sent to SocialHub, and the UI must say so.
 *  - 'unavailable' device mode in a browser that blocks storage: presets cannot be saved.
 *
 * Every success reported here is real: a server response in server mode, a completed
 * localStorage write in device mode. Requires a react-query QueryClientProvider (always present
 * in the app) because hooks cannot be called conditionally.
 */

export const PRESET_STORAGE = Object.freeze({
  SERVER: 'server',
  DEVICE: 'device',
  UNAVAILABLE: 'unavailable',
});

export const PRESET_NAME_MAX = COMPOSER_LIMITS.PRESET_NAME_MAX;

export const PRESET_MESSAGES = Object.freeze({
  nameRequired: 'Enter a name for the preset.',
  nameTooLong: `Use ${PRESET_NAME_MAX} characters or fewer for the preset name.`,
  noAccounts: 'Select at least one account to save as a preset.',
  storageUnavailable:
    "This browser doesn't let SocialHub store data, so presets can't be saved here.",
  storageFull: "This browser's storage is full, so the preset couldn't be saved.",
  storageError: "The preset couldn't be saved in this browser.",
  removeFailed: "The preset couldn't be removed from this browser.",
  notScoped: "Presets can't be saved until your workspace has finished loading.",
});

const WRITE_FAILURES = Object.freeze({
  unavailable: PRESET_MESSAGES.storageUnavailable,
  quota: PRESET_MESSAGES.storageFull,
  error: PRESET_MESSAGES.storageError,
});

const EMPTY = Object.freeze([]);
const noop = () => {};

/** react-query key for the workspace's shared presets (server mode only). */
export const accountPresetsQueryKey = (workspaceId) => [
  'workspace',
  workspaceId,
  'composer',
  'account-presets',
];

/** Trims a preset name and collapses runs of whitespace. */
export const normalizePresetName = (name) =>
  String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const foldName = (name) => normalizePresetName(name).toLocaleLowerCase();

/**
 * Checks a new preset against the existing ones and returns the cleaned input
 * `{ name, socialAccountIds }`. Throws an Error with a people-facing message when the name is
 * empty, longer than PRESET_NAME_MAX, already used (case-insensitive), or no account is given.
 */
export function validatePresetInput(name, ids, presets = EMPTY) {
  const clean = normalizePresetName(name);
  if (!clean) throw new Error(PRESET_MESSAGES.nameRequired);
  if (clean.length > PRESET_NAME_MAX) throw new Error(PRESET_MESSAGES.nameTooLong);
  const socialAccountIds = [
    ...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0)),
  ];
  if (socialAccountIds.length === 0) throw new Error(PRESET_MESSAGES.noAccounts);
  const folded = foldName(clean);
  const taken = (presets ?? EMPTY).find((preset) => foldName(preset.name) === folded);
  if (taken) {
    throw new Error(`A preset called “${taken.name}” already exists. Choose a different name.`);
  }
  return { name: clean, socialAccountIds };
}

/** Maps one AccountPreset from the API to the hook's preset shape (null when unusable). */
function fromServer(item) {
  if (!item || item.id === undefined || item.id === null || typeof item.name !== 'string') {
    return null;
  }
  return {
    id: String(item.id),
    name: item.name,
    socialAccountIds: Array.isArray(item.socialAccountIds)
      ? item.socialAccountIds.filter((id) => id !== null && id !== undefined).map(String)
      : [],
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    createdBy:
      item.createdBy && typeof item.createdBy.name === 'string'
        ? { id: item.createdBy.id ?? null, name: item.createdBy.name }
        : null,
  };
}

function readDevice(scope, userId, workspaceId) {
  const available = isLocalStorageAvailable();
  const scoped = Boolean(userId && workspaceId);
  return {
    scope,
    available,
    presets: available && scoped ? readLocalPresets(userId, workspaceId) : EMPTY,
  };
}

/**
 * useAccountPresets({ workspaceId, userId }) →
 * {
 *   presets: [{ id, name, socialAccountIds, createdAt, createdBy? }],
 *   storage: 'server' | 'device' | 'unavailable',
 *   status: 'loading' | 'ready' | 'error',      // 'loading'/'error' only happen in server mode
 *   error: Error | null,
 *   createPreset(name, ids) → Promise<preset>,  // rejects with an Error (message is UI-ready)
 *   deletePreset(id) → Promise<void>,
 *   isMutating: boolean,
 *   retry() → void,                             // refetches the server list (no-op on device)
 * }
 */
export function useAccountPresets({ workspaceId, userId } = {}) {
  const queryClient = useQueryClient();
  const [serverMode] = useState(() => getComposerCapabilities().serverPresets);
  const scope = `${userId ?? ''}:${workspaceId ?? ''}`;
  const [device, setDevice] = useState(() =>
    serverMode ? null : readDevice(scope, userId, workspaceId),
  );
  // Another person or workspace on the same mounted page: read that scope's presets instead.
  if (!serverMode && device.scope !== scope) {
    setDevice(readDevice(scope, userId, workspaceId));
  }

  const queryKey = accountPresetsQueryKey(workspaceId);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const data = await listAccountPresets(workspaceId, { signal });
      return (Array.isArray(data?.items) ? data.items : []).map(fromServer).filter(Boolean);
    },
    enabled: serverMode && Boolean(workspaceId),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const createMutation = useMutation({
    mutationFn: (input) => createAccountPreset(workspaceId, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (presetId) => deleteAccountPreset(workspaceId, presetId),
    onSuccess: invalidate,
  });

  if (serverMode) {
    const presets = query.data ?? EMPTY;
    return {
      presets,
      storage: PRESET_STORAGE.SERVER,
      status: query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading',
      error: query.error ?? null,
      createPreset: async (name, ids) => {
        const input = validatePresetInput(name, ids, presets);
        const data = await createMutation.mutateAsync(input);
        return fromServer(data?.preset);
      },
      deletePreset: async (presetId) => {
        await deleteMutation.mutateAsync(presetId);
      },
      isMutating: createMutation.isPending || deleteMutation.isPending,
      retry: () => {
        query.refetch();
      },
    };
  }

  const scoped = Boolean(userId && workspaceId);
  const ensureWritable = () => {
    if (!device.available) throw new Error(PRESET_MESSAGES.storageUnavailable);
    if (!scoped) throw new Error(PRESET_MESSAGES.notScoped);
  };

  return {
    presets: device.presets,
    storage: device.available ? PRESET_STORAGE.DEVICE : PRESET_STORAGE.UNAVAILABLE,
    status: 'ready',
    error: null,
    createPreset: async (name, ids) => {
      ensureWritable();
      // Re-read so presets saved from another tab since mount are kept, not overwritten.
      const current = readLocalPresets(userId, workspaceId);
      const input = validatePresetInput(name, ids, current);
      const preset = {
        id: createClientId('preset'),
        name: input.name,
        socialAccountIds: input.socialAccountIds,
        createdAt: new Date().toISOString(),
      };
      const next = [...current, preset];
      const result = writeLocalPresets(userId, workspaceId, next);
      if (!result.ok) {
        if (result.reason === 'unavailable') setDevice({ scope, available: false, presets: EMPTY });
        throw new Error(WRITE_FAILURES[result.reason] ?? PRESET_MESSAGES.storageError);
      }
      setDevice({ scope, available: true, presets: next });
      return preset;
    },
    deletePreset: async (presetId) => {
      ensureWritable();
      const current = readLocalPresets(userId, workspaceId);
      const next = current.filter((preset) => preset.id !== presetId);
      if (next.length !== current.length) {
        const result = writeLocalPresets(userId, workspaceId, next);
        if (!result.ok) throw new Error(PRESET_MESSAGES.removeFailed);
      }
      setDevice({ scope, available: true, presets: next });
    },
    isMutating: false,
    retry: noop,
  };
}
