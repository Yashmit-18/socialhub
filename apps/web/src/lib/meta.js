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
};

/**
 * Whether the server has Meta app credentials for a provider (`integration` is the
 * GET /integrations/meta response). While that answer is unknown the controls stay enabled:
 * the server is authoritative and answers META_NOT_CONFIGURED, which is then shown as is.
 */
export function isProviderConfigured(integration, provider) {
  if (!integration) return true;
  return Boolean(integration[PROVIDER_CONFIG_KEYS[provider]]?.configured);
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
  if (connection.provider !== SOCIAL_PROVIDERS.INSTAGRAM_LOGIN || counts.facebookPages > 0) {
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
  if (account?.connection?.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN)
    return [
      'neutral',
      'Not applicable',
      'Instagram Login accounts are not managed through a Facebook Page role.',
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
};

export function daysUntil(date, now = Date.now()) {
  return Math.ceil((new Date(date).getTime() - now) / 86_400_000);
}
