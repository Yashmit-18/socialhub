import { cn } from '../../lib/utils.js';

/**
 * A thin part-to-whole bar: `parts` are `{ key, label, value, className }`, each a solid colour
 * (a swatch class from charts/palette.js, never a gradient). A part at 0 draws nothing. With
 * `total`, the parts fill that share of the track and the rest stays grey (a meter); without
 * it the parts fill the bar. Nothing to show: an empty track, hidden from screen readers.
 * The caller writes `label` (every part with its share) and puts the figures, each with a
 * matching swatch, next to the bar: that is its legend. Other props (data-testid) pass through.
 */
export function SplitBar({ parts, label, total, size = 'sm', className, ...rest }) {
  const sum = parts.reduce((acc, part) => acc + Math.max(0, part.value ?? 0), 0);
  const height = size === 'md' ? 'h-2.5' : 'h-2';
  if (sum <= 0) {
    return (
      <div
        aria-hidden="true"
        className={cn('rounded-full bg-slate-100 dark:bg-white/[0.06]', height, className)}
      />
    );
  }
  const whole = total && total > sum ? total : sum;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'flex w-full gap-0.5 rounded-full',
        total && 'bg-slate-100 dark:bg-white/[0.06]',
        height,
        className,
      )}
      {...rest}
    >
      {parts
        .filter((part) => part.value > 0)
        .map((part) => (
          <span
            key={part.key}
            title={part.label}
            className={cn(
              'h-full min-w-1.5 origin-left animate-bar-grow rounded-full',
              part.className,
            )}
            style={{ flex: `${part.value} 1 0%` }}
          />
        ))}
      {whole > sum && <span aria-hidden="true" style={{ flex: `${whole - sum} 1 0%` }} />}
    </div>
  );
}
