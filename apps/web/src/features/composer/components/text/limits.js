/**
 * Helpers for showing platform limits in the text editors.
 *
 * A "soft" limit is one that Meta's documentation doesn't confirm (listed in
 * `PLATFORM_RULES[platform].unverified`). Going over it only ever warns: amber, "over the usual
 * limit", never `aria-invalid` — the same severity the readiness check gives it.
 */

/** Wording for a limit that Meta's documentation doesn't confirm. */
export const SOFT_LIMIT_NOTE = "not confirmed in Meta's documentation";

/** Whether a rule key (e.g. 'caption.maxChars') is a soft limit for this platform's rules. */
export function isSoftLimit(rules, key) {
  return Boolean(rules?.unverified?.includes(key));
}

/** True when any counter item is over a CONFIRMED limit. */
export const overHardLimit = (items) =>
  items.some((item) => item.max && !item.soft && item.count > item.max);
