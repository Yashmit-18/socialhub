import { useEffectEvent, useLayoutEffect, useRef } from 'react';

const DEFAULT_FORMAT = new Intl.NumberFormat();

function canAnimate() {
  return (
    typeof IntersectionObserver === 'function' &&
    typeof requestAnimationFrame === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that counts up to its value the first time it scrolls into view, and glides to a
 * new value when it changes. Anything that is not a number (null for "unknown") is shown
 * through `format` as is. The text is written straight to the DOM, so counting costs no
 * re-render; without IntersectionObserver or with reduced motion the final value is shown.
 */
export function AnimatedNumber({ value, format, duration = 1400, className, ...props }) {
  const ref = useRef(null);
  const shown = useRef(null);
  const fmt = useEffectEvent((n) =>
    format ? format(n) : typeof n === 'number' ? DEFAULT_FORMAT.format(n) : String(n ?? '—'),
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const done = () => {
      el.textContent = fmt(value);
      shown.current = value;
    };

    const isNumber = typeof value === 'number' && Number.isFinite(value);
    const from = typeof shown.current === 'number' ? shown.current : 0;
    if (!isNumber || from === value || !canAnimate()) {
      done();
      return undefined;
    }

    el.textContent = fmt(from);
    let frame = 0;
    const run = () => {
      let start;
      const step = (now) => {
        start ??= now;
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 4;
        const current = from + (value - from) * eased;
        const rounded = Number.isInteger(value) ? Math.round(current) : current;
        el.textContent = fmt(rounded);
        shown.current = rounded;
        if (t < 1) frame = requestAnimationFrame(step);
        else done();
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run();
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return <span ref={ref} {...props} className={className} />;
}
