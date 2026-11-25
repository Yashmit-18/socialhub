import {
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  META_OAUTH_RESULTS,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  SYNC_OUTCOMES,
  SYNC_SKIP_REASONS,
  SYNC_TRIGGERS,
  isInstagramDirectProvider,
} from '@socialhub/shared';
import { formatDate } from './utils.js';

export const CONNECTION_TONE = {
  [CONNECTION_STATUS.ACTIVE]: ['success', 'Connected'],
  [CONNECTION_STATUS.EXPIRED]: ['warning', 'Expired'],
  [CONNECTION_STATUS.REVOKED]: ['danger', 'Access revoked'],
  [CONNECTION_STATUS.ERROR]: ['danger', 'Needs attention'],
  [CONNECTION_STATUS.DISCONNECTED]: ['neutral', 'Disconnected'],
};

/** Publishing is not implemented yet: these labels describe permissions only. */
export const PUBLISHING_TONE = {
  [PUBLISHING_STATUS.READY]: ['brand', 'Publishing permissions OK'],
  [PUBLISHING_STATUS.RESTRICTED]: ['warning', 'Missing publishing access'],
  [PUBLISHING_STATUS.UNAVAILABLE]: ['neutral', 'Unavailable'],
};

/** Longer explanations of the readiness states (tooltips, legends). */
export const READINESS_HINTS = {
  [PUBLISHING_STATUS.READY]:
    'The login has every publishing permission and, for Page-based accounts, a Page role that can create content. Publishing itself arrives in a later phase.',
  [PUBLISHING_STATUS.RESTRICTED]:
    'A publishing permission or the Page role needed to create content is missing.',
  [PUBLISHING_STATUS.UNAVAILABLE]:
    'The login this account was added through cannot be used right now. Reconnect it to restore access.',
};

export const PROVIDER_LABELS = {
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'Facebook',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'Instagram',
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'Instagram',
};

/** Name of each login flow, for "… is not configured" messages and login details. */
export const LOGIN_FLOW_NAMES = {
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'Facebook Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'Instagram Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'Instagram Unified Login',
};

export const loginFlowName = (provider) => LOGIN_FLOW_NAMES[provider] ?? 'Meta login';

/** Provider labels that tell the two Instagram flows apart (filters). */
export const PROVIDER_FILTER_LABELS = {
  ...PROVIDER_LABELS,
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'Instagram (Unified Login)',
};

export const PLATFORM_LABELS = {
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: 'Facebook Page',
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: 'Instagram account',
};

/** Short labels for the computed attention codes (`health.attention[].code`). */
export const ATTENTION_LABELS = {
  [ACCOUNT_ATTENTION.CONNECTION_EXPIRED]: 'Login expired',
  [ACCOUNT_ATTENTION.CONNECTION_REVOKED]: 'Access revoked',
  [ACCOUNT_ATTENTION.CONNECTION_ERROR]: 'Login needs attention',
  [ACCOUNT_ATTENTION.ACCESS_LOST]: 'Access lost',
  [ACCOUNT_ATTENTION.DISCONNECTED]: 'Disconnected',
  [ACCOUNT_ATTENTION.MISSING_PERMISSIONS]: 'Missing permissions',
  [ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT]: 'No content-creation role',
  [ACCOUNT_ATTENTION.EXPIRING_SOON]: 'Expiring soon',
  [ACCOUNT_ATTENTION.SYNC_FAILED]: 'Last sync failed',
};

/** Attention codes that only a reconnect (new authorization) can fix. */
export const RECONNECT_ATTENTION = new Set([
  ACCOUNT_ATTENTION.CONNECTION_EXPIRED,
  ACCOUNT_ATTENTION.CONNECTION_REVOKED,
  ACCOUNT_ATTENTION.CONNECTION_ERROR,
  ACCOUNT_ATTENTION.DISCONNECTED,
  ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
  ACCOUNT_ATTENTION.EXPIRING_SOON,
]);

export const SYNC_OUTCOME_TONE = {
  [SYNC_OUTCOMES.SUCCESS]: ['success', 'Synced'],
  [SYNC_OUTCOMES.TOKEN_EXPIRED]: ['warning', 'Token expired'],
  [SYNC_OUTCOMES.TOKEN_REVOKED]: ['danger', 'Access revoked'],
  [SYNC_OUTCOMES.PERMISSION_DENIED]: ['danger', 'Permission removed'],
  [SYNC_OUTCOMES.RATE_LIMITED]: ['warning', 'Rate limited by Meta'],
  [SYNC_OUTCOMES.TRANSIENT_FAILURE]: ['warning', 'Meta temporarily unavailable'],
  [SYNC_OUTCOMES.FAILED]: ['danger', 'Failed'],
};

export const SYNC_SKIP_TONE = {
  [SYNC_SKIP_REASONS.CONFIG_REQUIRED]: ['neutral', 'Setup required'],
  [SYNC_SKIP_REASONS.IN_PROGRESS]: ['sky', 'Already syncing'],
  [SYNC_SKIP_REASONS.NEEDS_RECONNECT]: ['warning', 'Reconnect required'],
  [SYNC_SKIP_REASONS.SUPERSEDED]: ['neutral', 'Changed during sync'],
};

const PROVIDER_CONFIG_KEYS = {
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'facebook',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'instagram',
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'instagramUnified',
};

/** Key of a provider's block in the GET /integrations/meta response. */
export const providerConfigKey = (provider) => PROVIDER_CONFIG_KEYS[provider] ?? 'facebook';

/**
 * The login "Connect Instagram" starts directly, without a Facebook Page: Instagram Unified
 * Login (Meta's recommended setup) when the server has it, otherwise Instagram Login. null
 * when neither is configured (Facebook Login may still find Page-linked accounts).
 */
export function instagramDirectProvider(integration) {
  if (integration?.instagramUnified?.configured) return SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN;
  if (integration?.instagram?.configured) return SOCIAL_PROVIDERS.INSTAGRAM_LOGIN;
  return null;
}

/** Whether the server can start any Meta login at all. */
export function anyLoginConfigured(integration) {
  return Boolean(
    integration?.facebook?.configured ||
    integration?.instagramUnified?.configured ||
    integration?.instagram?.configured,
  );
}

/**
 * Whether the server has Meta app credentials for a provider (`integration` is the
 * GET /integrations/meta response). While that answer is unknown the controls stay enabled:
 * the server is authoritative and answers META_NOT_CONFIGURED, which is then shown as is.
 */
export function isProviderConfigured(integration, provider) {
  if (!integration) return true;
  return Boolean(integration[providerConfigKey(provider)]?.configured);
}

/** Problems of a login that still works where authorizing again is the fix. */
const RECONNECT_SOON = new Set([
  ACCOUNT_ATTENTION.EXPIRING_SOON,
  ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
]);

/** Whether Reconnect is the fix for a login: it is unusable, expiring or missing permissions. */
export function loginWantsReconnect(connection) {
  return (
    needsReconnect(connection.status) ||
    (connection.attention ?? []).some((item) => RECONNECT_SOON.has(item.code))
  );
}

/** Number of destinations added through a login. */
export function loginAccountTotal(connection) {
  const counts = connection.accountCounts;
  if (!counts) return connection.accountCount ?? 0;
  return (counts.facebookPages ?? 0) + (counts.instagramAccounts ?? 0);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 Facebook Pages · 1 Instagram account": one Facebook login can bring many destinations. */
export function loginDestinationsText(connection) {
  const counts = connection.accountCounts;
  if (!counts) return plural(connection.accountCount ?? 0, 'account');
  const parts = [];
  if (!isInstagramDirectProvider(connection.provider) || counts.facebookPages > 0) {
    parts.push(plural(counts.facebookPages ?? 0, 'Facebook Page'));
  }
  parts.push(plural(counts.instagramAccounts ?? 0, 'Instagram account'));
  return parts.join(' · ');
}

export const SYNC_TRIGGER_LABELS = {
  [SYNC_TRIGGERS.MANUAL]: 'Manual sync',
  [SYNC_TRIGGERS.BULK]: 'Bulk sync',
  [SYNC_TRIGGERS.SCHEDULED]: 'Scheduled sync',
  [SYNC_TRIGGERS.RECONNECT]: 'Reconnect',
};

/** `[tone, label]` for one entry of a bulk sync/refresh result (`outcome` or `skipReason`). */
export function syncResultTone(result) {
  if (result?.skipReason)
    return SYNC_SKIP_TONE[result.skipReason] ?? ['neutral', result.skipReason];
  return SYNC_OUTCOME_TONE[result?.outcome] ?? ['neutral', result?.outcome ?? 'Unknown'];
}

/**
 * `[tone, label, hint]` for the CREATE_CONTENT Page-task check of a destination.
 * Instagram Login destinations have no Page role, so the check does not apply to them.
 */
export function createContentState(account) {
  const value = account?.health?.eligibility?.createContent;
  if (value === true)
    return ['success', 'Can create content', 'The login has the CREATE_CONTENT task on this Page.'];
  if (value === false)
    return [
      'danger',
      'Cannot create content',
      'The login has no Page role with the CREATE_CONTENT task. Ask a Page admin to give it a role that can create content, then sync.',
    ];
  if (isInstagramDirectProvider(account?.connection?.provider))
    return [
      'neutral',
      'Not applicable',
      `${loginFlowName(account.connection.provider)} accounts are not managed through a Facebook Page role.`,
    ];
  return [
    'warning',
    'Not confirmed',
    'The Page role has not been confirmed yet. Sync the login to check it.',
  ];
}

/** True when a login in this status can only be fixed by authorizing again (Reconnect). */
export function needsReconnect(status) {
  return (
    status === CONNECTION_STATUS.EXPIRED ||
    status === CONNECTION_STATUS.REVOKED ||
    status === CONNECTION_STATUS.ERROR ||
    status === CONNECTION_STATUS.DISCONNECTED
  );
}

export function instagramTypeLabel(type) {
  if (type === 'BUSINESS') return 'Business';
  if (type === 'CREATOR') return 'Creator';
  return 'Professional';
}

/** Expiry line for an ACTIVE login, or null. `warn` marks access that ends within the warning window. */
export function connectionExpiry(connection) {
  if (!connection || connection.status !== CONNECTION_STATUS.ACTIVE) return null;
  if (connection.expiringSoonAt) {
    const days = daysUntil(connection.expiringSoonAt);
    return {
      warn: true,
      text: `Access expires in ${days} day${days === 1 ? '' : 's'} — reconnect to renew`,
    };
  }
  if (connection.tokenExpiresAt)
    return { warn: false, text: `Token valid until ${formatDate(connection.tokenExpiresAt)}` };
  return { warn: false, text: 'Long-lived access' };
}

/** Human messages for the reason codes the OAuth callback reports. */
export const OAUTH_RESULT_MESSAGES = {
  [META_OAUTH_RESULTS.CONNECTED]: 'Connected. Choose which accounts to add to this workspace.',
  [META_OAUTH_RESULTS.RECONNECTED]: 'Reconnected. Access has been renewed.',
  [META_OAUTH_RESULTS.STATE_MISSING]:
    'The authorization response was incomplete. Please start again.',
  [META_OAUTH_RESULTS.STATE_INVALID]:
    'This authorization link is not valid. Please start again from SocialHub.',
  [META_OAUTH_RESULTS.STATE_EXPIRED]:
    'The authorization took too long and expired. Please try again.',
  [META_OAUTH_RESULTS.STATE_ALREADY_USED]:
    'This authorization was already completed. Start a new one if needed.',
  [META_OAUTH_RESULTS.BROWSER_MISMATCH]:
    'For your security, the connection must be completed in the same browser where it was started.',
  [META_OAUTH_RESULTS.FORBIDDEN]:
    'You no longer have permission to manage connections in this workspace.',
  [META_OAUTH_RESULTS.USER_CANCELLED]: 'You cancelled the authorization. Nothing was connected.',
  [META_OAUTH_RESULTS.AUTHORIZATION_FAILED]:
    'Meta did not complete the authorization. Please try again.',
  [META_OAUTH_RESULTS.CODE_MISSING]: 'Meta did not return an authorization code. Please try again.',
  [META_OAUTH_RESULTS.TOKEN_EXCHANGE_FAILED]:
    'SocialHub could not complete the authorization with Meta. Please try again in a moment.',
  [META_OAUTH_RESULTS.IDENTITY_MISMATCH]:
    'You signed in with a different account than the one being reconnected. Sign in with the original account, or connect this one as a new connection.',
  [META_OAUTH_RESULTS.NOT_ELIGIBLE]:
    'Only Instagram Business and Creator accounts can be connected. Switch the account to a professional account in Instagram and try again.',
  [META_OAUTH_RESULTS.NOT_CONFIGURED]: 'This Meta login is not configured on the server.',
  [META_OAUTH_RESULTS.NO_INSTAGRAM_ACCOUNTS]:
    'No Instagram professional account was shared with SocialHub. Connect again and select at least one Instagram Business or Creator account in the Meta dialog. Personal accounts cannot be connected.',
  [META_OAUTH_RESULTS.ACCOUNT_DISCOVERY_FAILED]:
    'Meta authorized SocialHub but would not list the Instagram accounts, so nothing was connected. Please try again in a moment.',
};

export function daysUntil(date, now = Date.now()) {
  return Math.ceil((new Date(date).getTime() - now) / 86_400_000);
}
