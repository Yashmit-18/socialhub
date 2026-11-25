import { useLayoutEffect } from 'react';

/**
 * Moves an indicator element (a pill or an underline) onto the active link inside a
 * container, and slides it there when `key` (usually the pathname) changes. The active link
 * is `[aria-current="page"]`, which NavLink sets. Styles are written straight to the DOM, so
 * this costs no re-render; the first placement is not animated (the indicator gets
 * `data-ready` one frame later, and its transition classes should depend on it).
 *
 * `axis` is 'y' for a vertical list (moves and sizes on height) or 'x' for tabs.
 */
export function useActiveIndicator(containerRef, indicatorRef, key, axis = 'y') {
  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return undefined;
    const place = () => {
      const link = container.querySelector('a[aria-current="page"]');
      if (!link) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      if (axis === 'x') {
        indicator.style.transform = `translateX(${link.offsetLeft}px)`;
        indicator.style.width = `${link.offsetWidth}px`;
      } else {
        indicator.style.transform = `translateY(${link.offsetTop}px)`;
        indicator.style.height = `${link.offsetHeight}px`;
      }
    };
    place();
    const frame = requestAnimationFrame(() => indicator.setAttribute('data-ready', ''));
    // Web fonts and late-arriving counts change link sizes after the first placement.
    document.fonts?.ready?.then(place).catch(() => {});
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
    // Links change size when their counts arrive, without the container changing size.
    observer?.observe(container);
    container.querySelectorAll('a').forEach((link) => observer?.observe(link));
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [containerRef, indicatorRef, key, axis]);
}
