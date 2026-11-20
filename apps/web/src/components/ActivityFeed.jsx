import { describeActivity, TONE_CLASSES } from '../lib/activity.js';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

export function ActivityFeed({ items, compact = false }) {
  return (
    <ol className="relative space-y-1">
      {items.map((entry, index) => {
        const { icon: Icon, tone, actor, text } = describeActivity(entry);
        const last = index === items.length - 1;
        return (
          <li key={entry.id} className="relative flex gap-3.5 py-2.5">
            {!last && (
              <span
                className="absolute left-[17px] top-11 bottom-0 w-px bg-slate-200 dark:bg-white/10"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                TONE_CLASSES[tone],
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={cn(
                  'text-sm leading-snug text-slate-600 dark:text-slate-300',
                  compact && 'line-clamp-2',
                )}
              >
                <span className="font-medium text-slate-900 dark:text-white">{actor}</span> {text}
              </p>
              <time
                dateTime={entry.createdAt}
                title={formatDate(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                className="mt-0.5 block text-xs text-muted"
              >
                {timeAgo(entry.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
