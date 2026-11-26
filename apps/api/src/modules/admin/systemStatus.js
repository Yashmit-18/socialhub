import {
  ADMIN_ATTENTION_CODES,
  ADMIN_ATTENTION_SEVERITY,
  ADMIN_LIMITS,
  CLAIMABLE_DESTINATION_STATES,
  DESTINATION_STATES,
  PUBLISHING_MODES,
  PUBLISH_JOB_STATUS,
  QUEUE_STATUS,
  WORKER_STATUS,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { databaseState, isTransactionSupported } from '../../db/mongoose.js';
import { isEmailDeliveryConfigured } from '../../lib/mailer.js';
import { PublishDestination, PublishJob } from '../../models/index.js';
import { analyticsQueueStatus, getAnalyticsQueue } from '../../queue/analyticsQueue.js';
import { getPublishQueue, publishQueueStatus } from '../../queue/publishQueue.js';
import { getStorage } from '../../storage/index.js';
import { analyticsSettings } from '../analytics/analytics.settings.js';
import { publishingSettings } from '../publishing/publishing.settings.js';

/**
 * What the operator can know about this SocialHub: the facts of GET /health/details plus
 * delivery facts from MongoDB. Unknown is null (or UNKNOWN), never 0 and never "OK". Worker
 * presence comes only from the queue, never from this process being up. Nothing is cached.
 */

export const API_VERSION = '0.1.0';

const WAITING = [...CLAIMABLE_DESTINATION_STATES];
const FINISHED = [
  PUBLISH_JOB_STATUS.PUBLISHED,
  PUBLISH_JOB_STATUS.PARTIALLY_PUBLISHED,
  PUBLISH_JOB_STATUS.FAILED,
];

/** Exactly the body of GET /health/details. The key order is part of that contract. */
export async function healthSnapshot() {
  const db = databaseState();
  const queue = getPublishQueue();
  const queueStatus = publishQueueStatus();
  let counts = null;
  let workers = null;
  if (queue && queueStatus === QUEUE_STATUS.READY) {
    [counts, workers] = await Promise.all([
      queue.counts().catch(() => null),
      queue.workerCount().catch(() => null),
    ]);
  }
  const storage = getStorage();
  return {
    status: db === 'connected' ? 'ok' : 'degraded',
    version: API_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    database: db,
    publishing: { mode: publishingSettings().mode, queue: queueStatus, counts, workers },
    analytics: { mode: analyticsSettings().mode, queue: analyticsQueueStatus() },
    storage: { driver: storage?.name ?? null, publicUrls: Boolean(storage?.publicUrls) },
  };
}

const workerView = (count) => ({
  status:
    count === null
      ? WORKER_STATUS.UNKNOWN
      : count > 0
        ? WORKER_STATUS.RUNNING
        : WORKER_STATUS.NOT_RUNNING,
  count,
});

/** Counts and workers of the analytics queue: both null unless Redis answered. */
async function analyticsQueueFacts(status) {
  const queue = getAnalyticsQueue();
  if (!queue || status !== QUEUE_STATUS.READY) return [null, null];
  return Promise.all([queue.counts().catch(() => null), queue.workerCount().catch(() => null)]);
}

/** GET /admin/system (docs/ADMIN_PANEL.md). */
export async function systemStatus({ now = new Date() } = {}) {
  const lateBefore = new Date(now.getTime() - ADMIN_LIMITS.LATE_AFTER_MINUTES * 60_000);
  const analyticsQueue = analyticsQueueStatus();
  const [
    health,
    [analyticsCounts, analyticsWorkers],
    waiting,
    sending,
    [late],
    interrupted,
    [next],
    [lastFinished],
  ] = await Promise.all([
    healthSnapshot(),
    analyticsQueueFacts(analyticsQueue),
    PublishDestination.countDocuments({ state: { $in: WAITING } }),
    PublishDestination.countDocuments({ state: DESTINATION_STATES.PROCESSING }),
    PublishDestination.aggregate([
      { $match: { state: { $in: WAITING }, dueAt: { $lt: lateBefore } } },
      { $group: { _id: null, late: { $sum: 1 }, jobs: { $addToSet: '$job' } } },
      { $project: { _id: 0, late: 1, latePosts: { $size: '$jobs' } } },
    ]),
    PublishDestination.countDocuments({
      state: DESTINATION_STATES.PROCESSING,
      lockedUntil: { $lt: now },
    }),
    PublishDestination.find({ state: { $in: WAITING }, dueAt: { $ne: null } })
      .sort({ dueAt: 1 })
      .limit(1)
      .select('dueAt')
      .lean(),
    PublishJob.find({ status: { $in: FINISHED } })
      .sort({ updatedAt: -1 })
      .limit(1)
      .select('completedAt')
      .lean(),
  ]);

  return {
    generatedAt: now,
    api: {
      version: health.version,
      uptimeSeconds: health.uptimeSeconds,
      environment: config.env,
    },
    database: { state: health.database, transactions: isTransactionSupported() },
    publishing: {
      mode: health.publishing.mode,
      queue: { status: health.publishing.queue, counts: health.publishing.counts },
      worker: workerView(health.publishing.workers),
      deliveries: {
        waiting,
        sending,
        late: late?.late ?? 0,
        latePosts: late?.latePosts ?? 0,
        interrupted,
        nextDueAt: next?.dueAt ?? null,
        lastFinishedAt: lastFinished?.completedAt ?? null,
      },
    },
    analytics: {
      mode: health.analytics.mode,
      queue: { status: analyticsQueue, counts: analyticsCounts },
      worker: workerView(analyticsWorkers),
    },
    storage: { driver: health.storage.driver, publicUrls: health.storage.publicUrls },
    email: { configured: isEmailDeliveryConfigured() },
  };
}

const C = ADMIN_ATTENTION_CODES;
const S = ADMIN_ATTENTION_SEVERITY;

/**
 * Things the overview asks the operator to look at, in a fixed order. An item appears only
 * when its condition is known to hold: an unknown value never produces one.
 */
export function attentionItems(system, { suspended, failedLast24h }) {
  const { publishing, storage, email } = system;
  const publishingOn = publishing.mode !== PUBLISHING_MODES.DISABLED;
  const items = [];
  const add = (code, severity, count = null) => items.push({ code, severity, count });

  if (publishingOn && publishing.queue.status === QUEUE_STATUS.UNAVAILABLE) {
    add(C.QUEUE_UNAVAILABLE, S.DANGER);
  }
  if (publishingOn && publishing.queue.status === QUEUE_STATUS.NOT_CONFIGURED) {
    add(C.QUEUE_NOT_CONFIGURED, S.WARNING);
  }
  if (
    publishingOn &&
    publishing.queue.status === QUEUE_STATUS.READY &&
    publishing.worker.status === WORKER_STATUS.NOT_RUNNING
  ) {
    add(C.WORKER_NOT_RUNNING, S.DANGER);
  }
  if (publishing.deliveries.latePosts > 0) {
    add(C.POSTS_LATE, S.DANGER, publishing.deliveries.latePosts);
  }
  if (publishing.deliveries.interrupted > 0) {
    add(C.DELIVERIES_INTERRUPTED, S.WARNING, publishing.deliveries.interrupted);
  }
  if (failedLast24h > 0) add(C.POSTS_FAILED_RECENTLY, S.INFO, failedLast24h);
  if (suspended > 0) add(C.ACCOUNTS_SUSPENDED, S.INFO, suspended);
  if (
    publishing.mode === PUBLISHING_MODES.LIVE &&
    (storage.driver === null || storage.publicUrls === false)
  ) {
    add(C.STORAGE_NOT_PUBLIC, S.WARNING);
  }
  if (email.configured === false) add(C.EMAIL_NOT_CONFIGURED, S.INFO);
  return items;
}
