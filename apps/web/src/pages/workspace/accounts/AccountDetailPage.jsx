import {
  ACCOUNT_ACCESS_MODES,
  CONNECTION_STATUS,
  ERROR_CODES,
  PAGE_PUBLISHING_TASK,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  hasFullAccountAccess,
} from '@socialhub/shared';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  CircleX,
  HeartPulse,
  History,
  Info,
  KeyRound,
  Link2,
  LogIn,
  MoreHorizontal,
  RefreshCw,
  SearchX,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ActivityFeed } from '../../../components/ActivityFeed.jsx';
import {
  AccountPicture,
  AttentionList,
  ConnectionStatusBadge,
  CreateContentBadge,
  IdentityPicture,
  ReadinessBadge,
} from '../../../components/accounts/AccountBadges.jsx';
import { MetaSetupNotice } from '../../../components/accounts/MetaSetupNotice.jsx';
import { SyncRunList } from '../../../components/accounts/SyncRunList.jsx';
import { PageHeader } from '../../../components/layout/AppShell.jsx';
import { Avatar } from '../../../components/ui/Avatar.jsx';
import { Badge, RoleBadge } from '../../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../../components/ui/Button.jsx';
import { Card, CardBody, CardFooter, CardHeader } from '../../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback.jsx';
import { FormError } from '../../../components/ui/Field.jsx';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useRemoveAccount, useUpdateAccountMembers } from '../../../hooks/useAccountActions.js';
import { useSyncFlow } from '../../../hooks/useSyncFlow.jsx';
import {
  PLATFORM_LABELS,
  PROVIDER_LABELS,
  READINESS_HINTS,
  connectionExpiry,
  createContentState,
  instagramTypeLabel,
  needsReconnect,
} from '../../../lib/meta.js';
import { useAccountDetail, useMetaIntegration } from '../../../lib/queries.js';
import { cn, formatDate, timeAgo } from '../../../lib/utils.js';

/*
 * Destination detail (/w/:slug/accounts/a/:accountId): one Facebook Page or Instagram account
 * with its server-computed health and publishing readiness, account information, the login it
 * was added through, linked accounts and permissions, plus — depending on the member's role —
 * sync history, activity and team access. Everything shown comes from the API: readiness is
 * never computed here, and sections the API returns as null are not rendered at all.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const LINK_CLASS =
  'font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300';

/** A malformed id in the URL is answered with 422 by the API: for this page it is simply not found. */
const isNotFound = (error) => error?.status === 404 || error?.code === ERROR_CODES.VALIDATION_ERROR;

/** Whether the member sees every account of the workspace (by role, or with "All accounts"). */
const seesEveryAccount = (membership) =>
  hasFullAccountAccess(membership?.role) ||
  membership?.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL;

const READY_TEXT = {
  pageRole:
    'SocialHub has the permissions and Page role this account needs for publishing. Publishing itself is not available yet.',
  instagramLogin:
    'SocialHub has the permissions this account needs for publishing. Publishing itself is not available yet.',
};

/** Team access state of one member, as the API reports it. */
function accessLabel(member) {
  if (member.fullAccess) return 'Full access';
  if (member.mode === ACCOUNT_ACCESS_MODES.ALL) return 'All accounts';
  return member.hasAccess ? 'Has access' : 'No access';
}

/** What saving will do for a member whose checkbox differs from the saved state. */
function pendingLabel(member, wanted) {
  if (wanted) return 'Gets access when you save';
  if (member.mode === ACCOUNT_ACCESS_MODES.ALL)
    return 'Switches to selected accounts when you save, keeping every other account';
  return 'Loses access when you save';
}

/* ------------------------------------------------------------------ small pieces */

function BackLink({ to, children }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-slate-900 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {children}
    </Link>
  );
}

function SectionTitle({ id, children }) {
  return (
    <h3 id={id} className="text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </h3>
  );
}

function DateText({ value, relative = false }) {
  if (!value) return <span className="text-muted">Unknown</span>;
  return (
    <time dateTime={value} title={formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })}>
      {relative ? timeAgo(value) : formatDate(value)}
    </time>
  );
}

function ScopeBadges({ scopes, tone = 'neutral', label, empty = 'None' }) {
  if (!scopes?.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {scopes.map((scope) => (
        <li key={scope}>
          <Badge tone={tone} className="font-mono">
            {scope}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Page role tasks reported by Meta; CREATE_CONTENT (needed for publishing) is highlighted. */
function TaskBadges({ tasks }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Page tasks">
      {tasks.map((task) => (
        <li key={task}>
          <Badge tone={task === PAGE_PUBLISHING_TASK ? 'success' : 'neutral'} className="font-mono">
            {task}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  );
}

function Note({ id, children, className }) {
  return (
    <p id={id} className={cn('flex items-start gap-2 text-sm text-muted', className)}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* --------------------------------------------------------------------- header */

function AccountHeader({ account, actions }) {
  const health = account.health ?? {};
  const secondary = [account.username && `@${account.username}`, account.category]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex items-start gap-4">
      <div className="pt-1">
        <AccountPicture account={account} size="lg" />
      </div>
      <div className="min-w-0 flex-1">
        <PageHeader
          eyebrow={PLATFORM_LABELS[account.platform] ?? 'Social account'}
          title={<span className="break-words">{account.name}</span>}
          description={
            <span className="flex flex-col gap-2">
              {secondary && <span className="break-words">{secondary}</span>}
              <span className="flex flex-wrap items-center gap-2">
                <ConnectionStatusBadge
                  status={health.connectionStatus}
                  reason={health.connectionStatusReason}
                />
                <ReadinessBadge readiness={health.readiness} reasons={health.readinessReasons} />
              </span>
            </span>
          }
          actions={actions}
        />
      </div>
    </div>
  );
}

/** Refresh / Reconnect / menu for members who manage logins (capabilities.canManageConnections). */
function HeaderActions({ account, connection, sync, blocked, blockedId, loginUrl, onRemove }) {
  const navigate = useNavigate();
  const showReconnect = Boolean(connection) && needsReconnect(account.health?.connectionStatus);
  const describedBy = blocked ? blockedId : undefined;
  const reconnect = () =>
    sync.reconnect({ provider: connection.provider, connectionId: connection.id });

  return (
    <>
      <Button
        variant="secondary"
        disabled={Boolean(blocked)}
        aria-describedby={describedBy}
        loading={sync.pending.refreshAccountId === account.id}
        onClick={() => sync.refreshAccount(account)}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
      </Button>
      {showReconnect && (
        <Button
          disabled={Boolean(blocked)}
          aria-describedby={describedBy}
          loading={sync.pending.reconnectConnectionId === connection.id}
          onClick={reconnect}
        >
          <LogIn className="h-4 w-4" aria-hidden="true" /> Reconnect login
        </Button>
      )}
      <div className="flex items-center">
        <Menu
          trigger={({ toggle, props }) => (
            <Button
              variant="secondary"
              size="icon"
              onClick={toggle}
              {...props}
              aria-label={`More actions for ${account.name}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        >
          {(close) => (
            <>
              {loginUrl && (
                <MenuItem
                  icon={UserRound}
                  onClick={() => {
                    close();
                    navigate(loginUrl);
                  }}
                >
                  View login
                </MenuItem>
              )}
              {connection && !showReconnect && (
                <MenuItem
                  icon={KeyRound}
                  disabled={Boolean(blocked)}
                  onClick={() => {
                    close();
                    reconnect();
                  }}
                >
                  Reconnect to update permissions
                </MenuItem>
              )}
              {connection && <MenuSeparator />}
              <MenuItem
                icon={Trash2}
                danger
                onClick={() => {
                  close();
                  onRemove();
                }}
              >
                Remove from workspace
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </>
  );
}

/** Why Refresh/Reconnect are disabled when the login's Meta app is not configured, plus the setup notice. */
function SetupRequired({ id, message }) {
  const integration = useMetaIntegration();
  return (
    <div className="mb-6 space-y-3">
      <Note id={id}>{message}</Note>
      <MetaSetupNotice integration={integration.data} />
    </div>
  );
}

/* ---------------------------------------------------------------------- cards */

function HealthCard({ account, provider }) {
  const health = account.health ?? {};
  const reasons = health.readinessReasons ?? [];
  const missing = health.eligibility?.missingPermissions ?? [];
  const [, , createContentHint] = createContentState(account);
  // Problems already explained as readiness reasons are not repeated.
  const otherAttention = (health.attention ?? []).filter((item) => !reasons.includes(item.message));
  const ready = health.readiness === PUBLISHING_STATUS.READY;

  return (
    <Card>
      <CardHeader
        icon={HeartPulse}
        title="Health and publishing readiness"
        description="Computed by SocialHub from the login's current permissions and Page role. It describes permissions only: nothing is published yet."
      />
      <CardBody className="space-y-5">
        <div className="space-y-2.5">
          <ReadinessBadge readiness={health.readiness} reasons={reasons} />
          {ready ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN
                ? READY_TEXT.instagramLogin
                : READY_TEXT.pageRole}
            </p>
          ) : reasons.length > 0 ? (
            <ul className="space-y-1.5" aria-label="Why this account is not ready">
              {reasons.map((reason) => (
                <li
                  key={reason}
                  className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{READINESS_HINTS[health.readiness]}</p>
          )}
        </div>

        {missing.length > 0 && (
          <div className="space-y-2">
            <SectionTitle>Missing permissions</SectionTitle>
            <ScopeBadges scopes={missing} tone="danger" label="Missing permissions" />
          </div>
        )}

        <div className="space-y-2">
          <SectionTitle>Page role (CREATE_CONTENT)</SectionTitle>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <CreateContentBadge account={account} />
            <p className="min-w-0 flex-1 basis-48 text-xs text-muted">{createContentHint}</p>
          </div>
        </div>

        {otherAttention.length > 0 && (
          <div className="space-y-2">
            <SectionTitle>Also needs attention</SectionTitle>
            <AttentionList items={otherAttention} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function InfoCard({ account, provider }) {
  const isPage = account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
  const tasks = account.tasks ?? [];
  return (
    <Card>
      <CardHeader
        icon={Info}
        title="Account information"
        description="Details from Meta as of the last successful synchronization."
      />
      <CardBody>
        <dl className="divide-y divide-slate-100 dark:divide-white/5">
          <InfoRow label="Platform">
            {PLATFORM_LABELS[account.platform] ?? account.platform}
          </InfoRow>
          <InfoRow label={isPage ? 'Page ID' : 'Instagram account ID'}>
            <span className="font-mono text-[13px] break-all">{account.externalId}</span>
          </InfoRow>
          {(!isPage || account.username) && (
            <InfoRow label="Username">
              {account.username ? (
                `@${account.username}`
              ) : (
                <span className="text-muted">Not reported</span>
              )}
            </InfoRow>
          )}
          {(isPage || account.category) && (
            <InfoRow label="Category">
              {account.category ?? <span className="text-muted">Not reported</span>}
            </InfoRow>
          )}
          {!isPage && (
            <InfoRow label="Instagram account type">
              {instagramTypeLabel(account.instagramAccountType)}
            </InfoRow>
          )}
          <InfoRow label="Page tasks">
            {provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN ? (
              <span className="text-muted">Not applicable (Instagram Login)</span>
            ) : tasks.length > 0 ? (
              <TaskBadges tasks={tasks} />
            ) : (
              <span className="text-muted">Not reported</span>
            )}
          </InfoRow>
          <InfoRow label="Added on">
            <DateText value={account.createdAt} />
          </InfoRow>
          <InfoRow label="Last successful sync">
            {account.lastSyncedAt ? (
              <DateText value={account.lastSyncedAt} relative />
            ) : (
              <span className="text-muted">Never</span>
            )}
          </InfoRow>
        </dl>
      </CardBody>
    </Card>
  );
}

function LoginCard({ detail, loginUrl, loginsUrl }) {
  const { connection, account } = detail;

  if (!connection) {
    return (
      <Card>
        <CardHeader icon={UserRound} title="Login" />
        <CardBody className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              The login this account was added through has been removed. Reconnect a login that
              manages it.
            </span>
          </p>
          {loginsUrl && (
            <ButtonLink to={loginsUrl} variant="secondary" size="sm">
              Go to logins
            </ButtonLink>
          )}
        </CardBody>
      </Card>
    );
  }

  const name = connection.displayName ?? 'Unnamed login';
  // Members who manage logins get the full login view; everyone else a summary without dates.
  const fullView = Object.hasOwn(connection, 'tokenExpiresAt');
  const reason =
    connection.statusReason ??
    (connection.status !== CONNECTION_STATUS.ACTIVE
      ? (account.health?.connectionStatusReason ?? null)
      : null);
  const expiry = fullView ? connectionExpiry(connection) : null;

  return (
    <Card>
      <CardHeader
        icon={UserRound}
        title="Login"
        description="The Meta login SocialHub uses to reach this account."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <IdentityPicture connection={connection} />
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm font-semibold">
              {loginUrl ? (
                <Link
                  to={loginUrl}
                  className="text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                >
                  {name}
                </Link>
              ) : (
                name
              )}
            </p>
            <p className="text-xs text-muted">
              {PROVIDER_LABELS[connection.provider] ?? 'Meta'} login
            </p>
          </div>
          <ConnectionStatusBadge status={connection.status} reason={reason} />
        </div>

        {reason && (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{reason}</span>
          </p>
        )}

        {fullView && (
          <ul className="space-y-1 text-xs text-muted">
            {expiry && (
              <li className={expiry.warn ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                {expiry.text}
              </li>
            )}
            {connection.connectedBy?.name && (
              <li>
                Connected by {connection.connectedBy.name}
                {connection.createdAt && (
                  <>
                    {' '}
                    on <DateText value={connection.createdAt} />
                  </>
                )}
              </li>
            )}
            <li>
              Last successful sync:{' '}
              {connection.lastSyncedAt ? (
                <DateText value={connection.lastSyncedAt} relative />
              ) : (
                'never'
              )}
            </li>
          </ul>
        )}

        {connection.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN && (
          <p className="text-xs text-muted">
            A Facebook login can manage many Pages, and a Page can be managed through several
            logins. SocialHub uses the one this account was added through.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function LinkedRow({ account, href }) {
  const secondary =
    account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT
      ? account.username && `@${account.username}`
      : account.category;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      <AccountPicture account={account} size="sm" />
      <div className="min-w-0 flex-1 basis-32">
        <Link
          to={href}
          className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
        >
          {account.name}
        </Link>
        <p className="truncate text-xs text-muted">
          {secondary || PLATFORM_LABELS[account.platform]}
        </p>
      </div>
      <ReadinessBadge
        readiness={account.health?.readiness}
        reasons={account.health?.readinessReasons}
      />
    </li>
  );
}

function LinkedAccountsCard({ detail, provider, accountUrl, seesAll }) {
  const { account } = detail;
  const isPage = account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
  const linkedInstagram = detail.linkedInstagram ?? [];

  let body;
  if (isPage) {
    body =
      linkedInstagram.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {linkedInstagram.map((ig) => (
            <LinkedRow key={ig.id} account={ig} href={accountUrl(ig.id)} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {seesAll
            ? 'No Instagram account linked to this Page in SocialHub.'
            : 'No Instagram account linked to this Page is available to you in SocialHub.'}
        </p>
      );
  } else if (detail.linkedPage) {
    body = (
      <ul>
        <LinkedRow account={detail.linkedPage} href={accountUrl(detail.linkedPage.id)} />
      </ul>
    );
  } else if (account.linkedPage) {
    // The Page is named either way (the name is not secret), but only linked when accessible.
    body = (
      <div className="text-sm">
        <p>
          <span className="font-semibold">
            {account.linkedPage.name ?? `Page ${account.linkedPage.externalId}`}
          </span>{' '}
          <span className="text-muted">
            {seesAll ? '(not added to this workspace)' : '(not shared with you)'}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Facebook Page · ID <span className="font-mono">{account.linkedPage.externalId}</span>
        </p>
      </div>
    );
  } else if (provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) {
    body = (
      <p className="text-sm text-muted">
        Connected directly with Instagram Login — no Facebook Page.
      </p>
    );
  } else {
    body = <p className="text-sm text-muted">Meta did not report a linked Facebook Page.</p>;
  }

  return (
    <Card>
      <CardHeader
        icon={Link2}
        title="Linked accounts"
        description={
          isPage
            ? 'Instagram professional accounts linked to this Page.'
            : 'The Facebook Page linked to this Instagram account, if any.'
        }
      />
      <CardBody>{body}</CardBody>
    </Card>
  );
}

function PermissionsCard({ detail, provider }) {
  const checklistId = useId();
  const { permissions, account, connection } = detail;

  if (!permissions) {
    return (
      <Card>
        <CardHeader icon={KeyRound} title="Permissions" />
        <CardBody>
          <p className="text-sm text-muted">
            Permissions are not available because the login this account was added through has been
            removed.
          </p>
        </CardBody>
      </Card>
    );
  }

  const required = permissions.requiredForPublishing ?? [];
  const missing = new Set(permissions.missing ?? []);
  const otherGranted = (permissions.granted ?? []).filter((scope) => !required.includes(scope));
  const tasks = permissions.tasks ?? [];
  const loginName = connection?.displayName ?? 'this login';

  return (
    <Card>
      <CardHeader
        icon={KeyRound}
        title="Permissions"
        description={`Granted to ${loginName}; they apply to every account it manages.`}
      />
      <CardBody className="space-y-5">
        <div className="space-y-2">
          <SectionTitle id={checklistId}>Needed for publishing</SectionTitle>
          <ul
            aria-labelledby={checklistId}
            className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-white/5 dark:border-white/10"
          >
            {required.map((scope) => {
              const granted = !missing.has(scope);
              return (
                <li key={scope} className="flex items-center gap-2.5 px-3 py-2">
                  {granted ? (
                    <CircleCheck
                      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleX
                      className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                      aria-hidden="true"
                    />
                  )}
                  <code className="min-w-0 flex-1 font-mono text-xs break-all">{scope}</code>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      granted
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400',
                    )}
                  >
                    {granted ? 'Granted' : 'Missing'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <SectionTitle>Other granted permissions</SectionTitle>
          <ScopeBadges scopes={otherGranted} label="Other granted permissions" />
        </div>

        {permissions.declined !== undefined && (
          <div className="space-y-2">
            <SectionTitle>Declined</SectionTitle>
            <ScopeBadges
              scopes={permissions.declined}
              tone="warning"
              label="Declined permissions"
            />
          </div>
        )}

        <div className="space-y-2">
          <SectionTitle>Page role</SectionTitle>
          <div>
            <CreateContentBadge account={account} />
          </div>
          {provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN ? (
            <p className="text-xs text-muted">
              Instagram Login accounts are not managed through a Facebook Page role.
            </p>
          ) : tasks.length > 0 ? (
            <TaskBadges tasks={tasks} />
          ) : (
            <p className="text-xs text-muted">Meta has not reported this login's Page tasks.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function SyncHistoryCard({ runs, connection, loginUrl }) {
  return (
    <Card>
      <CardHeader
        icon={History}
        title="Sync history"
        description={`Synchronizations of ${connection?.displayName ?? 'the login'}. Each one refreshes every account the login manages.`}
        action={
          loginUrl && (
            <Link to={loginUrl} className={cn('text-sm', LINK_CLASS)}>
              Full history
            </Link>
          )
        }
      />
      <div className="mt-4 border-t border-slate-100 dark:border-white/5">
        <SyncRunList runs={runs} emptyText="This login has not been synchronized yet." />
      </div>
    </Card>
  );
}

function ActivityCard({ items, activityUrl }) {
  return (
    <Card>
      <CardHeader
        icon={Activity}
        title="Activity"
        description="Recent changes to this account and its login."
        action={
          <Link to={activityUrl} className={cn('text-sm', LINK_CLASS)}>
            All activity
          </Link>
        }
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

/**
 * Who can use this destination. Changes are collected locally (one desired value per member)
 * and saved as a single `{ grant, revoke }` request; the server applies the role hierarchy and
 * converts an "All accounts" member it revokes to selected accounts (every other one kept).
 */
function TeamAccessCard({ account, members }) {
  const { workspace, membership } = useWorkspace();
  const update = useUpdateAccountMembers(workspace.id, account.id);
  const [desired, setDesired] = useState(() => new Map());
  const allModeNoteId = useId();

  const wants = (member) =>
    desired.has(member.memberId) ? desired.get(member.memberId) : member.hasAccess;
  // Only real differences from the saved state count (the list is refetched after changes).
  const changed = members.filter((m) => m.manageable && wants(m) !== m.hasAccess);
  const grant = changed.filter((m) => wants(m)).map((m) => m.memberId);
  const revoke = changed.filter((m) => !wants(m)).map((m) => m.memberId);
  const dirty = changed.length > 0;
  const manageableCount = members.filter((m) => m.manageable).length;
  const anyAllMode = members.some((m) => m.manageable && m.mode === ACCOUNT_ACCESS_MODES.ALL);

  const toggle = (member) => {
    update.reset();
    setDesired((prev) => {
      const next = new Map(prev);
      const value = !(next.has(member.memberId) ? next.get(member.memberId) : member.hasAccess);
      if (value === member.hasAccess) next.delete(member.memberId);
      else next.set(member.memberId, value);
      return next;
    });
  };

  const resetChanges = () => {
    update.reset();
    setDesired(new Map());
  };

  const save = () => {
    const summary = [
      grant.length > 0 && `${plural(grant.length, 'member')} added`,
      revoke.length > 0 && `${plural(revoke.length, 'member')} removed`,
    ]
      .filter(Boolean)
      .join(', ');
    update.mutate(
      { grant, revoke },
      {
        onSuccess: () => {
          setDesired(new Map());
          toast.success(`Access to ${account.name} updated: ${summary}`);
        },
      },
    );
  };

  const showNotes = anyAllMode || manageableCount === 0 || Boolean(update.error);

  return (
    <Card>
      <CardHeader
        icon={Users}
        title="Team access"
        description="Members who can use this account. Owners and admins always have access to every account."
      />
      {members.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No members to show.</p>
        </CardBody>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
          {members.map((member) => {
            const checked = wants(member);
            const pending = member.manageable && checked !== member.hasAccess;
            const editable = member.manageable && !update.isPending;
            return (
              <li key={member.memberId}>
                <label
                  className={cn(
                    'flex items-center gap-3 px-5 py-3 sm:px-6',
                    editable && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600 disabled:cursor-not-allowed dark:border-white/20"
                    checked={checked}
                    disabled={!editable}
                    onChange={() => toggle(member)}
                    aria-label={`Access for ${member.user.name}`}
                    aria-describedby={
                      member.manageable && member.mode === ACCOUNT_ACCESS_MODES.ALL
                        ? allModeNoteId
                        : undefined
                    }
                  />
                  <Avatar name={member.user.name} seed={member.user.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.user.name}
                      {member.memberId === membership.id && (
                        <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">{member.user.email}</span>
                    {pending && (
                      <span className="mt-0.5 block text-xs font-medium text-sky-700 dark:text-sky-300">
                        {pendingLabel(member, checked)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <RoleBadge role={member.role} />
                    <span className="text-xs text-muted">{accessLabel(member)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {showNotes && (
        <CardBody className="space-y-3 border-t border-slate-100 py-4 dark:border-white/5">
          {anyAllMode && (
            <p id={allModeNoteId} className="text-xs text-muted">
              Unchecking a member who has “All accounts” switches them to selected accounts: they
              keep every other account and lose only this one.
            </p>
          )}
          {manageableCount === 0 && (
            <p className="text-xs text-muted">
              There is nobody here whose access you can change: owners and admins always have
              access, and you cannot change your own access.
            </p>
          )}
          <FormError message={update.error?.message} />
        </CardBody>
      )}
      {manageableCount > 0 && (
        <CardFooter>
          <p className="mr-auto text-xs text-muted" aria-live="polite">
            {dirty ? plural(changed.length, 'unsaved change') : 'No unsaved changes'}
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={!dirty || update.isPending}
              onClick={resetChanges}
            >
              Reset
            </Button>
            <Button disabled={!dirty} loading={update.isPending} onClick={save}>
              Save changes
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------ page */

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading account…
      </p>
      <div className="mb-8 flex items-start gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-3 pt-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-64 max-w-full" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-44 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {[4, 6, 3, 2].map((rows, card) => (
          <Card key={card} className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {Array.from({ length: rows }, (_, row) => (
                <Skeleton key={row} className="h-4 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AccountView({ detail }) {
  const { workspace, membership } = useWorkspace();
  const navigate = useNavigate();
  const sync = useSyncFlow(workspace.id);
  const remove = useRemoveAccount(workspace.id);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const blockedId = useId();

  const { account, connection } = detail;
  const capabilities = detail.capabilities ?? {};
  const manage = Boolean(capabilities.canManageConnections);
  const provider = connection?.provider ?? account.connection?.provider ?? null;
  const base = `/w/${workspace.slug}/accounts`;
  const tab =
    account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE
      ? { to: `${base}/pages`, label: 'Facebook Pages' }
      : { to: `${base}/instagram`, label: 'Instagram' };
  const loginUrl = manage && connection ? `${base}/logins/${connection.id}` : null;
  const accountUrl = (id) => `${base}/a/${id}`;

  // Why Refresh/Reconnect cannot run: nothing is attempted (and nothing simulated) in that case.
  const blocked = !manage
    ? null
    : !connection
      ? 'Refresh is unavailable: the login this account was added through has been removed.'
      : capabilities.providerConfigured
        ? null
        : `${PROVIDER_LABELS[connection.provider] ?? 'This'} Login is not configured on this server, so SocialHub cannot refresh or reconnect this account.`;

  const { reset: resetRemove } = remove;
  const closeRemove = useCallback(() => {
    resetRemove();
    setConfirmingRemove(false);
  }, [resetRemove]);

  const confirmRemove = () =>
    remove.mutate(account.id, {
      onSuccess: () => {
        toast.success(`${account.name} removed from the workspace`);
        navigate(tab.to);
      },
    });

  return (
    <>
      <BackLink to={tab.to}>{tab.label}</BackLink>
      <AccountHeader
        account={account}
        actions={
          manage && (
            <HeaderActions
              account={account}
              connection={connection}
              sync={sync}
              blocked={blocked}
              blockedId={blockedId}
              loginUrl={loginUrl}
              onRemove={() => setConfirmingRemove(true)}
            />
          )
        }
      />

      {blocked &&
        (connection ? (
          <SetupRequired id={blockedId} message={blocked} />
        ) : (
          <Note id={blockedId} className="mb-6">
            {blocked}
          </Note>
        ))}

      {/* grid-cols-1 (minmax(0, 1fr)) keeps long unbreakable content from widening the column. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <HealthCard account={account} provider={provider} />
        <InfoCard account={account} provider={provider} />
        <LoginCard
          detail={detail}
          loginUrl={loginUrl}
          loginsUrl={manage ? `${base}/logins` : null}
        />
        <LinkedAccountsCard
          detail={detail}
          provider={provider}
          accountUrl={accountUrl}
          seesAll={seesEveryAccount(membership)}
        />
        <PermissionsCard detail={detail} provider={provider} />
        {Array.isArray(detail.syncHistory) && (
          <SyncHistoryCard runs={detail.syncHistory} connection={connection} loginUrl={loginUrl} />
        )}
        {Array.isArray(detail.activity) && (
          <ActivityCard items={detail.activity} activityUrl={`/w/${workspace.slug}/activity`} />
        )}
        {Array.isArray(detail.access) && (
          <TeamAccessCard account={account} members={detail.access} />
        )}
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        title={`Remove ${account.name}?`}
        description={`It is removed from this workspace and from every member's account access.${
          connection ? ' Its login stays connected, so you can add it again later.' : ''
        }`}
        confirmLabel="Remove account"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={confirmRemove}
        onClose={closeRemove}
      />
      {sync.dialog}
    </>
  );
}

function AccountDetail({ accountId }) {
  const { workspace } = useWorkspace();
  const { data, error, isPending, refetch } = useAccountDetail(workspace.id, accountId);
  const accountsUrl = `/w/${workspace.slug}/accounts`;

  if (isPending) {
    return (
      <>
        <BackLink to={accountsUrl}>Social accounts</BackLink>
        <DetailSkeleton />
      </>
    );
  }

  // A failed background refetch keeps showing the last good data; a 404 never does.
  if (error && (isNotFound(error) || !data)) {
    return (
      <>
        <BackLink to={accountsUrl}>Social accounts</BackLink>
        <Card>
          {isNotFound(error) ? (
            <EmptyState
              icon={SearchX}
              title="Account not found"
              description="It may have been removed, or you may not have access to it."
              action={
                <ButtonLink to={accountsUrl} variant="secondary">
                  Back to social accounts
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState title="Could not load this account" error={error} onRetry={refetch} />
          )}
        </Card>
      </>
    );
  }

  return <AccountView detail={data} />;
}

export default function AccountDetailPage() {
  const { accountId } = useParams();
  // Following a linked-account link changes the id: start that account with fresh local state.
  return <AccountDetail key={accountId} accountId={accountId} />;
}
