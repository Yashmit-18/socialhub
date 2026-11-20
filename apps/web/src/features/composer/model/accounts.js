import {
  CONNECTION_STATUS,
  INSTAGRAM_ACCOUNT_TYPES,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
} from '@socialhub/shared';

/**
 * Adapter between GET /workspaces/:id/social-accounts items and the composer.
 *
 * Phase 3 (account management) adds a computed `health` object to each item. It reflects the
 * live connection: a token expiry or missing permission makes it non-ready before the next
 * sync. `health` is therefore preferred, and the stored `connectionStatus` /
 * `publishingStatus` fields are only the fallback for servers that do not send it yet.
 */

const reasonText = (reason) =>
  typeof reason === 'string' ? reason : (reason?.message ?? reason?.code ?? null);

export function normalizeAccount(raw) {
  const health = raw?.health ?? null;
  const connectionStatus =
    health?.connectionStatus ?? raw?.connectionStatus ?? CONNECTION_STATUS.ERROR;
  const readiness = health?.readiness ?? raw?.publishingStatus ?? PUBLISHING_STATUS.UNAVAILABLE;

  const healthReasons = Array.isArray(health?.readinessReasons)
    ? health.readinessReasons.map(reasonText).filter(Boolean)
    : [];
  const readinessReasons =
    healthReasons.length > 0
      ? healthReasons
      : raw?.publishingStatusReason && readiness !== PUBLISHING_STATUS.READY
        ? [raw.publishingStatusReason]
        : [];

  const attention = Array.isArray(health?.attention)
    ? health.attention
        .map((a) => ({ code: a?.code ?? null, message: reasonText(a) }))
        .filter((a) => a.message)
    : [];

  const publishable =
    connectionStatus === CONNECTION_STATUS.ACTIVE && readiness === PUBLISHING_STATUS.READY;

  return {
    id: String(raw?.id ?? ''),
    platform: raw?.platform,
    name: raw?.name || 'Unnamed account',
    username: raw?.username || null,
    pictureUrl: raw?.pictureUrl || null,
    category: raw?.category || null,
    instagramAccountType: raw?.instagramAccountType || null,
    connectionName: raw?.connection?.displayName || null,
    linkedPageName: raw?.linkedPage?.name || raw?.linkedFacebookPageName || null,
    connectionStatus,
    connectionStatusReason: health?.connectionStatusReason ?? raw?.connectionStatusReason ?? null,
    readiness,
    readinessReasons,
    attention,
    needsAttention: Boolean(health?.needsAttention ?? !publishable),
    /** Connection is healthy and Meta permissions allow publishing (publishing itself is not built yet). */
    publishable,
  };
}

export function normalizeAccounts(items) {
  return (items ?? []).filter((a) => a?.id && a?.platform).map(normalizeAccount);
}

export const isFacebookPage = (account) => account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
export const isInstagramAccount = (account) =>
  account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;

/** Short descriptor line for an account row ("Facebook Page · Retail", "@acme · business"). */
export function describeAccount(account) {
  if (isFacebookPage(account)) {
    return account.category ? `Facebook Page · ${account.category}` : 'Facebook Page';
  }
  const type =
    account.instagramAccountType === INSTAGRAM_ACCOUNT_TYPES.CREATOR
      ? 'Creator account'
      : account.instagramAccountType === INSTAGRAM_ACCOUNT_TYPES.BUSINESS
        ? 'Business account'
        : 'Professional account';
  return account.username ? `@${account.username} · ${type}` : `Instagram · ${type}`;
}

/** The handle shown in previews: @username for Instagram, the Page name for Facebook. */
export function displayHandle(account) {
  if (isInstagramAccount(account)) return account.username ?? account.name;
  return account.name;
}

/**
 * Why an account cannot receive posts right now, or null when its permissions are in order.
 * Wording never claims publishing works: publishing is not implemented yet.
 */
export function accountBlocker(account) {
  if (account.connectionStatus !== CONNECTION_STATUS.ACTIVE) {
    return (
      account.connectionStatusReason ??
      (account.connectionStatus === CONNECTION_STATUS.DISCONNECTED
        ? 'This account is disconnected. Reconnect it in Social accounts.'
        : 'This account needs to be reconnected in Social accounts.')
    );
  }
  if (account.readiness === PUBLISHING_STATUS.RESTRICTED) {
    return (
      account.readinessReasons[0] ?? 'Meta has not granted publishing access for this account.'
    );
  }
  if (account.readiness === PUBLISHING_STATUS.UNAVAILABLE) {
    return account.readinessReasons[0] ?? 'Publishing is not available for this account.';
  }
  return null;
}

export const PLATFORM_FILTERS = Object.freeze({
  ALL: 'ALL',
  FACEBOOK_PAGE: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  INSTAGRAM_ACCOUNT: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
});

const fold = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();

/** Filters by platform and a free-text query over name, username, category and linked Page. */
export function filterAccounts(accounts, { platform = PLATFORM_FILTERS.ALL, query = '' } = {}) {
  const needle = fold(query.trim().replace(/^@/, ''));
  return accounts.filter((account) => {
    if (platform !== PLATFORM_FILTERS.ALL && account.platform !== platform) return false;
    if (!needle) return true;
    return [account.name, account.username, account.category, account.linkedPageName].some(
      (field) => field && fold(field).includes(needle),
    );
  });
}

export function countByPlatform(accounts) {
  return {
    [PLATFORM_FILTERS.ALL]: accounts.length,
    [PLATFORM_FILTERS.FACEBOOK_PAGE]: accounts.filter(isFacebookPage).length,
    [PLATFORM_FILTERS.INSTAGRAM_ACCOUNT]: accounts.filter(isInstagramAccount).length,
  };
}

/** Platforms present among the given accounts, in COMPOSER order. */
export function platformsOf(accounts) {
  const set = new Set(accounts.map((a) => a.platform));
  return [SOCIAL_PLATFORMS.FACEBOOK_PAGE, SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT].filter((p) =>
    set.has(p),
  );
}

/**
 * Presets computed from the account list itself (no storage needed). Custom presets are
 * named account sets saved by people; see hooks/useAccountPresets.js.
 */
export const BUILT_IN_PRESETS = Object.freeze([
  {
    id: 'builtin:all',
    name: 'All accounts',
    description: 'Every account available to you',
    resolve: (accounts) => accounts.map((a) => a.id),
  },
  {
    id: 'builtin:facebook',
    name: 'All Facebook Pages',
    description: 'Every Facebook Page available to you',
    resolve: (accounts) => accounts.filter(isFacebookPage).map((a) => a.id),
  },
  {
    id: 'builtin:instagram',
    name: 'All Instagram accounts',
    description: 'Every Instagram account available to you',
    resolve: (accounts) => accounts.filter(isInstagramAccount).map((a) => a.id),
  },
  {
    id: 'builtin:publishable',
    name: 'Accounts with publishing access',
    description: 'Connected accounts whose Meta permissions allow publishing',
    resolve: (accounts) => accounts.filter((a) => a.publishable).map((a) => a.id),
  },
]);

/** Keeps only ids that still exist in `accounts` (presets can outlive accounts). */
export function existingIds(ids, accounts) {
  const known = new Set(accounts.map((a) => a.id));
  return [...new Set(ids ?? [])].filter((id) => known.has(id));
}
