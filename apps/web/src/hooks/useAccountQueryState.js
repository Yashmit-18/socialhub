import {
  ACCOUNT_SORTS,
  CONNECTION_STATUS,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
} from '@socialhub/shared';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const STATUSES = new Set(Object.values(CONNECTION_STATUS));
const READINESS = new Set(Object.values(PUBLISHING_STATUS));
const PLATFORMS = new Set(Object.values(SOCIAL_PLATFORMS));
export const ACCOUNT_FILTER_KEYS = [
  'q',
  'platform',
  'status',
  'readiness',
  'attention',
  'connectionId',
  'workspaceId',
];

const isEmpty = (value) => value === '' || value === undefined || value === null || value === false;

/**
 * Search, filters, sort and page of an account table, kept in the URL so a filtered view
 * survives reloads and can be shared. Values that are not valid are ignored (the API
 * validates again). Changing anything but the page returns to page 1.
 *
 * `platform` fixes the platform (tab pages); without it the platform is a URL filter too.
 * `crossWorkspace` enables the workspace filter (only GET /social-accounts accepts it); without
 * it a `workspaceId` in the URL is ignored.
 * Returns `{ state, params, update(patch), clear(), active }`, where `params` is ready for
 * useAccountList()/useMyAccounts().
 */
export function useAccountQueryState({
  pageSize = 25,
  defaultSort = 'name',
  platform,
  crossWorkspace = false,
} = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const get = (key) => searchParams.get(key) ?? '';
    const page = Number.parseInt(get('page') || '1', 10);
    return {
      q: get('q').slice(0, 100),
      platform: platform ?? (PLATFORMS.has(get('platform')) ? get('platform') : ''),
      status: STATUSES.has(get('status')) ? get('status') : '',
      readiness: READINESS.has(get('readiness')) ? get('readiness') : '',
      attention: get('attention') === 'true' ? 'true' : '',
      connectionId: OBJECT_ID.test(get('connectionId')) ? get('connectionId') : '',
      workspaceId: crossWorkspace && OBJECT_ID.test(get('workspaceId')) ? get('workspaceId') : '',
      sort: ACCOUNT_SORTS.includes(get('sort')) ? get('sort') : defaultSort,
      page: Number.isFinite(page) && page > 0 ? page : 1,
    };
  }, [searchParams, defaultSort, platform, crossWorkspace]);

  const update = useCallback(
    (patch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            const isDefault =
              (key === 'sort' && value === defaultSort) || (key === 'page' && Number(value) === 1);
            if (isEmpty(value) || isDefault) next.delete(key);
            else next.set(key, String(value));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaultSort],
  );

  const clear = useCallback(
    () => update(Object.fromEntries(ACCOUNT_FILTER_KEYS.map((key) => [key, '']))),
    [update],
  );

  const params = useMemo(
    () => ({
      platform: state.platform,
      q: state.q.trim(),
      status: state.status,
      readiness: state.readiness,
      attention: state.attention,
      connectionId: state.connectionId,
      workspaceId: state.workspaceId,
      sort: state.sort,
      page: state.page,
      limit: pageSize,
    }),
    [state, pageSize],
  );

  const active = ACCOUNT_FILTER_KEYS.some((key) => state[key] && !(key === 'platform' && platform));
  return { state, params, update, clear, active };
}
