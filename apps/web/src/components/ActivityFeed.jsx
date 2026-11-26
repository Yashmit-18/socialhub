import { describeActivity, TONE_CLASSES } from '../lib/activity.js';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

const RELATIVE_DAY = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const dayKey = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/**
 * Entries split by calendar day in the viewer's time zone (the zone of the time tooltips), in
 * the order given: "Today", "Yesterday", then the full date. Entries from a later page that
 * fall on a day already shown join that day.
 */
function groupByDay(items, now = new Date()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days = new Map();
  for (const entry of items) {
    const date = new Date(entry.createdAt);
    const key = dayKey(date);
    if (!days.has(key)) {
      const label =
        key === today
          ? capitalise(RELATIVE_DAY.format(0, 'day'))
          : key === yesterday
            ? capitalise(RELATIVE_DAY.format(-1, 'day'))
            : formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      days.set(key, { key, label, items: [] });
    }
    days.get(key).items.push(entry);
  }
  return [...days.values()];
}

/**
 * One entry: who did what on the left, when on the right once the list is wide enough (a
 * container query, so it also behaves in a narrow side card); below that the time goes under
 * the sentence. `time` replaces the relative time; the full date stays in the title.
 */
function Row({ entry, compact, time, className }) {
  const { icon: Icon, tone, actor, text } = describeActivity(entry);
  return (
    <li className={cn('flex gap-3', className)}>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          TONE_CLASSES[tone],
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-1 @[32rem]:flex @[32rem]:items-baseline @[32rem]:justify-between @[32rem]:gap-4">
        <p
          className={cn(
            'text-sm leading-6 text-slate-600 dark:text-slate-300',
            compact && 'line-clamp-2',
          )}
        >
          <span className="font-medium text-slate-900 dark:text-white">{actor}</span> {text}
        </p>
        <time
          dateTime={entry.createdAt}
          title={formatDate(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          className="block shrink-0 text-xs text-muted tabular-nums"
        >
          {time ?? timeAgo(entry.createdAt)}
        </time>
      </div>
    </li>
  );
}

/**
 * A list of activity entries. `grouped` is the audit-log layout: day headers (`h2`, for a card
 * without its own title) and clock times, with rows carrying the card's side padding.
 */
export function ActivityFeed({ items, compact = false, grouped = false }) {
  if (!grouped) {
    return (
      <ol className="space-y-0.5 @container">
        {items.map((entry) => (
          <Row key={entry.id} entry={entry} compact={compact} className="py-2" />
        ))}
      </ol>
    );
  }

  return (
    <div>
      {groupByDay(items).map((day, index) => (
        <div key={day.key}>
          <h2
            className={cn(
              'border-y border-slate-100 bg-slate-50/60 px-5 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase sm:px-6 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400',
              index === 0 && 'rounded-t-xl border-t-0',
            )}
          >
            {day.label}
          </h2>
          <ol className="divide-y divide-slate-100 @container dark:divide-white/5">
            {day.items.map((entry) => (
              <Row
                key={entry.id}
                entry={entry}
                compact={compact}
                className="px-5 py-3 sm:px-6"
                time={formatDate(entry.createdAt, { timeStyle: 'short' })}
              />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
