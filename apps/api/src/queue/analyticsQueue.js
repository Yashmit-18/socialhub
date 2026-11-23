import { QUEUE_STATUS } from '@socialhub/shared';
import { config } from '../config/env.js';
import { createBullQueue } from './publishQueue.js';

/**
 * The analytics sync queue: its own BullMQ queue on the same Redis, built with the publishing
 * queue's connection code (verified against a real Redis on 2026-11-23), so a slow insights
 * sync never holds up publishing. There is no in-memory substitute.
 *
 * A queue entry carries ONE AnalyticsSyncRun id and nothing else (the shared helper stores it
 * under the field name `destinationId`). No token or account data ever goes to Redis.
 */
export const ANALYTICS_QUEUE_NAME = 'socialhub-analytics';

let active;

/** The queue, or null when REDIS_URL is not configured. */
export function getAnalyticsQueue() {
  if (active === undefined) {
    active = config.publishing.redisUrl
      ? createBullQueue({ redisUrl: config.publishing.redisUrl, name: ANALYTICS_QUEUE_NAME })
      : null;
  }
  return active;
}

export function analyticsQueueStatus() {
  return getAnalyticsQueue()?.status() ?? QUEUE_STATUS.NOT_CONFIGURED;
}

/** Adds the entry for a sync run. Throws QueueUnavailableError when Redis is unreachable. */
export function enqueueSyncRun(runId, seq, delayMs = 0) {
  const queue = getAnalyticsQueue();
  if (!queue) throw new Error('The analytics queue is not configured');
  return queue.enqueue({ destinationId: runId, seq, delayMs });
}

/** Test hook: replace the queue (pass undefined to rebuild from configuration). */
export function setAnalyticsQueueForTests(queue) {
  if (!config.isTest) throw new Error('setAnalyticsQueueForTests is only available in tests');
  active = queue;
}

export async function closeAnalyticsQueue() {
  if (active) await active.close();
  active = undefined;
}
