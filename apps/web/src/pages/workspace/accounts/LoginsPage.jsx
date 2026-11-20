import {
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  PERMISSIONS,
  SOCIAL_PROVIDERS,
  SYNC_OUTCOMES,
} from '@socialhub/shared';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  Check,
  Clock,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Search,
  SearchX,
  ShieldAlert,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  AttentionList,
  ConnectionStatusBadge,
  IdentityPicture,
  SyncOutcomeBadge,
} from '../../../components/accounts/AccountBadges.jsx';
import { ConnectButtons } from '../../../components/accounts/ConnectButtons.jsx';
import { Button, ButtonLink } from '../../../components/ui/Button.jsx';
import { Card } from '../../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback.jsx';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useDisconnectConnection, useRemoveConnection } from '../../../hooks/useAccountActions.js';
import { useStartAuthorization } from '../../../hooks/useStartAuthorization.js';
import { useSyncFlow } from '../../../hooks/useSyncFlow.jsx';
import {
  CONNECTION_TONE,
  PROVIDER_LABELS,
  connectionExpiry,
  needsReconnect,
} from '../../../lib/meta.js';
import { useMetaIntegration, useSocialConnections } from '../../../lib/queries.js';
import { cn, formatDate, timeAgo } from '../../../lib/utils.js';

/* ----------------------------------------------------------------------------- helpers */

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const NO_FILTERS = { q: '', provider: '', status: '' };

/** While the server reports a sync as running, the list is re-read this often. */
const SYNC_POLL_MS = 5000;

const PROVIDERS = [SOCIAL_PROVIDERS.FACEBOOK_LOGIN, SOCIAL_PROVIDERS.INSTAGRAM_LOGIN];

const PROVIDER_CONFIG_KEYS = {
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'facebook',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'instagram',
};

/** Problems of a login that still works where authorizing again is the fix. */
const RECONNECT_SOON = new Set([
  ACCOUNT_ATTENTION.EXPIRING_SOON,
  ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
]);

const LOGIN_POINTS = [
  'One Facebook login can bring many Facebook Pages, together with the Instagram accounts linked to them. You choose which ones to add.',
  'An Instagram login brings its own Instagram professional account.',
  'Each login is independent: connecting, reconnecting or removing one never affects another.',
];

const loginName = (connection) => connection.displayName ?? 'Unnamed login';
const providerLabel = (provider) => PROVIDER_LABELS[provider] ?? 'Meta';

/**
 * Whether the server has Meta app credentials for a provider (GET /integrations/meta). When
 * that answer is unavailable the controls stay enabled: the server remains authoritative and
 * answers META_NOT_CONFIGURED, which is then shown as is.
 */
function isProviderConfigured(integration, provider) {
  if (!integration) return true;
  return Boolean(integration[PROVIDER_CONFIG_KEYS[provider]]?.configured);
}

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

/** Re-reads data while `active` (a sync the server reports as running), so its state clears. */
function useRefetchWhile(active, refetch) {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => refetch(), SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refetch]);
}

/* -------------------------------------------------------------------------- pieces */

function When({ value }) {
  return (
    <time dateTime={value} title={formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })}>
      {timeAgo(value)}
    </time>
  );
}

const controlClass =
  'h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200';

function SearchBox({ value, onChange }) {
  const id = useId();
  const inputRef = useRef(null);
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <label htmlFor={id} className="sr-only">
        Search logins by name
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name"
        maxLength={100}
        autoComplete="off"
        className={cn(
          controlClass,
          'w-full pl-9 pr-8 text-sm font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-200"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(controlClass, 'pr-8', value && 'border-brand-300 dark:border-brand-400/40')}
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function Toolbar({
  filters,
  onFilter,
  onClear,
  filtering,
  providerOptions,
  statusOptions,
  countText,
  syncAllReason,
  syncAllPending,
  onSyncAll,
}) {
  const hintId = useId();
  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div
          role="search"
          aria-label="Filter logins"
          className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        >
          <SearchBox value={filters.q} onChange={(q) => onFilter({ q })} />
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Filter by provider"
              value={filters.provider}
              onChange={(provider) => onFilter({ provider })}
              options={providerOptions}
            />
            <FilterSelect
              label="Filter by status"
              value={filters.status}
              onChange={(status) => onFilter({ status })}
              options={statusOptions}
            />
            {filtering && (
              <Button variant="ghost" size="sm" onClick={onClear}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <p role="status" className="text-xs text-muted tabular-nums">
            {countText}
          </p>
          <Button
            variant="secondary"
            size="sm"
            loading={syncAllPending}
            disabled={Boolean(syncAllReason)}
            title={syncAllReason ?? 'Synchronize every login of this workspace with Meta'}
            aria-describedby={syncAllReason ? hintId : undefined}
            onClick={onSyncAll}
          >
            {!syncAllPending && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Sync all
          </Button>
        </div>
      </div>
      {syncAllReason && (
        <p id={hintId} className="text-xs text-muted lg:text-right">
          {syncAllReason}
        </p>
      )}
    </div>
  );
}

function LoginCard({
  connection,
  slug,
  providerReady,
  syncing,
  reconnecting,
  onSync,
  onReconnect,
  onDisconnect,
  onRemove,
}) {
  const nameId = useId();
  const setupId = useId();
  const syncReasonId = useId();
  const name = loginName(connection);
  const provider = providerLabel(connection.provider);
  const active = connection.status === CONNECTION_STATUS.ACTIVE;
  const disconnected = connection.status === CONNECTION_STATUS.DISCONNECTED;
  const detailsHref = `/w/${slug}/accounts/logins/${connection.id}`;
  const expiry = connectionExpiry(connection);
  const reason = active ? null : connection.statusReason;
  // Problems already spelled out on the card (status reason, expiry warning) are not repeated.
  const attention = (connection.attention ?? []).filter(
    (item) =>
      item.message !== reason && !(expiry?.warn && item.code === ACCOUNT_ATTENTION.EXPIRING_SOON),
  );
  const total = accountTotal(connection);
  const needAttention = connection.accountCounts?.needsAttention ?? 0;
  // A missing required permission is already an attention item (with Reconnect as the fix).
  const missingForPublishing =
    active && !connection.missingScopes?.required?.length
      ? (connection.missingScopes?.publishing ?? [])
      : [];
  const lastOutcome = connection.lastSyncOutcome;
  const lastAttemptFailed = Boolean(lastOutcome) && lastOutcome !== SYNC_OUTCOMES.SUCCESS;
  const reconnectFirst = wantsReconnect(connection);
  const setupReason = providerReady
    ? null
    : `Sync and reconnect are unavailable until ${provider} Login is configured on this server.`;
  const syncReason =
    setupReason ??
    (disconnected
      ? 'This login is disconnected and its access tokens were erased. Reconnect it before syncing.'
      : null);
  // Buttons repeat across cards: their description names the login they act on, then why a
  // disabled one cannot be used (aria-describedby replaces the title as the description).
  const reconnectDescribedBy = setupReason ? `${nameId} ${setupId}` : nameId;
  const syncDescribedBy = setupReason
    ? `${nameId} ${setupId}`
    : syncReason
      ? `${nameId} ${syncReasonId}`
      : nameId;

  return (
    <article aria-labelledby={nameId} className="surface flex h-full min-w-0 flex-col">
      <div className="flex-1 px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <IdentityPicture connection={connection} />
          <div className="min-w-0 flex-1">
            <h3 id={nameId} className="text-sm font-semibold text-slate-900 dark:text-white">
              {/* Truncated on the link itself so its focus outline is not clipped. */}
              <Link
                to={detailsHref}
                title={name}
                className="block truncate rounded hover:text-brand-600 dark:hover:text-brand-300"
              >
                {name}
              </Link>
            </h3>
            <p className="text-xs text-muted">{provider} login</p>
          </div>
          <ConnectionStatusBadge status={connection.status} reason={connection.statusReason} />
        </div>

        {reason && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{reason}</span>
          </p>
        )}

        <ul className="mt-4 space-y-1.5 text-xs text-muted">
          <li className="flex items-start gap-2">
            <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {total > 0 ? destinationsText(connection) : 'No accounts added yet'}
              </span>
              {needAttention > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {' · '}
                  {needAttention} {needAttention === 1 ? 'needs' : 'need'} attention
                </span>
              )}
            </span>
          </li>
          {connection.createdAt && (
            <li className="flex items-start gap-2">
              <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Connected {formatDate(connection.createdAt)}
                {connection.connectedBy?.name ? ` by ${connection.connectedBy.name}` : ''}
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {connection.lastSyncedAt ? (
                <>
                  Last successful sync <When value={connection.lastSyncedAt} />
                </>
              ) : (
                'Never synced'
              )}
            </span>
          </li>
          {lastAttemptFailed && (
            <li className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                Last attempt <SyncOutcomeBadge result={{ outcome: lastOutcome }} />
                {connection.lastSyncAttemptAt && <When value={connection.lastSyncAttemptAt} />}
              </span>
            </li>
          )}
          {expiry && (
            <li
              className={cn(
                'flex items-start gap-2',
                expiry.warn && 'font-medium text-amber-700 dark:text-amber-400',
              )}
            >
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{expiry.text}</span>
            </li>
          )}
          {missingForPublishing.length > 0 && (
            <li className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                Not granted (needed for publishing in a later phase):{' '}
                {missingForPublishing.join(', ')}
              </span>
            </li>
          )}
        </ul>

        <AttentionList items={attention} className="mt-3" />

        {(connection.syncInProgress || syncing) && (
          <p
            role="status"
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Syncing…
          </p>
        )}

        {setupReason && (
          <p id={setupId} className="mt-3 text-xs text-muted">
            {setupReason}
          </p>
        )}
        {!setupReason && syncReason && (
          <span id={syncReasonId} className="sr-only">
            {syncReason}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/5">
        {reconnectFirst && (
          <Button
            size="sm"
            loading={reconnecting}
            disabled={!providerReady}
            title={setupReason ?? 'Authorize this login again with Meta'}
            aria-describedby={reconnectDescribedBy}
            onClick={onReconnect}
          >
            {!reconnecting && <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />} Reconnect
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          loading={syncing}
          disabled={Boolean(syncReason)}
          title={syncReason ?? 'Read the latest accounts, roles and permissions from Meta'}
          aria-describedby={syncDescribedBy}
          onClick={onSync}
        >
          {!syncing && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Sync now
        </Button>
        {active && (
          <ButtonLink
            size="sm"
            variant="secondary"
            to={`${detailsHref}/select`}
            aria-describedby={nameId}
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Choose accounts
          </ButtonLink>
        )}
        <ButtonLink size="sm" variant="ghost" to={detailsHref} aria-describedby={nameId}>
          View details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </ButtonLink>
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
                <MenuItem
                  icon={KeyRound}
                  disabled={!providerReady || reconnecting}
                  onClick={() => {
                    close();
                    onReconnect();
                  }}
                >
                  Reconnect / update permissions
                </MenuItem>
                <MenuSeparator />
                {!disconnected && (
                  <MenuItem
                    icon={Unplug}
                    danger
                    onClick={() => {
                      close();
                      onDisconnect();
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
                    onRemove();
                  }}
                >
                  Remove with its accounts
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
    </article>
  );
}

function LoginsSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading logins…</span>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="surface space-y-4 p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-52" />
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NoLogins({ integration, start }) {
  const data = integration.data;
  const canConnect = Boolean(data?.facebook?.configured || data?.instagram?.configured);
  let action;
  if (canConnect) {
    action = (
      <div className="flex flex-wrap justify-center gap-2">
        <ConnectButtons integration={data} start={start} />
      </div>
    );
  } else if (integration.isError) {
    action = (
      <div className="flex flex-col items-center gap-3">
        <p className="max-w-md text-sm text-muted">
          SocialHub could not check which Meta logins are configured on this server.
        </p>
        <Button variant="secondary" size="sm" onClick={() => integration.refetch()}>
          Check again
        </Button>
      </div>
    );
  } else {
    action = (
      <p className="max-w-md text-sm font-medium text-amber-700 dark:text-amber-400">
        Connecting is unavailable until Meta setup is complete. The notice above explains what a
        server administrator needs to add.
      </p>
    );
  }

  return (
    <Card>
      <EmptyState
        icon={KeyRound}
        title="No logins connected yet"
        description="A login is a Facebook or Instagram identity that SocialHub uses, with your permission, to reach the accounts it manages."
        action={action}
      >
        <ul className="mt-5 max-w-md space-y-2 text-left text-sm text-muted">
          {LOGIN_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400"
                aria-hidden="true"
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </EmptyState>
    </Card>
  );
}

/* ---------------------------------------------------------------------------- page */

function LoginsManager({ workspace }) {
  const connections = useSocialConnections(workspace.id);
  const integration = useMetaIntegration();
  const sync = useSyncFlow(workspace.id);
  const start = useStartAuthorization(workspace.id);
  const disconnect = useDisconnectConnection(workspace.id);
  const remove = useRemoveConnection(workspace.id);
  const [filters, setFilters] = useState(NO_FILTERS);
  // `{ type: 'disconnect' | 'remove', connection }` while a confirmation is open.
  const [pendingAction, setPendingAction] = useState(null);

  const list = connections.data ?? [];
  useRefetchWhile(
    list.some((c) => c.syncInProgress),
    connections.refetch,
  );

  const query = filters.q.trim().toLocaleLowerCase();
  const byQuery = (c) => !query || loginName(c).toLocaleLowerCase().includes(query);
  const byProvider = (c) => !filters.provider || c.provider === filters.provider;
  const byStatus = (c) => !filters.status || c.status === filters.status;
  const visible = list.filter((c) => byQuery(c) && byProvider(c) && byStatus(c));
  const filtering = Boolean(query || filters.provider || filters.status);

  // Each option counts the logins it would show, given the other filters.
  const providerOptions = [
    ['', 'All providers'],
    ...PROVIDERS.map((p) => [
      p,
      `${providerLabel(p)} (${list.filter((c) => c.provider === p && byQuery(c) && byStatus(c)).length})`,
    ]),
  ];
  const statusOptions = [
    ['', 'All statuses'],
    ...Object.values(CONNECTION_STATUS).map((s) => [
      s,
      `${CONNECTION_TONE[s]?.[1] ?? s} (${list.filter((c) => c.status === s && byQuery(c) && byProvider(c)).length})`,
    ]),
  ];

  const anyProviderReady = list.some((c) => isProviderConfigured(integration.data, c.provider));
  const syncAllReason = anyProviderReady
    ? null
    : 'Sync is unavailable until Meta setup is complete: none of these logins can be contacted yet.';

  const target = pendingAction?.connection ?? null;
  const removing = pendingAction?.type === 'remove';
  const mutation = removing ? remove : disconnect;
  const targetName = target ? loginName(target) : '';
  const targetTotal = target ? accountTotal(target) : 0;

  const closeDialog = () => {
    if (disconnect.isPending || remove.isPending) return;
    disconnect.reset();
    remove.reset();
    setPendingAction(null);
  };

  const confirmAction = () => {
    if (!target) return;
    if (removing) {
      remove.mutate(target.id, {
        onSuccess: (data) => {
          setPendingAction(null);
          const removed = data?.accountsRemoved ?? 0;
          toast.success(
            removed > 0
              ? `${targetName} removed with ${plural(removed, 'account')}`
              : `${targetName} removed`,
          );
        },
      });
    } else {
      disconnect.mutate(target.id, {
        onSuccess: () => {
          setPendingAction(null);
          toast.success(`${targetName} disconnected`);
        },
      });
    }
  };

  let content;
  if (connections.isPending || integration.isPending) {
    content = <LoginsSkeleton />;
  } else if (!connections.data) {
    content = (
      <Card>
        <ErrorState
          title="Could not load logins"
          error={connections.error}
          onRetry={() => connections.refetch()}
        />
      </Card>
    );
  } else if (list.length === 0) {
    content = <NoLogins integration={integration} start={start} />;
  } else {
    content = (
      <>
        <Toolbar
          filters={filters}
          onFilter={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
          onClear={() => setFilters(NO_FILTERS)}
          filtering={filtering}
          providerOptions={providerOptions}
          statusOptions={statusOptions}
          countText={
            filtering
              ? `${visible.length} of ${plural(list.length, 'login')}`
              : plural(list.length, 'login')
          }
          syncAllReason={syncAllReason}
          syncAllPending={sync.pending.syncAll}
          onSyncAll={() => sync.syncAll()}
        />
        {visible.length === 0 ? (
          <Card>
            <EmptyState
              icon={SearchX}
              title="No logins match these filters"
              description="Try another name, provider or status."
              action={
                <Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <h2 className="sr-only">Logins</h2>
            <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((connection) => (
                <li key={connection.id} className="min-w-0">
                  <LoginCard
                    connection={connection}
                    slug={workspace.slug}
                    providerReady={isProviderConfigured(integration.data, connection.provider)}
                    syncing={sync.pending.syncConnectionId === connection.id}
                    reconnecting={sync.pending.reconnectConnectionId === connection.id}
                    onSync={() => sync.syncConnection(connection)}
                    onReconnect={() =>
                      sync.reconnect({ provider: connection.provider, connectionId: connection.id })
                    }
                    onDisconnect={() => setPendingAction({ type: 'disconnect', connection })}
                    onRemove={() => setPendingAction({ type: 'remove', connection })}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {content}
      <ConfirmDialog
        open={Boolean(target)}
        title={removing ? `Remove ${targetName}?` : `Disconnect ${targetName}?`}
        description={removing ? removeDescription(targetTotal) : disconnectDescription(targetTotal)}
        confirmLabel={
          removing ? (targetTotal > 0 ? 'Remove login and accounts' : 'Remove login') : 'Disconnect'
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
 * Logins tab: one card per Facebook / Instagram identity connected to the workspace. A login
 * is never assumed to manage a single Page: each card reports how many Pages and Instagram
 * accounts were added through it. Every status, count and outcome comes from the server.
 */
export default function LoginsPage() {
  const { workspace, can } = useWorkspace();
  if (!can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Logins are restricted"
          description="Only workspace owners and admins can see and manage the Facebook and Instagram logins connected to this workspace."
          action={
            <ButtonLink variant="secondary" to={`/w/${workspace.slug}/accounts`}>
              Back to social accounts
            </ButtonLink>
          }
        />
      </Card>
    );
  }
  return <LoginsManager workspace={workspace} />;
}
