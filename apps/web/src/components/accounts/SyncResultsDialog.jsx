import { SYNC_OUTCOMES, SYNC_SKIP_REASONS } from '@socialhub/shared';
import { RefreshCw } from 'lucide-react';
import { PROVIDER_LABELS } from '../../lib/meta.js';
import { Button } from '../ui/Button.jsx';
import { Modal } from '../ui/Modal.jsx';
import { SyncOutcomeBadge } from './AccountBadges.jsx';

const RECONNECT_OUTCOMES = new Set([
  SYNC_OUTCOMES.TOKEN_EXPIRED,
  SYNC_OUTCOMES.TOKEN_REVOKED,
  SYNC_OUTCOMES.PERMISSION_DENIED,
]);

/** True when the result can only be fixed by authorizing the login again. */
const wantsReconnect = (r) =>
  r.skipReason === SYNC_SKIP_REASONS.NEEDS_RECONNECT || RECONNECT_OUTCOMES.has(r.outcome);

function countsText(accounts) {
  if (!accounts) return null;
  const parts = [];
  if (accounts.refreshed) parts.push(`${accounts.refreshed} refreshed`);
  if (accounts.lost) parts.push(`${accounts.lost} no longer available`);
  return parts.length ? parts.join(' · ') : null;
}

function summaryText(summary) {
  if (!summary) return null;
  const parts = [`${summary.succeeded} synced`];
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  return `${parts.join(' · ')} — ${summary.total} login${summary.total === 1 ? '' : 's'} in total`;
}

/**
 * Per-login results of a synchronization (`data` = POST /social-connections/sync response) or
 * of a destination refresh (`data` = POST /social-accounts/refresh response, whose per-account
 * entries are grouped under the login that was synced for them). Nothing here is simulated:
 * every line is what the server reported.
 */
export function SyncResultsDialog({
  open,
  onClose,
  title = 'Sync results',
  data,
  onReconnect,
  reconnectingId,
}) {
  const connections = data?.connections ?? data?.results ?? [];
  const accountsByConnection = new Map();
  if (data?.connections) {
    for (const r of data.results ?? []) {
      const list = accountsByConnection.get(r.connectionId) ?? [];
      list.push(r);
      accountsByConnection.set(r.connectionId, list);
    }
  }
  const orphaned = data?.connections
    ? (data.results ?? []).filter(
        (r) => !connections.some((c) => c.connectionId === r.connectionId),
      )
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={summaryText(data?.summary) ?? undefined}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {connections.length === 0 && orphaned.length === 0 ? (
        <p className="text-sm text-muted">There were no logins to synchronize.</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
          {connections.map((r) => {
            const accounts = accountsByConnection.get(r.connectionId) ?? [];
            const counts = countsText(r.accounts);
            return (
              <li key={r.connectionId} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {r.displayName ?? 'Unnamed login'}
                    </p>
                    <p className="text-xs text-muted">
                      {PROVIDER_LABELS[r.provider] ?? 'Meta'} login
                      {counts && ` · ${counts}`}
                    </p>
                  </div>
                  <SyncOutcomeBadge result={r} />
                  {onReconnect && wantsReconnect(r) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={reconnectingId === r.connectionId}
                      onClick={() => onReconnect(r)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reconnect
                    </Button>
                  )}
                </div>
                {r.message && <p className="text-xs text-muted">{r.message}</p>}
                {accounts.length > 0 && (
                  <p className="text-xs text-muted">
                    Accounts: {accounts.map((a) => a.name).join(', ')}
                  </p>
                )}
              </li>
            );
          })}
          {orphaned.map((r) => (
            <li key={r.accountId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</p>
                <SyncOutcomeBadge result={r} />
              </div>
              {r.message && <p className="text-xs text-muted">{r.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
