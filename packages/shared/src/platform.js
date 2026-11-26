/**
 * Platform administration: the operator console of this SocialHub (web /admin, API
 * /api/v1/admin). Nothing here is a workspace role: PLATFORM_ADMIN has nothing to do with
 * ROLES.ADMIN, and none of these names may be added to PERMISSIONS (roles.js gives every
 * permission to workspace owners). See docs/ADMIN_PANEL.md.
 */
import { z } from 'zod';
import { WORKSPACE_PUBLISHING_MODES } from './publishing.js';
import { LIMITS, objectIdSchema } from './schemas.js';

/** Stored on User.platformRole. Granted and revoked only by apps/api/scripts/platform-admin.js. */
export const PLATFORM_ROLES = Object.freeze({ PLATFORM_ADMIN: 'PLATFORM_ADMIN' });

/** True for a user (API JSON or document) who may use the operator console. */
export const isPlatformAdmin = (user) => user?.platformRole === PLATFORM_ROLES.PLATFORM_ADMIN;

/** User.status. People read DISABLED as "Suspended". */
export const USER_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' });

export const ADMIN_LIMITS = Object.freeze({
  SEARCH_MAX: 100,
  PAGE_SIZE_DEFAULT: 25,
  PAGE_SIZE_MAX: LIMITS.PAGE_SIZE_MAX,
  REASON_MIN: 10,
  REASON_MAX: 500,
  NOTE_MAX: 500,
  /** Rows returned inside one detail answer: a person's workspaces, a workspace's members. */
  DETAIL_ROWS_MAX: 200,
  /** Days in the overview's activity chart, today (UTC) included. */
  ACTIVITY_DAYS: 14,
  /** A delivery still waiting this long after its time counts as late. */
  LATE_AFTER_MINUTES: 10,
});

/** PlatformAuditLog.action. */
export const PLATFORM_AUDIT_ACTIONS = Object.freeze({
  USER_SUSPENDED: 'platform.user_suspended',
  USER_REACTIVATED: 'platform.user_reactivated',
  ADMIN_GRANTED: 'platform.admin_granted',
  ADMIN_REVOKED: 'platform.admin_revoked',
});

/** `error.details.reason` of a 409 from suspend or reactivate. */
export const ADMIN_CONFLICT_REASONS = Object.freeze({
  SELF: 'SELF',
  TARGET_IS_PLATFORM_ADMIN: 'TARGET_IS_PLATFORM_ADMIN',
  ALREADY_SUSPENDED: 'ALREADY_SUSPENDED',
  NOT_SUSPENDED: 'NOT_SUSPENDED',
});

/** Whether a worker is connected to a queue. UNKNOWN: the queue could not say. */
export const WORKER_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  NOT_RUNNING: 'NOT_RUNNING',
  UNKNOWN: 'UNKNOWN',
});

/** Things the overview asks the operator to look at. */
export const ADMIN_ATTENTION_CODES = Object.freeze({
  QUEUE_NOT_CONFIGURED: 'QUEUE_NOT_CONFIGURED',
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
  WORKER_NOT_RUNNING: 'WORKER_NOT_RUNNING',
  POSTS_LATE: 'POSTS_LATE',
  DELIVERIES_INTERRUPTED: 'DELIVERIES_INTERRUPTED',
  POSTS_FAILED_RECENTLY: 'POSTS_FAILED_RECENTLY',
  ACCOUNTS_SUSPENDED: 'ACCOUNTS_SUSPENDED',
  STORAGE_NOT_PUBLIC: 'STORAGE_NOT_PUBLIC',
  EMAIL_NOT_CONFIGURED: 'EMAIL_NOT_CONFIGURED',
});

export const ADMIN_ATTENTION_SEVERITY = Object.freeze({
  DANGER: 'danger',
  WARNING: 'warning',
  INFO: 'info',
});

/** Newest first (default) or oldest first. Both lists sort on creation time only. */
export const ADMIN_SORTS = Object.freeze(['-createdAt', 'createdAt']);

const search = z
  .string()
  .trim()
  .max(ADMIN_LIMITS.SEARCH_MAX, {
    error: `Search for at most ${ADMIN_LIMITS.SEARCH_MAX} characters`,
  })
  .optional();
const sort = z.enum(ADMIN_SORTS).default('-createdAt');
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(ADMIN_LIMITS.PAGE_SIZE_MAX)
  .default(ADMIN_LIMITS.PAGE_SIZE_DEFAULT);

/** GET /admin/users (query string). */
export const adminUserQuerySchema = z.strictObject({
  q: search,
  status: z.enum(Object.values(USER_STATUS)).optional(),
  sort,
  page,
  limit,
});

/** GET /admin/workspaces (query string). */
export const adminWorkspaceQuerySchema = z.strictObject({
  q: search,
  publishingMode: z.enum(Object.values(WORKSPACE_PUBLISHING_MODES)).optional(),
  sort,
  page,
  limit,
});

/** GET /admin/audit-log (query string). Newest first; `cursor` is the last id of the page before. */
export const adminAuditQuerySchema = z.strictObject({
  action: z.enum(Object.values(PLATFORM_AUDIT_ACTIONS)).optional(),
  targetId: objectIdSchema.optional(),
  cursor: objectIdSchema.optional(),
  limit,
});

const confirmPassword = z
  .string({ error: 'Password is required' })
  .min(1, { error: 'Password is required' })
  .max(1024);

/** POST /admin/users/:userId/suspend. `password` is the platform admin's own. */
export const adminSuspendUserSchema = z.strictObject({
  reason: z
    .string({ error: 'Write why you are suspending this account' })
    .trim()
    .min(ADMIN_LIMITS.REASON_MIN, {
      error: `Write at least ${ADMIN_LIMITS.REASON_MIN} characters, so the reason is clear later`,
    })
    .max(ADMIN_LIMITS.REASON_MAX, { error: `Use at most ${ADMIN_LIMITS.REASON_MAX} characters` }),
  password: confirmPassword,
});

/** POST /admin/users/:userId/reactivate. `note` is optional. */
export const adminReactivateUserSchema = z.strictObject({
  note: z
    .string()
    .trim()
    .max(ADMIN_LIMITS.NOTE_MAX, { error: `Use at most ${ADMIN_LIMITS.NOTE_MAX} characters` })
    .optional(),
  password: confirmPassword,
});
