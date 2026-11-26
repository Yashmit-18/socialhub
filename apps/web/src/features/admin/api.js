/**
 * Data hooks of the operator console (/api/v1/admin). Every key starts with adminKeys.all, so
 * one invalidation refreshes the whole console; signing out clears the cache anyway.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../../lib/api.js';

export const adminKeys = {
  all: ['admin'],
  overview: ['admin', 'overview'],
  users: (params) => ['admin', 'users', 'list', params],
  user: (id) => ['admin', 'users', 'detail', id],
  workspaces: (params) => ['admin', 'workspaces', 'list', params],
  workspace: (id) => ['admin', 'workspaces', 'detail', id],
  system: ['admin', 'system'],
  audit: (params) => ['admin', 'audit', params],
};

// Equal filters share a cache entry, and defaults do not travel.
const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

export function useAdminOverview() {
  return useQuery({ queryKey: adminKeys.overview, queryFn: () => api.get('/admin/overview') });
}

/** `{ items, total, page, limit, pages, facets: { status } }` */
export function useAdminUsers(params) {
  const query = clean(params);
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () => api.get('/admin/users', { query }),
    placeholderData: keepPreviousData,
  });
}

/** `{ user, memberships, membershipsTruncated, impact, actions }`. `fresh` reads it again on mount. */
export function useAdminUser(userId, { fresh = false } = {}) {
  return useQuery({
    queryKey: adminKeys.user(userId),
    queryFn: () => api.get(`/admin/users/${userId}`),
    enabled: Boolean(userId),
    staleTime: fresh ? 0 : 30_000,
  });
}

export function useAdminWorkspaces(params) {
  const query = clean(params);
  return useQuery({
    queryKey: adminKeys.workspaces(query),
    queryFn: () => api.get('/admin/workspaces', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminWorkspace(workspaceId) {
  return useQuery({
    queryKey: adminKeys.workspace(workspaceId),
    queryFn: () => api.get(`/admin/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
}

/** Read again every 30 s while the page is open, like the publishing status. */
export function useAdminSystem() {
  return useQuery({
    queryKey: adminKeys.system,
    queryFn: () => api.get('/admin/system'),
    refetchInterval: 30_000,
  });
}

/** Newest first, a page at a time (`cursor` is the `nextCursor` of the page before). */
export function useAdminAudit(params) {
  const query = clean(params);
  return useInfiniteQuery({
    queryKey: adminKeys.audit(query),
    queryFn: ({ pageParam }) =>
      api.get('/admin/audit-log', { query: { ...query, cursor: pageParam } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Both actions refresh the console when they succeed, and also when the server refuses them
 * (409: someone else changed the account first), so the page shows the account as it is.
 */
function useAdminAction(action, body) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...values }) =>
      api.post(`/admin/users/${userId}/${action}`, body(values)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    onError: (error) => {
      if (error?.status === 409) queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

export const useSuspendUser = () =>
  useAdminAction('suspend', ({ reason, password }) => ({ reason, password }));

export const useReactivateUser = () =>
  useAdminAction('reactivate', ({ note, password }) => ({
    ...(note?.trim() ? { note: note.trim() } : {}),
    password,
  }));
