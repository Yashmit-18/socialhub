/**
 * Follower counts as the API reports them. A count Meta has not returned is null (unknown)
 * and is shown as "—", never as 0. Totals are sums of the per-account counts Meta last
 * returned, so someone following several accounts is counted once per account.
 */
const NUMBER = new Intl.NumberFormat();
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Exact below 10,000 (1,284), compact above (12.9K); "—" when unknown. */
export function formatFollowers(value) {
  if (typeof value !== 'number') return '—';
  return value >= 10_000 ? COMPACT.format(value) : NUMBER.format(value);
}

/** Exact figure for titles / screen readers: "12,931 followers". */
export function exactFollowers(value) {
  return typeof value === 'number' ? `${NUMBER.format(value)} followers` : 'Unknown';
}

/** "2 accounts without a count" note for a summary `followers` object, or null. */
export function missingFollowersNote(followers) {
  const missing = followers?.missing ?? 0;
  if (missing === 0) return null;
  return `${NUMBER.format(missing)} ${missing === 1 ? 'account has' : 'accounts have'} no follower count from Meta yet and ${missing === 1 ? 'is' : 'are'} not included.`;
}
