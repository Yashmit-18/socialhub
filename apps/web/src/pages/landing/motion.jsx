import { Fragment, useEffect, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { useInView, useReducedMotion } from './useMotion.js';

/**
 * Fades and lifts its children in when they scroll into view.
 * `variant`: 'up' (default), 'blur', 'scale', 'left' or 'right'.
 */
export function Reveal({
  as: Tag = 'div',
  delay = 0,
  variant = 'up',
  className,
  style,
  children,
  ...props
}) {
  const [ref, inView] = useInView();
  return (
    <Tag
      ref={ref}
      className={cn(
        'lp-reveal',
        variant !== 'up' && `lp-reveal-${variant}`,
        inView && 'is-visible',
        className,
      )}
      style={delay ? { '--lp-delay': `${delay}ms`, ...style } : style}
      {...props}
    >
      {children}
    </Tag>
  );
}

/**
 * Splits `text` into words that blur up one after another. `mode="enter"` animates on mount
 * (the hero); the default waits for a revealed parent (`.is-visible`, e.g. a <Reveal>).
 * The words stay real text separated by real spaces, so headings keep their accessible name.
 */
export function Words({ text, mode = 'reveal', delay = 0, step = 55, className }) {
  const words = text.split(' ');
  return words.map((word, i) => (
    <Fragment key={`${word}-${i}`}>
      <span
        className={cn(mode === 'enter' ? 'lp-word' : 'lp-w', className)}
        style={mode === 'enter' ? { '--lp-delay': `${delay + i * step}ms` } : { '--i': i }}
      >
        {word}
      </span>
      {i < words.length - 1 && ' '}
    </Fragment>
  ));
}

const easeOut = (t) => 1 - (1 - t) ** 3;
const grouped = new Intl.NumberFormat('en-US');

/**
 * Counts up from 0 to `value` once visible. Screen readers get the final value only.
 * `group` formats with thousands separators (128,420).
 */
export function CountUp({
  value,
  suffix = '',
  duration = 1600,
  delay = 0,
  group = false,
  className,
}) {
  const [ref, inView] = useInView({ threshold: 0.4 });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const animate = inView && !reduced && value !== 0 && typeof requestAnimationFrame !== 'undefined';
  // Without animation the final value is shown as soon as the number is in view.
  const display = animate ? shown : inView ? value : 0;
  const format = (n) => (group ? grouped.format(n) : n);

  useEffect(() => {
    if (!animate) return undefined;
    let frame;
    let start;
    const step = (now) => {
      start ??= now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setShown(Math.round(easeOut(t) * value));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animate, value, duration, delay]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">
        {format(display)}
        {suffix}
      </span>
      <span className="sr-only">
        {format(value)}
        {suffix}
      </span>
    </span>
  );
}
