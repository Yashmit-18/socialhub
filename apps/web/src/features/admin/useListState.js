import { ADMIN_LIMITS, ADMIN_SORTS } from '@socialhub/shared';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const DEFAULT_SORT = ADMIN_SORTS[0];

/**
 * Search, one filter, sort and page of an admin list, kept in the address so a filtered view
 * survives a reload and can be linked to (the overview links to `?status=DISABLED`). Values
 * that are not allowed are ignored; defaults are left out of the address; changing anything
 * but the page goes back to page 1. Returns `{ state, params, update, clear, filtered }`, where
 * `params` is ready for the list hook.
 */
export function useListState(filterKey, allowed) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const get = (key) => searchParams.get(key) ?? '';
    const page = Number.parseInt(get('page') || '1', 10);
    const filter = get(filterKey);
    return {
      q: get('q').slice(0, ADMIN_LIMITS.SEARCH_MAX),
      filter: allowed.includes(filter) ? filter : '',
      sort: ADMIN_SORTS.includes(get('sort')) ? get('sort') : DEFAULT_SORT,
      page: Number.isFinite(page) && page > 0 ? page : 1,
    };
  }, [searchParams, filterKey, allowed]);

  const update = useCallback(
    (patch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [name, value] of Object.entries(patch)) {
            const key = name === 'filter' ? filterKey : name;
            const isDefault =
              value === '' ||
              (name === 'sort' && value === DEFAULT_SORT) ||
              (name === 'page' && Number(value) === 1);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, filterKey],
  );

  const clear = useCallback(() => update({ q: '', filter: '' }), [update]);

  const params = {
    q: state.q.trim(),
    [filterKey]: state.filter,
    sort: state.sort === DEFAULT_SORT ? undefined : state.sort,
    page: state.page > 1 ? state.page : undefined,
  };

  return { state, params, update, clear, filtered: Boolean(state.q.trim() || state.filter) };
}
