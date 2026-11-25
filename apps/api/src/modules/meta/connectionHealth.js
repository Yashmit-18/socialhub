/**
 * Pure rules for connection health, permission coverage and publishing readiness.
 * No I/O here, so the rules are easy to test and reuse (web views, sync, the Phase 4
 * publishing engine).
 */
import {
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  META_PERMISSIONS,
  PAGE_PUBLISHING_TASK,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  SYNC_OUTCOMES,
} from '@socialhub/shared';
import { facebookLoginIncludesInstagram } from '../../integrations/meta/facebook.js';
import { META_ERROR_KINDS } from '../../integrations/meta/http.js';

const DAY_MS = 86_400_000;
export const EXPIRING_SOON_DAYS = 7;

export const STATUS_REASONS = Object.freeze({
  TOKEN_EXPIRED: 'The access token has expired. Reconnect to restore access.',
  DATA_ACCESS_EXPIRED:
    "Meta's data access for this login has expired (the date Meta reported has passed). Reconnect to renew it.",
  REVOKED:
    'Access was revoked or a required permission was removed in Meta. Reconnect to restore access.',
  REMOVED_BY_PERSON: 'The person removed SocialHub from their Meta account settings.',
  DISCONNECTED: 'Disconnected by a workspace manager.',
  ACCOUNT_LOST:
    'No longer accessible through this login (the role was removed or the account was unlinked).',
});

/** Status as of `now`: stored problems win; otherwise expiry dates are applied. */
export function effectiveStatus(connection, now = new Date()) {
  if (connection.status !== CONNECTION_STATUS.ACTIVE) {
    return { status: connection.status, reason: connection.statusReason ?? null };
  }
  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= now) {
    return { status: CONNECTION_STATUS.EXPIRED, reason: STATUS_REASONS.TOKEN_EXPIRED };
  }
  if (connection.dataAccessExpiresAt && connection.dataAccessExpiresAt <= now) {
    return { status: CONNECTION_STATUS.EXPIRED, reason: STATUS_REASONS.DATA_ACCESS_EXPIRED };
  }
  return { status: CONNECTION_STATUS.ACTIVE, reason: null };
}

export function isUsable(connection, now = new Date()) {
  return effectiveStatus(connection, now).status === CONNECTION_STATUS.ACTIVE;
}

/** Earliest of token / data-access expiry, if within the warning window. */
export function expiringSoon(connection, now = new Date()) {
  const dates = [connection.tokenExpiresAt, connection.dataAccessExpiresAt].filter(Boolean);
  if (dates.length === 0) return null;
  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
  return earliest > now && earliest - now <= EXPIRING_SOON_DAYS * DAY_MS ? earliest : null;
}

export function statusFromMetaError(err) {
  return err.kind === META_ERROR_KINDS.TOKEN_EXPIRED
    ? CONNECTION_STATUS.EXPIRED
    : CONNECTION_STATUS.REVOKED;
}

export function reasonForStatus(status) {
  if (status === CONNECTION_STATUS.EXPIRED) return STATUS_REASONS.TOKEN_EXPIRED;
  return STATUS_REASONS.REVOKED;
}

export function publishingScopes(provider, platform) {
  if (provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) return META_PERMISSIONS.INSTAGRAM.PUBLISHING;
  if (provider === SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN)
    return META_PERMISSIONS.INSTAGRAM_UNIFIED.PUBLISHING;
  return platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE
    ? META_PERMISSIONS.FACEBOOK.PAGE_PUBLISHING
    : META_PERMISSIONS.FACEBOOK.INSTAGRAM_PUBLISHING;
}

/** Which of the permissions SocialHub relies on are not granted. */
export function scopeReport(connection) {
  const granted = new Set(connection.grantedScopes ?? []);
  const missing = (list) => list.filter((scope) => !granted.has(scope));
  if (connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) {
    return {
      required: missing(META_PERMISSIONS.INSTAGRAM.REQUIRED),
      recommended: [],
      publishing: missing(META_PERMISSIONS.INSTAGRAM.PUBLISHING),
    };
  }
  if (connection.provider === SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN) {
    return {
      required: missing(META_PERMISSIONS.INSTAGRAM_UNIFIED.REQUIRED),
      recommended: [],
      publishing: missing(META_PERMISSIONS.INSTAGRAM_UNIFIED.PUBLISHING),
    };
  }
  // Instagram publishing permissions are only expected from a Facebook login when this
  // server's Facebook Login asks for Instagram (a Facebook-only login never lists them).
  return {
    required: missing(META_PERMISSIONS.FACEBOOK.REQUIRED),
    recommended: missing(META_PERMISSIONS.FACEBOOK.RECOMMENDED),
    publishing: missing([
      ...new Set([
        ...META_PERMISSIONS.FACEBOOK.PAGE_PUBLISHING,
        ...(facebookLoginIncludesInstagram() ? META_PERMISSIONS.FACEBOOK.INSTAGRAM_PUBLISHING : []),
      ]),
    ]),
  };
}

/**
 * What stands between a destination and publishing: missing permissions and, for destinations
 * reached through Facebook Login, the CREATE_CONTENT Page task. An unknown task list counts as
 * missing (never assume a Page role that Meta has not reported).
 */
function publishingGaps({ provider, platform, tasks, grantedScopes }) {
  const granted = new Set(grantedScopes ?? []);
  const missingPermissions = publishingScopes(provider, platform).filter((s) => !granted.has(s));
  const viaFacebook = provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN;
  const tasksKnown = Array.isArray(tasks);
  const lacksCreateContent = viaFacebook && (!tasksKnown || !tasks.includes(PAGE_PUBLISHING_TASK));
  const reasons = [];
  if (missingPermissions.length > 0)
    reasons.push(`Missing permission: ${missingPermissions.join(', ')}`);
  if (lacksCreateContent) {
    reasons.push(
      tasksKnown
        ? 'This login has no Page role that allows creating content (CREATE_CONTENT task)'
        : 'The Page role (CREATE_CONTENT task) has not been confirmed yet. Sync to refresh it',
    );
  }
  return {
    missingPermissions,
    createContent: viaFacebook && tasksKnown ? tasks.includes(PAGE_PUBLISHING_TASK) : null,
    reasons,
  };
}

/**
 * Whether a destination has what publishing will need: the permissions, and for Page-based
 * destinations a Page role that allows creating content. (Publishing itself comes later.)
 */
export function assessPublishing(input) {
  const { reasons } = publishingGaps(input);
  return reasons.length > 0
    ? { status: PUBLISHING_STATUS.RESTRICTED, reason: reasons.join('. ') }
    : { status: PUBLISHING_STATUS.READY, reason: null };
}

const ATTENTION_FOR_STATUS = {
  [CONNECTION_STATUS.EXPIRED]: ACCOUNT_ATTENTION.CONNECTION_EXPIRED,
  [CONNECTION_STATUS.REVOKED]: ACCOUNT_ATTENTION.CONNECTION_REVOKED,
  [CONNECTION_STATUS.ERROR]: ACCOUNT_ATTENTION.CONNECTION_ERROR,
  [CONNECTION_STATUS.DISCONNECTED]: ACCOUNT_ATTENTION.DISCONNECTED,
};

const FALLBACK_REASONS = {
  [CONNECTION_STATUS.EXPIRED]: STATUS_REASONS.TOKEN_EXPIRED,
  [CONNECTION_STATUS.REVOKED]: STATUS_REASONS.REVOKED,
  [CONNECTION_STATUS.ERROR]: 'This login needs attention. Reconnect to restore access.',
  [CONNECTION_STATUS.DISCONNECTED]: STATUS_REASONS.DISCONNECTED,
};

const SYNC_FAILED_MESSAGE =
  'The last synchronization did not complete. The information shown may be out of date.';

const formatDay = (date) => date.toISOString().slice(0, 10);

/** Problems with a connection worth surfacing, in priority order. Pure. */
export function connectionAttention(connection, now = new Date()) {
  const { status, reason } = effectiveStatus(connection, now);
  if (status !== CONNECTION_STATUS.ACTIVE) {
    return [{ code: ATTENTION_FOR_STATUS[status], message: reason ?? FALLBACK_REASONS[status] }];
  }
  const items = [];
  const required = scopeReport(connection).required;
  if (required.length > 0) {
    items.push({
      code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
      message: `Required permission not granted: ${required.join(', ')}. Reconnect and allow it.`,
    });
  }
  const soon = expiringSoon(connection, now);
  if (soon) {
    items.push({
      code: ACCOUNT_ATTENTION.EXPIRING_SOON,
      message: `Access expires on ${formatDay(soon)}. Reconnect before then to avoid an interruption.`,
    });
  }
  if (connection.lastSyncOutcome && connection.lastSyncOutcome !== SYNC_OUTCOMES.SUCCESS) {
    items.push({ code: ACCOUNT_ATTENTION.SYNC_FAILED, message: SYNC_FAILED_MESSAGE });
  }
  return items;
}

/**
 * Health of one destination, computed from its own record and the CURRENT state of the
 * connection it was obtained through (expiry dates, granted permissions, last sync).
 * A destination is READY only when its connection is usable, the account itself is active,
 * every publishing permission is granted and (via Facebook Login) the CREATE_CONTENT Page
 * task is confirmed. Pure: no I/O.
 */
export function accountHealth(account, connection, now = new Date()) {
  if (!connection) {
    return {
      connectionStatus: CONNECTION_STATUS.ERROR,
      connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
      readiness: PUBLISHING_STATUS.UNAVAILABLE,
      readinessReasons: [STATUS_REASONS.ACCOUNT_LOST],
      eligibility: { eligible: false, createContent: null, missingPermissions: [] },
      attention: [{ code: ACCOUNT_ATTENTION.ACCESS_LOST, message: STATUS_REASONS.ACCOUNT_LOST }],
      needsAttention: true,
    };
  }

  const conn = effectiveStatus(connection, now);
  const connectionUsable = conn.status === CONNECTION_STATUS.ACTIVE;
  const connectionStatus = connectionUsable ? account.connectionStatus : conn.status;
  const connectionStatusReason = connectionUsable
    ? account.connectionStatus === CONNECTION_STATUS.ACTIVE
      ? null
      : (account.connectionStatusReason ?? FALLBACK_REASONS[account.connectionStatus] ?? null)
    : (conn.reason ?? FALLBACK_REASONS[conn.status]);

  const gaps = publishingGaps({
    provider: connection.provider,
    platform: account.platform,
    tasks: account.tasks,
    grantedScopes: connection.grantedScopes,
  });
  const eligibility = {
    eligible: gaps.reasons.length === 0,
    createContent: gaps.createContent,
    missingPermissions: gaps.missingPermissions,
  };

  const attention = [];
  let readiness;
  let readinessReasons;
  if (connectionStatus !== CONNECTION_STATUS.ACTIVE) {
    readiness = PUBLISHING_STATUS.UNAVAILABLE;
    readinessReasons = [connectionStatusReason ?? 'This account is not connected.'];
    // An account-level ERROR on a healthy connection means this login lost access to it.
    const code =
      connectionUsable && connectionStatus === CONNECTION_STATUS.ERROR
        ? ACCOUNT_ATTENTION.ACCESS_LOST
        : ATTENTION_FOR_STATUS[connectionStatus];
    attention.push({ code, message: readinessReasons[0] });
  } else {
    readiness = eligibility.eligible ? PUBLISHING_STATUS.READY : PUBLISHING_STATUS.RESTRICTED;
    readinessReasons = gaps.reasons;
    if (gaps.missingPermissions.length > 0) {
      attention.push({
        code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
        message: `Missing permission: ${gaps.missingPermissions.join(', ')}`,
      });
    }
    if (gaps.createContent !== true && connection.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN) {
      attention.push({
        code: ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT,
        message: gaps.reasons.at(-1),
      });
    }
    const soon = expiringSoon(connection, now);
    if (soon) {
      attention.push({
        code: ACCOUNT_ATTENTION.EXPIRING_SOON,
        message: `Access expires on ${formatDay(soon)}. Reconnect the login before then.`,
      });
    }
    if (connection.lastSyncOutcome && connection.lastSyncOutcome !== SYNC_OUTCOMES.SUCCESS) {
      attention.push({ code: ACCOUNT_ATTENTION.SYNC_FAILED, message: SYNC_FAILED_MESSAGE });
    }
  }

  return {
    connectionStatus,
    connectionStatusReason,
    readiness,
    readinessReasons,
    eligibility,
    attention,
    needsAttention: attention.length > 0,
  };
}

/** API representation of a connection. Never contains token material. */
export function connectionView(connection, { accountCount, accountCounts, now = new Date() } = {}) {
  const json = connection.toJSON();
  const { status, reason } = effectiveStatus(connection, now);
  const connectedBy = connection.populated?.('connectedBy') ? connection.connectedBy : null;
  const attention = connectionAttention(connection, now);
  return {
    id: json.id,
    provider: json.provider,
    displayName: json.displayName ?? null,
    pictureUrl: json.pictureUrl ?? null,
    status,
    statusReason: reason,
    grantedScopes: json.grantedScopes ?? [],
    declinedScopes: json.declinedScopes ?? [],
    missingScopes: scopeReport(connection),
    tokenExpiresAt: json.tokenExpiresAt ?? null,
    dataAccessExpiresAt: json.dataAccessExpiresAt ?? null,
    expiringSoonAt: expiringSoon(connection, now),
    lastSyncedAt: json.lastSyncedAt ?? null,
    lastSyncAttemptAt: json.lastSyncAttemptAt ?? null,
    lastSyncOutcome: json.lastSyncOutcome ?? null,
    syncInProgress: Boolean(connection.syncLockedUntil && connection.syncLockedUntil > now),
    lastRefreshedAt: json.lastRefreshedAt ?? null,
    lastError: json.lastError ?? null,
    attention,
    // Login-level only (same rule as the summary counts); destination problems are reported
    // separately in accountCounts.needsAttention.
    needsAttention: attention.length > 0,
    connectedBy: connectedBy ? { id: String(connectedBy._id), name: connectedBy.name } : null,
    disconnectedAt: json.disconnectedAt ?? null,
    accountCount: accountCount ?? undefined,
    accountCounts: accountCounts ?? undefined,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}
