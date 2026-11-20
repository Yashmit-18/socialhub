import { useCallback, useEffect } from 'react';
import { useBlocker } from 'react-router';

/**
 * Warns before work that isn't saved anywhere is lost.
 *
 * While `when` is true:
 *  - closing or reloading the tab triggers the browser's own "Leave site?" prompt
 *    (`beforeunload`; browsers show their own wording), and
 *  - in-app navigation to another page is held by React Router's `useBlocker`, so the page can
 *    ask first — render <UnsavedChangesDialog blocker={blocker} /> to do that.
 *
 * Navigation that stays on the same path (search or hash changes, e.g. ?draft=…) is not
 * blocked. Requires a data router (createBrowserRouter / createMemoryRouter).
 *
 * Returns { blocker } — React Router's Blocker: state 'unblocked' | 'blocked' | 'proceeding',
 * with proceed() / reset() while blocked.
 */
export function useUnsavedChangesGuard({ when }) {
  const active = Boolean(when);

  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
    [active],
  );
  const blocker = useBlocker(shouldBlock);

  return { blocker };
}
