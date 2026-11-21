/**
 * Shared body of the All accounts, Facebook Pages and Instagram tabs: search, filters, the
 * accounts table with row and bulk actions (refresh, reconnect, labels, team access, removal),
 * stars, CSV export, pagination and the readiness legend. Readiness always comes from the
 * server's computed `health`.
 */
import { LIMITS, PERMISSIONS, PUBLISHING_STATUS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Info,
  KeyRound,
  Link2,
  MoreHorizontal,
  RefreshCw,
  SearchX,
  Settings2,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import { Fragment, useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ReadinessBadge } from './AccountBadges.jsx';
import { AccountFilters } from './AccountFilters.jsx';
import { ApplyLabelsDialog } from './ApplyLabelsDialog.jsx';
import { ExportAccountsButton } from './ExportAccountsButton.jsx';
import { ManageLabelsDialog } from './ManageLabelsDialog.jsx';
import { AccountsTable } from './AccountsTable.jsx';
import { BulkAccessDialog } from './BulkAccessDialog.jsx';
import { BulkActionBar } from './BulkActionBar.jsx';
import { ConnectButtons } from './ConnectButtons.jsx';
import { Button, ButtonLink } from '../ui/Button.jsx';
import { Card } from '../ui/Card.jsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Spinner } from '../ui/Feedback.jsx';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu.jsx';
import { Pagination } from '../ui/Pagination.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useRemoveAccount, useRemoveAccounts } from '../../hooks/useAccountActions.js';
import { useAccountQueryState } from '../../hooks/useAccountQueryState.js';
import { useStartAuthorization } from '../../hooks/useStartAuthorization.js';
import { useSyncFlow } from '../../hooks/useSyncFlow.jsx';
import { copyText, platformSiteName, platformUrl } from '../../lib/accountOrganization.js';
import { READINESS_HINTS, needsReconnect } from '../../lib/meta.js';
import {
  useAccountLabels,
  useAccountList,
  useMetaIntegration,
  useSocialConnections,
} from '../../lib/queries.js';

const PAGE_SIZE = 25;
const SETUP_HINT = 'Meta setup required';

const LEGEND_ORDER = [
  PUBLISHING_STATUS.READY,
  PUBLISHING_STATUS.RESTRICTED,
  PUBLISHING_STATUS.UNAVAILABLE,
];

const counted = (n, copy) => `${n} ${n === 1 ? copy.one : copy.many}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Meta permission (or Page task) names as code, joined as "a, b and c". */
export function PermissionList({ names }) {
  return names.map((name, index) => (
    <Fragment key={name}>
      {index > 0 && (index === names.length - 1 ? ' and ' : ', ')}
      <code className="rounded-md bg-white px-1 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200 ring-inset dark:bg-white/5 dark:text-slate-200 dark:ring-white/10">
        {name}
      </code>
    </Fragment>
  ));
}

/** Collapsible explanation of the readiness labels; `entries` holds the platform's rules. */
function ReadinessLegend({ entries }) {
  return (
    <details className="group px-5 pb-4 sm:px-6">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white [&::-webkit-details-marker]:hidden">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        How publishing readiness is decided
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3 rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed dark:bg-white/[0.03]">
        <dl className="space-y-3">
          {LEGEND_ORDER.map((readiness) => (
            <div key={readiness} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
              <dt className="shrink-0 sm:w-52">
                <ReadinessBadge readiness={readiness} />
              </dt>
              <dd className="text-slate-600 dark:text-slate-300">
                {entries?.[readiness] ?? READINESS_HINTS[readiness]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-slate-200/70 pt-3 text-muted dark:border-white/10">
          Each label is the server’s latest check of the login’s permissions and Page role. It
          describes permissions only: publishing itself arrives in a later phase, and nothing is
          posted from SocialHub yet.
        </p>
      </div>
    </details>
  );
}

function ActionLabel({ children, hint }) {
  return (
    <span className="min-w-0">
      <span className="block">{children}</span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </span>
  );
}

function RowActions({
  account,
  canManage,
  detailHref,
  loginHref,
  providerConfigured,
  refreshing,
  reconnecting,
  onRefresh,
  onReconnect,
  onRemove,
  onLabels,
}) {
  const navigate = useNavigate();
  const connection = account.connection;
  const reconnectable = Boolean(connection) && needsReconnect(account.health?.connectionStatus);
  const externalUrl = platformUrl(account);
  return (
    <div className="flex items-center justify-end gap-1.5">
      {refreshing && <Spinner label={`Refreshing ${account.name}`} />}
      {reconnecting && (
        <Spinner label={`Opening Meta to reconnect ${connection?.displayName ?? 'the login'}`} />
      )}
      {/* Rendered in a portal: the table scrolls horizontally and would clip the menu. */}
      <Menu
        portal
        trigger={({ toggle, props }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            {...props}
            aria-label={`Actions for ${account.name}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={Eye}
              onClick={() => {
                close();
                navigate(detailHref);
              }}
            >
              View details
            </MenuItem>
            {externalUrl && (
              <MenuItem
                icon={ExternalLink}
                onClick={() => {
                  close();
                  window.open(externalUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                Open on {platformSiteName(account)}
              </MenuItem>
            )}
            <MenuItem
              icon={Copy}
              onClick={async () => {
                close();
                if (await copyText(account.externalId)) toast.success('Meta ID copied');
                else
                  toast.error(
                    `Copying was blocked by the browser. The Meta ID is ${account.externalId}.`,
                  );
              }}
            >
              Copy Meta ID
            </MenuItem>
            {canManage && (
              <MenuItem
                icon={Tag}
                onClick={() => {
                  close();
                  onLabels(account);
                }}
              >
                Labels…
              </MenuItem>
            )}
            {canManage && connection && (
              <>
                <MenuItem
                  icon={RefreshCw}
                  disabled={!providerConfigured || refreshing}
                  onClick={() => {
                    close();
                    onRefresh(account);
                  }}
                >
                  <ActionLabel hint={providerConfigured ? null : SETUP_HINT}>Refresh</ActionLabel>
                </MenuItem>
                {reconnectable && (
                  <MenuItem
                    icon={KeyRound}
                    disabled={!providerConfigured || reconnecting}
                    onClick={() => {
                      close();
                      onReconnect({ provider: connection.provider, connectionId: connection.id });
                    }}
                  >
                    <ActionLabel hint={providerConfigured ? null : SETUP_HINT}>
                      Reconnect login
                    </ActionLabel>
                  </MenuItem>
                )}
                <MenuItem
                  icon={Link2}
                  onClick={() => {
                    close();
                    navigate(loginHref);
                  }}
                >
                  View login
                </MenuItem>
              </>
            )}
            {canManage && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={Trash2}
                  danger
                  onClick={() => {
                    close();
                    onRemove(account);
                  }}
                >
                  Remove from workspace
                </MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
    </div>
  );
}

/**
 * One platform's destinations (the Facebook Pages tab, the Instagram tab): URL-synced search,
 * filters, sort and pagination; for members who manage logins also row selection with bulk
 * refresh / access / removal and per-row refresh, reconnect and removal. Readiness and status
 * always come from the server-computed `health`; every action reports what the server answered.
 *
 * `providers` are the logins that can yield this platform (login filter, Connect buttons).
 * `copy` holds the platform wording, `legend` the readiness rules keyed by PUBLISHING_STATUS,
 * `note` optional content above the table.
 */
export function DestinationTab({ platform, providers, columns, copy, legend, note, pageHrefFor }) {
  const { workspace, can } = useWorkspace();
  const canManage = can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const canManageAccess = can(PERMISSIONS.MEMBERS_MANAGE);
  const base = `/w/${workspace.slug}/accounts`;

  const { state, params, update, clear, active } = useAccountQueryState({
    platform,
    pageSize: PAGE_SIZE,
  });
  const list = useAccountList(workspace.id, params);
  const connections = useSocialConnections(workspace.id, { enabled: canManage });
  const integration = useMetaIntegration();
  const sync = useSyncFlow(workspace.id);
  const start = useStartAuthorization(workspace.id);
  const removeOne = useRemoveAccount(workspace.id);
  const removeMany = useRemoveAccounts(workspace.id);
  const labels = useAccountLabels(workspace.id);

  // Selected destinations by id (kept while paging or filtering), with the row data last seen.
  const [selected, setSelected] = useState(() => new Map());
  const [removing, setRemoving] = useState(null);
  const [confirmingBulkRemove, setConfirmingBulkRemove] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  // Accounts whose labels are being edited (one row, or the selection), and the label manager.
  const [labelling, setLabelling] = useState(null);
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false);
  const closeLabelling = useCallback(() => setLabelling(null), []);
  const closeManageLabels = useCallback(() => setManageLabelsOpen(false), []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);
  const closeRemove = useCallback(() => setRemoving(null), []);
  const closeBulkRemove = useCallback(() => setConfirmingBulkRemove(false), []);
  const closeAccess = useCallback(() => setAccessOpen(false), []);

  const data = list.data;
  const items = data?.items ?? [];
  const itemsById = new Map(items.map((a) => [a.id, a]));
  const selectedAccounts = [...selected.values()].map((a) => itemsById.get(a.id) ?? a);
  const selectedIds = new Set(selected.keys());
  const ids = selectedAccounts.map((a) => a.id);
  const count = ids.length;

  const meta = integration.data;
  // Unknown until the integration loads: the server stays authoritative (it answers
  // META_NOT_CONFIGURED / CONFIG_REQUIRED), so nothing is blocked before then.
  const configuredFor = (provider) =>
    !meta ||
    Boolean(
      provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN
        ? meta.instagram?.configured
        : meta.facebook?.configured,
    );
  const logins = canManage
    ? (connections.data ?? []).filter((c) => providers.includes(c.provider))
    : undefined;

  const hrefFor = (account) => `${base}/a/${account.id}`;
  const loginHrefFor = (account) =>
    account.connection ? `${base}/logins/${account.connection.id}` : null;

  const changeSelection = (nextIds) =>
    setSelected((prev) => {
      const next = new Map();
      for (const id of nextIds) {
        const account = itemsById.get(id) ?? prev.get(id);
        if (account) next.set(id, account);
      }
      return next;
    });
  const deselect = (id) =>
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  const clearFilters = () => clear();

  /** After removals, step back when the current page no longer exists. */
  const settlePage = (removedCount) => {
    if (!data) return;
    const remaining = Math.max(0, data.total - removedCount);
    const lastPage = Math.max(1, Math.ceil(remaining / data.limit));
    if (state.page > lastPage) update({ page: lastPage });
  };

  const openRemove = (account) => {
    removeOne.reset();
    setRemoving(account);
  };
  const confirmRemove = () => {
    const account = removing;
    if (!account) return;
    removeOne.mutate(account.id, {
      onSuccess: () => {
        toast.success(`${account.name} removed from the workspace`);
        deselect(account.id);
        setRemoving(null);
        settlePage(1);
      },
    });
  };

  const openBulkRemove = () => {
    removeMany.reset();
    setConfirmingBulkRemove(true);
  };
  const confirmBulkRemove = () => {
    const accountIds = ids;
    removeMany.mutate(accountIds, {
      onSuccess: ({ removed }) => {
        toast.success(
          removed === accountIds.length
            ? `${counted(removed, copy)} removed from the workspace`
            : `${removed} of ${counted(accountIds.length, copy)} removed — the others were already gone`,
        );
        clearSelection();
        setConfirmingBulkRemove(false);
        settlePage(removed);
      },
    });
  };

  /* ------------------------------------------------------------------ bulk bar */

  const withLogin = selectedAccounts.filter((a) => a.connection);
  const refreshable = withLogin.some((a) => configuredFor(a.connection.provider));
  const reconnectAccounts = withLogin.filter((a) => needsReconnect(a.health?.connectionStatus));
  const reconnectLogins = new Set(reconnectAccounts.map((a) => a.connection.id)).size;
  const offPage = selectedAccounts.filter((a) => !itemsById.has(a.id)).length;
  const overBulkLimit = count > LIMITS.BULK_MAX;
  const overAccessLimit = count > LIMITS.ACCOUNT_ACCESS_MAX;

  const notes = [];
  if (offPage > 0) {
    notes.push(
      <p key="off-page" className="text-muted">
        {offPage === count
          ? 'None of them are shown on this page.'
          : `${offPage} of them ${offPage === 1 ? 'is' : 'are'} not shown on this page.`}
      </p>,
    );
  }
  if (reconnectAccounts.length > 0) {
    const n = reconnectAccounts.length;
    notes.push(
      <p key="reconnect" className="text-amber-700 dark:text-amber-400">
        {`${n} of the selected ${copy.many} ${n === 1 ? 'belongs' : 'belong'} to ${plural(reconnectLogins, 'login')} that ${reconnectLogins === 1 ? 'needs' : 'need'} reconnecting. Meta authorizes one login at a time: use “Reconnect login” in a row’s actions, or reconnect from the `}
        <Link
          to={`${base}/logins`}
          className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
        >
          Logins tab
        </Link>
        .
      </p>,
    );
  }
  if (count > 0 && !refreshable) {
    notes.push(
      <p key="setup" className="text-muted">
        {withLogin.length === 0
          ? 'The selected accounts no longer have a login to refresh through.'
          : 'Refreshing needs the Meta app credentials on the server (setup required).'}
      </p>,
    );
  }
  if (overBulkLimit) {
    notes.push(
      <p key="limit" className="text-rose-600 dark:text-rose-400">
        Refresh and remove work on up to {LIMITS.BULK_MAX} accounts at a time
        {overAccessLimit ? `, access changes on up to ${LIMITS.ACCOUNT_ACCESS_MAX}` : ''}. Clear
        part of the selection to continue.
      </p>,
    );
  }

  /* -------------------------------------------------------------------- states */

  // "Nothing at all" (as opposed to "nothing matches the filters"): for a platform tab nothing
  // of that platform, for the All accounts tab nothing of any platform.
  const platformTotal = data?.facets?.platform
    ? platform
      ? (data.facets.platform[platform] ?? 0)
      : Object.values(data.facets.platform).reduce((sum, n) => sum + n, 0)
    : null;
  const noneAtAll =
    Boolean(data) && data.total === 0 && (platformTotal !== null ? platformTotal === 0 : !active);
  const providerReady = providers.some(configuredFor);
  const connectable = meta && {
    facebook: providers.includes(SOCIAL_PROVIDERS.FACEBOOK_LOGIN) ? meta.facebook : undefined,
    instagram: providers.includes(SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) ? meta.instagram : undefined,
  };

  const emptyNode = !data ? null : data.total > 0 ? (
    <EmptyState
      icon={SearchX}
      title="This page is empty"
      description={`The list changed since this page was opened. It now has ${plural(data.pages, 'page')}.`}
      action={
        <Button variant="secondary" size="sm" onClick={() => update({ page: data.pages })}>
          Go to page {data.pages}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={SearchX}
      title={copy.filteredTitle}
      description={`Try a different search or filter, or clear them to see all ${copy.many}.`}
      action={
        <Button variant="secondary" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  );

  const renderRowActions = (account) => (
    <RowActions
      account={account}
      canManage={canManage}
      detailHref={hrefFor(account)}
      loginHref={loginHrefFor(account)}
      providerConfigured={Boolean(account.connection) && configuredFor(account.connection.provider)}
      refreshing={sync.pending.refreshAccountId === account.id}
      reconnecting={
        Boolean(account.connection) && sync.pending.reconnectConnectionId === account.connection.id
      }
      onRefresh={sync.refreshAccount}
      onReconnect={sync.reconnect}
      onRemove={openRemove}
      onLabels={(row) => setLabelling([row])}
    />
  );

  const filterActions = (
    <>
      <ExportAccountsButton
        path={`/workspaces/${workspace.id}/social-accounts/export`}
        params={params}
      />
      {canManage && (
        <Button variant="secondary" size="sm" onClick={() => setManageLabelsOpen(true)}>
          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Manage labels
        </Button>
      )}
    </>
  );

  return (
    <div>
      {note && <div className="mb-4">{note}</div>}

      <Card>
        {noneAtAll ? (
          <EmptyState
            icon={copy.icon}
            title={copy.emptyTitle}
            description={
              !canManage
                ? copy.emptyShared
                : !providerReady
                  ? copy.emptySetup
                  : logins?.length
                    ? copy.emptyChoose
                    : copy.emptyConnect
            }
            action={
              canManage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <ConnectButtons integration={connectable} start={start} />
                  <ButtonLink variant="secondary" to={`${base}/logins`}>
                    Go to Logins
                  </ButtonLink>
                </div>
              ) : null
            }
          />
        ) : (
          <>
            <AccountFilters
              state={state}
              update={update}
              clear={clearFilters}
              active={active}
              facets={data?.facets}
              connections={logins}
              labels={labels.data?.items}
              showPlatform={!platform}
              searchPlaceholder={copy.searchPlaceholder}
              actions={filterActions}
            />
            <ReadinessLegend entries={legend} />

            {list.isError && !data ? (
              <ErrorState
                title={`${copy.caption} could not be loaded`}
                error={list.error}
                onRetry={() => list.refetch()}
              />
            ) : (
              <>
                {list.isError && (
                  <div
                    role="alert"
                    className="mx-5 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700 sm:mx-6 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      The list could not be refreshed: {list.error?.message ?? 'Please try again.'}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => list.refetch()}>
                      Try again
                    </Button>
                  </div>
                )}
                <AccountsTable
                  caption={copy.caption}
                  items={items}
                  columns={columns}
                  sort={state.sort}
                  onSortChange={(sort) => update({ sort })}
                  selectable={canManage}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={changeSelection}
                  loading={!data}
                  fetching={list.isPlaceholderData}
                  empty={emptyNode}
                  rowActions={renderRowActions}
                  hrefFor={hrefFor}
                  identityHrefFor={canManage ? loginHrefFor : undefined}
                  pageHrefFor={pageHrefFor}
                  star
                  onLabelClick={(label) => update({ label: label.id })}
                />
                {data && items.length > 0 && (
                  <Pagination
                    page={data.page}
                    pages={data.pages}
                    total={data.total}
                    limit={data.limit}
                    noun={copy.many}
                    onPageChange={(page) => update({ page })}
                  />
                )}
              </>
            )}
          </>
        )}
      </Card>

      {canManage && (
        <BulkActionBar count={count} onClear={clearSelection} noun={copy.one}>
          <Button
            variant="secondary"
            size="sm"
            loading={sync.pending.refreshAccounts}
            disabled={!refreshable || overBulkLimit}
            onClick={() => sync.refreshAccounts(ids, { onSuccess: clearSelection })}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh selected
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={overBulkLimit}
            onClick={() => setLabelling(selectedAccounts)}
          >
            <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Labels
          </Button>
          {canManageAccess && (
            <Button
              variant="secondary"
              size="sm"
              disabled={overAccessLimit}
              onClick={() => setAccessOpen(true)}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Manage access
            </Button>
          )}
          <Button
            variant="danger-outline"
            size="sm"
            disabled={overBulkLimit}
            onClick={openBulkRemove}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove from workspace
          </Button>
          {notes.length > 0 && (
            <div className="order-last basis-full space-y-1 text-xs leading-relaxed">{notes}</div>
          )}
        </BulkActionBar>
      )}

      {canManage && (
        <>
          <ConfirmDialog
            open={Boolean(removing)}
            title={`Remove ${removing?.name ?? 'this account'} from the workspace?`}
            description="It is removed from this workspace and from every member’s account access. The login it came from stays connected, so it can be added again later."
            confirmLabel="Remove from workspace"
            loading={removeOne.isPending}
            error={removeOne.error}
            onConfirm={confirmRemove}
            onClose={closeRemove}
          />
          <ConfirmDialog
            open={confirmingBulkRemove}
            title={`Remove ${counted(count, copy)} from the workspace?`}
            description="They are removed from this workspace and from every member’s account access. The logins they came from stay connected, so they can be added again later."
            confirmLabel={`Remove ${counted(count, copy)}`}
            loading={removeMany.isPending}
            error={removeMany.error}
            onConfirm={confirmBulkRemove}
            onClose={closeBulkRemove}
          >
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm dark:border-white/10">
              {selectedAccounts.slice(0, 10).map((a) => (
                <li key={a.id} className="truncate">
                  {a.name}
                </li>
              ))}
              {count > 10 && <li className="text-muted">and {count - 10} more</li>}
            </ul>
          </ConfirmDialog>
        </>
      )}
      {canManageAccess && (
        <BulkAccessDialog
          open={accessOpen}
          onClose={closeAccess}
          onDone={clearSelection}
          accountIds={ids}
        />
      )}
      {canManage && (
        <>
          <ApplyLabelsDialog
            open={Boolean(labelling)}
            accounts={labelling ?? []}
            onClose={closeLabelling}
            onDone={labelling && labelling.length > 1 ? clearSelection : undefined}
            onManage={() => {
              setLabelling(null);
              setManageLabelsOpen(true);
            }}
          />
          <ManageLabelsDialog open={manageLabelsOpen} onClose={closeManageLabels} />
        </>
      )}
      {sync.dialog}
    </div>
  );
}
