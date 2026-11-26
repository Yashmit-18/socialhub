import { Link } from 'react-router';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { softTone } from '../../components/ui/tones.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { auditSentence } from './adminFormat.js';

/** A state in words with a dot: `state` is `[tone, words]`. The words carry the meaning. */
export function StateBadge({ state, className }) {
  const [tone, label] = state;
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}

/**
 * Label and value pairs: `items` are `{ label, value }` (value may be a node). Two columns
 * once the card itself is wide enough (a container query, so it suits a narrow side card).
 */
export function Facts({ items, className }) {
  return (
    <div className="@container">
      <dl className={cn('grid gap-x-8 gap-y-5 @[20rem]:grid-cols-2', className)}>
        {items.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-1 text-sm break-words text-slate-900 dark:text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Rows of a status card: what it is on the left, its state on the right, and what that state
 * means across the row underneath (a second `dd`). `rows` are `{ key, label, hint, value }`.
 */
export function StatusRows({ rows }) {
  return (
    <dl className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
      {rows.map(({ key, label, hint, value }) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-3.5 sm:px-6"
        >
          <dt className="pt-px text-sm font-medium text-slate-900 dark:text-white">{label}</dt>
          <dd className="min-w-0 text-right text-sm text-slate-700 dark:text-slate-200">{value}</dd>
          {hint && <dd className="col-span-2 mt-1 text-xs leading-5 text-muted">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** The impact lines of a suspension: `lines` from adminFormat.js (`sub` lines are indented). */
export function ImpactList({ lines, className }) {
  return (
    <ul className={cn('space-y-2.5 text-sm', className)}>
      {lines.map(({ key, icon: Icon, text, detail, sub }) => (
        <li key={key} className={cn('flex gap-2.5', sub && 'pl-6')}>
          <Icon
            className={cn('mt-0.5 shrink-0 text-muted', sub ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            aria-hidden="true"
          />
          <div className="min-w-0 leading-relaxed">
            <p className={cn('text-slate-700 dark:text-slate-200', sub && 'text-[13px]')}>{text}</p>
            {detail && <p className="mt-0.5 text-xs leading-5 text-muted">{detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A person in a table cell: picture, name (a link to their page), email, extra badges. */
export function PersonCell({ person, badges }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={person.name} seed={person.id} size="sm" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/admin/users/${person.id}`}
            className="truncate font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
          >
            {person.name}
          </Link>
          {badges}
        </div>
        <p className="truncate text-xs text-muted">{person.email}</p>
      </div>
    </div>
  );
}

/** A workspace in a table cell: square picture, name (a link to its page), address. */
export function WorkspaceCell({ workspace }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={workspace.name} seed={workspace.id} size="sm" square />
      <div className="min-w-0">
        <Link
          to={`/admin/workspaces/${workspace.id}`}
          className="block truncate font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
        >
          {workspace.name}
        </Link>
        <p className="truncate text-xs text-muted">/w/{workspace.slug}</p>
      </div>
    </div>
  );
}

/** The search and filter row above a list. */
export function ListToolbar({ children }) {
  return (
    <div className="flex flex-col gap-3 px-5 pt-4 pb-4 sm:px-6 lg:flex-row lg:flex-wrap lg:items-center">
      {children}
    </div>
  );
}

const RELATIVE_DAY = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const dayKey = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** Entries by calendar day in the viewer's time zone, newest first as given. */
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

function AuditRow({ entry, time, showTarget }) {
  const { icon: Icon, tone, before, after, detail, facts, email } = auditSentence(entry);
  const { actor, target } = entry;
  const targetName = target.label ?? email ?? 'an account';
  return (
    <li className="flex gap-3 px-5 py-3.5 sm:px-6">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          softTone(tone),
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            <span className="font-medium text-slate-900 dark:text-white">{actor.name}</span>{' '}
            {before}{' '}
            {showTarget ? (
              target.type === 'user' && target.id ? (
                <Link
                  to={`/admin/users/${target.id}`}
                  className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-brand-600 hover:decoration-brand-400 dark:text-white dark:decoration-white/25 dark:hover:text-brand-300"
                >
                  {targetName}
                </Link>
              ) : (
                <span className="font-medium text-slate-900 dark:text-white">{targetName}</span>
              )
            ) : (
              'this account'
            )}
            {after && ` ${after}`}
          </p>
          <time
            dateTime={entry.createdAt}
            title={formatDate(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            className="shrink-0 text-xs text-muted tabular-nums"
          >
            {time}
          </time>
        </div>
        {detail && (
          <blockquote className="mt-2 rounded-lg border-l-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700 dark:border-white/15 dark:bg-white/[0.03] dark:text-slate-200">
            <span className="font-medium text-slate-900 dark:text-white">{detail.label}:</span>{' '}
            {detail.text}
          </blockquote>
        )}
        {(facts.length > 0 || (showTarget && email)) && (
          <p className="mt-1.5 text-xs leading-5 text-muted">
            {[showTarget && email, ...facts].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Audit entries. `grouped`: day headers (`h2`, for a card without its own title) and clock
 * times, as on the workspace Activity page. Otherwise one list with relative times.
 * `showTarget` names the person each entry is about (off on that person's own page).
 */
export function AuditList({ items, grouped = false, showTarget = true }) {
  if (!grouped) {
    return (
      <ol className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
        {items.map((entry) => (
          <AuditRow
            key={entry.id}
            entry={entry}
            showTarget={showTarget}
            time={timeAgo(entry.createdAt)}
          />
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
          <ol className="divide-y divide-slate-100 dark:divide-white/5">
            {day.items.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                showTarget={showTarget}
                time={formatDate(entry.createdAt, { timeStyle: 'short' })}
              />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
