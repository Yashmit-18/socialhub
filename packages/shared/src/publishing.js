/**
 * Publishing domain (Phase 5): lifecycle states, their legal transitions and the request
 * schemas, shared by the API (authoritative) and the web app. See docs/PUBLISHING_API.md.
 *
 * One PublishJob = one prepared post sent to N destinations. Every destination (one Facebook
 * Page or one Instagram account) has its own record and its own state; the job's status is
 * always derived from its destinations and never set by hand.
 */
import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './enums.js';
import { objectIdSchema } from './schemas.js';

/** How this server publishes. Real publishing is not enabled in this build. */
export const PUBLISHING_MODES = Object.freeze({
  /** Publishing is switched off: jobs cannot be created. */
  DISABLED: 'DISABLED',
  /** Development only: the whole engine runs, but nothing is sent to Meta. */
  SIMULATED: 'SIMULATED',
  /** Real Meta Graph API calls. */
  LIVE: 'LIVE',
});

/** State of one destination of a job. */
export const DESTINATION_STATES = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const D = DESTINATION_STATES;

/** Destination states in which work is still pending or running. */
export const ACTIVE_DESTINATION_STATES = Object.freeze([
  D.SCHEDULED,
  D.QUEUED,
  D.PROCESSING,
  D.RETRY_SCHEDULED,
]);

/** States a worker may pick a destination up from. */
export const CLAIMABLE_DESTINATION_STATES = Object.freeze([
  D.SCHEDULED,
  D.QUEUED,
  D.RETRY_SCHEDULED,
]);

/** States that can still be cancelled. A destination being processed cannot. */
export const CANCELLABLE_DESTINATION_STATES = CLAIMABLE_DESTINATION_STATES;

/** Every legal move. Anything else is refused. PUBLISHED and CANCELLED are final. */
export const DESTINATION_TRANSITIONS = Object.freeze({
  [D.SCHEDULED]: Object.freeze([D.PROCESSING, D.CANCELLED]),
  [D.QUEUED]: Object.freeze([D.PROCESSING, D.CANCELLED]),
  [D.PROCESSING]: Object.freeze([D.PUBLISHED, D.RETRY_SCHEDULED, D.FAILED]),
  [D.RETRY_SCHEDULED]: Object.freeze([D.PROCESSING, D.CANCELLED]),
  // Only a person can move a failed destination back into the queue.
  [D.FAILED]: Object.freeze([D.QUEUED]),
  [D.PUBLISHED]: Object.freeze([]),
  [D.CANCELLED]: Object.freeze([]),
});

export function canTransitionDestination(from, to) {
  return DESTINATION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Status of a whole job, derived from its destinations. */
export const PUBLISH_JOB_STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  PUBLISHED: 'PUBLISHED',
  PARTIALLY_PUBLISHED: 'PARTIALLY_PUBLISHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const J = PUBLISH_JOB_STATUS;

export const ACTIVE_JOB_STATUSES = Object.freeze([J.SCHEDULED, J.QUEUED, J.PROCESSING]);

export const emptyDestinationCounts = () =>
  Object.fromEntries(Object.values(D).map((state) => [state, 0]));

/**
 * The job status for a set of destination counts (`{ QUEUED: 2, PUBLISHED: 1, … }`).
 * One failed destination never makes the others look failed: a mix of published and
 * failed/cancelled is PARTIALLY_PUBLISHED.
 */
export function deriveJobStatus(counts) {
  const n = (state) => counts?.[state] ?? 0;
  const finished = n(D.PUBLISHED) + n(D.FAILED) + n(D.CANCELLED);
  const active = n(D.SCHEDULED) + n(D.QUEUED) + n(D.PROCESSING) + n(D.RETRY_SCHEDULED);
  if (active > 0) {
    if (n(D.PROCESSING) + n(D.RETRY_SCHEDULED) > 0) return J.PROCESSING;
    // Everything still waiting is waiting for its scheduled time (some accounts may have been
    // cancelled): the post is still a scheduled post.
    if (n(D.QUEUED) === 0) return J.SCHEDULED;
    return finished > 0 ? J.PROCESSING : J.QUEUED;
  }
  if (n(D.PUBLISHED) > 0) {
    return n(D.FAILED) + n(D.CANCELLED) > 0 ? J.PARTIALLY_PUBLISHED : J.PUBLISHED;
  }
  return n(D.FAILED) > 0 ? J.FAILED : J.CANCELLED;
}

/** Machine-readable reasons a destination failed. Messages shown to people are separate. */
export const PUBLISH_ERROR_CODES = Object.freeze({
  /** The account was removed from the workspace after the job was created. */
  ACCOUNT_REMOVED: 'ACCOUNT_REMOVED',
  /** The login behind the account is expired, revoked or disconnected. */
  ACCOUNT_NEEDS_RECONNECT: 'ACCOUNT_NEEDS_RECONNECT',
  /** The account cannot receive posts (missing permission or Page task). */
  ACCOUNT_NOT_READY: 'ACCOUNT_NOT_READY',
  /** The post does not meet the platform's rules (e.g. Instagram needs media). */
  CONTENT_NOT_PUBLISHABLE: 'CONTENT_NOT_PUBLISHABLE',
  /** A file of the post is missing or was never verified. */
  MEDIA_UNAVAILABLE: 'MEDIA_UNAVAILABLE',
  /** Media is not reachable by Meta over public HTTPS (local storage). */
  MEDIA_NOT_PUBLIC: 'MEDIA_NOT_PUBLIC',
  /** Real publishing is not enabled or the Meta app is not configured. */
  LIVE_PUBLISHING_DISABLED: 'LIVE_PUBLISHING_DISABLED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  /** Meta or the network failed temporarily. */
  PLATFORM_UNAVAILABLE: 'PLATFORM_UNAVAILABLE',
  /** Meta refused the post. */
  PLATFORM_REJECTED: 'PLATFORM_REJECTED',
  /** The request was sent but no answer arrived: the post may or may not exist. */
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  /** The worker stopped while this destination was being processed. */
  INTERRUPTED: 'INTERRUPTED',
  /**
   * Checked again just before sending: the person who asked for this post left the workspace,
   * lost the publish permission or lost access to the account. Nothing was sent.
   */
  AUTHOR_NOT_AUTHORIZED: 'AUTHOR_NOT_AUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/** Why a destination was blocked with AUTHOR_NOT_AUTHORIZED (activity log metadata). */
export const PUBLISH_BLOCK_REASONS = Object.freeze({
  WORKSPACE_DELETED: 'WORKSPACE_DELETED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  NO_PUBLISH_PERMISSION: 'NO_PUBLISH_PERMISSION',
  NO_ACCOUNT_ACCESS: 'NO_ACCOUNT_ACCESS',
});

/** After these, the post may already exist: retrying can create a duplicate. */
export const UNCERTAIN_PUBLISH_ERROR_CODES = Object.freeze([
  PUBLISH_ERROR_CODES.OUTCOME_UNKNOWN,
  PUBLISH_ERROR_CODES.INTERRUPTED,
]);

/** Notes attached to a destination that did publish, but not everything was sent. */
export const PUBLISH_WARNINGS = Object.freeze({
  /** First comments need Meta permissions SocialHub does not request yet. */
  FIRST_COMMENT_NOT_SENT: 'FIRST_COMMENT_NOT_SENT',
  /** Hashtags were set to go in the first comment, which is not sent. */
  HASHTAGS_NOT_SENT: 'HASHTAGS_NOT_SENT',
  ALT_TEXT_NOT_SENT: 'ALT_TEXT_NOT_SENT',
});

/** State of the Redis-backed queue as the API sees it. */
export const QUEUE_STATUS = Object.freeze({
  /** REDIS_URL is not set. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  /** Redis is configured but cannot be reached. */
  UNAVAILABLE: 'UNAVAILABLE',
});

/** API error codes added by publishing (same envelope as every other error). */
export const PUBLISHING_API_ERRORS = Object.freeze({
  /** PUBLISHING_MODE is off on this server. */
  PUBLISHING_DISABLED: 'PUBLISHING_DISABLED',
  /** Redis is not configured or not reachable, so nothing can be queued. */
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
});

export const PUBLISH_ACTIVITY_ACTIONS = Object.freeze({
  JOB_CREATED: 'publish_job.created',
  JOB_CANCELLED: 'publish_job.cancelled',
  JOB_FINISHED: 'publish_job.finished',
  JOB_RESCHEDULED: 'publish_job.rescheduled',
  DESTINATION_RETRIED: 'publish_destination.retried',
  DESTINATION_CANCELLED: 'publish_destination.cancelled',
  /** SocialHub stopped a destination because its author may no longer publish it. */
  DESTINATION_BLOCKED: 'publish_destination.blocked',
});

export const PUBLISHING_LIMITS = Object.freeze({
  /** Destinations of one job. */
  DESTINATIONS_MAX: 100,
  JOBS_PAGE_MAX: 50,
  /** A job can be scheduled at most this far ahead. */
  SCHEDULE_MAX_DAYS: 90,
  IDEMPOTENCY_KEY_MIN: 16,
  IDEMPOTENCY_KEY_MAX: 100,
  /** Documented Instagram limits. */
  INSTAGRAM_CAPTION_MAX: 2200,
  INSTAGRAM_HASHTAGS_MAX: 30,
  INSTAGRAM_CAROUSEL_MAX: 10,
});

const L = PUBLISHING_LIMITS;

/**
 * Create a job (docs/PUBLISHING_API.md §3). `idempotencyKey` is chosen by the client once per
 * "Publish" click: sending the same request again returns the job that already exists.
 */
export const createPublishJobSchema = z.strictObject({
  contentPackageId: objectIdSchema,
  /** Defaults to the accounts saved on the draft. */
  socialAccountIds: z
    .array(objectIdSchema)
    .min(1, { error: 'Select at least one account' })
    .max(L.DESTINATIONS_MAX, { error: `Publish to at most ${L.DESTINATIONS_MAX} accounts at once` })
    .refine((list) => new Set(list.map((id) => id.toLowerCase())).size === list.length, {
      error: 'Each account can only be listed once',
    })
    .optional(),
  idempotencyKey: z
    .string({ error: 'idempotencyKey is required' })
    .regex(/^[A-Za-z0-9_-]+$/, { error: 'idempotencyKey is not valid' })
    .min(L.IDEMPOTENCY_KEY_MIN, { error: 'idempotencyKey is too short' })
    .max(L.IDEMPOTENCY_KEY_MAX, { error: 'idempotencyKey is too long' }),
  /** ISO date-time in the future. Omit to publish now. */
  scheduledAt: z.iso
    .datetime({ offset: true, error: 'scheduledAt must be a date and time' })
    .optional(),
  /** Needed to send a post again to an account it was already published to. */
  republish: z.boolean().default(false),
});

/** Orders of the job list. NEWEST: newest first (default). SCHEDULED: soonest scheduled time first. */
export const PUBLISH_JOB_ORDERS = Object.freeze({ NEWEST: 'newest', SCHEDULED: 'scheduled' });

export const publishJobQuerySchema = z.strictObject({
  status: z.enum(Object.values(PUBLISH_JOB_STATUS)).optional(),
  /** Omitted = newest first. `scheduled` lists only jobs with a scheduled time, soonest first. */
  order: z.enum(Object.values(PUBLISH_JOB_ORDERS)).optional(),
  /** Opaque value from a previous page's `nextCursor` (only valid with the same `order`). */
  cursor: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, { error: 'This page link is not valid' })
    .optional(),
  limit: z.coerce.number().int().min(1).max(L.JOBS_PAGE_MAX).default(20),
});

/** Move the scheduled accounts of a job to another time (docs/PUBLISHING_API.md). */
export const rescheduleJobSchema = z.strictObject({
  scheduledAt: z.iso.datetime({ offset: true, error: 'scheduledAt must be a date and time' }),
});

/** Retrying after an uncertain failure needs `acknowledgeDuplicateRisk: true`. */
export const retryDestinationSchema = z.strictObject({
  acknowledgeDuplicateRisk: z.boolean().default(false),
});

const codePoints = (value) => [...value].length;

// Hashtags written in a text, without "#". Same pattern as the composer
// (apps/web/src/features/composer/model/text.js), so a post is checked and sent exactly as it
// was previewed.
const HASHTAG_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_/&#=?])#([\p{L}\p{M}\p{N}_]+)/gu;
export const hashtagsInText = (text) =>
  [...String(text ?? '').matchAll(HASHTAG_IN_TEXT)].map((m) => m[1]);

/**
 * Caption as it is sent to one platform: its own caption or the shared one, then a blank line
 * and the hashtags not already written in it (compared case-insensitively), when hashtags go
 * in the caption. The composer's preview builds it the same way.
 */
export function composeCaption(content, platform) {
  const base = (content.platformCaptions?.[platform] ?? content.caption ?? '').trim();
  if (content.hashtagPlacement !== 'CAPTION' || !content.hashtags?.length) return base;
  const present = new Set(hashtagsInText(base).map((tag) => tag.toLowerCase()));
  const extra = content.hashtags.filter((tag) => !present.has(tag.toLowerCase()));
  if (extra.length === 0) return base;
  const line = extra.map((tag) => `#${tag}`).join(' ');
  return base ? `${base}\n\n${line}` : line;
}

/**
 * Why a post cannot be published to a platform, as plain sentences (empty = it can).
 * `content.media` is a list of `{ kind: 'IMAGE' | 'VIDEO' }`.
 */
export function publishIssues(content, platform) {
  const issues = [];
  const media = content.media ?? [];
  const caption = composeCaption(content, platform);
  const videos = media.filter((m) => m.kind === 'VIDEO').length;
  if (platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT) {
    if (media.length === 0) issues.push('Instagram posts need at least one image or video.');
    if (media.length > L.INSTAGRAM_CAROUSEL_MAX) {
      issues.push(`Instagram posts can have at most ${L.INSTAGRAM_CAROUSEL_MAX} files.`);
    }
    if (codePoints(caption) > L.INSTAGRAM_CAPTION_MAX) {
      issues.push(
        `Instagram captions can be at most ${L.INSTAGRAM_CAPTION_MAX.toLocaleString('en-US')} characters, including hashtags.`,
      );
    }
    // Every hashtag in the caption counts, typed ones too, as in the composer's check.
    if (hashtagsInText(caption).length > L.INSTAGRAM_HASHTAGS_MAX) {
      issues.push(`Instagram allows at most ${L.INSTAGRAM_HASHTAGS_MAX} hashtags.`);
    }
  } else {
    if (media.length === 0 && caption.length === 0) {
      issues.push('Facebook posts need text, an image or a video.');
    }
    if (videos > 1 || (videos === 1 && media.length > 1)) {
      issues.push('A Facebook post can have one video, or images, but not both.');
    }
  }
  return issues;
}
