/**
 * Analytics filters, kept in the page address (?range=30d&platform=…) so a view can be shared
 * and survives a reload. Dates are calendar days in the workspace time zone, as the API reads
 * them.
 */
import { ANALYTICS_LIMITS, ANALYTICS_SOURCES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { instantToZoned, isValidTimeZone } from '../publishing/schedule.js';

export const RANGE_PRESETS = Object.freeze([
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'custom', label: 'Custom', days: null },
]);
export const DEFAULT_RANGE = '30d';

const DAY = 86_400_000;
const shift = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Today's date (YYYY-MM-DD) in the workspace time zone. */
export function todayIn(timeZone, now = new Date()) {
  return instantToZoned(now, isValidTimeZone(timeZone) ? timeZone : 'UTC').date;
}

/** Why a custom range cannot be used, or null. */
export function customRangeProblem(start, end, today) {
  if (!start || !end) return 'Choose a start and an end date.';
  if (end < start) return 'The end date is before the start date.';
  if (end > today) return 'The range cannot end in the future.';
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY + 1;
  if (days > ANALYTICS_LIMITS.RANGE_MAX_DAYS) {
    return `Choose at most ${ANALYTICS_LIMITS.RANGE_MAX_DAYS} days.`;
  }
  return null;
}

/** Reads the filters from URLSearchParams → { preset, startDate, endDate, platform, accountId, source, error }. */
export function readFilters(searchParams, timeZone, now = new Date()) {
  const today = todayIn(timeZone, now);
  const presetKey = searchParams.get('range') ?? DEFAULT_RANGE;
  const preset = RANGE_PRESETS.find((p) => p.key === presetKey) ?? RANGE_PRESETS[2];
  const platform = Object.values(SOCIAL_PLATFORMS).includes(searchParams.get('platform'))
    ? searchParams.get('platform')
    : '';
  const accountId = /^[a-f\d]{24}$/i.test(searchParams.get('account') ?? '')
    ? searchParams.get('account')
    : '';
  const source =
    searchParams.get('source') === ANALYTICS_SOURCES.SIMULATED
      ? ANALYTICS_SOURCES.SIMULATED
      : ANALYTICS_SOURCES.META;
  let startDate;
  let endDate;
  let error = null;
  if (preset.key === 'custom') {
    startDate = searchParams.get('from') ?? shift(today, -29);
    endDate = searchParams.get('to') ?? today;
    error = customRangeProblem(startDate, endDate, today);
  } else {
    endDate = today;
    startDate = shift(today, -(preset.days - 1));
  }
  return { preset: preset.key, startDate, endDate, platform, accountId, source, error, today };
}

/** The query the API gets (only valid ranges are sent). */
export function apiParams(filters) {
  return {
    startDate: filters.error ? undefined : filters.startDate,
    endDate: filters.error ? undefined : filters.endDate,
    platform: filters.platform || undefined,
    accountId: filters.accountId || undefined,
    source: filters.source,
  };
}
