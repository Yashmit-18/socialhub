import { AtSign, CircleAlert, Hash } from 'lucide-react';
import { cn } from '../../../../lib/utils.js';
import { platformLabel } from '../../constants/platformRules.js';
import { PlatformGlyph } from '../shared/PlatformIcon.jsx';

/** Share of the limit at which a counter turns amber. */
const NEAR_LIMIT = 0.9;

const num = (n) => n.toLocaleString('en-US');
const amount = (n, unit) => `${num(n)} ${n === 1 ? unit : `${unit}s`}`;

const TONES = {
  ok: 'text-slate-500 dark:text-slate-400',
  near: 'text-amber-600 dark:text-amber-400',
  over: 'text-rose-600 dark:text-rose-400',
};

const RING_TONES = {
  ok: 'text-brand-500 dark:text-brand-400',
  near: 'text-amber-500 dark:text-amber-400',
  over: 'text-rose-500',
};

function usageState(count, max) {
  if (max === null) return 'ok';
  if (count > max) return 'over';
  return count >= max * NEAR_LIMIT ? 'near' : 'ok';
}

function UsageRing({ ratio, className }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, ratio)) * circumference;
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('h-3.5 w-3.5 shrink-0 -rotate-90', className)}
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        strokeWidth="2"
        className="stroke-slate-200 dark:stroke-white/10"
      />
      {filled > 0 && (
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="transition-[stroke-dasharray] duration-200"
        />
      )}
    </svg>
  );
}

/**
 * A usage counter: visible "Instagram 1,980/2,200" (amber from 90% of `max`, rose with an icon
 * when over), and a screen-reader sentence "Instagram: 220 characters left" /
 * "Instagram: 15 characters over the limit". With `max` null it shows just the count.
 *
 * Props:
 *  - count: number
 *  - max: number | null — the limit (from PLATFORM_RULES; never hard-coded by callers)
 *  - label: visible label (string or node). Also used in the spoken text when it is a string.
 *  - srLabel: spoken label, when it differs from the visible one (e.g. the label is an icon)
 *  - unit: 'character' (default) | 'hashtag' | 'mention' …, pluralised with "s"
 *  - icon: optional lucide icon shown before the numbers
 *  - showRing: show the progress ring (default true when there is a limit)
 *  - id: element id, so a textarea can reference the counter with aria-describedby
 *
 * The root carries `data-state="ok" | "near" | "over"`.
 */
export function CharacterCount({
  count,
  max = null,
  label,
  srLabel,
  unit = 'character',
  icon: Icon,
  showRing = true,
  id,
  className,
}) {
  const value = Math.max(0, Math.trunc(Number(count) || 0));
  const limit = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : null;
  const state = usageState(value, limit);
  const spokenName = srLabel ?? (typeof label === 'string' ? label : null);
  const lead = spokenName ? `${spokenName}: ` : '';

  let spoken;
  if (limit === null) spoken = `${lead}${amount(value, unit)}`;
  else if (state === 'over') spoken = `${lead}${amount(value - limit, unit)} over the limit`;
  else spoken = `${lead}${amount(limit - value, unit)} left`;

  let shown;
  if (limit !== null) shown = `${num(value)}/${num(limit)}`;
  else shown = label || Icon ? num(value) : amount(value, unit);

  return (
    <span
      id={id}
      data-state={state}
      className={cn(
        'inline-flex min-w-0 items-center text-xs tabular-nums transition-colors',
        TONES[state],
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {state === 'over' ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        ) : (
          limit !== null &&
          showRing && <UsageRing ratio={value / limit} className={RING_TONES[state]} />
        )}
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        {label && <span className="font-medium">{label}</span>}
        <span className={state === 'over' ? 'font-semibold' : undefined}>{shown}</span>
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/** PlatformGlyph at text size (14px, decorative). */
export function InlinePlatformGlyph({ platform, className }) {
  return <PlatformGlyph platform={platform} className={cn('h-3.5 w-3.5', className)} />;
}

const UNIT_ICONS = { hashtag: Hash, mention: AtSign };

/**
 * One platform's limits as a compact chip: the platform mark and name, then a counter per item.
 * The visible name is decorative for screen readers: every counter already speaks it
 * ("Instagram: 220 characters left", "Instagram: 27 hashtags left").
 *
 * Props:
 *  - platform: SOCIAL_PLATFORMS value
 *  - items: [{ id, unit: 'character'|'hashtag'|'mention', count, max }] — build `max` from
 *    PLATFORM_RULES; items without a limit show a plain count.
 */
export function PlatformCounts({ platform, items, className }) {
  const label = platformLabel(platform);
  return (
    <span
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg bg-white px-2 py-1 ring-1 ring-slate-200/80 ring-inset dark:bg-white/[0.04] dark:ring-white/10',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
      >
        <InlinePlatformGlyph platform={platform} />
        {label}
      </span>
      {items.map((item) => (
        <CharacterCount
          key={item.id}
          id={item.id}
          count={item.count}
          max={item.max}
          unit={item.unit}
          srLabel={label}
          icon={UNIT_ICONS[item.unit]}
          showRing={!UNIT_ICONS[item.unit]}
        />
      ))}
    </span>
  );
}
