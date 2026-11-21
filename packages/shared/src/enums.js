/**
 * Domain enums shared by the API and web app.
 *
 * The social/publishing enums are defined now so that the Phase 1 data model
 * (SocialConnection, SocialAccount) and later phases (ContentPackage, Post,
 * PublishingJob) agree on vocabulary from the start.
 */

/** How a member's visibility of social accounts is scoped inside a workspace. */
export const ACCOUNT_ACCESS_MODES = Object.freeze({
  ALL: 'ALL',
  SELECTED: 'SELECTED',
});

export const INVITATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
});

/**
 * An OAuth identity that authorised SocialHub. One workspace may hold many,
 * and one identity may grant access to many destinations (Pages / IG accounts).
 */
export const SOCIAL_PROVIDERS = Object.freeze({
  /** Facebook Login — yields Facebook Pages and Instagram accounts linked to those Pages. */
  FACEBOOK_LOGIN: 'FACEBOOK_LOGIN',
  /** Instagram API with Instagram Login — yields the professional account itself. */
  INSTAGRAM_LOGIN: 'INSTAGRAM_LOGIN',
});

/** A publishing destination. */
export const SOCIAL_PLATFORMS = Object.freeze({
  FACEBOOK_PAGE: 'FACEBOOK_PAGE',
  INSTAGRAM_ACCOUNT: 'INSTAGRAM_ACCOUNT',
});

export const INSTAGRAM_ACCOUNT_TYPES = Object.freeze({
  BUSINESS: 'BUSINESS',
  CREATOR: 'CREATOR',
});

/** Health of an OAuth identity / its token. */
export const CONNECTION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
});

/** Whether a destination can currently receive posts — tracked independently of connection health. */
export const PUBLISHING_STATUS = Object.freeze({
  READY: 'READY',
  RESTRICTED: 'RESTRICTED',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** Per-destination publishing job lifecycle (Phase 4, BullMQ). */
export const PUBLISHING_JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  RETRYING: 'RETRYING',
});

export const ACTIVITY_ACTIONS = Object.freeze({
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_OWNERSHIP_TRANSFERRED: 'workspace.ownership_transferred',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_ACCEPTED: 'invitation.accepted',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_ACCOUNT_ACCESS_UPDATED: 'member.account_access_updated',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_LEFT: 'member.left',
  SOCIAL_CONNECTION_CONNECTED: 'social_connection.connected',
  SOCIAL_CONNECTION_RECONNECTED: 'social_connection.reconnected',
  SOCIAL_CONNECTION_SYNCED: 'social_connection.synced',
  SOCIAL_CONNECTION_STATUS_CHANGED: 'social_connection.status_changed',
  SOCIAL_CONNECTION_DISCONNECTED: 'social_connection.disconnected',
  SOCIAL_CONNECTION_REMOVED: 'social_connection.removed',
  /** The person removed the app in their Facebook/Instagram settings (Meta deauthorize callback). */
  SOCIAL_CONNECTION_REVOKED: 'social_connection.revoked',
  SOCIAL_ACCOUNT_ADDED: 'social_account.added',
  SOCIAL_ACCOUNT_RELINKED: 'social_account.relinked',
  SOCIAL_ACCOUNT_REMOVED: 'social_account.removed',
  /** Composer drafts, stored media and account presets (Phase 4). */
  CONTENT_PACKAGE_CREATED: 'content_package.created',
  CONTENT_PACKAGE_UPDATED: 'content_package.updated',
  CONTENT_PACKAGE_DELETED: 'content_package.deleted',
  MEDIA_UPLOADED: 'media.uploaded',
  MEDIA_DELETED: 'media.deleted',
  ACCOUNT_PRESET_CREATED: 'account_preset.created',
  ACCOUNT_PRESET_DELETED: 'account_preset.deleted',
  /** Account organisation: workspace labels, labels on destinations and team notes. */
  ACCOUNT_LABEL_CREATED: 'account_label.created',
  ACCOUNT_LABEL_UPDATED: 'account_label.updated',
  ACCOUNT_LABEL_DELETED: 'account_label.deleted',
  SOCIAL_ACCOUNT_LABELS_UPDATED: 'social_account.labels_updated',
  SOCIAL_ACCOUNT_NOTES_UPDATED: 'social_account.notes_updated',
});

/**
 * Meta permissions SocialHub relies on, grouped by what they unlock. Connection health and
 * publishing readiness are evaluated against these lists (publishing itself is Phase 4).
 */
export const META_PERMISSIONS = Object.freeze({
  FACEBOOK: Object.freeze({
    /** Without it SocialHub cannot list the Pages an identity manages. */
    REQUIRED: Object.freeze(['pages_show_list']),
    /** Permissions SocialHub suggests but does not need. None at present. */
    RECOMMENDED: Object.freeze([]),
    /**
     * Not requested by default: only add (via META_FACEBOOK_SCOPES) for a documented need.
     * Meta lists business_management for Business Manager API use cases; ads_management /
     * ads_read are needed to publish to Instagram when the Page role comes from Business
     * Manager (Phase 4).
     */
    OPTIONAL: Object.freeze(['business_management', 'ads_management', 'ads_read']),
    PAGE_PUBLISHING: Object.freeze(['pages_manage_posts', 'pages_read_engagement']),
    INSTAGRAM_PUBLISHING: Object.freeze([
      'instagram_basic',
      'instagram_content_publish',
      'pages_read_engagement',
    ]),
  }),
  INSTAGRAM: Object.freeze({
    REQUIRED: Object.freeze(['instagram_business_basic']),
    PUBLISHING: Object.freeze(['instagram_business_content_publish']),
  }),
});

/**
 * Page task required to publish (Pages API: the user must be able to perform CREATE_CONTENT
 * on the Page). Page admins hold it alongside MANAGE; MANAGE alone is not treated as enough.
 */
export const PAGE_PUBLISHING_TASK = 'CREATE_CONTENT';

/** Why an OAuth round-trip is happening. */
export const OAUTH_PURPOSES = Object.freeze({
  CONNECT: 'CONNECT',
  RECONNECT: 'RECONNECT',
});

/** Outcome codes the OAuth callback reports back to the web app (never secrets). */
export const META_OAUTH_RESULTS = Object.freeze({
  CONNECTED: 'CONNECTED',
  RECONNECTED: 'RECONNECTED',
  STATE_MISSING: 'STATE_MISSING',
  STATE_INVALID: 'STATE_INVALID',
  STATE_EXPIRED: 'STATE_EXPIRED',
  STATE_ALREADY_USED: 'STATE_ALREADY_USED',
  BROWSER_MISMATCH: 'BROWSER_MISMATCH',
  FORBIDDEN: 'FORBIDDEN',
  USER_CANCELLED: 'USER_CANCELLED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  CODE_MISSING: 'CODE_MISSING',
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
});

/** What started a connection synchronization (recorded in sync history). */
export const SYNC_TRIGGERS = Object.freeze({
  MANUAL: 'MANUAL',
  BULK: 'BULK',
  SCHEDULED: 'SCHEDULED',
  RECONNECT: 'RECONNECT',
});

/** Result of a synchronization attempt that actually reached Meta. */
export const SYNC_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  TRANSIENT_FAILURE: 'TRANSIENT_FAILURE',
  FAILED: 'FAILED',
});

/**
 * Why a connection's synchronization wrote nothing (bulk results only; no history entry is
 * recorded for these).
 */
export const SYNC_SKIP_REASONS = Object.freeze({
  /** The Meta app credentials for this provider are not configured on the server. */
  CONFIG_REQUIRED: 'CONFIG_REQUIRED',
  /** Another synchronization of the same connection is running. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Disconnected or token erased: the person must reauthorize first. */
  NEEDS_RECONNECT: 'NEEDS_RECONNECT',
  /**
   * The login was disconnected, reconnected or removed while Meta was answering. The newer
   * change wins and the sync's results are discarded.
   */
  SUPERSEDED: 'SUPERSEDED',
});

/** Why a destination or connection is flagged as needing attention. */
export const ACCOUNT_ATTENTION = Object.freeze({
  CONNECTION_EXPIRED: 'CONNECTION_EXPIRED',
  CONNECTION_REVOKED: 'CONNECTION_REVOKED',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  ACCESS_LOST: 'ACCESS_LOST',
  DISCONNECTED: 'DISCONNECTED',
  MISSING_PERMISSIONS: 'MISSING_PERMISSIONS',
  MISSING_CREATE_CONTENT: 'MISSING_CREATE_CONTENT',
  EXPIRING_SOON: 'EXPIRING_SOON',
  SYNC_FAILED: 'SYNC_FAILED',
});

/** Sort keys accepted by the account listing endpoints. */
export const ACCOUNT_SORTS = Object.freeze([
  'name',
  '-name',
  'attention',
  '-lastSyncedAt',
  'lastSyncedAt',
  '-createdAt',
  'createdAt',
  /** Follower counts Meta last returned; accounts without a count sort last either way. */
  '-followers',
  'followers',
]);

/** Discovery status of a Page / Instagram account relative to the current workspace. */
export const DISCOVERY_STATES = Object.freeze({
  NEW: 'NEW',
  CONNECTED_HERE: 'CONNECTED_HERE',
  CONNECTED_VIA_OTHER: 'CONNECTED_VIA_OTHER',
  /** Registered via another identity whose connection is broken: can be re-linked here. */
  RECLAIMABLE: 'RECLAIMABLE',
});

/** Machine-readable API error codes. */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  REFRESH_RACE: 'REFRESH_RACE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The Meta integration (app id/secret) is not configured on this server. */
  META_NOT_CONFIGURED: 'META_NOT_CONFIGURED',
  /** A connection's token is expired/revoked; the user must reauthorize. */
  META_RECONNECT_REQUIRED: 'META_RECONNECT_REQUIRED',
  /** Meta returned an error or was unreachable. */
  META_UNAVAILABLE: 'META_UNAVAILABLE',
  /** A synchronization of the same connection is already running. */
  SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',
  /** Media storage is not configured on this server (STORAGE_DRIVER). */
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  /** The storage provider failed or was unreachable. */
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  /** Completion was requested but the file has not arrived in storage. */
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
});

/** Header the web client sends on cookie-authenticated endpoints (refresh/logout) as a CSRF guard. */
export const CLIENT_HEADER = 'X-SocialHub-Client';
