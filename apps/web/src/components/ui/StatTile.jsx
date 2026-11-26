import { Link } from 'react-router';
import { cn } from '../../lib/utils.js';
import { AnimatedNumber } from './AnimatedNumber.jsx';
import { Card } from './Card.jsx';
import { Skeleton } from './Feedback.jsx';
import { softTone } from './tones.js';

const NUMBER = new Intl.NumberFormat();

const VARIANTS = {
  // A tile of its own on the page.
  card: 'surface p-4 sm:p-5',
  // A tile inside a card.
  inset: 'rounded-xl border border-slate-200 p-3.5 sm:p-4 dark:border-white/10',
  // A cell of a StatGrid (the grid draws the hairlines).
  cell: 'bg-white px-4 py-4 sm:px-5 dark:bg-slate-900',
};

const LINKED = {
  card: 'surface-hover',
  inset:
    'transition-colors hover:border-slate-300 hover:bg-slate-50/70 dark:hover:border-white/20 dark:hover:bg-white/[0.03]',
  cell: 'transition-colors hover:bg-slate-50 focus-visible:-outline-offset-2 dark:hover:bg-slate-800/60',
};

const EMPHASIS = {
  danger: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-700 dark:text-amber-300',
};

const SIZES = {
  sm: 'text-xl leading-7',
  md: 'text-2xl leading-8',
};

/**
 * One figure with its label. `value` is a number (formatted by `format`, counting up unless
 * `animate` is false), a string already formatted ("75%", "Unavailable"), or null/undefined
 * for unknown, which prints `unknown` (a dash) in the quiet style, never 0. `quiet` forces the
 * quiet style for a string such as "Unavailable". `emphasis` ('danger' | 'warning') colours a
 * figure that is itself a problem count. `to` makes the whole tile a link.
 */
export function StatTile({
  label,
  value,
  format,
  hint,
  icon: Icon,
  tone = 'neutral',
  emphasis,
  quiet = false,
  unknown = '—',
  animate = true,
  loading = false,
  to,
  variant = 'card',
  size = 'md',
  className,
}) {
  const missing = value === null || value === undefined;
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const soft = missing || quiet;
  const shown = missing ? unknown : isNumber && !animate ? (format ?? NUMBER.format)(value) : value;

  const body = (
    <>
      {Icon && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-3.5 right-3.5 flex h-8 w-8 items-center justify-center rounded-lg sm:top-4 sm:right-4',
            softTone(tone),
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <p
        className={cn(
          'text-[13px] leading-5 font-medium text-slate-600 dark:text-slate-400',
          Icon && 'pr-10',
        )}
      >
        {label}
      </p>
      {loading ? (
        <Skeleton className={cn('mt-2', size === 'sm' ? 'h-6 w-12' : 'h-7 w-14')} />
      ) : (
        <p
          className={cn(
            'mt-1 font-semibold tracking-tight break-words tabular-nums',
            // Unknown keeps the figure's line height, so tiles in a row share one baseline.
            soft
              ? cn(
                  'text-base font-medium text-slate-500 dark:text-slate-400',
                  size === 'sm' ? 'leading-7' : 'leading-8',
                )
              : cn(SIZES[size], EMPHASIS[emphasis] ?? 'text-slate-900 dark:text-white'),
          )}
        >
          {isNumber && animate && !soft ? <AnimatedNumber value={value} format={format} /> : shown}
        </p>
      )}
      {hint && !loading && (
        <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </>
  );

  const classes = cn('relative block min-w-0', VARIANTS[variant], to && LINKED[variant], className);
  return to ? (
    <Link to={to} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

const COLUMNS = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

/**
 * Several figures in one card, divided by hairlines: give each StatTile `variant="cell"`.
 * `label` names the card (a region) for screen readers. Fill whole rows (2, 4, 6 or 8 tiles
 * with 4 columns) so no empty cell shows.
 */
export function StatGrid({ label, columns = 4, className, children }) {
  return (
    <Card aria-label={label} className={cn('overflow-hidden', className)}>
      <div className={cn('grid gap-px bg-slate-100 dark:bg-white/[0.06]', COLUMNS[columns])}>
        {children}
      </div>
    </Card>
  );
}
