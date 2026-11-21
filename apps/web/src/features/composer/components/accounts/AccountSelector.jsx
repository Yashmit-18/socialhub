import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import {
  ListChecks,
  ListX,
  Plug,
  Search,
  SearchX,
  Share2,
  TriangleAlert,
  UserRoundX,
  X,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button, ButtonLink } from '../../../../components/ui/Button.jsx';
import { Card } from '../../../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/ui/Feedback.jsx';
import { cn } from '../../../../lib/utils.js';
import {
  PLATFORM_FILTERS,
  countByPlatform,
  filterAccounts,
  platformsOf,
  quickSelectGroups,
} from '../../model/accounts.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';
import { AccountOption } from './AccountOption.jsx';
import { AccountPresets } from './AccountPresets.jsx';
import { PlatformFilter } from './PlatformFilter.jsx';
import { QuickSelect } from './QuickSelect.jsx';

const GROUP_LABELS = {
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: 'Facebook Pages',
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: 'Instagram accounts',
};

const STACK_MAX = 5;
const SKELETON_ROWS = 4;

const accountsLabel = (n) => `${n} account${n === 1 ? '' : 's'}`;

function summaryText(status, total, selectedCount) {
  if (status === 'loading') return 'Loading your accounts…';
  if (status === 'error') return "Your accounts couldn't be loaded.";
  if (total === 0) return 'No accounts available yet.';
  if (selectedCount === 0) return 'Choose one or more accounts for this post.';
  return `${selectedCount} of ${accountsLabel(total)} selected`;
}

function SelectedStack({ accounts }) {
  const shown = accounts.slice(0, STACK_MAX);
  const extra = accounts.length - shown.length;
  return (
    <div
      className="flex items-center -space-x-2"
      aria-hidden="true"
      title={accounts.map((account) => account.name).join(', ')}
    >
      {shown.map((account) => (
        <AccountAvatar key={account.id} account={account} size="sm" showPlatform={false} />
      ))}
      {extra > 0 && (
        <span className="relative inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-900">
          +{extra}
        </span>
      )}
    </div>
  );
}

function SearchField({ value, onChange, inputRef, className }) {
  const id = useId();
  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };
  return (
    <div className={cn('relative min-w-0', className)}>
      <label htmlFor={id} className="sr-only">
        Search accounts
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        placeholder="Search accounts"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          'block h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white pr-9 pl-9 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400',
          'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none',
          'dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400',
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search text"
          className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div role="status" className="space-y-1 px-2 pt-3 pb-4 sm:px-3">
      <span className="sr-only">Loading accounts…</span>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div
          key={index}
          data-testid="account-skeleton"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5"
        >
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn('h-3.5', index % 2 ? 'w-1/3' : 'w-1/2')} />
            <Skeleton className={cn('h-3', index % 2 ? 'w-1/2' : 'w-2/5')} />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoAccounts({ canManageAccounts, accountsHref }) {
  if (canManageAccounts) {
    return (
      <EmptyState
        icon={Plug}
        title="No social accounts connected yet"
        description="Connect a Facebook Page or Instagram professional account to start composing."
        action={
          accountsHref ? <ButtonLink to={accountsHref}>Go to Social accounts</ButtonLink> : null
        }
      />
    );
  }
  return (
    <EmptyState
      icon={UserRoundX}
      title="No accounts assigned to you"
      description="No social accounts have been assigned to you yet. Ask a workspace owner or admin to give you access."
    />
  );
}

function FilteredEmpty({ query, platform, onClearSearch, onShowAll }) {
  const trimmed = query.trim();
  const platformName = GROUP_LABELS[platform] ?? 'accounts';
  return (
    <EmptyState
      icon={SearchX}
      className="py-10"
      title={trimmed ? `No accounts match “${trimmed}”` : `No ${platformName} available to you`}
      description={
        trimmed
          ? 'Try a name, @username, category or linked Page.'
          : `None of the accounts you can use are ${platformName}.`
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {trimmed && (
            <Button variant="secondary" size="sm" onClick={onClearSearch}>
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear search
            </Button>
          )}
          {platform !== PLATFORM_FILTERS.ALL && (
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              Show all platforms
            </Button>
          )}
        </div>
      }
    />
  );
}

function AccountList({ groups, showHeaders, selectedSet, onToggle }) {
  const id = useId();
  return (
    <fieldset className="min-w-0 px-2 pb-3 sm:px-3">
      <legend className="sr-only">Accounts to post to</legend>
      <div className="space-y-3 pt-1 sm:max-h-[26rem] sm:overflow-y-auto sm:overscroll-contain">
        {groups.map(([platform, list]) => {
          const headingId = `${id}-${platform}`;
          return (
            <div
              key={platform}
              role={showHeaders ? 'group' : undefined}
              aria-labelledby={showHeaders ? headingId : undefined}
            >
              {showHeaders && (
                <p
                  id={headingId}
                  className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
                >
                  {GROUP_LABELS[platform] ?? platform}{' '}
                  <span className="font-medium tracking-normal normal-case">· {list.length}</span>
                </p>
              )}
              <ul className="space-y-1">
                {list.map((account) => (
                  <li key={account.id}>
                    <AccountOption
                      account={account}
                      selected={selectedSet.has(account.id)}
                      onToggle={onToggle}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * "Post to" card: choose the destinations for a post.
 *
 * `accounts` are normalized (model/accounts.js → normalizeAccounts) and `selectedIds` is the
 * composer's `selectedAccountIds`. Selection changes go through the callbacks (wire them to
 * composerActions.toggleAccount / selectAccounts / deselectAccounts / setSelectedAccounts).
 * Selected ids that are not in `accounts` (e.g. access was removed) are reported, never shown
 * as selectable.
 */
export function AccountSelector({
  accounts = [],
  selectedIds = [],
  onToggle,
  onSelect,
  onDeselect,
  onSetSelected,
  status = 'ready',
  error,
  onRetry,
  canManageAccounts = false,
  accountsHref,
  presets,
  className,
}) {
  const [platform, setPlatform] = useState(PLATFORM_FILTERS.ALL);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const titleId = useId();

  const ready = status === 'ready';
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const selectedSet = new Set(selectedIds);
  const selectedAccounts = ready ? [...selectedSet].map((id) => byId.get(id)).filter(Boolean) : [];
  const missingIds = ready ? [...selectedSet].filter((id) => !byId.has(id)) : [];

  const filtered = filterAccounts(accounts, { platform, query });
  const filteredIds = filtered.map((account) => account.id);
  const allShownSelected = filtered.length > 0 && filteredIds.every((id) => selectedSet.has(id));
  const isFiltered = platform !== PLATFORM_FILTERS.ALL || query.trim() !== '';
  const showHeaders = platform === PLATFORM_FILTERS.ALL;
  const groups = showHeaders
    ? platformsOf(filtered).map((p) => [p, filtered.filter((account) => account.platform === p)])
    : [[platform, filtered]];

  const focusSearch = () => searchRef.current?.focus();

  let body;
  if (status === 'loading') {
    body = <LoadingRows />;
  } else if (status === 'error') {
    body = <ErrorState title="Couldn't load your accounts" error={error} onRetry={onRetry} />;
  } else if (accounts.length === 0) {
    body = <NoAccounts canManageAccounts={canManageAccounts} accountsHref={accountsHref} />;
  } else {
    body = (
      <>
        <div className="space-y-3 px-5 pt-4 sm:px-6">
          <PlatformFilter
            value={platform}
            onChange={setPlatform}
            counts={countByPlatform(accounts)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              value={query}
              onChange={setQuery}
              inputRef={searchRef}
              className="min-w-[12rem] flex-1"
            />
            <AccountPresets
              accounts={accounts}
              selectedIds={selectedIds}
              onApply={onSetSelected}
              presets={presets}
            />
          </div>
          <QuickSelect
            groups={quickSelectGroups(accounts)}
            selectedSet={selectedSet}
            onSelect={onSelect}
            onDeselect={onDeselect}
          />
        </div>

        <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-100 px-5 py-1.5 sm:px-6 dark:border-white/5">
          <p className="text-xs text-muted" aria-live="polite">
            {isFiltered
              ? `Showing ${filtered.length} of ${accounts.length}`
              : accountsLabel(accounts.length)}
          </p>
          {filtered.length > 0 &&
            (allShownSelected ? (
              <Button variant="ghost" size="sm" onClick={() => onDeselect?.(filteredIds)}>
                <ListX className="h-3.5 w-3.5" aria-hidden="true" /> Deselect shown
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => onSelect?.(filteredIds)}>
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                {`Select all shown (${filtered.length})`}
              </Button>
            ))}
        </div>

        {filtered.length === 0 ? (
          <FilteredEmpty
            query={query}
            platform={platform}
            onClearSearch={() => {
              setQuery('');
              focusSearch();
            }}
            onShowAll={() => {
              setPlatform(PLATFORM_FILTERS.ALL);
              focusSearch();
            }}
          />
        ) : (
          <AccountList
            groups={groups}
            showHeaders={showHeaders}
            selectedSet={selectedSet}
            onToggle={onToggle}
          />
        )}
      </>
    );
  }

  return (
    <Card className={className} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <Share2 className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-slate-900 dark:text-white"
            >
              Post to
            </h2>
            <p className="mt-0.5 text-sm text-muted" aria-live="polite">
              {summaryText(status, accounts.length, selectedAccounts.length)}
            </p>
          </div>
        </div>
        {selectedAccounts.length > 0 && (
          <div className="flex items-center gap-2">
            <SelectedStack accounts={selectedAccounts} />
            <Button variant="ghost" size="sm" onClick={() => onSetSelected?.([])}>
              Clear <span className="sr-only">selection</span>
            </Button>
          </div>
        )}
      </div>

      {missingIds.length > 0 && (
        <div className="mx-5 mt-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 sm:mx-6 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 leading-relaxed">
            {missingIds.length === 1
              ? '1 selected account is no longer available to you and will be left out.'
              : `${missingIds.length} selected accounts are no longer available to you and will be left out.`}
          </p>
          <button
            type="button"
            onClick={() => onDeselect?.(missingIds)}
            className="shrink-0 rounded-md font-semibold underline-offset-2 hover:underline"
          >
            Remove from selection
          </button>
        </div>
      )}

      {body}
    </Card>
  );
}
