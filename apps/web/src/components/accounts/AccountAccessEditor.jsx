import { ACCOUNT_ACCESS_MODES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { AccountPicture } from './AccountBadges.jsx';

const MODE_OPTIONS = [
  {
    value: ACCOUNT_ACCESS_MODES.SELECTED,
    title: 'Selected accounts only',
    body: 'Only the accounts you pick below. New accounts are not shared automatically.',
  },
  {
    value: ACCOUNT_ACCESS_MODES.ALL,
    title: 'All accounts',
    body: 'Every current and future social account in this workspace.',
  },
];

const GROUPS = [
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE, 'Facebook Pages'],
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT, 'Instagram accounts'],
];

function matches(account, needle) {
  if (!needle) return true;
  return [account.name, account.username, account.externalId, account.connection?.displayName].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(needle),
  );
}

/**
 * Controlled editor for one member's (or invitee's) social account access: a mode (ALL or
 * SELECTED) and, for SELECTED, the chosen destinations. Least privilege is the default: an
 * empty selection means the member sees no accounts. The server validates every id again.
 *
 * `accounts` are workspace destinations (GET /social-accounts items).
 */
export function AccountAccessEditor({
  mode,
  onModeChange,
  selectedIds,
  onSelectedIdsChange,
  accounts = [],
  loading = false,
  error = null,
  allowAll = true,
  subject = 'this member',
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = accounts.filter((a) => matches(a, needle));
  const visibleIds = visible.map((a) => a.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggle = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };
  const setVisible = (on) => {
    const next = new Set(selectedIds);
    for (const id of visibleIds) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onSelectedIdsChange(next);
  };

  const options = allowAll
    ? MODE_OPTIONS
    : MODE_OPTIONS.filter((o) => o.value !== ACCOUNT_ACCESS_MODES.ALL);
  const selectedCount = accounts.filter((a) => selectedIds.has(a.id)).length;

  return (
    <div className="space-y-4">
      {options.length > 1 && (
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Account access mode</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                'cursor-pointer rounded-xl border p-3.5 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-500/20',
                mode === o.value
                  ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
              )}
            >
              <input
                type="radio"
                name={`${searchId}-mode`}
                value={o.value}
                checked={mode === o.value}
                onChange={() => onModeChange(o.value)}
                className="sr-only"
              />
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{o.body}</span>
            </label>
          ))}
        </fieldset>
      )}

      {mode === ACCOUNT_ACCESS_MODES.SELECTED && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-white/5">
            <div className="relative min-w-0 flex-1">
              <label htmlFor={searchId} className="sr-only">
                Search accounts
              </label>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Enter must not submit a surrounding form (the invite dialog).
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                placeholder="Search accounts"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60"
              />
            </div>
            <button
              type="button"
              onClick={() => setVisible(!allVisibleSelected)}
              disabled={visibleIds.length === 0}
              className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
            >
              {allVisibleSelected ? 'Deselect shown' : 'Select shown'}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-muted" role="status">
                Loading accounts…
              </p>
            ) : error ? (
              <p className="p-4 text-sm text-rose-600 dark:text-rose-400" role="alert">
                {error.message ?? 'Accounts could not be loaded.'}
              </p>
            ) : accounts.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                This workspace has no social accounts yet, so {subject} will not see any until you
                grant access.
              </p>
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-muted">No accounts match “{query}”.</p>
            ) : (
              GROUPS.map(([platform, label]) => {
                const group = visible.filter((a) => a.platform === platform);
                if (group.length === 0) return null;
                return (
                  <div key={platform} role="group" aria-label={label}>
                    <p className="sticky top-0 bg-slate-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/95 dark:text-slate-400">
                      {label}
                    </p>
                    <ul className="divide-y divide-slate-100 dark:divide-white/5">
                      {group.map((a) => (
                        <li key={a.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(a.id)}
                              onChange={() => toggle(a.id)}
                              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                            />
                            <AccountPicture account={a} size="sm" showPlatform={false} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{a.name}</span>
                              <span className="block truncate text-xs text-muted">
                                {a.username ? `@${a.username} · ` : ''}
                                via {a.connection?.displayName ?? 'a removed login'}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
          <p
            className="border-t border-slate-100 px-4 py-2 text-xs text-muted dark:border-white/5"
            aria-live="polite"
          >
            {selectedCount === 0
              ? `No accounts selected — ${subject} will not see any social accounts.`
              : `${selectedCount} of ${accounts.length} account${accounts.length === 1 ? '' : 's'} selected`}
          </p>
        </div>
      )}
    </div>
  );
}
