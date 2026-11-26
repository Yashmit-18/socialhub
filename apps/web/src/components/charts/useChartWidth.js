import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The width of a chart's box, kept up to date with a ResizeObserver. Without one (jsdom, old
 * browsers) the chart is drawn at `fallback` px, so nothing may depend on measuring text.
 */
export function useChartWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () =>
      setWidth(Math.max(240, Math.round(node.getBoundingClientRect().width) || fallback));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}
