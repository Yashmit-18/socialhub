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

/**
 * Publishing modes.
 *
 * As a SERVER setting (`PUBLISHING_MODE`): DISABLED = no jobs at all; SIMULATED = every job is
 * simulated; LIVE = real publishing is *available*. Even on a LIVE server, each workspace stays
 * in simulation until an owner or admin switches that workspace to live
 * (WORKSPACE_PUBLISHING_MODES), so real publishing never starts by itself.
 *
 * As a JOB mode: the mode the job was created in, fixed for its whole life. A SIMULATED job
 * can never reach Meta, whatever changes later.
 */
export const PUBLISHING_MODES = Object.freeze({
  /** Publishing is switched off: jobs cannot be created. */
  DISABLED: 'DISABLED',
  /** The whole engine runs, but nothing is sent to Meta. */
  SIMULATED: 'SIMULATED',
  /** Real Meta Graph API calls. */
  LIVE: 'LIVE',
});

/** A workspace's own choice. SIMULATED is the default; LIVE takes an owner or admin. */
export const WORKSPACE_PUBLISHING_MODES = Object.freeze({
  SIMULATED: 'SIMULATED',
  LIVE: 'LIVE',
});

/**
 * The mode new jobs of a workspace get: real publishing only when the server offers it AND
 * the workspace chose it. Anything else (including an unknown value) is simulation.
 */
export function effectivePublishingMode(serverMode, workspaceMode) {
  if (serverMode === PUBLISHING_MODES.DISABLED || !serverMode) return PUBLISHING_MODES.DISABLED;
  if (serverMode === PUBLISHING_MODES.LIVE && workspaceMode === WORKSPACE_PUBLISHING_MODES.LIVE) {
    return PUBLISHING_MODES.LIVE;
  }
  return PUBLISHING_MODES.SIMULATED;
}

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
  /** Instagram published the post but reported that the caption could not be attached. */
  CAPTION_NOT_ATTACHED: 'CAPTION_NOT_ATTACHED',
  /** Instagram published the post but reported another part it could not apply. */
  PLATFORM_PARTIAL: 'PLATFORM_PARTIAL',
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
  /**
   * The request would create a REAL post but does not carry `confirmRealPost: true`. Nothing
   * was created, and the request was not turned into a simulation either.
   */
  REAL_POST_CONFIRMATION_REQUIRED: 'REAL_POST_CONFIRMATION_REQUIRED',
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
  /** An owner or admin switched the workspace between simulated and real publishing. */
  MODE_CHANGED: 'publishing.mode_changed',
  /** The text of a real published Facebook post was changed on Facebook. */
  POST_EDITED: 'publish_destination.post_edited',
  /** A real published Facebook post was deleted from Facebook. */
  POST_DELETED: 'publish_destination.post_deleted',
});

/** Longest text Facebook accepts for a Page post message (Graph API `message`). */
export const FACEBOOK_POST_TEXT_MAX = 63_206;

/**
 * Change the text of a real, published Facebook Page post (POST /{post-id} on Meta). Like
 * creating one, it needs `confirmRealPost: true` (REAL_POST_CONFIRMATION_REQUIRED without it).
 */
export const editPublishedPostSchema = z.strictObject({
  message: z
    .string({ error: 'Enter the new text' })
    .trim()
    .min(1, { error: 'Enter the new text' })
    .max(FACEBOOK_POST_TEXT_MAX, {
      error: `Facebook accepts at most ${FACEBOOK_POST_TEXT_MAX} characters`,
    }),
  confirmRealPost: z.boolean().default(false),
});

/** Delete a real, published Facebook Page post (DELETE /{post-id} on Meta). Cannot be undone. */
export const deletePublishedPostSchema = z.strictObject({
  confirmRealPost: z.boolean().default(false),
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
  INSTAGRAM_MENTIONS_MAX: 20,
  // Meta now documents up to 20 carousel items; 10 is kept until 20 is verified live.
  INSTAGRAM_CAROUSEL_MAX: 10,
});

const MB = 1024 * 1024;

/**
 * File requirements of real publishing, from Meta's documentation (2026-11):
 *  - Facebook Page photos (Graph API reference, page/photos): JPEG, BMP, PNG, GIF or TIFF,
 *    at most 10 MB.
 *  - Instagram (Content Publishing API, ig-user/media): images JPEG only, at most 8 MB, aspect
 *    ratio 4:5 to 1.91:1; reels MP4 or MOV, 3 seconds to 15 minutes, at most 300 MB.
 * Video codecs, frame rates and bitrates cannot be checked here; Meta reports those itself.
 */
export const PLATFORM_MEDIA_RULES = Object.freeze({
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: Object.freeze({
    imageTypes: Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff']),
    imageMaxBytes: 10 * MB,
    videoTypes: Object.freeze(['video/mp4', 'video/quicktime']),
  }),
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: Object.freeze({
    imageTypes: Object.freeze(['image/jpeg']),
    imageMaxBytes: 8 * MB,
    imageAspectMin: 4 / 5,
    imageAspectMax: 1.91,
    videoTypes: Object.freeze(['video/mp4', 'video/quicktime']),
    videoMaxBytes: 300 * MB,
    videoMinSec: 3,
    videoMaxSec: 15 * 60,
  }),
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
  /**
   * The person confirmed, for this request, that it creates a REAL public post. Required
   * (`true`) whenever the job would be real (the workspace's mode is LIVE); without it nothing
   * is created (REAL_POST_CONFIRMATION_REQUIRED). Ignored for simulated jobs.
   */
  confirmRealPost: z.boolean().default(false),
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
  /**
   * Retrying a REAL destination sends a real public post again, so it needs the same explicit
   * confirmation as creating one (REAL_POST_CONFIRMATION_REQUIRED without it). Ignored when
   * the job is simulated.
   */
  confirmRealPost: z.boolean().default(false),
});

/**
 * Switch a workspace between simulated and real publishing. Turning real publishing ON needs
 * the person's password and an explicit acknowledgement; turning it off needs neither.
 */
export const updatePublishingModeSchema = z
  .strictObject({
    mode: z.enum(Object.values(WORKSPACE_PUBLISHING_MODES), {
      error: 'Choose simulated or live publishing',
    }),
    password: z.string().max(1024).optional(),
    acknowledgeRealPublishing: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== WORKSPACE_PUBLISHING_MODES.LIVE) return;
    if (!value.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Enter your password to switch on real publishing',
      });
    }
    if (value.acknowledgeRealPublishing !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['acknowledgeRealPublishing'],
        message: 'Confirm that posts will be published to the real accounts',
      });
    }
  });

const codePoints = (value) => [...value].length;

// Hashtags written in a text, without "#". Same pattern as the composer
// (apps/web/src/features/composer/model/text.js), so a post is checked and sent exactly as it
// was previewed.
const HASHTAG_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_/&#=?])#([\p{L}\p{M}\p{N}_]+)/gu;
export const hashtagsInText = (text) =>
  [...String(text ?? '').matchAll(HASHTAG_IN_TEXT)].map((m) => m[1]);

// Instagram @mentions (usernames: letters, digits, "." and "_", at most 30 characters). An
// email address is not a mention, so the "@" must not follow a word character.
const MENTION_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_.@])@([A-Za-z0-9._]{1,30})/gu;
export const mentionsInText = (text) =>
  [...String(text ?? '').matchAll(MENTION_IN_TEXT)].map((m) => m[1]);

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
    if (mentionsInText(caption).length > L.INSTAGRAM_MENTIONS_MAX) {
      issues.push(`Instagram allows at most ${L.INSTAGRAM_MENTIONS_MAX} @mentions in a caption.`);
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

const KIND_LABEL = { IMAGE: 'image', VIDEO: 'video' };
const typeName = (mime) =>
  String(mime ?? 'unknown')
    .replace(/^(image|video)\//, '')
    .toUpperCase();
const megabytes = (bytes) => `${Math.round(bytes / MB)} MB`;

/**
 * Why the files of a post cannot be sent to a platform for real, as plain sentences (empty =
 * they can). `media` entries are `{ kind, mimeType, sizeBytes, width, height, durationSec }`
 * (MediaAsset fields); a missing dimension or duration is not held against the file.
 * Checked when a LIVE job is created and again just before it is sent.
 */
export function mediaIssues(media, platform) {
  const rules = PLATFORM_MEDIA_RULES[platform];
  if (!rules) return [];
  const name = platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT ? 'Instagram' : 'Facebook';
  const issues = [];
  (media ?? []).forEach((file, index) => {
    const which =
      media.length > 1 ? `File ${index + 1} (${KIND_LABEL[file.kind] ?? 'file'})` : 'The file';
    if (file.kind === 'IMAGE') {
      if (!rules.imageTypes.includes(file.mimeType)) {
        issues.push(
          `${which} is ${typeName(file.mimeType)}; ${name} accepts ${rules.imageTypes.map(typeName).join(', ')} images.`,
        );
      }
      if (rules.imageMaxBytes && file.sizeBytes > rules.imageMaxBytes) {
        issues.push(
          `${which} is larger than ${name}'s ${megabytes(rules.imageMaxBytes)} limit for images.`,
        );
      }
      if (rules.imageAspectMin && file.width > 0 && file.height > 0) {
        const ratio = file.width / file.height;
        // A small tolerance for rounding in exported image sizes.
        if (ratio < rules.imageAspectMin - 0.005 || ratio > rules.imageAspectMax + 0.005) {
          issues.push(
            `${which} is ${file.width}×${file.height}; ${name} needs an aspect ratio between 4:5 (portrait) and 1.91:1 (landscape).`,
          );
        }
      }
    } else if (file.kind === 'VIDEO') {
      if (!rules.videoTypes.includes(file.mimeType)) {
        issues.push(`${which} is ${typeName(file.mimeType)}; ${name} accepts MP4 and MOV videos.`);
      }
      if (rules.videoMaxBytes && file.sizeBytes > rules.videoMaxBytes) {
        issues.push(
          `${which} is larger than ${name}'s ${megabytes(rules.videoMaxBytes)} limit for videos.`,
        );
      }
      if (rules.videoMinSec && file.durationSec > 0 && file.durationSec < rules.videoMinSec) {
        issues.push(
          `${which} is shorter than ${rules.videoMinSec} seconds, the minimum for ${name} videos.`,
        );
      }
      if (rules.videoMaxSec && file.durationSec > rules.videoMaxSec) {
        issues.push(
          `${which} is longer than ${rules.videoMaxSec / 60} minutes, the maximum for ${name} videos.`,
        );
      }
    } else {
      issues.push(`${which} is not an image or a video.`);
    }
  });
  return issues;
}
