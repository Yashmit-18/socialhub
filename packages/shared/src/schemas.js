/**
 * Request validation schemas shared by the API (authoritative) and the web
 * app (instant form feedback). All object schemas are strict: unknown keys
 * are rejected, which also blocks MongoDB operator injection via bodies.
 */
import { z } from 'zod';
import { ASSIGNABLE_ROLES } from './roles.js';
import {
  ACCOUNT_ACCESS_MODES,
  ACCOUNT_SORTS,
  CONNECTION_STATUS,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from './enums.js';

export const LIMITS = Object.freeze({
  NAME_MAX: 80,
  PASSWORD_MIN: 8,
  /** bcrypt only uses the first 72 bytes of input, so longer secrets are rejected rather than silently truncated. */
  PASSWORD_MAX_BYTES: 72,
  WORKSPACE_NAME_MIN: 2,
  WORKSPACE_NAME_MAX: 60,
  SLUG_MIN: 3,
  SLUG_MAX: 48,
  PAGE_SIZE_MAX: 100,
  ACCOUNT_ACCESS_MAX: 500,
  /** Maximum items in one bulk request (accounts, members, connections). */
  BULK_MAX: 200,
});

export const RESERVED_SLUGS = Object.freeze([
  'api',
  'app',
  'admin',
  'auth',
  'login',
  'logout',
  'register',
  'signup',
  'invite',
  'invitations',
  'onboarding',
  'settings',
  'account',
  'new',
  'w',
  'www',
  'help',
  'support',
  'static',
  'assets',
]);

const byteLength = (value) => new TextEncoder().encode(value).length;

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, { error: 'Invalid identifier' });

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, { error: 'Email is too long' })
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(LIMITS.PASSWORD_MIN, { error: `Use at least ${LIMITS.PASSWORD_MIN} characters` })
  .refine((v) => byteLength(v) <= LIMITS.PASSWORD_MAX_BYTES, {
    error: `Use at most ${LIMITS.PASSWORD_MAX_BYTES} characters`,
  })
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
    error: 'Include at least one letter and one number',
  });

export const personNameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, { error: 'Name is required' })
  .max(LIMITS.NAME_MAX, { error: `Use at most ${LIMITS.NAME_MAX} characters` });

/* ------------------------------------------------------------------ auth */

export const registerSchema = z.strictObject({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Do not apply the password policy on login: legacy/other policies must still be able to sign in.
  password: z
    .string({ error: 'Password is required' })
    .min(1, { error: 'Password is required' })
    .max(1024),
});

export const forgotPasswordSchema = z.strictObject({
  email: emailSchema,
});

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(256),
  password: passwordSchema,
});

export const updateProfileSchema = z.strictObject({
  name: personNameSchema,
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, { error: 'Current password is required' }).max(1024),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    error: 'New password must be different from the current password',
    path: ['newPassword'],
  });

/* ------------------------------------------------------------- workspaces */

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.SLUG_MIN, { error: `Use at least ${LIMITS.SLUG_MIN} characters` })
  .max(LIMITS.SLUG_MAX, { error: `Use at most ${LIMITS.SLUG_MAX} characters` })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'Use lowercase letters, numbers and single hyphens',
  })
  .refine((v) => !RESERVED_SLUGS.includes(v), { error: 'This URL is reserved' });

export const workspaceNameSchema = z
  .string({ error: 'Workspace name is required' })
  .trim()
  .min(LIMITS.WORKSPACE_NAME_MIN, { error: `Use at least ${LIMITS.WORKSPACE_NAME_MIN} characters` })
  .max(LIMITS.WORKSPACE_NAME_MAX, { error: `Use at most ${LIMITS.WORKSPACE_NAME_MAX} characters` });

export const timeZoneSchema = z
  .string()
  .trim()
  .refine(isValidTimeZone, { error: 'Choose a valid time zone' });

export const createWorkspaceSchema = z.strictObject({
  name: workspaceNameSchema,
  slug: slugSchema.optional(),
  timezone: timeZoneSchema.optional(),
});

export const updateWorkspaceSchema = z
  .strictObject({
    name: workspaceNameSchema.optional(),
    slug: slugSchema.optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export const deleteWorkspaceSchema = z.strictObject({
  confirmation: z.string().min(1, { error: 'Type the workspace name to confirm' }),
  password: z.string().min(1, { error: 'Password is required' }).max(1024),
});

export const transferOwnershipSchema = z.strictObject({
  memberId: objectIdSchema,
  password: z.string().min(1, { error: 'Password is required' }).max(1024),
});

/* ------------------------------------------------------- members & invites */

export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES, { error: 'Choose a valid role' });

export const updateMemberRoleSchema = z.strictObject({
  role: assignableRoleSchema,
});

export const accountAccessSchema = z
  .strictObject({
    mode: z.enum(Object.values(ACCOUNT_ACCESS_MODES)),
    socialAccountIds: z.array(objectIdSchema).max(LIMITS.ACCOUNT_ACCESS_MAX).default([]),
  })
  .refine((v) => v.mode === ACCOUNT_ACCESS_MODES.SELECTED || v.socialAccountIds.length === 0, {
    error: 'Account list is only allowed when access mode is SELECTED',
    path: ['socialAccountIds'],
  });

export const createInvitationSchema = z.strictObject({
  email: emailSchema,
  role: assignableRoleSchema,
  /**
   * Social account access granted on acceptance (editors and viewers). When omitted, the new
   * member starts with no account access until an admin assigns some.
   */
  accountAccess: accountAccessSchema.optional(),
});

export const invitationTokenSchema = z.string().min(20).max(256);

/* ------------------------------------------------------ meta integration */

export const startMetaAuthorizationSchema = z.strictObject({
  provider: z.enum(Object.values(SOCIAL_PROVIDERS), { error: 'Choose Facebook or Instagram' }),
  /** Present when re-authorizing an existing connection. */
  connectionId: objectIdSchema.optional(),
});

/** Meta object ids are numeric strings. */
export const metaExternalIdSchema = z.string().regex(/^\d{1,32}$/, { error: 'Invalid account id' });

export const selectSocialAccountsSchema = z.strictObject({
  accounts: z
    .array(
      z.strictObject({
        platform: z.enum(Object.values(SOCIAL_PLATFORMS)),
        externalId: metaExternalIdSchema,
      }),
    )
    .min(1, { error: 'Select at least one account' })
    .max(LIMITS.ACCOUNT_ACCESS_MAX),
});

/* ------------------------------------------------------ account management */

const objectIdList = (max) => z.array(objectIdSchema).max(max).default([]);

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Listing / search of destinations (query string). */
export const socialAccountQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  platform: z.enum(Object.values(SOCIAL_PLATFORMS)).optional(),
  status: z.enum(Object.values(CONNECTION_STATUS)).optional(),
  readiness: z.enum(Object.values(PUBLISHING_STATUS)).optional(),
  attention: booleanQuery.optional(),
  connectionId: objectIdSchema.optional(),
  sort: z.enum(ACCOUNT_SORTS).default('name'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.ACCOUNT_ACCESS_MAX)
    .default(LIMITS.ACCOUNT_ACCESS_MAX),
});

/** Cross-workspace listing adds an optional workspace filter. */
export const crossWorkspaceAccountQuerySchema = socialAccountQuerySchema.extend({
  workspaceId: objectIdSchema.optional(),
});

export const crossWorkspaceSummaryQuerySchema = z.strictObject({
  workspaceId: objectIdSchema.optional(),
});

/** Bulk actions on destinations. */
export const accountIdsSchema = z.strictObject({
  accountIds: z
    .array(objectIdSchema)
    .min(1, { error: 'Select at least one account' })
    .max(LIMITS.BULK_MAX),
});

/** Bulk synchronization of connections (all when omitted). */
export const syncConnectionsSchema = z.strictObject({
  connectionIds: z.array(objectIdSchema).min(1).max(LIMITS.BULK_MAX).optional(),
});

const nonEmptyNoOverlap = (a, b) => (value) => {
  if (value[a].length + value[b].length === 0) return false;
  const first = new Set(value[a]);
  return !value[b].some((v) => first.has(v));
};

/** Incremental change to one member's account access. */
export const memberAccountAccessPatchSchema = z
  .strictObject({
    add: objectIdList(LIMITS.ACCOUNT_ACCESS_MAX),
    remove: objectIdList(LIMITS.ACCOUNT_ACCESS_MAX),
  })
  .refine(nonEmptyNoOverlap('add', 'remove'), {
    error: 'Provide accounts to add or remove, and do not list one in both',
  });

/** Grant or revoke one account for several members. */
export const accountMembersPatchSchema = z
  .strictObject({
    grant: objectIdList(LIMITS.BULK_MAX),
    revoke: objectIdList(LIMITS.BULK_MAX),
  })
  .refine(nonEmptyNoOverlap('grant', 'revoke'), {
    error: 'Provide members to grant or revoke, and do not list one in both',
  });

/* ------------------------------------------------------------- pagination */

export const cursorPaginationSchema = z.strictObject({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(20),
});

/** Turn a ZodError into `{ field: message }` (first message per field) for form display. */
export function fieldErrorsFromIssues(issues) {
  const out = {};
  for (const issue of issues ?? []) {
    const key = issue.path?.length ? issue.path.join('.') : '_root';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
