import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './enums.js';
import { objectIdSchema } from './schemas.js';

/**
 * Analytics & Publishing Intelligence (docs/ANALYTICS.md).
 *
 * Two kinds of numbers, never mixed:
 *  - SocialHub publishing metrics, computed from SocialHub's own publishing records.
 *    They are real records, but a job made in simulation mode stays labelled "simulated".
 *  - Platform insights (reach, views, likes…) from Meta. Each stored value carries its
 *    source: META (read from Meta's official API) or SIMULATED (demo values made by the
 *    development adapter, never shown as real). A metric Meta did not report is stored as
 *    absent and shown as "unavailable", never as 0.
 */

/** Where an insight value came from. */
export const ANALYTICS_SOURCES = Object.freeze({
  /** Read from Meta's official Graph API. */
  META: 'META',
  /** Made up by the development adapter. Always labelled DEMO, never shown as real. */
  SIMULATED: 'SIMULATED',
});

/** ANALYTICS_MODE on the server. There is no configuration value for live Meta insights. */
export const ANALYTICS_MODES = Object.freeze({
  DISABLED: 'DISABLED',
  SIMULATED: 'SIMULATED',
  LIVE: 'LIVE',
});

/** The source a server mode writes. */
export const sourceForMode = (mode) =>
  mode === ANALYTICS_MODES.LIVE
    ? ANALYTICS_SOURCES.META
    : mode === ANALYTICS_MODES.SIMULATED
      ? ANALYTICS_SOURCES.SIMULATED
      : null;

/**
 * Normalized metrics. `aggregate` says how values over several days or accounts combine:
 *  - sum:  added up (likes on day 1 + likes on day 2). For reach this is "daily reach added
 *          up": a person reached on two days counts twice, and the label says so.
 *  - last: a level, not a flow (followers): the latest value in the range.
 *  - none: cannot be combined honestly (averages): only shown per post or per day.
 */
export const ANALYTICS_METRICS = Object.freeze({
  reach: { label: 'Reach', aggregate: 'sum', rangeLabel: 'Daily reach, added up' },
  impressions: { label: 'Impressions', aggregate: 'sum' },
  views: { label: 'Views', aggregate: 'sum' },
  likes: { label: 'Likes', aggregate: 'sum' },
  comments: { label: 'Comments', aggregate: 'sum' },
  shares: { label: 'Shares', aggregate: 'sum' },
  saves: { label: 'Saves', aggregate: 'sum' },
  engagement: { label: 'Engagement', aggregate: 'sum' },
  followers: { label: 'Followers', aggregate: 'last' },
  profileVisits: { label: 'Profile visits', aggregate: 'sum' },
  watchTimeSec: { label: 'Watch time (seconds)', aggregate: 'sum' },
  avgWatchTimeSec: { label: 'Average watch time (seconds)', aggregate: 'none' },
});

export const METRIC_KEYS = Object.freeze(Object.keys(ANALYTICS_METRICS));

/**
 * Engagement rate of ONE post, in percent: engagement ÷ reach × 100, where engagement is the
 * platform's own total of interactions on the post and reach is the number of unique accounts
 * that saw it. Null (unavailable) unless both are reported and reach > 0. Never computed for
 * a whole account or period: summed daily reach is not a count of people.
 */
export function engagementRate(metrics) {
  const engagement = metrics?.engagement;
  const reach = metrics?.reach;
  if (typeof engagement !== 'number' || typeof reach !== 'number' || reach <= 0) return null;
  return Math.round((engagement / reach) * 10_000) / 100;
}

/**
 * Follower growth over a range: followers at the last reported day minus followers at the
 * first reported day. Null unless both ends are reported (a missing day is not 0 followers).
 */
export function followerGrowth(first, last) {
  if (typeof first !== 'number' || typeof last !== 'number') return null;
  return last - first;
}

/**
 * Publishing success rate, in percent: destinations PUBLISHED ÷ destinations that reached a
 * final result (PUBLISHED + FAILED) × 100. Cancelled, scheduled and in-progress destinations
 * are not in the denominator. Null when nothing has finished.
 */
export function publishingSuccessRate({ published = 0, failed = 0 } = {}) {
  const done = published + failed;
  return done === 0 ? null : Math.round((published / done) * 10_000) / 100;
}

export const ANALYTICS_LIMITS = Object.freeze({
  /** Longest range one request may cover. */
  RANGE_MAX_DAYS: 366,
  POSTS_PAGE_MAX: 100,
  TOP_POSTS_MAX: 20,
  SYNC_ACCOUNTS_MAX: 100,
  /** How many days back one sync may read (Meta keeps a limited history). */
  SYNC_MAX_DAYS: 90,
});

const L = ANALYTICS_LIMITS;
const DAY = 24 * 60 * 60 * 1000;
const dateSchema = z.iso.date({ error: 'Use a date like 2026-11-23' });

/** Checks a { startDate, endDate } pair (calendar dates, YYYY-MM-DD). */
function checkRange(value, ctx) {
  if (!value.startDate || !value.endDate) {
    if (Boolean(value.startDate) !== Boolean(value.endDate)) {
      ctx.addIssue({
        code: 'custom',
        path: [value.startDate ? 'endDate' : 'startDate'],
        message: 'Give both a start and an end date',
      });
    }
    return;
  }
  const start = Date.parse(`${value.startDate}T00:00:00Z`);
  const end = Date.parse(`${value.endDate}T00:00:00Z`);
  if (end < start) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'The end date is before the start',
    });
  } else if ((end - start) / DAY + 1 > L.RANGE_MAX_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: `Choose at most ${L.RANGE_MAX_DAYS} days`,
    });
  }
}

const filterShape = {
  /** Calendar dates in the workspace time zone. Both or neither (default: last 30 days). */
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  platform: z.enum(Object.values(SOCIAL_PLATFORMS)).optional(),
  accountId: objectIdSchema.optional(),
  /** Which insights to read. Defaults to META; SIMULATED (demo) only when asked for. */
  source: z.enum(Object.values(ANALYTICS_SOURCES)).optional(),
};

export const analyticsQuerySchema = z.strictObject(filterShape).superRefine(checkRange);

export const ANALYTICS_POST_SORTS = Object.freeze([
  'publishedAt',
  'reach',
  'views',
  'engagement',
  'engagementRate',
  'likes',
  'comments',
  'shares',
  'saves',
]);

export const analyticsPostsQuerySchema = z
  .strictObject({
    ...filterShape,
    postId: objectIdSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(L.POSTS_PAGE_MAX).default(20),
    sortBy: z.enum(ANALYTICS_POST_SORTS).default('publishedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine(checkRange);

export const analyticsTopPostsQuerySchema = z
  .strictObject({
    ...filterShape,
    metric: z.enum(ANALYTICS_POST_SORTS.filter((s) => s !== 'publishedAt')).default('engagement'),
    limit: z.coerce.number().int().min(1).max(L.TOP_POSTS_MAX).default(5),
  })
  .superRefine(checkRange);

export const ANALYTICS_EXPORTS = Object.freeze(['accounts', 'posts', 'publishing']);

/** GET /analytics/export: one CSV of the current filters. */
export const analyticsExportQuerySchema = z
  .strictObject({ ...filterShape, type: z.enum(ANALYTICS_EXPORTS) })
  .superRefine(checkRange);

/** POST /analytics/sync: read insights for some accounts (default: every account you may use). */
export const analyticsSyncSchema = z.strictObject({
  accountIds: z
    .array(objectIdSchema)
    .min(1, { error: 'Choose at least one account' })
    .max(L.SYNC_ACCOUNTS_MAX, { error: `Sync at most ${L.SYNC_ACCOUNTS_MAX} accounts at once` })
    .optional(),
});

/** Status of one sync run. */
export const ANALYTICS_SYNC_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  SUCCEEDED: 'SUCCEEDED',
  /** Some metrics or posts could not be read; what was read is kept. */
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
});

export const ACTIVE_SYNC_STATUSES = Object.freeze([
  ANALYTICS_SYNC_STATUS.QUEUED,
  ANALYTICS_SYNC_STATUS.RUNNING,
  ANALYTICS_SYNC_STATUS.RETRY_SCHEDULED,
]);

export const ANALYTICS_API_ERRORS = Object.freeze({
  ANALYTICS_DISABLED: 'ANALYTICS_DISABLED',
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
});

export const ANALYTICS_ACTIVITY_ACTIONS = Object.freeze({
  SYNC_REQUESTED: 'analytics.sync_requested',
});
