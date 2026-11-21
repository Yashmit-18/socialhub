import { QueryClient, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Retry only transient failures; 4xx answers are final.
      retry: (count, error) => (error?.status === 0 || error?.status >= 500) && count < 2,
    },
  },
});

export const keys = {
  workspaces: ['workspaces'],
  workspace: (id) => ['workspace', id],
  overview: (id) => ['workspace', id, 'overview'],
  members: (id) => ['workspace', id, 'members'],
  invitations: (id) => ['workspace', id, 'invitations'],
  activity: (id) => ['workspace', id, 'activity'],
  // Every account-management key below starts with socialAccounts(id) or socialConnections(id),
  // so invalidating those two prefixes refreshes all destination and login data at once.
  socialAccounts: (id) => ['workspace', id, 'social-accounts'],
  accountList: (id, params) => ['workspace', id, 'social-accounts', 'list', params],
  accountSummary: (id) => ['workspace', id, 'social-accounts', 'summary'],
  accountDetail: (id, accountId) => ['workspace', id, 'social-accounts', 'detail', accountId],
  accountAccess: (id, accountId) => ['workspace', id, 'social-accounts', 'access', accountId],
  accountLabels: (id) => ['workspace', id, 'social-accounts', 'labels'],
  socialConnections: (id) => ['workspace', id, 'social-connections'],
  connectionDetail: (id, connectionId) => [
    'workspace',
    id,
    'social-connections',
    'detail',
    connectionId,
  ],
  syncRuns: (id, connectionId) => [
    'workspace',
    id,
    'social-connections',
    'sync-runs',
    connectionId,
  ],
  discovery: (id, connectionId) => ['workspace', id, 'discovery', connectionId],
  // Cross-workspace (every workspace the user belongs to).
  myAccounts: ['me', 'social-accounts'],
  myAccountList: (params) => ['me', 'social-accounts', 'list', params],
  myAccountSummary: ['me', 'social-accounts', 'summary'],
  metaIntegration: ['integrations', 'meta'],
};

/** Drops empty values so equal filters share one cache entry and one URL. */
function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

export function useMetaIntegration() {
  return useQuery({
    queryKey: keys.metaIntegration,
    queryFn: () => api.get('/integrations/meta'),
    staleTime: 5 * 60_000,
  });
}

/** Live discovery from Meta — never cached for long, since it reflects current Page roles. */
export function useDiscovery(workspaceId, connectionId) {
  return useQuery({
    queryKey: keys.discovery(workspaceId, connectionId),
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/social-connections/${connectionId}/discovery`),
    staleTime: 0,
    retry: false,
  });
}

export function useWorkspaces(options = {}) {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: () => api.get('/workspaces').then((d) => d.items),
    ...options,
  });
}

export function useOverview(workspaceId) {
  return useQuery({
    queryKey: keys.overview(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/overview`),
  });
}

export function useMembers(workspaceId) {
  return useQuery({
    queryKey: keys.members(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/members`).then((d) => d.items),
  });
}

export function useInvitations(workspaceId, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.invitations(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/invitations`).then((d) => d.items),
    enabled,
  });
}

export function useSocialAccounts(workspaceId) {
  return useQuery({
    queryKey: keys.socialAccounts(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-accounts`).then((d) => d.items),
  });
}

export function useSocialConnections(workspaceId, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.socialConnections(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-connections`).then((d) => d.items),
    enabled,
  });
}

/* ------------------------------------------------------- account management (Phase 3) */

/**
 * Searchable, filterable, paginated destinations of a workspace (only those the member may
 * access). Returns the full response: `{ items, total, page, limit, pages, facets, truncated }`.
 */
export function useAccountList(workspaceId, params = {}, { enabled = true } = {}) {
  const query = cleanParams(params);
  return useQuery({
    queryKey: keys.accountList(workspaceId, query),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-accounts`, { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Dashboard figures: `{ accounts, connections (null unless the member manages logins), meta }`. */
export function useAccountSummary(workspaceId) {
  return useQuery({
    queryKey: keys.accountSummary(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-accounts/summary`),
  });
}

/**
 * Workspace labels with how many of the member's accounts carry each:
 * `{ items: [{ id, name, color, accountCount }], limit }`.
 */
export function useAccountLabels(workspaceId, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.accountLabels(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/account-labels`),
    enabled: enabled && Boolean(workspaceId),
  });
}

/** One destination with its login, linked accounts, permissions, history and team access. */
export function useAccountDetail(workspaceId, accountId) {
  return useQuery({
    queryKey: keys.accountDetail(workspaceId, accountId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-accounts/${accountId}`),
    enabled: Boolean(accountId),
  });
}

/** Which members can use a destination (members:manage only). Returns the members array. */
export function useAccountAccess(workspaceId, accountId, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.accountAccess(workspaceId, accountId),
    queryFn: () =>
      api
        .get(`/workspaces/${workspaceId}/social-accounts/${accountId}/access`)
        .then((d) => d.members),
    enabled: enabled && Boolean(accountId),
  });
}

/** One login (connection) with its destinations, permissions, sync history and activity. */
export function useConnectionDetail(workspaceId, connectionId, { enabled = true } = {}) {
  return useQuery({
    queryKey: keys.connectionDetail(workspaceId, connectionId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/social-connections/${connectionId}`),
    enabled: enabled && Boolean(connectionId),
  });
}

/** Full synchronization history of a login, newest first, 20 per page. */
export function useSyncRuns(workspaceId, connectionId, { enabled = true } = {}) {
  return useInfiniteQuery({
    queryKey: keys.syncRuns(workspaceId, connectionId),
    queryFn: ({ pageParam }) =>
      api.get(`/workspaces/${workspaceId}/social-connections/${connectionId}/sync-runs`, {
        query: { limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && Boolean(connectionId),
  });
}

/** Destinations across every workspace the user belongs to (read-only; items carry `workspace`). */
export function useMyAccounts(params = {}, { enabled = true } = {}) {
  const query = cleanParams(params);
  return useQuery({
    queryKey: keys.myAccountList(query),
    queryFn: () => api.get('/social-accounts', { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Summary across every workspace the user belongs to (adds `workspaces`). */
export function useMyAccountSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: keys.myAccountSummary,
    queryFn: () => api.get('/social-accounts/summary'),
    enabled,
  });
}

export function useActivity(workspaceId, { enabled = true } = {}) {
  return useInfiniteQuery({
    queryKey: keys.activity(workspaceId),
    queryFn: ({ pageParam }) =>
      api.get(`/workspaces/${workspaceId}/activity`, { query: { limit: 25, cursor: pageParam } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}
