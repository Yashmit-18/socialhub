/**
 * Phase 6: manual Facebook Group distribution. SocialHub keeps a directory of Facebook Groups
 * and turns a post into one sharing task per group; a person posts it in the group themselves
 * and marks the task done. Nothing here posts to, reads or scrapes Facebook.
 *
 * Each group can list the workspace's Facebook Pages that are members of it (entered by
 * people: Meta offers no API to read which groups a Page has joined). A real post published
 * to one of those Pages can then get its sharing tasks automatically ("auto share").
 */
import { z } from 'zod';
import { objectIdSchema } from './schemas.js';

export const GROUP_LIMITS = Object.freeze({
  NAME_MAX: 120,
  CATEGORY_NAME_MAX: 40,
  CATEGORIES_MAX: 50,
  GROUPS_MAX: 2000,
  TAGS_MAX: 15,
  TAG_MAX: 30,
  NOTES_MAX: 2000,
  COOLDOWN_DAYS_MAX: 365,
  SHARE_TITLE_MAX: 120,
  MESSAGE_MAX: 5000,
  LINK_MAX: 2000,
  GROUPS_PER_SHARE_MAX: 200,
  TASK_NOTE_MAX: 500,
  PAGE_SIZE_MAX: 100,
  /** Facebook Pages listed as members of one group. */
  PAGES_PER_GROUP_MAX: 50,
  /** Group links accepted by one bulk add. */
  BULK_GROUPS_MAX: 100,
});

export const FACEBOOK_GROUP_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
});

export const SHARING_TASK_STATUS = Object.freeze({
  OPEN: 'OPEN',
  DONE: 'DONE',
  SKIPPED: 'SKIPPED',
});

/** Why a group did not get a task when a share was created or extended. */
export const SHARE_SKIP_REASONS = Object.freeze({
  /** This share already has a task for the group (duplicate prevention). */
  ALREADY_QUEUED: 'ALREADY_QUEUED',
  /** The group's "days between shares" rule: something was shared there too recently. */
  TOO_SOON: 'TOO_SOON',
  /** Archived groups receive no new tasks. */
  ARCHIVED: 'ARCHIVED',
});

const FACEBOOK_HOSTS = /^(?:www\.|m\.|web\.|mbasic\.)?facebook\.com$/i;

/**
 * A Facebook Group address in canonical form, or null when it is not one. Accepts the
 * www/m/web/mbasic hosts with or without https://; the key is the group's id or vanity name,
 * lower-cased, and identifies the group for duplicate checks.
 */
export function parseFacebookGroupUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > GROUP_LIMITS.LINK_MAX) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!FACEBOOK_HOSTS.test(url.hostname)) return null;
  const match = /^\/groups\/([A-Za-z0-9._-]{1,100})\/?/.exec(url.pathname);
  if (!match) return null;
  const slug = match[1];
  return { url: `https://www.facebook.com/groups/${slug}/`, key: slug.toLowerCase() };
}

/**
 * A readable starting name for a group added by link only: "london.fashion-lovers" becomes
 * "London Fashion Lovers", a numeric id becomes "Facebook group 1234". People can rename it.
 */
export function groupNameFromUrl(input) {
  const parsed = parseFacebookGroupUrl(input);
  if (!parsed) return null;
  const slug = /\/groups\/([^/]+)\//.exec(parsed.url)[1];
  if (/^\d+$/.test(slug)) return `Facebook group ${slug}`;
  const words = slug
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return (words.join(' ') || slug).slice(0, GROUP_LIMITS.NAME_MAX);
}

/** True for an https address on facebook.com (any subdomain) or fb.com: a shared post's link. */
export function isFacebookUrl(input) {
  if (typeof input !== 'string' || input.length > GROUP_LIMITS.LINK_MAX) return false;
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' && /(^|\.)(facebook\.com|fb\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

const trimmedString = (max, label) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, { error: `${label} is required` })
    .max(max, { error: `Use at most ${max} characters` });

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use at most ${max} characters` });

const httpsLink = z
  .string()
  .trim()
  .max(GROUP_LIMITS.LINK_MAX)
  .refine(
    (value) => {
      if (value === '') return true;
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { error: 'Enter a full https:// link' },
  );

const groupUrlSchema = z
  .string({ error: 'Group link is required' })
  .refine((value) => parseFacebookGroupUrl(value) !== null, {
    error: 'Enter a Facebook Group link, like https://www.facebook.com/groups/your-group',
  });

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(GROUP_LIMITS.TAG_MAX, { error: `Tags are at most ${GROUP_LIMITS.TAG_MAX} characters` });

const tagsSchema = z
  .array(tagSchema)
  .max(GROUP_LIMITS.TAGS_MAX, { error: `Use at most ${GROUP_LIMITS.TAGS_MAX} tags` })
  .transform((tags) => [...new Set(tags)]);

const cooldownSchema = z.number().int().min(1).max(GROUP_LIMITS.COOLDOWN_DAYS_MAX).nullable();

/** The workspace's Facebook Pages (social account ids) that are members of a group. */
const pageIdsSchema = z
  .array(objectIdSchema)
  .max(GROUP_LIMITS.PAGES_PER_GROUP_MAX, {
    error: `Choose at most ${GROUP_LIMITS.PAGES_PER_GROUP_MAX} Pages`,
  })
  .transform((ids) => [...new Set(ids.map((value) => value.toLowerCase()))]);

export const groupCategorySchema = z.strictObject({
  name: trimmedString(GROUP_LIMITS.CATEGORY_NAME_MAX, 'Name'),
});

export const facebookGroupCreateSchema = z.strictObject({
  name: trimmedString(GROUP_LIMITS.NAME_MAX, 'Name'),
  url: groupUrlSchema,
  categoryId: objectIdSchema.nullable().optional(),
  tags: tagsSchema.optional(),
  memberCount: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  /** The group's posting rules or anything the team should know. */
  notes: optionalText(GROUP_LIMITS.NOTES_MAX).optional(),
  /** Minimum days between two shares in this group (null: no rule). */
  minDaysBetweenShares: cooldownSchema.optional(),
  /** The workspace's Facebook Pages that are members of this group. */
  pageIds: pageIdsSchema.optional(),
});

/**
 * Many groups at once, by link: one per line in the app. Each link is checked on its own and
 * reported back (added, already listed, not a group link). Groups get a name from their link.
 */
export const facebookGroupBulkCreateSchema = z.strictObject({
  urls: z
    .array(z.string().max(GROUP_LIMITS.LINK_MAX))
    .min(1, { error: 'Paste at least one group link' })
    .max(GROUP_LIMITS.BULK_GROUPS_MAX, {
      error: `Add at most ${GROUP_LIMITS.BULK_GROUPS_MAX} groups at a time`,
    }),
  categoryId: objectIdSchema.nullable().optional(),
  /** Pages that are members of every listed group (added to groups already listed, too). */
  pageIds: pageIdsSchema.optional(),
});

export const facebookGroupUpdateSchema = facebookGroupCreateSchema
  .partial()
  .extend({ status: z.enum(Object.values(FACEBOOK_GROUP_STATUS)).optional() })
  .refine((value) => Object.keys(value).length > 0, { error: 'Change at least one field' });

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce.number().int().min(1).max(GROUP_LIMITS.PAGE_SIZE_MAX).default(25);

export const FACEBOOK_GROUP_SORTS = Object.freeze([
  'name',
  '-name',
  '-lastSharedAt',
  'lastSharedAt',
  '-memberCount',
  '-createdAt',
]);

export const facebookGroupQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  /** A category id, or "none" for groups without a category. */
  category: z.union([objectIdSchema, z.literal('none')]).optional(),
  tag: z.string().trim().toLowerCase().max(GROUP_LIMITS.TAG_MAX).optional(),
  /** Only groups this Facebook Page (social account id) is a member of. */
  pageId: objectIdSchema.optional(),
  status: z.enum([...Object.values(FACEBOOK_GROUP_STATUS), 'ALL']).default('ACTIVE'),
  sort: z.enum(FACEBOOK_GROUP_SORTS).default('name'),
  page,
  limit,
});

const groupIdsSchema = z
  .array(objectIdSchema)
  .min(1, { error: 'Choose at least one group' })
  .max(GROUP_LIMITS.GROUPS_PER_SHARE_MAX, {
    error: `Choose at most ${GROUP_LIMITS.GROUPS_PER_SHARE_MAX} groups at a time`,
  });

const assigneeSchema = objectIdSchema.nullable().optional();
const dueAtSchema = z.iso.datetime({ offset: true }).nullable().optional();

export const groupShareCreateSchema = z.strictObject({
  title: trimmedString(GROUP_LIMITS.SHARE_TITLE_MAX, 'Title'),
  message: trimmedString(GROUP_LIMITS.MESSAGE_MAX, 'Text'),
  link: httpsLink.optional(),
  groupIds: groupIdsSchema,
  /** A member (user id) who will post in these groups; null or absent: anyone. */
  assigneeId: assigneeSchema,
  dueAt: dueAtSchema,
});

export const groupShareUpdateSchema = z
  .strictObject({
    title: trimmedString(GROUP_LIMITS.SHARE_TITLE_MAX, 'Title').optional(),
    message: trimmedString(GROUP_LIMITS.MESSAGE_MAX, 'Text').optional(),
    link: httpsLink.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Change at least one field' });

export const groupShareAddGroupsSchema = z.strictObject({
  groupIds: groupIdsSchema,
  assigneeId: assigneeSchema,
  dueAt: dueAtSchema,
});

export const groupShareQuerySchema = z.strictObject({ page, limit });

/**
 * Auto share: sharing tasks for a real post, in the groups its Facebook Pages are members of.
 * Tasks for a Page are created once its post is live on Facebook.
 */
export const autoGroupShareSchema = z.strictObject({ publishJobId: objectIdSchema });

/** Why a published post cannot be shared in groups automatically. */
export const AUTO_SHARE_REFUSALS = Object.freeze({
  /** Simulated posts never reached Facebook: there is nothing to share. */
  SIMULATED: 'SIMULATED',
  /** The post went to no Facebook Page. */
  NO_FACEBOOK_PAGES: 'NO_FACEBOOK_PAGES',
});

export const sharingTaskQuerySchema = z.strictObject({
  status: z.enum([...Object.values(SHARING_TASK_STATUS), 'ALL']).default('OPEN'),
  /** me: assigned to me; unassigned; mine-or-unassigned (the default work queue); any. */
  assignee: z.enum(['me', 'unassigned', 'available', 'any']).default('any'),
  shareId: objectIdSchema.optional(),
  groupId: objectIdSchema.optional(),
  page,
  limit,
});

export const sharingTaskUpdateSchema = z
  .strictObject({
    status: z.enum(Object.values(SHARING_TASK_STATUS)).optional(),
    /** Link to the post in the group, after sharing it. */
    postUrl: z
      .string()
      .trim()
      .refine((value) => value === '' || isFacebookUrl(value), {
        error: 'Paste the https:// link of the post on Facebook',
      })
      .nullable()
      .optional(),
    note: optionalText(GROUP_LIMITS.TASK_NOTE_MAX).nullable().optional(),
    assigneeId: assigneeSchema,
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Change at least one field' });
