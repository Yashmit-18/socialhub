import { SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Link } from 'react-router';
import {
  ATTENTION_LABELS,
  PLATFORM_LABELS,
  PROVIDER_LABELS,
  instagramTypeLabel,
} from '../../lib/meta.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { Skeleton } from '../ui/Feedback.jsx';
import {
  AccountPicture,
  ConnectionStatusBadge,
  CreateContentBadge,
  ReadinessBadge,
} from './AccountBadges.jsx';

/*
 * Column registry. Pages pick columns by id, e.g.
 *   columns={['account', 'pageId', 'identity', 'createContent', 'readiness', 'status', 'lastSync']}
 * `hide` lists breakpoints below which a column is hidden (phones keep the essentials).
 */
const COLUMNS = {
  account: {
    header: 'Account',
    sortKey: 'name',
    defaultDirection: 'asc',
    cell: (a, ctx) => <AccountCell account={a} href={ctx.hrefFor?.(a)} />,
  },
  platform: {
    header: 'Platform',
    hide: 'md',
    cell: (a) => <span className="text-xs text-muted">{PLATFORM_LABELS[a.platform]}</span>,
  },
  pageId: {
    header: 'Page ID',
    hide: 'lg',
    cell: (a) => (
      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{a.externalId}</span>
    ),
  },
  instagramType: {
    header: 'Type',
    hide: 'md',
    cell: (a) => <span className="text-xs">{instagramTypeLabel(a.instagramAccountType)}</span>,
  },
  linkedPage: {
    header: 'Linked Facebook Page',
    hide: 'lg',
    cell: (a, ctx) => <LinkedPageCell account={a} hrefFor={ctx.pageHrefFor} />,
  },
  identity: {
    header: 'Login',
    hide: 'md',
    cell: (a, ctx) => <IdentityCell account={a} href={ctx.identityHrefFor?.(a)} />,
  },
  workspace: {
    header: 'Workspace',
    hide: 'md',
    cell: (a) => <span className="text-xs">{a.workspace?.name ?? '—'}</span>,
  },
  createContent: {
    header: 'CREATE_CONTENT',
    hide: 'xl',
    cell: (a) => <CreateContentBadge account={a} />,
  },
  readiness: {
    header: 'Publishing readiness',
    hide: 'sm',
    cell: (a) => (
      <ReadinessBadge readiness={a.health?.readiness} reasons={a.health?.readinessReasons} />
    ),
  },
  status: {
    header: 'Status',
    cell: (a) => <StatusCell account={a} />,
  },
  lastSync: {
    header: 'Last sync',
    hide: 'lg',
    sortKey: 'lastSyncedAt',
    defaultDirection: 'desc',
    cell: (a) =>
      a.lastSyncedAt ? (
        <time
          dateTime={a.lastSyncedAt}
          title={formatDate(a.lastSyncedAt, { dateStyle: 'medium', timeStyle: 'short' })}
          className="text-xs whitespace-nowrap text-muted"
        >
          {timeAgo(a.lastSyncedAt)}
        </time>
      ) : (
        <span className="text-xs text-muted">Never</span>
      ),
  },
};

const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

function AccountCell({ account, href }) {
  const secondary =
    account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT
      ? account.username && `@${account.username}`
      : account.category;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountPicture account={account} size="sm" />
      <div className="min-w-0">
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
        <span className="block truncate text-xs text-muted">
          {secondary || PLATFORM_LABELS[account.platform]}
        </span>
      </div>
    </div>
  );
}

function IdentityCell({ account, href }) {
  const connection = account.connection;
  if (!connection) return <span className="text-xs text-muted">Login removed</span>;
  const name = connection.displayName ?? 'Unnamed login';
  return (
    <div className="min-w-0 text-xs">
      {href ? (
        <Link
          to={href}
          className="block truncate font-medium hover:text-brand-600 dark:hover:text-brand-300"
        >
          {name}
        </Link>
      ) : (
        <span className="block truncate font-medium">{name}</span>
      )}
      <span className="block text-muted">{PROVIDER_LABELS[connection.provider]} login</span>
    </div>
  );
}

function LinkedPageCell({ account, hrefFor }) {
  if (account.connection?.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN && !account.linkedPage) {
    return <span className="text-xs text-muted">None (Instagram Login)</span>;
  }
  if (!account.linkedPage) return <span className="text-xs text-muted">—</span>;
  const name = account.linkedPage.name ?? `Page ${account.linkedPage.externalId}`;
  const href = account.linkedPage.id ? hrefFor?.(account.linkedPage) : null;
  return href ? (
    <Link to={href} className="text-xs font-medium hover:text-brand-600 dark:hover:text-brand-300">
      {name}
    </Link>
  ) : (
    <span className="text-xs">{name}</span>
  );
}

function StatusCell({ account }) {
  const attention = account.health?.attention ?? [];
  return (
    <div className="space-y-1">
      <ConnectionStatusBadge
        status={account.health?.connectionStatus ?? account.connectionStatus}
        reason={account.health?.connectionStatusReason}
      />
      {attention.length > 0 && (
        <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400">
          {attention.map((item) => ATTENTION_LABELS[item.code] ?? item.code).join(' · ')}
        </p>
      )}
    </div>
  );
}

function SortHeader({ column, sort, onSortChange }) {
  const direction = sort === column.sortKey ? 'asc' : sort === `-${column.sortKey}` ? 'desc' : null;
  const next =
    direction === null
      ? column.defaultDirection === 'desc'
        ? `-${column.sortKey}`
        : column.sortKey
      : direction === 'asc'
        ? `-${column.sortKey}`
        : column.sortKey;
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onSortChange(next)}
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-200"
    >
      {column.header}
      <Icon className={cn('h-3 w-3', !direction && 'opacity-40')} aria-hidden="true" />
      <span className="sr-only">
        {direction ? `, sorted ${direction === 'asc' ? 'ascending' : 'descending'}` : ', sortable'}
      </span>
    </button>
  );
}

/**
 * Table of destinations with optional row selection, sortable headers and per-row actions.
 * Selection covers the rows on the current page. While `loading` (first load) skeleton rows
 * are shown; while `fetching` (filters changed, previous rows kept) the table is dimmed.
 */
export function AccountsTable({
  caption,
  items = [],
  columns,
  sort,
  onSortChange,
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  loading = false,
  fetching = false,
  skeletonRows = 4,
  empty = null,
  rowActions,
  hrefFor,
  identityHrefFor,
  pageHrefFor,
}) {
  const defs = columns.map((col) =>
    typeof col === 'string' ? { id: col, ...COLUMNS[col] } : { ...COLUMNS[col.id], ...col },
  );
  const ctx = { hrefFor, identityHrefFor, pageHrefFor };
  const selected = selectedIds ?? new Set();
  const pageIds = items.map((a) => a.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;

  const toggleAll = () => {
    const next = new Set(selected);
    for (const id of pageIds) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    onSelectedIdsChange?.(next);
  };
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange?.(next);
  };

  if (!loading && items.length === 0) return empty;

  return (
    <div
      className={cn('overflow-x-auto transition-opacity', fetching && 'opacity-60')}
      aria-busy={loading || fetching || undefined}
    >
      <table className="w-full min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/60 text-[11px] text-slate-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
            {selectable && (
              <th scope="col" className="w-10 py-2.5 pl-5 pr-2 sm:pl-6">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedOnPage > 0 && !allSelected;
                  }}
                  onChange={toggleAll}
                  disabled={loading || pageIds.length === 0}
                  aria-label="Select all accounts on this page"
                />
              </th>
            )}
            {defs.map((col, index) => (
              <th
                key={col.id}
                scope="col"
                aria-sort={
                  col.sortKey && sort === col.sortKey
                    ? 'ascending'
                    : col.sortKey && sort === `-${col.sortKey}`
                      ? 'descending'
                      : undefined
                }
                className={cn(
                  'py-2.5 pr-4 font-semibold uppercase tracking-wider whitespace-nowrap',
                  index === 0 && !selectable && 'pl-5 sm:pl-6',
                  HIDE_BELOW[col.hide],
                  col.headerClassName,
                )}
              >
                {col.sortKey && onSortChange ? (
                  <SortHeader column={col} sort={sort} onSortChange={onSortChange} />
                ) : (
                  col.header
                )}
              </th>
            ))}
            {rowActions && (
              <th scope="col" className="w-12 py-2.5 pr-5 sm:pr-6">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {loading
            ? Array.from({ length: skeletonRows }, (_, row) => (
                <tr key={`skeleton-${row}`}>
                  {selectable && (
                    <td className="py-3.5 pl-5 pr-2 sm:pl-6">
                      <Skeleton className="h-4 w-4" />
                    </td>
                  )}
                  {defs.map((col, index) => (
                    <td
                      key={col.id}
                      className={cn(
                        'py-3.5 pr-4',
                        index === 0 && !selectable && 'pl-5 sm:pl-6',
                        HIDE_BELOW[col.hide],
                      )}
                    >
                      {index === 0 ? (
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-8 w-8 rounded-xl" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      ) : (
                        <Skeleton className="h-4 w-20" />
                      )}
                    </td>
                  ))}
                  {rowActions && <td className="pr-5 sm:pr-6" />}
                </tr>
              ))
            : items.map((account) => {
                const isSelected = selected.has(account.id);
                return (
                  <tr
                    key={account.id}
                    className={cn(
                      'align-middle transition-colors',
                      isSelected
                        ? 'bg-brand-50/50 dark:bg-brand-500/[0.06]'
                        : 'hover:bg-slate-50/70 dark:hover:bg-white/[0.02]',
                    )}
                  >
                    {selectable && (
                      <td className="py-3 pl-5 pr-2 sm:pl-6">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                          checked={isSelected}
                          onChange={() => toggle(account.id)}
                          aria-label={`Select ${account.name}`}
                        />
                      </td>
                    )}
                    {defs.map((col, index) => (
                      <td
                        key={col.id}
                        className={cn(
                          'max-w-[18rem] py-3 pr-4',
                          index === 0 && !selectable && 'pl-5 sm:pl-6',
                          HIDE_BELOW[col.hide],
                          col.className,
                        )}
                      >
                        {col.cell(account, ctx)}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="py-3 pr-5 text-right sm:pr-6">{rowActions(account)}</td>
                    )}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
