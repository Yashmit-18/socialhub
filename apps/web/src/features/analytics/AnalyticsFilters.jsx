import { ANALYTICS_SOURCES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { cn } from '../../lib/utils.js';
import { RANGE_PRESETS } from './filters.js';

const selectClass =
  'h-9 rounded-xl border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 shadow-xs focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100';
const dateClass =
  'h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100';

/**
 * One row of filters above the charts (wraps on small screens): date range, platform,
 * account and which insights to show. Changing a filter updates the page address.
 */
export function AnalyticsFilters({ filters, accounts, onChange }) {
  const set = (patch) => onChange(patch);
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
      <fieldset className="min-w-0 max-w-full">
        <legend className="mb-1 text-xs font-medium text-muted">Date range</legend>
        <div className="flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              aria-pressed={filters.preset === preset.key}
              onClick={() => set({ range: preset.key })}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                filters.preset === preset.key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      {filters.preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-muted">
            <span className="mb-1 block">From</span>
            <input
              type="date"
              className={dateClass}
              value={filters.startDate}
              max={filters.today}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className="text-xs font-medium text-muted">
            <span className="mb-1 block">To</span>
            <input
              type="date"
              className={dateClass}
              value={filters.endDate}
              max={filters.today}
              onChange={(e) => set({ to: e.target.value })}
            />
          </label>
        </div>
      )}

      <label className="text-xs font-medium text-muted">
        <span className="mb-1 block">Platform</span>
        <select
          className={selectClass}
          value={filters.platform}
          onChange={(e) => set({ platform: e.target.value, account: '' })}
        >
          <option value="">All platforms</option>
          <option value={SOCIAL_PLATFORMS.FACEBOOK_PAGE}>Facebook Pages</option>
          <option value={SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT}>Instagram</option>
        </select>
      </label>

      <label className="min-w-0 max-w-full text-xs font-medium text-muted">
        <span className="mb-1 block">Account</span>
        <select
          className={cn(selectClass, 'w-full max-w-64')}
          value={filters.accountId}
          onChange={(e) => set({ account: e.target.value })}
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
      </label>

      <label className="text-xs font-medium text-muted">
        <span className="mb-1 block">Insights</span>
        <select
          className={selectClass}
          value={filters.source}
          onChange={(e) => set({ source: e.target.value })}
        >
          <option value={ANALYTICS_SOURCES.META}>From Meta</option>
          <option value={ANALYTICS_SOURCES.SIMULATED}>Demo data (made up)</option>
        </select>
      </label>
    </div>
  );
}
