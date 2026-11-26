import { ANALYTICS_SOURCES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { useId } from 'react';
import { segmentItem, segmentTrack } from '../../components/ui/segmented.js';
import { cn } from '../../lib/utils.js';
import { RANGE_PRESETS } from './filters.js';

// Phones show short range names so the five buttons fit on one line; the full name stays the
// button's accessible name.
const SHORT_LABELS = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days' };

const labelClass = 'mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400';

// The house field look at the filter bar's height (36 px), 16 px text on phones (no zoom).
const controlClass =
  'block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 shadow-[0_1px_2px_rgb(24_20_51/0.05)] transition-[border-color,box-shadow] duration-200 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 focus:outline-none sm:text-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:hover:border-white/20 dark:focus:border-brand-400 dark:focus:ring-brand-400/20';

function FilterField({ label, className, children }) {
  const id = useId();
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * The filter bar above the figures: date range, then platform, account and which insights to
 * show. Changing a filter updates the page address, so a view can be shared.
 */
export function AnalyticsFilters({ filters, accounts, onChange }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-4">
      <fieldset className="min-w-0">
        <legend className={labelClass}>Date range</legend>
        <div
          className={cn(
            segmentTrack,
            'grid w-full grid-cols-5 sm:inline-flex sm:w-auto sm:flex-nowrap',
          )}
        >
          {RANGE_PRESETS.map((preset) => {
            const active = filters.preset === preset.key;
            const short = SHORT_LABELS[preset.key] ?? preset.label;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                aria-label={short === preset.label ? undefined : preset.label}
                onClick={() => onChange({ range: preset.key })}
                className={cn(segmentItem(active, 'sm'), 'px-1 sm:px-3')}
              >
                {short === preset.label ? (
                  preset.label
                ) : (
                  <>
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{preset.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      {filters.preset === 'custom' && (
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
          <FilterField label="From" className="sm:w-40">
            {(id) => (
              <input
                id={id}
                type="date"
                className={controlClass}
                value={filters.startDate}
                max={filters.today}
                onChange={(e) => onChange({ from: e.target.value })}
              />
            )}
          </FilterField>
          <FilterField label="To" className="sm:w-40">
            {(id) => (
              <input
                id={id}
                type="date"
                className={controlClass}
                value={filters.endDate}
                max={filters.today}
                onChange={(e) => onChange({ to: e.target.value })}
              />
            )}
          </FilterField>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <FilterField label="Platform" className="sm:w-40">
          {(id) => (
            <select
              id={id}
              className={cn(controlClass, 'select-chevron pr-9')}
              value={filters.platform}
              onChange={(e) => onChange({ platform: e.target.value, account: '' })}
            >
              <option value="">All platforms</option>
              <option value={SOCIAL_PLATFORMS.FACEBOOK_PAGE}>Facebook Pages</option>
              <option value={SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT}>Instagram</option>
            </select>
          )}
        </FilterField>
        <FilterField label="Account" className="sm:w-52">
          {(id) => (
            <select
              id={id}
              className={cn(controlClass, 'select-chevron truncate pr-9')}
              value={filters.accountId}
              onChange={(e) => onChange({ account: e.target.value })}
            >
              <option value="">All accounts</option>
              {accounts
                .filter((a) => !filters.platform || a.platform === filters.platform)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          )}
        </FilterField>
        <FilterField label="Insights" className="col-span-2 sm:w-48">
          {(id) => (
            <select
              id={id}
              className={cn(controlClass, 'select-chevron pr-9')}
              value={filters.source}
              onChange={(e) => onChange({ source: e.target.value })}
            >
              <option value={ANALYTICS_SOURCES.META}>From Meta</option>
              <option value={ANALYTICS_SOURCES.SIMULATED}>Demo data (made up)</option>
            </select>
          )}
        </FilterField>
      </div>
    </div>
  );
}
