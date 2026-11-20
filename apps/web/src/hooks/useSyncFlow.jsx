import { ERROR_CODES, SYNC_OUTCOMES, SYNC_SKIP_REASONS } from '@socialhub/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { SyncResultsDialog } from '../components/accounts/SyncResultsDialog.jsx';
import {
  useRefreshAccount,
  useRefreshAccounts,
  useSyncConnection,
  useSyncConnections,
} from './useAccountActions.js';
import { useStartAuthorization } from './useStartAuthorization.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function syncErrorToast(err) {
  // A sync whose login was disconnected, reconnected or removed meanwhile wrote nothing.
  if (err?.code === ERROR_CODES.SYNC_IN_PROGRESS || err?.details?.superseded)
    toast.info(err.message);
  else toast.error(err?.message ?? 'Synchronization failed');
}

function summaryToast(summary) {
  if (!summary || summary.total === 0) {
    toast.info('There are no logins to synchronize.');
  } else if (summary.succeeded === summary.total) {
    toast.success(`${plural(summary.total, 'login')} synced`);
  } else if (summary.succeeded > 0) {
    toast.warning(
      `${summary.succeeded} of ${plural(summary.total, 'login')} synced — see the results`,
    );
  } else {
    toast.warning('No login could be synced — see the results');
  }
}

/**
 * One place for every "Sync now" / "Refresh" control, so outcomes are reported the same way
 * everywhere: a toast for single logins, and a results dialog (per login, with Reconnect where
 * that is the fix) for bulk operations. Results always come from the server; when Meta is not
 * configured the server answers META_NOT_CONFIGURED / CONFIG_REQUIRED and that is what is shown.
 *
 * Render `dialog` once in the page.
 */
export function useSyncFlow(workspaceId) {
  const [results, setResults] = useState(null);
  const syncAll = useSyncConnections(workspaceId);
  const syncOne = useSyncConnection(workspaceId);
  const refreshMany = useRefreshAccounts(workspaceId);
  const refreshOne = useRefreshAccount(workspaceId);
  const start = useStartAuthorization(workspaceId);

  const reconnect = ({ provider, connectionId }) => start.mutate({ provider, connectionId });

  return {
    /** Sync every login of the workspace, or only `connectionIds`. */
    syncAll: (connectionIds) =>
      syncAll.mutate(connectionIds, {
        onSuccess: (data) => {
          summaryToast(data.summary);
          if (data.summary.total > 0) setResults({ title: 'Sync results', data });
        },
        onError: syncErrorToast,
      }),
    /** Sync one login (`{ id, displayName }`). */
    syncConnection: (connection) =>
      syncOne.mutate(connection.id, {
        onSuccess: (data) => {
          const name = connection.displayName ?? data.connection.displayName ?? 'Login';
          if (data.outcome === SYNC_OUTCOMES.SUCCESS) {
            toast.success(
              `${name} synced · ${plural(data.accounts.refreshed, 'account')} refreshed`,
            );
          } else {
            toast.warning(data.connection.statusReason ?? `${name} needs to be reconnected`);
          }
        },
        onError: syncErrorToast,
      }),
    /** Refresh several destinations (each distinct login is synced once). */
    refreshAccounts: (accountIds, { onSuccess } = {}) =>
      refreshMany.mutate(accountIds, {
        onSuccess: (data) => {
          summaryToast(data.summary);
          setResults({ title: 'Refresh results', data });
          onSuccess?.(data);
        },
        onError: syncErrorToast,
      }),
    /** Refresh one destination (`{ id, name }`). */
    refreshAccount: (account) =>
      refreshOne.mutate(account.id, {
        onSuccess: ({ result }) => {
          if (result.outcome === SYNC_OUTCOMES.SUCCESS) toast.success(`${account.name} refreshed`);
          else if (result.skipReason === SYNC_SKIP_REASONS.IN_PROGRESS) toast.info(result.message);
          else toast.warning(result.message ?? `${account.name} could not be refreshed`);
        },
        onError: syncErrorToast,
      }),
    reconnect,
    pending: {
      syncAll: syncAll.isPending,
      syncConnectionId: syncOne.isPending ? syncOne.variables : null,
      refreshAccounts: refreshMany.isPending,
      refreshAccountId: refreshOne.isPending ? refreshOne.variables : null,
      reconnectConnectionId: start.isPending ? (start.variables?.connectionId ?? null) : null,
    },
    dialog: (
      <SyncResultsDialog
        open={Boolean(results)}
        title={results?.title}
        data={results?.data}
        onClose={() => setResults(null)}
        onReconnect={reconnect}
        reconnectingId={start.isPending ? start.variables?.connectionId : null}
      />
    ),
  };
}
