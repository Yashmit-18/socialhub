/**
 * Data hooks for Facebook Group distribution (Phase 6). Every key starts with
 * groupKeys.all(workspaceId), so one invalidation refreshes the directory, shares and tasks.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queries.js';

export const groupKeys = {
  all: (ws) => ['workspace', ws, 'groups'],
  categories: (ws) => ['workspace', ws, 'groups', 'categories'],
  list: (ws, params) => ['workspace', ws, 'groups', 'list', params],
  detail: (ws, id) => ['workspace', ws, 'groups', 'detail', id],
  shares: (ws, params) => ['workspace', ws, 'groups', 'shares', params],
  share: (ws, id) => ['workspace', ws, 'groups', 'share', id],
  tasks: (ws, params) => ['workspace', ws, 'groups', 'tasks', params],
};

const base = (ws) => `/workspaces/${ws}`;
const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

export function useGroupCategories(ws) {
  return useQuery({
    queryKey: groupKeys.categories(ws),
    queryFn: () => api.get(`${base(ws)}/group-categories`).then((d) => d.items),
  });
}

/** `{ items, total, page, limit, pages, facets: { categories, tags, status } }` */
export function useFacebookGroups(ws, params = {}, { enabled = true } = {}) {
  const query = clean(params);
  return useQuery({
    queryKey: groupKeys.list(ws, query),
    queryFn: () => api.get(`${base(ws)}/facebook-groups`, { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFacebookGroup(ws, groupId) {
  return useQuery({
    queryKey: groupKeys.detail(ws, groupId),
    queryFn: () => api.get(`${base(ws)}/facebook-groups/${groupId}`),
    enabled: Boolean(groupId),
  });
}

export function useGroupShares(ws, params = {}) {
  const query = clean(params);
  return useQuery({
    queryKey: groupKeys.shares(ws, query),
    queryFn: () => api.get(`${base(ws)}/group-shares`, { query }),
    placeholderData: keepPreviousData,
  });
}

export function useGroupShare(ws, shareId) {
  return useQuery({
    queryKey: groupKeys.share(ws, shareId),
    queryFn: () => api.get(`${base(ws)}/group-shares/${shareId}`),
    enabled: Boolean(shareId),
  });
}

/** `{ items, total, page, limit, pages, counts: { open, done, skipped, total } }` */
export function useSharingTasks(ws, params = {}) {
  const query = clean(params);
  return useQuery({
    queryKey: groupKeys.tasks(ws, query),
    queryFn: () => api.get(`${base(ws)}/sharing-tasks`, { query }),
    placeholderData: keepPreviousData,
  });
}

function useGroupMutation(ws, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all(ws) }),
        queryClient.invalidateQueries({ queryKey: keys.activity(ws) }),
      ]),
  });
}

export const useCreateCategory = (ws) =>
  useGroupMutation(ws, (name) => api.post(`${base(ws)}/group-categories`, { name }));
export const useRenameCategory = (ws) =>
  useGroupMutation(ws, ({ categoryId, name }) =>
    api.patch(`${base(ws)}/group-categories/${categoryId}`, { name }),
  );
export const useDeleteCategory = (ws) =>
  useGroupMutation(ws, (categoryId) => api.delete(`${base(ws)}/group-categories/${categoryId}`));

export const useCreateGroup = (ws) =>
  useGroupMutation(ws, (body) => api.post(`${base(ws)}/facebook-groups`, body));
export const useUpdateGroup = (ws) =>
  useGroupMutation(ws, ({ groupId, ...body }) =>
    api.patch(`${base(ws)}/facebook-groups/${groupId}`, body),
  );
export const useDeleteGroup = (ws) =>
  useGroupMutation(ws, (groupId) => api.delete(`${base(ws)}/facebook-groups/${groupId}`));

/** Resolves to `{ share, created, skipped: [{ groupId, name, reason, nextShareAllowedAt? }] }`. */
export const useCreateShare = (ws) =>
  useGroupMutation(ws, (body) => api.post(`${base(ws)}/group-shares`, body));
export const useUpdateShare = (ws) =>
  useGroupMutation(ws, ({ shareId, ...body }) =>
    api.patch(`${base(ws)}/group-shares/${shareId}`, body),
  );
export const useAddShareGroups = (ws) =>
  useGroupMutation(ws, ({ shareId, ...body }) =>
    api.post(`${base(ws)}/group-shares/${shareId}/groups`, body),
  );
export const useDeleteShare = (ws) =>
  useGroupMutation(ws, (shareId) => api.delete(`${base(ws)}/group-shares/${shareId}`));

/** `{ taskId, status?, postUrl?, note?, assigneeId? }` → `{ task }` */
export const useUpdateTask = (ws) =>
  useGroupMutation(ws, ({ taskId, ...body }) =>
    api.patch(`${base(ws)}/sharing-tasks/${taskId}`, body),
  );

/** Readable reason for a group that did not get a task. */
export function skipReasonText(skip) {
  switch (skip.reason) {
    case 'ALREADY_QUEUED':
      return 'already has this share';
    case 'ARCHIVED':
      return 'archived';
    case 'TOO_SOON':
      return skip.nextShareAllowedAt
        ? `its rules allow the next share on ${new Date(skip.nextShareAllowedAt).toLocaleDateString()}`
        : 'shared there too recently';
    default:
      return skip.reason;
  }
}
