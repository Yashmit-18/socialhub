import {
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  ERROR_CODES,
  PERMISSIONS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  HeartPulse,
  History,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MoreHorizontal,
  Plug,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ActivityFeed } from '../../../components/ActivityFeed.jsx';
import {
  AccountPicture,
  AttentionList,
  ConnectionStatusBadge,
  IdentityPicture,
  ReadinessBadge,
  SyncOutcomeBadge,
} from '../../../components/accounts/AccountBadges.jsx';
import { MetaSetupNotice } from '../../../components/accounts/MetaSetupNotice.jsx';
import { SyncRunList } from '../../../components/accounts/SyncRunList.jsx';
import { PageHeader } from '../../../components/layout/AppShell.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../../components/ui/Button.jsx';
import { Card, CardBody, CardFooter, CardHeader } from '../../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback.jsx';
import { Menu, MenuItem } from '../../../components/ui/Menu.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useDisconnectConnection, useRemoveConnection } from '../../../hooks/useAccountActions.js';
import { useSyncFlow } from '../../../hooks/useSyncFlow.jsx';
import {
  PLATFORM_LABELS,
  PROVIDER_LABELS,
  connectionExpiry,
  needsReconnect,
} from '../../../lib/meta.js';
import { useConnectionDetail, useMetaIntegration, useSyncRuns } from '../../../lib/queries.js';
import { cn, formatDate, timeAgo } from '../../../lib/utils.js';

/* ----------------------------------------------------------------------------- helpers */

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** While the server reports a sync as running, the page is re-read this often. */
const SYNC_POLL_MS = 5000;

const DATE_TIME = { dateStyle: 'medium', timeStyle: 'short' };

/** Problems of a login that still works where authorizing again is the fix. */
const RECONNECT_SOON = new Set([
  ACCOUNT_ATTENTION.EXPIRING_SOON,
  ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
]);

const providerLabel = (provider) => PROVIDER_LABELS[provider] ?? 'Meta';

function wantsReconnect(connection) {
  return (
    needsReconnect(connection.status) ||
    (connection.attention ?? []).some((item) => RECONNECT_SOON.has(item.code))
  );
}

function accountTotal(connection) {
  const counts = connection.accountCounts;
  if (!counts) return connection.accountCount ?? 0;
  return (counts.facebookPages ?? 0) + (counts.instagramAccounts ?? 0);
}

/** "2 Facebook Pages · 1 Instagram account": one Facebook login can bring many destinations. */
function destinationsText(connection) {
  const counts = connection.accountCounts;
  if (!counts) return plural(connection.accountCount ?? 0, 'account');
  const parts = [];
  if (connection.provider !== SOCIAL_PROVIDERS.INSTAGRAM_LOGIN || counts.facebookPages > 0) {
    parts.push(plural(counts.facebookPages ?? 0, 'Facebook Page'));
  }
  parts.push(plural(counts.instagramAccounts ?? 0, 'Instagram account'));
  return parts.join(' · ');
}

const needAttentionText = (n) => `${n} ${n === 1 ? 'needs' : 'need'} attention`;

/** The detail and sync-run queries answer 404 (or 422 for a malformed id) for unknown logins. */
const isMissing = (error) =>
  error?.status === 404 ||
  error?.code === ERROR_CODES.NOT_FOUND ||
  error?.code === ERROR_CODES.VALIDATION_ERROR;

function disconnectDescription(total) {
  const accounts =
    total === 0
      ? ''
      : ` ${total === 1 ? 'Its account stays' : `Its ${total} accounts stay`} listed but cannot be used until the login is reconnected.`;
  return `SocialHub erases this login's access tokens.${accounts}`;
}

function removeDescription(total) {
  if (total === 0) return 'The login is removed from this workspace.';
  return `The login and the ${plural(total, 'account')} added through it are removed from this workspace, together with every member's access to them.`;
}

/* -------------------------------------------------------------------------- pieces */

function When({ value }) {
  return (
    <time dateTime={value} title={formatDate(value, DATE_TIME)}>
      {timeAgo(value)}
    </time>
  );
}

function DateTime({ value }) {
  return <time dateTime={value}>{formatDate(value, DATE_TIME)}</time>;
}

function BackLink({ to, children = 'Logins' }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted hover:text-slate-900 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {children}
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading login details…</span>
      <div className="mb-8 flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function HealthCard({ connection, setupReason, syncing }) {
  const active = connection.status === CONNECTION_STATUS.ACTIVE;
  const reason = connection.statusReason;
  // The status reason is shown on its own; its attention entry would only repeat it.
  const attention = (connection.attention ?? []).filter((item) => item.message !== reason);
  const total = accountTotal(connection);
  const accountsNeedingAttention = connection.accountCounts?.needsAttention ?? 0;
  const { lastError } = connection;
  const healthy = active && attention.length === 0 && accountsNeedingAttention === 0;

  return (
    <Card>
      <CardHeader
        icon={HeartPulse}
        title="Health"
        description="Computed by SocialHub from this login's last check with Meta."
        action={<ConnectionStatusBadge status={connection.status} reason={reason} />}
      />
      <CardBody className="space-y-4">
        {reason && (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{reason}</span>
          </p>
        )}
        <AttentionList items={attention} />
        {accountsNeedingAttention > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {accountsNeedingAttention} of {plural(total, 'account')} from this login{' '}
            {accountsNeedingAttention === 1 ? 'needs' : 'need'} attention — see the list below.
          </p>
        )}
        {healthy && (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Nothing needs attention
            on this login.
          </p>
        )}
        {lastError?.message && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-500/20 dark:bg-rose-500/[0.07]">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
              Last error
            </p>
            <p className="mt-1 text-sm text-rose-800 dark:text-rose-200">{lastError.message}</p>
            {(lastError.code || lastError.at) && (
              <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-300/80">
                {lastError.code && <code className="font-mono">{lastError.code}</code>}
                {lastError.code && lastError.at && ' · '}
                {lastError.at && <When value={lastError.at} />}
              </p>
            )}
          </div>
        )}
        {setupReason && (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Plug className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{setupReason}</span>
          </p>
        )}
        {(connection.syncInProgress || syncing) && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Synchronization in
            progress…
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="grid gap-0.5 px-5 py-3 sm:px-6">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  );
}

function DetailsCard({ connection }) {
  const expiry = connectionExpiry(connection);
  const disconnected = connection.status === CONNECTION_STATUS.DISCONNECTED;
  return (
    <Card>
      <CardHeader icon={KeyRound} title="Login details" />
      <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
        <DetailRow label="Provider">{providerLabel(connection.provider)} Login</DetailRow>
        <DetailRow label="Connected">
          {connection.createdAt ? (
            <time
              dateTime={connection.createdAt}
              title={formatDate(connection.createdAt, DATE_TIME)}
            >
              {formatDate(connection.createdAt)}
            </time>
          ) : (
            'Date not recorded'
          )}
          {connection.connectedBy?.name ? ` by ${connection.connectedBy.name}` : ''}
        </DetailRow>
        <DetailRow label="Token expiry">
          {expiry ? (
            <span className={cn(expiry.warn && 'font-medium text-amber-700 dark:text-amber-400')}>
              {expiry.text}
            </span>
          ) : disconnected ? (
            'Tokens were erased when this login was disconnected'
          ) : (
            'Not usable until this login is reconnected'
          )}
          {connection.tokenExpiresAt && (
            <span className="mt-0.5 block text-xs text-muted">
              Expiry date: <DateTime value={connection.tokenExpiresAt} />
            </span>
          )}
        </DetailRow>
        <DetailRow label="Data access expiry">
          {connection.dataAccessExpiresAt ? (
            <>
              <DateTime value={connection.dataAccessExpiresAt} />
              <span className="mt-0.5 block text-xs text-muted">
                Reconnecting renews Meta&apos;s data access for this login.
              </span>
            </>
          ) : (
            'Not reported by Meta'
          )}
        </DetailRow>
        <DetailRow label="Last successful sync">
          {connection.lastSyncedAt ? <When value={connection.lastSyncedAt} /> : 'Never'}
        </DetailRow>
        <DetailRow label="Last attempt">
          {connection.lastSyncAttemptAt ? (
            <span className="flex flex-wrap items-center gap-2">
              <When value={connection.lastSyncAttemptAt} />
              {connection.lastSyncOutcome && (
                <SyncOutcomeBadge result={{ outcome: connection.lastSyncOutcome }} />
              )}
            </span>
          ) : (
            'Never'
          )}
        </DetailRow>
        <DetailRow label="Last token refresh">
          {connection.lastRefreshedAt ? <When value={connection.lastRefreshedAt} /> : 'Never'}
        </DetailRow>
        {connection.disconnectedAt && (
          <DetailRow label="Disconnected">
            <DateTime value={connection.disconnectedAt} />
          </DetailRow>
        )}
      </dl>
    </Card>
  );
}

function ScopeGroup({ label, scopes, tone, note, noteClassName, emptyText }) {
  const id = useId();
  const list = scopes ?? [];
  if (list.length === 0 && !emptyText) return null;
  return (
    <div>
      <h3
        id={id}
        className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
      >
        {label}
      </h3>
      {list.length > 0 ? (
        <ul aria-labelledby={id} className="mt-2 flex flex-wrap gap-1.5">
          {list.map((scope) => (
            <li key={scope}>
              <Badge tone={tone}>{scope}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted">{emptyText}</p>
      )}
      {note && list.length > 0 && (
        <p className={cn('mt-2 text-xs', noteClassName ?? 'text-muted')}>{note}</p>
      )}
    </div>
  );
}

function PermissionsCard({ permissions }) {
  const missing = permissions?.missing ?? {};
  const nothingMissing =
    !missing.required?.length && !missing.publishing?.length && !missing.recommended?.length;
  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Permissions"
        description="What Meta has granted SocialHub for this login."
      />
      <CardBody className="space-y-5">
        {nothingMissing && (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> No required or
            publishing permission is missing.
          </p>
        )}
        <ScopeGroup
          label="Missing: required"
          scopes={missing.required}
          tone="danger"
          note="SocialHub cannot read this login's accounts without them. Reconnect and allow them."
          noteClassName="text-rose-700 dark:text-rose-400"
        />
        <ScopeGroup
          label="Missing: for publishing"
          scopes={missing.publishing}
          tone="warning"
          note="Not granted — needed for publishing in a later phase. Reconnect and allow them to prepare."
          noteClassName="text-amber-700 dark:text-amber-400"
        />
        <ScopeGroup
          label="Missing: recommended"
          scopes={missing.recommended}
          tone="sky"
          note="Optional, but recommended."
        />
        <ScopeGroup
          label="Granted"
          scopes={permissions?.granted}
          tone="success"
          emptyText="Meta has not reported any granted permission."
        />
        <ScopeGroup
          label="Declined"
          scopes={permissions?.declined}
          tone="neutral"
          note="Declined when this login was authorized."
        />
        <ScopeGroup
          label="Requested by SocialHub"
          scopes={permissions?.requested}
          tone="neutral"
          note="What SocialHub asks for when this login is connected or reconnected."
        />
      </CardBody>
    </Card>
  );
}

function AccountRow({ account, href }) {
  const health = account.health ?? {};
  const details = [
    PLATFORM_LABELS[account.platform] ?? 'Account',
    account.username ? `@${account.username}` : null,
    account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE ? account.category : null,
    account.linkedPage?.name ? `linked to ${account.linkedPage.name}` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
      <AccountPicture account={account} />
      <div className="min-w-0 flex-1 basis-48">
        <Link
          to={href}
          title={account.name}
          className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
        >
          {account.name}
        </Link>
        <p className="truncate text-xs text-muted">{details.join(' · ')}</p>
        <AttentionList items={health.attention} compact className="mt-1" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReadinessBadge readiness={health.readiness} reasons={health.readinessReasons} />
        <ConnectionStatusBadge
          status={health.connectionStatus ?? account.connectionStatus}
          reason={health.connectionStatusReason}
        />
      </div>
    </li>
  );
}

function AccountsCard({ accounts, connection, slug, selectHref }) {
  const active = connection.status === CONNECTION_STATUS.ACTIVE;
  const needAttention = connection.accountCounts?.needsAttention ?? 0;
  const instagramLogin = connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN;
  const chooseLink = (
    <ButtonLink size="sm" variant="secondary" to={selectHref}>
      <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Choose accounts
    </ButtonLink>
  );
  return (
    <Card>
      <CardHeader
        icon={Layers}
        title="Accounts from this login"
        description={
          accounts.length > 0
            ? `${destinationsText(connection)}${needAttention > 0 ? ` · ${needAttentionText(needAttention)}` : ''}`
            : undefined
        }
        action={active && accounts.length > 0 ? chooseLink : undefined}
      />
      {accounts.length === 0 ? (
        <EmptyState
          className="py-10"
          title="No accounts added from this login yet"
          description={
            !active
              ? 'Reconnect this login, then choose which of its accounts to add.'
              : instagramLogin
                ? 'Add the Instagram professional account of this login to the workspace.'
                : 'Choose which of the Facebook Pages and Instagram accounts this login manages to add to the workspace.'
          }
          action={active ? chooseLink : undefined}
        />
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              href={`/w/${slug}/accounts/a/${account.id}`}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SyncHistoryCard({ runs }) {
  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Card>
      <CardHeader
        icon={History}
        title="Sync history"
        description="Every synchronization SocialHub recorded for this login, newest first."
      />
      <div className="mt-4 border-t border-slate-100 dark:border-white/5">
        {runs.isPending ? (
          <div className="space-y-3 px-5 py-4 sm:px-6" role="status">
            <span className="sr-only">Loading sync history…</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !runs.data ? (
          <ErrorState
            title="Could not load the sync history"
            error={runs.error}
            onRetry={() => runs.refetch()}
          />
        ) : (
          <SyncRunList runs={items} />
        )}
      </div>
      {runs.hasNextPage && (
        <CardFooter className="justify-center">
          {runs.isFetchNextPageError && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {runs.error?.message ?? 'Could not load older entries.'}
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            loading={runs.isFetchingNextPage}
            onClick={() => runs.fetchNextPage()}
          >
            Load more
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ActivityCard({ activity }) {
  const items = activity ?? [];
  return (
    <Card>
      <CardHeader
        icon={Activity}
        title="Activity"
        description="Recent changes to this login and its accounts."
      />
      <CardBody>
        {items.length > 0 ? (
          <ActivityFeed items={items} compact />
        ) : (
          <p className="text-sm text-muted">No activity yet</p>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------- page */

function ConnectionDetail({ workspace, connectionId }) {
  const navigate = useNavigate();
  const detail = useConnectionDetail(workspace.id, connectionId);
  const runs = useSyncRuns(workspace.id, connectionId);
  const integration = useMetaIntegration();
  const sync = useSyncFlow(workspace.id);
  const disconnect = useDisconnectConnection(workspace.id);
  const remove = useRemoveConnection(workspace.id);
  // 'disconnect' | 'remove' while a confirmation is open.
  const [confirming, setConfirming] = useState(null);
  const loginsUrl = `/w/${workspace.slug}/accounts/logins`;

  // A sync the server reports as running (started elsewhere): re-read until it finishes.
  const syncingOnServer = Boolean(detail.data?.connection?.syncInProgress);
  const { refetch: refetchDetail } = detail;
  const { refetch: refetchRuns } = runs;
  useEffect(() => {
    if (!syncingOnServer) return undefined;
    const timer = setInterval(() => {
      refetchDetail();
      refetchRuns();
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingOnServer, refetchDetail, refetchRuns]);

  if (detail.isPending) {
    return (
      <>
        <BackLink to={loginsUrl} />
        <DetailSkeleton />
      </>
    );
  }

  if (!detail.data) {
    return (
      <>
        <BackLink to={loginsUrl} />
        <Card>
          {isMissing(detail.error) ? (
            <EmptyState
              icon={SearchX}
              title="Login not found"
              description="It may have been removed from this workspace, or the link may be incorrect."
              action={
                <ButtonLink variant="secondary" to={loginsUrl}>
                  Back to logins
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState
              title="Could not load this login"
              error={detail.error}
              onRetry={() => detail.refetch()}
            />
          )}
        </Card>
      </>
    );
  }

  const { connection, accounts, permissions, activity, capabilities } = detail.data;
  const name = connection.displayName ?? 'Unnamed login';
  const provider = providerLabel(connection.provider);
  const active = connection.status === CONNECTION_STATUS.ACTIVE;
  const disconnected = connection.status === CONNECTION_STATUS.DISCONNECTED;
  // Server-computed: false when the Meta app credentials for this provider are missing.
  const configured = capabilities?.providerConfigured !== false;
  const setupReason = configured
    ? null
    : `Sync and reconnect are unavailable until ${provider} Login is configured on this server.`;
  const syncReason =
    setupReason ??
    (disconnected
      ? 'This login is disconnected and its access tokens were erased. Reconnect it before syncing.'
      : null);
  const reconnectFirst = wantsReconnect(connection);
  const syncing = sync.pending.syncConnectionId === connection.id;
  const reconnecting = sync.pending.reconnectConnectionId === connection.id;
  const selectHref = `${loginsUrl}/${connection.id}/select`;
  const total = accountTotal(connection);
  const removing = confirming === 'remove';
  const mutation = removing ? remove : disconnect;

  const closeDialog = () => {
    if (disconnect.isPending || remove.isPending) return;
    disconnect.reset();
    remove.reset();
    setConfirming(null);
  };

  const confirmAction = () => {
    if (removing) {
      remove.mutate(connection.id, {
        onSuccess: (data) => {
          const removed = data?.accountsRemoved ?? 0;
          toast.success(
            removed > 0 ? `${name} removed with ${plural(removed, 'account')}` : `${name} removed`,
          );
          setConfirming(null);
          navigate(loginsUrl, { replace: true });
        },
      });
    } else {
      disconnect.mutate(connection.id, {
        onSuccess: () => {
          setConfirming(null);
          toast.success(`${name} disconnected`);
        },
      });
    }
  };

  return (
    <>
      <BackLink to={loginsUrl} />
      <PageHeader
        eyebrow={`${provider} login`}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <IdentityPicture connection={connection} size="lg" />
            <span className="min-w-0 break-words">{name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ConnectionStatusBadge status={connection.status} reason={connection.statusReason} />
            <span>{total > 0 ? destinationsText(connection) : 'No accounts added yet'}</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              loading={syncing}
              disabled={Boolean(syncReason)}
              title={syncReason ?? 'Read the latest accounts, roles and permissions from Meta'}
              onClick={() => sync.syncConnection(connection)}
            >
              {!syncing && <RefreshCw className="h-4 w-4" aria-hidden="true" />} Sync now
            </Button>
            <Button
              variant={reconnectFirst ? 'primary' : 'secondary'}
              loading={reconnecting}
              disabled={!configured}
              title={
                setupReason ??
                'Authorize this login again with Meta to renew access or update its permissions'
              }
              onClick={() =>
                sync.reconnect({ provider: connection.provider, connectionId: connection.id })
              }
            >
              {!reconnecting && <KeyRound className="h-4 w-4" aria-hidden="true" />} Reconnect
            </Button>
            {active && (
              <ButtonLink variant={reconnectFirst ? 'secondary' : 'primary'} to={selectHref}>
                <ListChecks className="h-4 w-4" aria-hidden="true" /> Choose accounts
              </ButtonLink>
            )}
            {/* Kept at the end of its row, so the right-aligned menu never opens off-screen. */}
            <div className="ml-auto">
              <Menu
                trigger={({ toggle, props }) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    {...props}
                    aria-label={`More actions for ${name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    {!disconnected && (
                      <MenuItem
                        icon={Unplug}
                        danger
                        onClick={() => {
                          close();
                          setConfirming('disconnect');
                        }}
                      >
                        Disconnect
                      </MenuItem>
                    )}
                    <MenuItem
                      icon={Trash2}
                      danger
                      onClick={() => {
                        close();
                        setConfirming('remove');
                      }}
                    >
                      Remove with its accounts
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          </>
        }
      />

      {!configured && <MetaSetupNotice integration={integration.data} className="mb-6" />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <HealthCard connection={connection} setupReason={setupReason} syncing={syncing} />
          <AccountsCard
            accounts={accounts ?? []}
            connection={connection}
            slug={workspace.slug}
            selectHref={selectHref}
          />
          <SyncHistoryCard runs={runs} />
        </div>
        <div className="min-w-0 space-y-6">
          <DetailsCard connection={connection} />
          <PermissionsCard permissions={permissions} />
          <ActivityCard activity={activity} />
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        title={removing ? `Remove ${name}?` : `Disconnect ${name}?`}
        description={removing ? removeDescription(total) : disconnectDescription(total)}
        confirmLabel={
          removing ? (total > 0 ? 'Remove login and accounts' : 'Remove login') : 'Disconnect'
        }
        loading={mutation.isPending}
        error={mutation.error}
        onConfirm={confirmAction}
        onClose={closeDialog}
      >
        <p className="text-sm text-muted">
          {removing
            ? 'Accounts added through other logins are not affected. This cannot be undone: to use these accounts again, connect the login and add them again.'
            : 'Other logins are not affected. You can reconnect this login at any time, or remove it with its accounts.'}
        </p>
      </ConfirmDialog>
      {sync.dialog}
    </>
  );
}

/**
 * One login (Facebook or Instagram identity): its health, token and data-access dates,
 * permissions, every account added through it (a login can manage many Pages), sync history
 * and activity. Everything shown is what the server reported; nothing is simulated.
 */
export default function ConnectionDetailPage() {
  const { connectionId } = useParams();
  const { workspace, can } = useWorkspace();
  if (!can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)) {
    return (
      <>
        <BackLink to={`/w/${workspace.slug}/accounts`}>Social accounts</BackLink>
        <Card>
          <EmptyState
            icon={Lock}
            title="Login details are restricted"
            description="Only workspace owners and admins can see and manage the Facebook and Instagram logins connected to this workspace."
          />
        </Card>
      </>
    );
  }
  // Keyed so that moving to another login starts from a clean state.
  return <ConnectionDetail key={connectionId} workspace={workspace} connectionId={connectionId} />;
}
