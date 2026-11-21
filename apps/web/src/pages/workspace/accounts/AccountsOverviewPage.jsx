import {
  ACCOUNT_ACCESS_MODES,
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  PERMISSIONS,
  PUBLISHING_STATUS,
  SOCIAL_PROVIDERS,
  hasPermission,
} from '@socialhub/shared';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  Link2,
  ListChecks,
  Plug,
  RefreshCw,
  SearchX,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { useId, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AccountFilters } from '../../../components/accounts/AccountFilters.jsx';
import {
  AccountPicture,
  AttentionList,
  ConnectionStatusBadge,
  IdentityPicture,
  ReadinessBadge,
} from '../../../components/accounts/AccountBadges.jsx';
import { AccountsTable } from '../../../components/accounts/AccountsTable.jsx';
import { ConnectButtons } from '../../../components/accounts/ConnectButtons.jsx';
import { FollowersCard } from '../../../components/accounts/FollowersCard.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../../components/ui/Brand.jsx';
import { Button, ButtonLink } from '../../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback.jsx';
import { Pagination } from '../../../components/ui/Pagination.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { ACCOUNT_FILTER_KEYS, useAccountQueryState } from '../../../hooks/useAccountQueryState.js';
import { useStartAuthorization } from '../../../hooks/useStartAuthorization.js';
import { useSyncFlow } from '../../../hooks/useSyncFlow.jsx';
import {
  CONNECTION_TONE,
  PLATFORM_LABELS,
  PROVIDER_LABELS,
  PUBLISHING_TONE,
  READINESS_HINTS,
  needsReconnect,
} from '../../../lib/meta.js';
import {
  useAccountList,
  useAccountSummary,
  useMetaIntegration,
  useMyAccountSummary,
  useMyAccounts,
  useSocialConnections,
  useWorkspaces,
} from '../../../lib/queries.js';
import { cn } from '../../../lib/utils.js';

/*
 * Social accounts dashboard — the index tab of AccountsLayout (which renders the page header,
 * the section tabs and, for managers, the Meta setup notice).
 *
 * Everything shown comes from the API: totals, the computed `health` of each destination, the
 * attention items of each login. Nothing is derived or simulated here. When the Meta app
 * credentials are missing, sync and reconnect controls are disabled with the reason; the
 * server would refuse them anyway (META_NOT_CONFIGURED / CONFIG_REQUIRED).
 *
 * "All my workspaces" (?scope=all) switches the same view to a read-only, cross-workspace scope.
 */

const PAGE_SIZE = 25;
const LOGIN_PREVIEW = 5;
/** The "Needs attention" preview: the five most urgent destinations. */
const ATTENTION_PARAMS = { attention: 'true', sort: 'attention', limit: 5 };
/** Every list filter emptied (used before applying a single "show these" filter). */
const NO_FILTERS = Object.fromEntries(ACCOUNT_FILTER_KEYS.map((key) => [key, '']));

const SCOPES = [
  ['workspace', 'This workspace'],
  ['all', 'All my workspaces'],
];

/** Readiness legend, in bar order. Colours follow the PUBLISHING_TONE badge tones. */
const READINESS_ROWS = [
  { status: PUBLISHING_STATUS.READY, field: 'ready', bar: 'bg-brand-500 dark:bg-brand-500' },
  {
    status: PUBLISHING_STATUS.RESTRICTED,
    field: 'restricted',
    bar: 'bg-amber-600 dark:bg-amber-600',
  },
  {
    status: PUBLISHING_STATUS.UNAVAILABLE,
    field: 'unavailable',
    bar: 'bg-slate-500 dark:bg-slate-500',
  },
];

/** Attention codes of an ACTIVE login that only a new authorization (Reconnect) fixes. */
const RECONNECT_FIXES = [ACCOUNT_ATTENTION.EXPIRING_SOON, ACCOUNT_ATTENTION.MISSING_PERMISSIONS];

/** Used only when a login view carries no `attention` list (older API responses). */
const STATUS_ATTENTION = {
  [CONNECTION_STATUS.EXPIRED]: ACCOUNT_ATTENTION.CONNECTION_EXPIRED,
  [CONNECTION_STATUS.REVOKED]: ACCOUNT_ATTENTION.CONNECTION_REVOKED,
  [CONNECTION_STATUS.ERROR]: ACCOUNT_ATTENTION.CONNECTION_ERROR,
  [CONNECTION_STATUS.DISCONNECTED]: ACCOUNT_ATTENTION.DISCONNECTED,
};

const NUMBER = new Intl.NumberFormat();
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Stat values: exact below 10,000 (1,284), compact above (12.9K). */
const formatCount = (value) =>
  typeof value !== 'number' ? '—' : value >= 10_000 ? COMPACT.format(value) : NUMBER.format(value);

const plural = (count, word, many = `${word}s`) =>
  `${NUMBER.format(count)} ${count === 1 ? word : many}`;

const providerKey = (provider) =>
  provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN ? 'instagram' : 'facebook';

const providerName = (provider) => `${PROVIDER_LABELS[provider] ?? 'Meta'} Login`;

/** The login's own problems as the API reported them. */
function loginProblems(login) {
  if (login.attention?.length) return login.attention;
  const code = STATUS_ATTENTION[login.status];
  if (!code) return [];
  return [{ code, message: login.statusReason ?? CONNECTION_TONE[login.status][1] }];
}

const loginNeedsAttention = (login) =>
  Boolean(login.needsAttention) || login.status !== CONNECTION_STATUS.ACTIVE;

const managesLogins = (workspace) =>
  hasPermission(workspace.membership?.role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);

/** Total from a list response (tolerates responses without pagination fields). */
const totalOf = (data) => (data ? (data.total ?? data.items?.length ?? 0) : 0);

/* --------------------------------------------------------------------------- scope */

function ScopeToggle({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Accounts to show"
      className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs dark:border-white/10 dark:bg-slate-900/60"
    >
      {SCOPES.map(([key, label]) => {
        const pressed = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              if (!pressed) onChange(key);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors',
              pressed
                ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500 dark:text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SyncAllControl({ integration, sync }) {
  const reasonId = useId();
  // Unknown (still loading) is not treated as "not configured": the server decides.
  const unavailable =
    Boolean(integration) && !integration.facebook?.configured && !integration.instagram?.configured;
  const busy = sync.pending.syncAll;
  return (
    <div className="flex flex-col items-start gap-1.5 sm:ml-auto sm:flex-row sm:items-center sm:gap-3">
      {unavailable && (
        <p id={reasonId} className="max-w-xs text-xs text-muted sm:text-right">
          Syncing needs Facebook Login or Instagram Login to be configured on the server.
        </p>
      )}
      <Button
        variant="secondary"
        loading={busy}
        disabled={unavailable}
        aria-describedby={unavailable ? reasonId : undefined}
        onClick={() => sync.syncAll()}
      >
        {!busy && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        Sync all logins
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------------------- stats */

function StatCard({ label, value, icon: Icon, accent, hint, loading }) {
  return (
    <Card className="relative h-full overflow-hidden p-5">
      <div
        className={cn(
          'absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12] blur-2xl',
          accent,
        )}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
            accent,
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {formatCount(value)}
        </p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function TruncatedNote({ children, className }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-muted', className)}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

function StatsSection({ summary, expectLoginStats, partialLoginStats, allScope }) {
  const { data, isPending, error, refetch } = summary;
  if (error) {
    return (
      <Card>
        <ErrorState
          title="Could not load the account totals"
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const accounts = data?.accounts;
  const logins = data?.connections;
  // `connections` is null for members who do not manage logins: never show login figures then.
  const showLogins = data ? Boolean(logins) : expectLoginStats;
  const loginProblemsHint =
    logins &&
    [
      logins.error > 0 &&
        `${NUMBER.format(logins.error)} with ${logins.error === 1 ? 'an error' : 'errors'}`,
      logins.disconnected > 0 && `${NUMBER.format(logins.disconnected)} disconnected`,
    ]
      .filter(Boolean)
      .join(' · ');

  const stats = [
    showLogins && {
      key: 'facebook-logins',
      label: 'Facebook logins',
      value: logins?.facebook,
      icon: KeyRound,
      accent: 'bg-gradient-to-br from-brand-500 to-violet-500',
      hint: logins?.instagram > 0 ? `Plus ${plural(logins.instagram, 'Instagram login')}` : null,
    },
    {
      key: 'facebook-pages',
      label: 'Facebook Pages',
      value: accounts?.facebookPages,
      icon: FacebookIcon,
      accent: 'bg-gradient-to-br from-blue-600 to-indigo-500',
    },
    {
      key: 'instagram-accounts',
      label: 'Instagram accounts',
      value: accounts?.instagramAccounts,
      icon: InstagramIcon,
      accent: 'bg-gradient-to-br from-fuchsia-500 to-orange-400',
    },
    {
      key: 'connected',
      label: 'Connected accounts',
      value: accounts?.connected,
      icon: Link2,
      accent: 'bg-gradient-to-br from-emerald-500 to-teal-500',
      hint: accounts ? `of ${plural(accounts.total, 'account')}` : null,
    },
    showLogins && {
      key: 'expired-logins',
      label: 'Expired logins',
      value: logins?.expired,
      icon: Clock,
      accent: 'bg-gradient-to-br from-amber-500 to-orange-500',
      hint: logins?.expiringSoon > 0 ? `${NUMBER.format(logins.expiringSoon)} expiring soon` : null,
    },
    showLogins && {
      key: 'revoked-logins',
      label: 'Revoked logins',
      value: logins?.revoked,
      icon: Ban,
      accent: 'bg-gradient-to-br from-rose-500 to-pink-500',
      hint: loginProblemsHint || null,
    },
    {
      key: 'needs-attention',
      label: 'Accounts needing attention',
      value: accounts?.needsAttention,
      icon: AlertTriangle,
      accent: 'bg-gradient-to-br from-amber-500 to-rose-500',
    },
    allScope && {
      key: 'workspaces',
      label: 'Workspaces',
      value: data?.workspaces,
      icon: Building2,
      accent: 'bg-gradient-to-br from-sky-500 to-cyan-500',
    },
  ].filter(Boolean);

  return (
    <div>
      <ul aria-label="Account totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ key, ...stat }) => (
          <li key={key} className="min-w-0">
            <StatCard {...stat} loading={isPending} />
          </li>
        ))}
      </ul>
      {partialLoginStats && showLogins && data && (
        <p className="mt-3 text-xs text-muted">
          Login figures cover only the workspaces where you manage logins.
        </p>
      )}
      {data?.truncated && (
        <TruncatedNote className="mt-3">
          These totals cover only the first 5,000 accounts evaluated.
        </TruncatedNote>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- readiness */

function ReadinessCard({ accounts, loading, onShow }) {
  return (
    <Card aria-label="Publishing readiness">
      <CardHeader
        icon={ShieldCheck}
        title="Publishing readiness"
        description="Checks permissions only. Publishing itself is not available in SocialHub yet, so nothing is posted."
      />
      <CardBody>
        {loading ? (
          <div className="space-y-4" aria-hidden="true">
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="grid gap-3 md:grid-cols-3">
              {READINESS_ROWS.map((row) => (
                <Skeleton key={row.status} className="h-28 rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <ReadinessBreakdown accounts={accounts} onShow={onShow} />
        )}
      </CardBody>
    </Card>
  );
}

function ReadinessBreakdown({ accounts, onShow }) {
  const rows = READINESS_ROWS.map((row) => ({
    ...row,
    count: accounts?.[row.field] ?? 0,
    label: PUBLISHING_TONE[row.status][1],
    tone: PUBLISHING_TONE[row.status][0],
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const share = (count) => (total ? Math.round((count / total) * 100) : 0);
  const describe = (row) => `${row.label}: ${NUMBER.format(row.count)} (${share(row.count)}%)`;

  return (
    <>
      {/* Thin part-to-whole bar: 2px surface gaps between parts, a part at zero draws nothing. */}
      <div
        role="img"
        aria-label={
          total
            ? `Publishing readiness of ${plural(total, 'account')}. ${rows.map(describe).join(', ')}.`
            : 'No accounts to assess yet.'
        }
        className={cn(
          'flex h-2 w-full gap-0.5 overflow-hidden rounded-full',
          total === 0 && 'bg-slate-100 dark:bg-white/10',
        )}
      >
        {rows
          .filter((row) => row.count > 0)
          .map((row) => (
            <span
              key={row.status}
              title={describe(row)}
              className={cn('h-full min-w-1 basis-0', row.bar)}
              style={{ flexGrow: row.count }}
            />
          ))}
      </div>

      <ul className="mt-5 grid gap-3 md:grid-cols-3">
        {rows.map((row) => (
          <li
            key={row.status}
            className="flex flex-col rounded-xl border border-slate-100 p-4 dark:border-white/5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={row.tone} dot>
                {row.label}
              </Badge>
              <span className="text-2xl font-semibold leading-none tracking-tight text-slate-900 dark:text-white">
                {formatCount(row.count)}
              </span>
            </div>
            <p className="mt-2.5 flex-1 text-xs leading-relaxed text-muted">
              {READINESS_HINTS[row.status]}
            </p>
            {row.count > 0 && (
              <button
                type="button"
                onClick={() => onShow(row.status)}
                aria-label={`Show accounts: ${row.label}`}
                className="mt-3 inline-flex items-center gap-1 self-start rounded-md text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Show accounts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ needs attention */

function AttentionSkeleton() {
  return (
    <Card aria-hidden="true" className="p-5 sm:px-6">
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </Card>
  );
}

function HealthyLine() {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-300"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      All accounts healthy — nothing needs attention right now.
    </p>
  );
}

function AttentionGroup({ title, count, action, children }) {
  return (
    <div className="border-t border-slate-100 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3 sm:px-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title} <span className="font-medium">({NUMBER.format(count)})</span>
        </h3>
        {action}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-white/5">{children}</ul>
    </div>
  );
}

function LoginAttentionRow({ login, slug, integration, sync }) {
  const nameId = useId();
  const reasonId = useId();
  const problems = loginProblems(login);
  const codes = new Set(problems.map((item) => item.code));
  const canReconnect =
    needsReconnect(login.status) || RECONNECT_FIXES.some((code) => codes.has(code));
  const canSync =
    login.status === CONNECTION_STATUS.ACTIVE && codes.has(ACCOUNT_ATTENTION.SYNC_FAILED);
  // Unknown (integration still loading or failed) is left to the server to decide.
  const configured = integration
    ? Boolean(integration[providerKey(login.provider)]?.configured)
    : true;
  const syncing = sync.pending.syncConnectionId === login.id;
  const reconnecting = sync.pending.reconnectConnectionId === login.id;
  const describedBy = cn(nameId, !configured && reasonId);

  return (
    <li className="px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <IdentityPicture connection={login} />
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              id={nameId}
              to={`/w/${slug}/accounts/logins/${login.id}`}
              className="min-w-0 truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
            >
              {login.displayName ?? 'Unnamed login'}
            </Link>
            <ConnectionStatusBadge status={login.status} reason={login.statusReason} />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {PROVIDER_LABELS[login.provider] ?? 'Meta'} login
            {typeof login.accountCount === 'number' &&
              ` · ${plural(login.accountCount, 'account')}`}
          </p>
          <AttentionList items={problems} className="mt-2" />
          {canSync && login.lastError?.message && (
            <p className="mt-1 text-xs text-muted">Last error: {login.lastError.message}</p>
          )}
          {!configured && (canReconnect || canSync) && (
            <p id={reasonId} className="mt-2 text-xs text-muted">
              {providerName(login.provider)} is not configured on the server, so this login cannot
              be reconnected or synced yet. See the setup notice above.
            </p>
          )}
        </div>
        {(canReconnect || canSync) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canSync && (
              <Button
                size="sm"
                variant="secondary"
                loading={syncing}
                disabled={!configured || login.syncInProgress}
                aria-describedby={describedBy}
                onClick={() => sync.syncConnection(login)}
              >
                {!syncing && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                {login.syncInProgress ? 'Sync running…' : 'Sync now'}
              </Button>
            )}
            {canReconnect && (
              <Button
                size="sm"
                loading={reconnecting}
                disabled={!configured}
                aria-describedby={describedBy}
                onClick={() => sync.reconnect({ provider: login.provider, connectionId: login.id })}
              >
                {!reconnecting && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                Reconnect
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function AccountAttentionRow({ account, href, showWorkspace }) {
  const health = account.health;
  const secondary = [
    PLATFORM_LABELS[account.platform],
    account.username && `@${account.username}`,
    showWorkspace && account.workspace?.name,
    account.connection?.displayName && `via ${account.connection.displayName}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
      <AccountPicture account={account} />
      <div className="min-w-0 flex-1 basis-52">
        {href ? (
          <Link
            to={href}
            className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
          >
            {account.name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold">{account.name}</span>
        )}
        <p className="truncate text-xs text-muted">{secondary}</p>
        <AttentionList items={health.attention} compact className="mt-1.5" />
      </div>
      <ReadinessBadge readiness={health.readiness} reasons={health.readinessReasons} />
    </li>
  );
}

function InlineError({ title, query }) {
  return (
    <div className="border-t border-slate-100 dark:border-white/5">
      <ErrorState title={title} error={query.error} onRetry={() => query.refetch()} />
    </div>
  );
}

function AttentionSection({
  allScope,
  manageLogins,
  slug,
  connections,
  attention,
  integration,
  sync,
  hasAccounts,
  crossLoginProblems,
  hrefFor,
  onShowAll,
}) {
  if (attention.isPending || (manageLogins && connections.isPending)) return <AttentionSkeleton />;

  const problemLogins = manageLogins
    ? (connections.data ?? [])
        .filter(loginNeedsAttention)
        // Logins that cannot be used at all come first; the order is otherwise the API's.
        .toSorted(
          (a, b) =>
            Number(b.status !== CONNECTION_STATUS.ACTIVE) -
            Number(a.status !== CONNECTION_STATUS.ACTIVE),
        )
    : [];
  const loginsError = manageLogins ? connections.error : null;
  // Only rows the server itself flagged (the request already asked for attention=true).
  const accounts = (attention.data?.items ?? []).filter((a) => a.health?.needsAttention);
  const accountTotal = accounts.length ? totalOf(attention.data) : 0;

  const nothing =
    !loginsError &&
    !attention.error &&
    problemLogins.length === 0 &&
    accountTotal === 0 &&
    !crossLoginProblems;
  // "Healthy" is only claimed when there is something to be healthy.
  if (nothing) return hasAccounts ? <HealthyLine /> : null;

  const description = allScope
    ? 'Accounts with a problem in any of your workspaces. Open one to see what needs fixing in its workspace.'
    : manageLogins
      ? 'Logins and accounts with a problem, most urgent first.'
      : 'Accounts you can use that have a problem.';

  return (
    <Card aria-label="Needs attention">
      <CardHeader icon={AlertTriangle} title="Needs attention" description={description} />
      <div className="mt-4">
        {loginsError ? (
          <InlineError title="Could not load the logins" query={connections} />
        ) : (
          problemLogins.length > 0 && (
            <AttentionGroup
              title="Logins"
              count={problemLogins.length}
              action={
                problemLogins.length > LOGIN_PREVIEW && (
                  <ButtonLink to={`/w/${slug}/accounts/logins`} variant="ghost" size="sm">
                    All logins <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </ButtonLink>
                )
              }
            >
              {problemLogins.slice(0, LOGIN_PREVIEW).map((login) => (
                <LoginAttentionRow
                  key={login.id}
                  login={login}
                  slug={slug}
                  integration={integration}
                  sync={sync}
                />
              ))}
            </AttentionGroup>
          )
        )}

        {attention.error ? (
          <InlineError title="Could not load the accounts needing attention" query={attention} />
        ) : (
          accountTotal > 0 && (
            <AttentionGroup
              title="Accounts"
              count={accountTotal}
              action={
                <Button variant="ghost" size="sm" onClick={onShowAll}>
                  Show all in the table <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              }
            >
              {accounts.map((account) => (
                <AccountAttentionRow
                  key={account.id}
                  account={account}
                  href={hrefFor(account)}
                  showWorkspace={allScope}
                />
              ))}
            </AttentionGroup>
          )
        )}

        {crossLoginProblems > 0 && (
          <p className="flex items-start gap-2 border-t border-slate-100 px-5 py-3.5 text-xs text-amber-800 sm:px-6 dark:border-white/5 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {plural(crossLoginProblems, 'login')} in workspaces you manage{' '}
            {crossLoginProblems === 1 ? 'needs' : 'need'} attention. Logins are reconnected and
            synced from the Logins tab of their own workspace.
          </p>
        )}

        {!manageLogins && !allScope && (
          <p className="border-t border-slate-100 px-5 py-3.5 text-xs text-muted sm:px-6 dark:border-white/5">
            Login problems (an expired or revoked login, missing permissions) can only be fixed by a
            workspace owner or admin. Ask one of them to reconnect the login.
          </p>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------- all accounts */

function NoAccounts({ allScope, canManage, accessMode, connections, integration, start, slug }) {
  if (allScope) {
    return (
      <EmptyState
        icon={Share2}
        title="No social accounts yet"
        description="None of your workspaces has Facebook Pages or Instagram accounts that you can use."
      />
    );
  }
  if (!canManage) {
    return (
      <EmptyState
        icon={Share2}
        title="No accounts shared with you"
        description={
          accessMode === ACCOUNT_ACCESS_MODES.ALL
            ? 'This workspace has no social accounts yet. Workspace admins connect Facebook Pages and Instagram accounts.'
            : 'No social accounts have been shared with you yet. Workspace admins decide which accounts each member can use.'
        }
      />
    );
  }
  if ((connections.data?.length ?? 0) > 0 || connections.error) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No accounts added yet"
        description="Choose which Pages and Instagram accounts to add from your logins."
        action={
          <ButtonLink to={`/w/${slug}/accounts/logins`}>
            Go to Logins <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        }
      />
    );
  }
  const configured = integration
    ? Boolean(integration.facebook?.configured || integration.instagram?.configured)
    : null;
  if (configured === false) {
    return (
      <EmptyState
        icon={Plug}
        title="No accounts yet"
        description="Connecting Facebook Pages and Instagram accounts needs the Meta app credentials on the server. The setup notice above lists what a server administrator must add."
      />
    );
  }
  return (
    <EmptyState
      icon={Share2}
      title="Connect your first account"
      description="Connect a Facebook login to add the Pages it manages and their linked Instagram accounts, or connect an Instagram professional account directly."
      action={
        configured && (
          <div className="flex flex-wrap justify-center gap-2">
            <ConnectButtons integration={integration} start={start} />
          </div>
        )
      }
    />
  );
}

function AccountsCard({
  cardRef,
  title,
  description,
  list,
  loading,
  query,
  filtersActive,
  noAccounts,
  connections,
  workspaces,
  columns,
  hrefFor,
  identityHrefFor,
}) {
  const data = list.data;
  const items = data?.items ?? [];
  const total = totalOf(data);
  const ready = !loading && Boolean(data);

  let empty = null;
  if (ready && items.length === 0) {
    empty =
      total > 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nothing on this page"
          description="The list has fewer pages now."
          action={
            <Button variant="secondary" onClick={() => query.update({ page: 1 })}>
              Go to the first page
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={SearchX}
          title="No accounts match these filters"
          description="Try another search, or remove a filter."
          action={
            <Button variant="secondary" onClick={() => query.clear()}>
              Clear filters
            </Button>
          }
        />
      );
  }

  return (
    <Card ref={cardRef} tabIndex={-1} aria-label={title} className="scroll-mt-6 overflow-hidden">
      <CardHeader title={title} description={description} />
      {list.error ? (
        <ErrorState
          title="Could not load the accounts"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : noAccounts ? (
        <div className="mt-2 border-t border-slate-100 dark:border-white/5">{noAccounts}</div>
      ) : (
        <>
          <AccountFilters
            state={query.state}
            update={query.update}
            clear={query.clear}
            active={filtersActive}
            facets={data?.facets}
            connections={connections}
            workspaces={workspaces}
            showPlatform
          />
          {empty ?? (
            <AccountsTable
              caption="Social accounts"
              items={items}
              columns={columns}
              sort={query.state.sort}
              onSortChange={(sort) => query.update({ sort })}
              loading={loading || !data}
              fetching={list.isPlaceholderData}
              hrefFor={hrefFor}
              identityHrefFor={identityHrefFor}
            />
          )}
          {ready && items.length > 0 && (
            <Pagination
              page={data.page ?? 1}
              pages={data.pages ?? 1}
              total={total}
              limit={data.limit ?? PAGE_SIZE}
              onPageChange={(page) => query.update({ page })}
              noun={total === 1 ? 'account' : 'accounts'}
            />
          )}
          {data?.truncated && (
            <TruncatedNote className="border-t border-slate-100 px-5 py-3 sm:px-6 dark:border-white/5">
              Only the first 5,000 accounts are evaluated, so this list may be incomplete.
            </TruncatedNote>
          )}
          <p role="status" className="sr-only">
            {ready && !list.isFetching
              ? `${plural(total, 'account')} ${filtersActive ? 'match the filters' : 'in total'}`
              : ''}
          </p>
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------------- page */

export default function AccountsOverviewPage() {
  const { workspace, membership, can } = useWorkspace();
  const canManage = can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const slug = workspace.slug;
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: workspaces = [] } = useWorkspaces();
  const multiWorkspace = workspaces.length > 1;
  const allScope = multiWorkspace && searchParams.get('scope') === 'all';
  // Login-level information and actions exist only for managers, in this workspace's scope.
  const manageLogins = canManage && !allScope;

  // The workspace filter exists only in the all-workspaces scope (GET /social-accounts accepts
  // it, the workspace endpoint does not); elsewhere a `workspaceId` in the URL is ignored.
  const query = useAccountQueryState({ pageSize: PAGE_SIZE, crossWorkspace: allScope });
  const tableRef = useRef(null);

  const integration = useMetaIntegration().data;
  const sync = useSyncFlow(workspace.id);
  const start = useStartAuthorization(workspace.id);
  const connections = useSocialConnections(workspace.id, { enabled: manageLogins });

  const workspaceSummary = useAccountSummary(workspace.id);
  const crossSummary = useMyAccountSummary({ enabled: allScope });
  const summary = allScope ? crossSummary : workspaceSummary;

  // The login filter is offered to managers of this workspace only, so elsewhere a login in the
  // URL is neither sent nor counted as an active filter.
  const listParams = manageLogins ? query.params : { ...query.params, connectionId: '' };
  const filtersActive = ACCOUNT_FILTER_KEYS.some(
    (key) => Boolean(query.state[key]) && (key !== 'connectionId' || manageLogins),
  );
  const workspaceList = useAccountList(workspace.id, listParams, { enabled: !allScope });
  const crossList = useMyAccounts(listParams, { enabled: allScope });
  const list = allScope ? crossList : workspaceList;

  const workspaceAttention = useAccountList(workspace.id, ATTENTION_PARAMS, {
    enabled: !allScope,
  });
  const crossAttention = useMyAccounts(ATTENTION_PARAMS, { enabled: allScope });
  const attention = allScope ? crossAttention : workspaceAttention;

  const loginCount = manageLogins ? (connections.data?.length ?? 0) : 0;
  const accountsTotal = summary.data?.accounts?.total ?? 0;
  const hasAccounts = accountsTotal > 0 || totalOf(list.data) > 0;
  // While the summary loads, guess from the roles whether login figures will be included.
  const expectLoginStats = allScope ? workspaces.some(managesLogins) : canManage;
  const partialLoginStats = allScope && workspaces.some((w) => !managesLogins(w));

  const setScope = (next) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') {
        params.set('scope', 'all');
        params.delete('connectionId');
      } else {
        params.delete('scope');
        params.delete('workspaceId');
      }
      params.delete('page');
      return params;
    });

  const revealTable = () => {
    const el = tableRef.current;
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  /** Shows exactly the accounts behind a figure: that one filter, nothing else. */
  const showOnly = (patch) => {
    query.update({ ...NO_FILTERS, ...patch });
    revealTable();
  };

  const hrefFor = allScope
    ? (a) => (a.workspace?.slug ? `/w/${a.workspace.slug}/accounts/a/${a.id}` : null)
    : (a) => `/w/${slug}/accounts/a/${a.id}`;
  const identityHrefFor = allScope
    ? (a) =>
        a.canManage && a.workspace?.slug && a.connection?.id
          ? `/w/${a.workspace.slug}/accounts/logins/${a.connection.id}`
          : null
    : canManage
      ? (a) => (a.connection?.id ? `/w/${slug}/accounts/logins/${a.connection.id}` : null)
      : undefined;

  // With no accounts at all, a manager's empty state depends on whether logins exist.
  const listEmpty = !list.isPending && !list.error && !filtersActive && totalOf(list.data) === 0;
  const waitingForLogins = listEmpty && manageLogins && connections.isPending;
  const noAccounts =
    listEmpty && !waitingForLogins ? (
      <NoAccounts
        allScope={allScope}
        canManage={canManage}
        accessMode={membership.accountAccess?.mode}
        connections={connections}
        integration={integration}
        start={start}
        slug={slug}
      />
    ) : null;

  const showSyncAll = manageLogins && loginCount > 0;

  return (
    <div className="space-y-6">
      {(multiWorkspace || showSyncAll) && (
        <div className="flex flex-wrap items-center gap-3">
          {multiWorkspace && (
            <>
              <ScopeToggle value={allScope ? 'all' : 'workspace'} onChange={setScope} />
              {allScope && (
                <p className="text-xs text-muted">
                  Read-only view of your {NUMBER.format(workspaces.length)} workspaces. Open an
                  account to manage it in its own workspace.
                </p>
              )}
            </>
          )}
          {showSyncAll && <SyncAllControl integration={integration} sync={sync} />}
        </div>
      )}

      <StatsSection
        summary={summary}
        expectLoginStats={expectLoginStats}
        partialLoginStats={partialLoginStats}
        allScope={allScope}
      />

      {!summary.error && (summary.isPending || accountsTotal > 0) && (
        <FollowersCard followers={summary.data?.followers} loading={summary.isPending} />
      )}

      <AttentionSection
        allScope={allScope}
        manageLogins={manageLogins}
        slug={slug}
        connections={connections}
        attention={attention}
        integration={integration}
        sync={sync}
        hasAccounts={hasAccounts}
        crossLoginProblems={allScope ? (summary.data?.connections?.needsAttention ?? 0) : 0}
        hrefFor={hrefFor}
        onShowAll={() => showOnly({ attention: 'true' })}
      />

      {!summary.error && (summary.isPending || accountsTotal > 0) && (
        <ReadinessCard
          accounts={summary.data?.accounts}
          loading={summary.isPending}
          onShow={(readiness) => showOnly({ readiness })}
        />
      )}

      <AccountsCard
        cardRef={tableRef}
        title={allScope ? 'Accounts in all your workspaces' : 'All accounts'}
        description={
          allScope
            ? 'Every account you can use, in every workspace you belong to.'
            : canManage
              ? 'Every Facebook Page and Instagram account in this workspace.'
              : 'The Facebook Pages and Instagram accounts you can use in this workspace.'
        }
        list={list}
        loading={list.isPending || waitingForLogins}
        query={query}
        filtersActive={filtersActive}
        noAccounts={noAccounts}
        connections={manageLogins ? connections.data : undefined}
        workspaces={allScope ? workspaces : undefined}
        columns={
          allScope
            ? [
                'account',
                'platform',
                'workspace',
                'identity',
                'followers',
                'readiness',
                'status',
                'lastSync',
              ]
            : ['account', 'platform', 'identity', 'followers', 'readiness', 'status', 'lastSync']
        }
        hrefFor={hrefFor}
        identityHrefFor={identityHrefFor}
      />

      {sync.dialog}
    </div>
  );
}
