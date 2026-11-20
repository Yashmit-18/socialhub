import { History } from 'lucide-react';
import { CONNECTION_TONE, SYNC_TRIGGER_LABELS } from '../../lib/meta.js';
import { formatDate, timeAgo } from '../../lib/utils.js';
import { SyncOutcomeBadge } from './AccountBadges.jsx';

function duration(ms) {
  if (typeof ms !== 'number') return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function countsText(accounts) {
  if (!accounts) return null;
  const parts = [`${accounts.refreshed ?? 0} refreshed`];
  if (accounts.lost) parts.push(`${accounts.lost} no longer available`);
  return parts.join(', ');
}

const statusLabel = (status) => CONNECTION_TONE[status]?.[1] ?? status;

/**
 * Synchronization history of a login (SyncRun records, newest first): what triggered each run,
 * who started it, its outcome, how many destinations were refreshed and any status change.
 * Every entry is a real attempt the server recorded; nothing is synthesized.
 */
export function SyncRunList({ runs, emptyText = 'This login has not been synchronized yet.' }) {
  if (!runs?.length) {
    return (
      <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted sm:px-6">
        <History className="h-4 w-4" aria-hidden="true" /> {emptyText}
      </p>
    );
  }
  return (
    <ol className="divide-y divide-slate-100 dark:divide-white/5">
      {runs.map((run) => {
        const details = [
          duration(run.durationMs),
          countsText(run.accounts),
          run.statusBefore && run.statusAfter && run.statusBefore !== run.statusAfter
            ? `${statusLabel(run.statusBefore)} → ${statusLabel(run.statusAfter)}`
            : null,
        ].filter(Boolean);
        return (
          <li
            key={run.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {SYNC_TRIGGER_LABELS[run.trigger] ?? run.trigger}
                {run.actorName && (
                  <span className="font-normal text-muted"> · {run.actorName}</span>
                )}
              </p>
              <p className="text-xs text-muted">
                <time
                  dateTime={run.startedAt}
                  title={formatDate(run.startedAt, { dateStyle: 'medium', timeStyle: 'medium' })}
                >
                  {timeAgo(run.startedAt)}
                </time>
                {details.length > 0 && ` · ${details.join(' · ')}`}
              </p>
              {run.error?.message && (
                <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">
                  {run.error.message}
                </p>
              )}
            </div>
            <SyncOutcomeBadge result={{ outcome: run.outcome }} />
          </li>
        );
      })}
    </ol>
  );
}
