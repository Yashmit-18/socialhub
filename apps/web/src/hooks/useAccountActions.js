import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { keys } from '../lib/queries.js';

/**
 * Mutations for social account management. Each hook invalidates every cache entry that the
 * change can affect; components add their own toasts through `mutate(vars, { onSuccess })`
 * (hook-level callbacks finish first, so lists are fresh when the toast appears).
 *
 * The API is authoritative for every permission: these hooks are only called from controls
 * that the role may use, and a 403/404 from the API is surfaced as an error.
 */

/**
 * Returns `invalidate({ gone })`. Ids in `gone` (destinations or logins that were just
 * deleted) are skipped instead of refetched: a refetch would only answer 404.
 */
export function useInvalidateAccounts(workspaceId) {
  const queryClient = useQueryClient();
  return ({ gone = [] } = {}) => {
    const goneIds = new Set(gone.map(String));
    const keep = (query) =>
      !query.queryKey.some((part) => typeof part === 'string' && goneIds.has(part));
    const prefixes = [
      keys.socialAccounts(workspaceId),
      keys.socialConnections(workspaceId),
      keys.overview(workspaceId),
      keys.activity(workspaceId),
      keys.members(workspaceId),
      keys.invitations(workspaceId),
      keys.myAccounts,
    ];
    return Promise.all(
      prefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey, predicate: keep })),
    );
  };
}

const base = (workspaceId) => `/workspaces/${workspaceId}`;

/* ---------------------------------------------------------------- synchronization */

/**
 * Syncs every login of the workspace (or `connectionIds`), one after another on the server.
 * Resolves to `{ results: [...], summary: { total, succeeded, failed, skipped } }`; a login
 * that could not be contacted has `skipReason` (CONFIG_REQUIRED, IN_PROGRESS, NEEDS_RECONNECT).
 */
export function useSyncConnections(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (connectionIds) =>
      api.post(
        `${base(workspaceId)}/social-connections/sync`,
        connectionIds?.length ? { connectionIds } : {},
      ),
    onSettled: () => invalidate(),
  });
}

/**
 * Syncs one login. Resolves to `{ connection, accounts, outcome, statusChanged }`; rejects with
 * 409 META_NOT_CONFIGURED / SYNC_IN_PROGRESS / META_RECONNECT_REQUIRED or 502 META_UNAVAILABLE.
 */
export function useSyncConnection(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (connectionId) =>
      api.post(`${base(workspaceId)}/social-connections/${connectionId}/sync`),
    onSettled: () => invalidate(),
  });
}

/** Refreshes destinations by syncing each distinct parent login once. Resolves to `{ results, connections, summary }`. */
export function useRefreshAccounts(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (accountIds) =>
      api.post(`${base(workspaceId)}/social-accounts/refresh`, { accountIds }),
    onSettled: () => invalidate(),
  });
}

/** Refreshes one destination (syncs its login). Resolves to `{ result, connections }`. */
export function useRefreshAccount(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (accountId) =>
      api.post(`${base(workspaceId)}/social-accounts/${accountId}/refresh`),
    onSettled: () => invalidate(),
  });
}

/* --------------------------------------------------------- disconnect and remove */

/** Removes one destination from the workspace (its login stays connected). */
export function useRemoveAccount(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (accountId) => api.delete(`${base(workspaceId)}/social-accounts/${accountId}`),
    onSuccess: (_data, accountId) => invalidate({ gone: [accountId] }),
  });
}

/** Removes several destinations. Resolves to `{ removed }`. */
export function useRemoveAccounts(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (accountIds) =>
      api.post(`${base(workspaceId)}/social-accounts/remove`, { accountIds }),
    onSuccess: (_data, accountIds) => invalidate({ gone: accountIds }),
  });
}

/** Disconnects a login: tokens are erased, its destinations stay listed but unusable. */
export function useDisconnectConnection(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (connectionId) =>
      api.post(`${base(workspaceId)}/social-connections/${connectionId}/disconnect`),
    onSuccess: () => invalidate(),
  });
}

/** Removes a login together with every destination added through it. Resolves to `{ accountsRemoved, revokedAtMeta }`. */
export function useRemoveConnection(workspaceId) {
  const invalidate = useInvalidateAccounts(workspaceId);
  return useMutation({
    mutationFn: (connectionId) =>
      api.delete(`${base(workspaceId)}/social-connections/${connectionId}`),
    onSuccess: (_data, connectionId) => invalidate({ gone: [connectionId] }),
  });
}

/* ------------------------------------------------------------------ team access */

function useInvalidateAccess(workspaceId) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        keys.members(workspaceId),
        keys.invitations(workspaceId),
        keys.activity(workspaceId),
        keys.socialAccounts(workspaceId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/**
 * Grants or revokes one destination for several members: `{ grant: [memberId], revoke: [memberId] }`.
 * Resolves to `{ members }` (the destination's updated access list).
 */
export function useUpdateAccountMembers(workspaceId, accountId) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAccess(workspaceId);
  return useMutation({
    mutationFn: ({ grant = [], revoke = [] }) =>
      api.patch(`${base(workspaceId)}/social-accounts/${accountId}/access`, { grant, revoke }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.accountAccess(workspaceId, accountId), data.members);
      return invalidate();
    },
  });
}

/**
 * Adds or removes destinations for one member without touching the rest of their grant:
 * `{ memberId, add: [accountId], remove: [accountId] }`. Resolves to `{ member }`.
 */
export function usePatchMemberAccess(workspaceId) {
  const invalidate = useInvalidateAccess(workspaceId);
  return useMutation({
    mutationFn: ({ memberId, add = [], remove = [] }) =>
      api.patch(`${base(workspaceId)}/members/${memberId}/account-access`, { add, remove }),
    onSuccess: () => invalidate(),
  });
}

/**
 * Replaces one member's whole grant: `{ memberId, mode: 'ALL' | 'SELECTED', socialAccountIds }`.
 * Resolves to `{ member }`.
 */
export function useReplaceMemberAccess(workspaceId) {
  const invalidate = useInvalidateAccess(workspaceId);
  return useMutation({
    mutationFn: ({ memberId, mode, socialAccountIds = [] }) =>
      api.put(`${base(workspaceId)}/members/${memberId}/account-access`, {
        mode,
        socialAccountIds: mode === 'SELECTED' ? socialAccountIds : [],
      }),
    onSuccess: () => invalidate(),
  });
}
