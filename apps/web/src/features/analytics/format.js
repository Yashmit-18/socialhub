/**
 * How analytics numbers are written. `null` always reads "Unavailable": a metric the platform
 * did not report is never shown as 0.
 */
import { ANALYTICS_METRICS, DESTINATION_STATES, SOCIAL_PLATFORMS } from '@socialhub/shared';

export const UNAVAILABLE = 'Unavailable';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function formatNumber(value, { short = false } = {}) {
  if (!isNumber(value)) return UNAVAILABLE;
  return short && Math.abs(value) >= 10_000 ? compact.format(value) : whole.format(value);
}

export function formatSigned(value) {
  if (!isNumber(value)) return UNAVAILABLE;
  return `${value > 0 ? '+' : ''}${whole.format(value)}`;
}

export function formatPercent(value) {
  if (!isNumber(value)) return UNAVAILABLE;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function formatDuration(seconds) {
  if (!isNumber(seconds)) return UNAVAILABLE;
  if (seconds < 60) return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

export const metricLabel = (key) =>
  key === 'followerGrowth' ? 'Follower growth' : (ANALYTICS_METRICS[key]?.label ?? key);

export const platformLabel = (platform) =>
  platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT ? 'Instagram' : 'Facebook Page';

/** "3 of 5 accounts reported this" — so a total is never read as covering everyone. */
export function coverageText(metric) {
  if (!metric || metric.accountsInScope === 0) return null;
  if (metric.accountsReporting === 0) return 'No account reported this';
  if (metric.accountsReporting === metric.accountsInScope) {
    return metric.accountsInScope === 1 ? null : `All ${metric.accountsInScope} accounts`;
  }
  return `${metric.accountsReporting} of ${metric.accountsInScope} accounts reported this`;
}

/** A moment (ISO string) as a calendar date in the workspace time zone, like the filters. */
export function formatDate(iso, timeZone) {
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(new Date(iso));
  } catch {
    // An unknown time zone name: fall back to UTC rather than failing the whole list.
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
      new Date(iso),
    );
  }
}

export function formatDay(day, options = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export const D = DESTINATION_STATES;
