import { CONNECTION_STATUS, PUBLISHING_STATUS, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { AlertTriangle, Search, Star, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { CONNECTION_TONE, PUBLISHING_TONE } from '../../lib/meta.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/Button.jsx';

const SORT_OPTIONS = [
  ['name', 'Name (A–Z)'],
  ['-name', 'Name (Z–A)'],
  ['attention', 'Needs attention first'],
  ['-lastSyncedAt', 'Recently synced'],
  ['lastSyncedAt', 'Least recently synced'],
  ['-createdAt', 'Newest first'],
  ['createdAt', 'Oldest first'],
  ['-followers', 'Most followers'],
  ['followers', 'Fewest followers'],
];

/*
 * Filter controls pick exactly one colour set. Overriding a border or background colour with a
 * later class does not work (the stylesheet's order decides, and cn() does not merge those),
 * which is why the active states are separate sets rather than additions.
 */
const controlBase =
  'h-9 rounded-xl border px-3 text-xs font-medium shadow-xs transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15';
const NEUTRAL =
  'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200';
/** A select with a value chosen: brand border, otherwise neutral. */
const SELECTED =
  'border-brand-300 bg-white text-slate-700 dark:border-brand-400/40 dark:bg-slate-900/60 dark:text-slate-200';
/** A pressed toggle ("Starred", "Needs attention"). */
const PRESSED =
  'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300';
const controlClass = cn(controlBase, NEUTRAL);

/**
 * Debounced search box driven by `value` (for example the URL's `q`). What the person types is
 * kept locally and sent with `onSearch` after a short pause (or at once on Enter). When `value`
 * changes for any other reason (Clear filters, a link, back/forward) the box shows the new
 * value in the same render, so it can never fall out of step with the list.
 */
export function SearchBox({ value, onSearch, placeholder, label, delay = 300, className }) {
  const id = useId();
  const timer = useRef(null);
  const inputRef = useRef(null);
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Adopt outside changes of `value`; ignore the echo of what this box itself sent.
  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      setText(value);
      setSent(value);
    }
  }

  const send = (next) => {
    clearTimeout(timer.current);
    setSent(next);
    onSearch(next);
  };

  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={text}
        placeholder={placeholder}
        maxLength={100}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => send(next), delay);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send(e.currentTarget.value);
          }
        }}
        className={cn(controlClass, 'w-full pl-9 pr-8 text-sm font-normal')}
      />
      {text !== '' && (
        <button
          type="button"
          onClick={() => {
            setText('');
            send('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Compact labelled select used by the filter toolbars. `options` is `[[value, label], …]`.
 * `highlight` (default: a value is chosen) gives it the active-filter border.
 */
export function FilterSelect({ label, value, onChange, options, highlight = Boolean(value) }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(controlBase, highlight ? SELECTED : NEUTRAL, 'pr-8')}
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

const withCount = (label, count) => (count === undefined ? label : `${label} (${count})`);

/**
 * Search, filter and sort controls for an account table. Works with useAccountQueryState():
 * `state`/`update`/`clear`/`active`. `facets` (from the list response) adds counts to options.
 * `connections` (managers only) enables the login filter; `workspaces` the workspace filter;
 * `labels` (the workspace labels) the label filter; `showPlatform` the platform filter (pages
 * that list both platforms); `showStarred` the "Starred" toggle. `actions` are extra controls
 * placed at the end of the row (export, manage labels).
 */
export function AccountFilters({
  state,
  update,
  clear,
  active,
  facets,
  connections,
  workspaces,
  labels,
  showPlatform = false,
  showStarred = true,
  searchPlaceholder = 'Search by name, username, ID or label',
  actions,
  className,
}) {
  const statusOptions = [
    ['', 'All statuses'],
    ...Object.values(CONNECTION_STATUS).map((s) => [
      s,
      withCount(CONNECTION_TONE[s][1], facets?.status ? (facets.status[s] ?? 0) : undefined),
    ]),
  ];
  const readinessOptions = [
    ['', 'Any readiness'],
    ...Object.values(PUBLISHING_STATUS).map((r) => [
      r,
      withCount(PUBLISHING_TONE[r][1], facets?.readiness ? (facets.readiness[r] ?? 0) : undefined),
    ]),
  ];
  const attentionOn = state.attention === 'true';
  const starredOn = state.starred === 'true';
  // A label in the URL that no longer exists still shows (as unknown) so it can be cleared.
  const labelOptions = labels?.length
    ? [
        ['', 'All labels'],
        ...labels.map((l) => [
          l.id,
          withCount(l.name, facets?.labels ? (facets.labels[l.id] ?? 0) : undefined),
        ]),
        ...(state.label && !labels.some((l) => l.id === state.label)
          ? [[state.label, 'Deleted label']]
          : []),
      ]
    : null;

  return (
    <div
      role="search"
      aria-label="Filter accounts"
      className={cn('flex flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-start', className)}
    >
      <SearchBox
        value={state.q}
        onSearch={(q) => update({ q })}
        placeholder={searchPlaceholder}
        label="Search accounts"
        // Fixed width beside the filters: the filter row wraps instead of squeezing the search.
        className="lg:w-72 lg:flex-none"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {showPlatform && (
          <FilterSelect
            label="Filter by platform"
            value={state.platform}
            onChange={(platform) => update({ platform })}
            options={[
              ['', 'All platforms'],
              [
                SOCIAL_PLATFORMS.FACEBOOK_PAGE,
                withCount(
                  'Facebook Pages',
                  facets?.platform ? (facets.platform.FACEBOOK_PAGE ?? 0) : undefined,
                ),
              ],
              [
                SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
                withCount(
                  'Instagram accounts',
                  facets?.platform ? (facets.platform.INSTAGRAM_ACCOUNT ?? 0) : undefined,
                ),
              ],
            ]}
          />
        )}
        <FilterSelect
          label="Filter by connection status"
          value={state.status}
          onChange={(status) => update({ status })}
          options={statusOptions}
        />
        <FilterSelect
          label="Filter by publishing readiness"
          value={state.readiness}
          onChange={(readiness) => update({ readiness })}
          options={readinessOptions}
        />
        {connections?.length > 0 && (
          <FilterSelect
            label="Filter by login"
            value={state.connectionId}
            onChange={(connectionId) => update({ connectionId })}
            options={[
              ['', 'All logins'],
              ...connections.map((c) => [c.id, c.displayName ?? 'Unnamed login']),
            ]}
          />
        )}
        {workspaces?.length > 1 && (
          <FilterSelect
            label="Filter by workspace"
            value={state.workspaceId}
            onChange={(workspaceId) => update({ workspaceId })}
            options={[['', 'All workspaces'], ...workspaces.map((w) => [w.id, w.name])]}
          />
        )}
        {labelOptions && (
          <FilterSelect
            label="Filter by label"
            value={state.label ?? ''}
            onChange={(label) => update({ label })}
            options={labelOptions}
          />
        )}
        {showStarred && (
          <button
            type="button"
            aria-pressed={starredOn}
            onClick={() => update({ starred: starredOn ? '' : 'true' })}
            className={cn(
              controlBase,
              starredOn ? PRESSED : NEUTRAL,
              'inline-flex items-center gap-1.5',
            )}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={starredOn ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            {withCount('Starred', facets?.starred)}
          </button>
        )}
        <button
          type="button"
          aria-pressed={attentionOn}
          onClick={() => update({ attention: attentionOn ? '' : 'true' })}
          className={cn(
            controlBase,
            attentionOn ? PRESSED : NEUTRAL,
            'inline-flex items-center gap-1.5',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {withCount('Needs attention', facets?.attention)}
        </button>
        <FilterSelect
          label="Sort accounts"
          // A sort is always set; only filters are highlighted when active.
          highlight={false}
          value={state.sort}
          onChange={(sort) => update({ sort })}
          options={SORT_OPTIONS}
        />
        {active && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        )}
        {actions && <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{actions}</div>}
      </div>
    </div>
  );
}
