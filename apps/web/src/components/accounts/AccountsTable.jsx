import { ACCOUNT_ATTENTION, SOCIAL_PLATFORMS, isInstagramDirectProvider } from '@socialhub/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, StickyNote } from 'lucide-react';
import { Link } from 'react-router';
import {
  ATTENTION_LABELS,
  PLATFORM_LABELS,
  PROVIDER_LABELS,
  instagramTypeLabel,
  loginFlowName,
} from '../../lib/meta.js';
import { formatFollowers } from '../../lib/followers.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { Skeleton } from '../ui/Feedback.jsx';
import {
  AccountPicture,
  ConnectionStatusBadge,
  PageRoleLine,
  ReadinessBadge,
} from './AccountBadges.jsx';
import { LabelChips, StarButton } from './AccountLabels.jsx';

/*
 * Column registry. Pages pick columns by id, or pass an object to set options, e.g.
 *   columns={[{ id: 'account', secondary: 'pageId' }, 'identity', { id: 'status', pageRole: true }]}
 * - account `secondary`: what the line under the name says. Not set: @username or category;
 *   'platform': the platform first; 'pageId': category and the Page ID; 'instagramType':
 *   @username and Business / Creator. Facts about the account live under its name rather than
 *   in columns of their own, so the table fits without wrapping.
 * - status `pageRole`: the Page-role check under the connection badge (Facebook Pages).
 * `hide` lists breakpoints below which a column is hidden (phones keep the essentials).
 */
const COLUMNS = {
  account: {
    header: 'Account',
    sortKey: 'name',
    defaultDirection: 'asc',
    cell: (a, ctx, col) => (
      <AccountCell
        account={a}
        href={ctx.hrefFor?.(a)}
        star={ctx.star}
        onLabelClick={ctx.onLabelClick}
        secondary={col.secondary}
      />
    ),
  },
  linkedPage: {
    header: 'Linked Facebook Page',
    hide: 'xl',
    // The one header allowed to wrap: it keeps the Instagram table inside 1280 px screens.
    headerClassName: 'whitespace-normal',
    cell: (a, ctx) => <LinkedPageCell account={a} hrefFor={ctx.pageHrefFor} />,
  },
  identity: {
    header: 'Login',
    hide: 'xl',
    cell: (a, ctx) => <IdentityCell account={a} href={ctx.identityHrefFor?.(a)} />,
  },
  workspace: {
    header: 'Workspace',
    hide: 'lg',
    cell: (a) => <span className="text-xs">{a.workspace?.name ?? '—'}</span>,
  },
  readiness: {
    header: 'Publishing readiness',
    hide: 'md',
    cell: (a) => (
      <ReadinessBadge readiness={a.health?.readiness} reasons={a.health?.readinessReasons} />
    ),
  },
  followers: {
    header: 'Followers',
    sortKey: 'followers',
    defaultDirection: 'desc',
    // Per-account counts are secondary: the dashboards show the combined and per-platform totals.
    hide: 'wide',
    headerClassName: 'text-right',
    className: 'text-right',
    // null = Meta has not returned a count: shown as "—", never as 0.
    cell: (a) =>
      typeof a.followersCount === 'number' ? (
        <span
          className="text-xs tabular-nums text-slate-700 dark:text-slate-200"
          title={
            a.followersCountUpdatedAt
              ? `As of ${formatDate(a.followersCountUpdatedAt, { dateStyle: 'medium', timeStyle: 'short' })}`
              : undefined
          }
        >
          {formatFollowers(a.followersCount)}
        </span>
      ) : (
        <span className="text-xs text-muted" title="Meta has not returned a follower count yet">
          —
        </span>
      ),
  },
  status: {
    header: 'Status',
    cell: (a, ctx, col) => <StatusCell account={a} pageRole={col.pageRole} />,
  },
  lastSync: {
    header: 'Last sync',
    hide: 'xl',
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

/*
 * On phones the table scrolls sideways; the actions column stays pinned to the right edge so
 * the row menu is always reachable. From sm up it is an ordinary column again. Pinned cells
 * need opaque backgrounds that match what is under them: the header band, the card
 * (white / slate-900) or a selected row's tint.
 */
const PINNED_ACTIONS =
  'sticky right-0 pl-2 shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.35)] sm:static sm:bg-transparent sm:pl-0 sm:shadow-none dark:sm:bg-transparent';
const PINNED_BG = {
  head: 'bg-[color-mix(in_oklab,var(--color-slate-50)_60%,white)] dark:bg-[color-mix(in_oklab,white_2%,var(--color-slate-900))]',
  row: 'bg-white dark:bg-slate-900',
  selected:
    'bg-[color-mix(in_oklab,var(--color-brand-50)_50%,white)] dark:bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--color-slate-900))]',
};

const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  // Wide desktops only: below ~1360px the Instagram table would push the row actions out of view.
  wide: 'hidden min-[1360px]:table-cell',
};

function Dot() {
  return <span aria-hidden="true">{' · '}</span>;
}

/** The line under an account's name; see `secondary` in the registry above. */
function AccountSecondary({ account, variant }) {
  const isInstagram = account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;
  const usual = isInstagram ? account.username && `@${account.username}` : account.category;
  const className = 'block truncate text-xs text-muted';
  if (variant === 'platform') {
    return (
      <span className={className}>
        {[PLATFORM_LABELS[account.platform], usual].filter(Boolean).join(' · ')}
      </span>
    );
  }
  if (variant === 'pageId') {
    return (
      <span className={className}>
        {account.category && (
          <>
            {account.category}
            <Dot />
          </>
        )}
        ID{' '}
        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
          {account.externalId}
        </span>
      </span>
    );
  }
  if (variant === 'instagramType') {
    // Separate elements: the username and the type are each looked up on their own.
    return (
      <span className={className}>
        {account.username && (
          <>
            <span>{`@${account.username}`}</span>
            <Dot />
          </>
        )}
        <span>{instagramTypeLabel(account.instagramAccountType)}</span>
      </span>
    );
  }
  return <span className={className}>{usual || PLATFORM_LABELS[account.platform]}</span>;
}

function AccountCell({ account, href, star = false, onLabelClick, secondary }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountPicture account={account} size="sm" />
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-1">
          {href ? (
            <Link
              to={href}
              className="truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
            >
              {account.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold">{account.name}</span>
          )}
          {account.hasNotes && (
            <StickyNote
              className="h-3 w-3 shrink-0 text-slate-400"
              aria-label="Has team notes"
              role="img"
            />
          )}
          {star && <StarButton account={account} className="-my-1" />}
        </span>
        <AccountSecondary account={account} variant={secondary} />
        <LabelChips labels={account.labels} onLabelClick={onLabelClick} className="mt-1" />
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
      <span className="block whitespace-nowrap text-muted">
        {PROVIDER_LABELS[connection.provider]} login
      </span>
    </div>
  );
}

function LinkedPageCell({ account, hrefFor }) {
  if (isInstagramDirectProvider(account.connection?.provider) && !account.linkedPage) {
    return (
      <span
        className="text-xs text-muted"
        title={`Connected directly with ${loginFlowName(account.connection.provider)}, so it is not linked to a Facebook Page`}
      >
        Not linked
      </span>
    );
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

function StatusCell({ account, pageRole = false }) {
  // With the Page-role line shown, its own problem is not repeated in the amber note.
  const attention = (account.health?.attention ?? []).filter(
    (item) => !pageRole || item.code !== ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT,
  );
  return (
    <div className="space-y-1">
      <ConnectionStatusBadge
        status={account.health?.connectionStatus ?? account.connectionStatus}
        reason={account.health?.connectionStatusReason}
      />
      {pageRole && <PageRoleLine account={account} />}
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
  star = false,
  onLabelClick,
}) {
  const defs = columns.map((col) =>
    typeof col === 'string' ? { id: col, ...COLUMNS[col] } : { ...COLUMNS[col.id], ...col },
  );
  const ctx = { hrefFor, identityHrefFor, pageHrefFor, star, onLabelClick };
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
              <th scope="col" className="w-10 py-2.5 pl-5 pr-2 align-middle sm:pl-6">
                <input
                  type="checkbox"
                  className="h-4 w-4 checkbox"
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
                  'py-2.5 pr-4 align-middle font-semibold uppercase tracking-wider whitespace-nowrap',
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
              <th
                scope="col"
                className={cn('w-12 py-2.5 pr-5 sm:pr-6', PINNED_ACTIONS, PINNED_BG.head)}
              >
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
                          className="h-4 w-4 checkbox"
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
                        {col.cell(account, ctx, col)}
                      </td>
                    ))}
                    {rowActions && (
                      <td
                        className={cn(
                          'py-3 pr-5 text-right sm:pr-6',
                          PINNED_ACTIONS,
                          isSelected ? PINNED_BG.selected : PINNED_BG.row,
                        )}
                      >
                        {rowActions(account)}
                      </td>
                    )}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
