/**
 * Data hooks for the Analytics screen. Every figure shown comes from these API calls: nothing
 * is computed from made-up data, and a metric the API returns as null stays "unavailable".
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

const base = (workspaceId) => `/workspaces/${workspaceId}/analytics`;

// Every key starts with analyticsKeys.all(id): invalidate that prefix to refresh the screen.
export const analyticsKeys = {
  all: (id) => ['workspace', id, 'analytics'],
  view: (id, name, params) => ['workspace', id, 'analytics', name, params],
};

/** Drops empty values so equal filters share one cache entry. */
export function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

function useAnalyticsView(workspaceId, name, params, { enabled = true } = {}) {
  const query = cleanParams(params);
  return useQuery({
    queryKey: analyticsKeys.view(workspaceId, name, query),
    queryFn: () => api.get(`${base(workspaceId)}/${name}`, { query }),
    placeholderData: keepPreviousData,
    enabled: enabled && Boolean(workspaceId),
  });
}

export const useAnalyticsOverview = (id, params, opts) =>
  useAnalyticsView(id, 'overview', params, opts);
export const useAnalyticsTrends = (id, params, opts) =>
  useAnalyticsView(id, 'trends', params, opts);
export const useAnalyticsAccounts = (id, params, opts) =>
  useAnalyticsView(id, 'accounts', params, opts);
export const useTopPosts = (id, params, opts) => useAnalyticsView(id, 'top-posts', params, opts);
export const usePostsPage = (id, params, opts) => useAnalyticsView(id, 'posts', params, opts);

/** Sync status, refreshed every 5 s while a sync is on its way. */
export function useSyncStatus(workspaceId, params, { enabled = true } = {}) {
  const query = cleanParams(params);
  return useQuery({
    queryKey: analyticsKeys.view(workspaceId, 'sync-status', query),
    queryFn: () => api.get(`${base(workspaceId)}/sync-status`, { query }),
    refetchInterval: (q) => (q.state.data?.items?.some((item) => item.active) ? 5_000 : false),
    enabled: enabled && Boolean(workspaceId),
  });
}

/** `mutate({ accountIds? })` → `{ source, simulated, queued, alreadyRunning, skipped }` */
export function useRequestSync(workspaceId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountIds } = {}) =>
      api.post(`${base(workspaceId)}/sync`, accountIds?.length ? { accountIds } : {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: analyticsKeys.all(workspaceId) }),
  });
}

export const exportPath = (workspaceId) => `${base(workspaceId)}/export`;
