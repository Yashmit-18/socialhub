import { useEffect, useState } from 'react';
import { timeAgo } from '../../../lib/utils.js';

/** How often relative times such as "2 minutes ago" refresh. */
export const NOW_INTERVAL_MS = 30_000;

/**
 * The current time (ms timestamp) as state, refreshed every `intervalMs` and whenever the tab
 * becomes visible again (background tabs throttle timers). Components use it to show relative
 * times without calling Date.now() during render.
 */
export function useNow(intervalMs = NOW_INTERVAL_MS) {
  const [now, setNow] = useState(() => Date.now());
  const period = Math.max(1000, Number(intervalMs) || NOW_INTERVAL_MS);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, period);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [period]);

  return now;
}

/**
 * "just now", "5 minutes ago", "yesterday"… for a date (ISO string or ms timestamp).
 * `now` from useNow can lag a fresh save by up to one interval, so it is clamped to the date:
 * the result never reads "in 20 seconds". Returns null for a missing or invalid date.
 */
export function relativeTime(value, now) {
  if (value === null || value === undefined || value === '') return null;
  const at = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return timeAgo(at, Math.max(Number(now) || at, at));
}
