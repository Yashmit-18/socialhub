import mongoose from 'mongoose';
import { QUEUE_STATUS } from '@socialhub/shared';
import { AccountInsight } from '../src/models/AccountInsight.js';
import { AnalyticsSyncRun } from '../src/models/AnalyticsSyncRun.js';
import { PostInsight } from '../src/models/PostInsight.js';
import { Membership, PublishDestination, PublishJob } from '../src/models/index.js';
import { processSyncRun } from '../src/modules/analytics/analyticsSync.processor.js';
import { QueueUnavailableError } from '../src/queue/publishQueue.js';

/**
 * Deterministic analytics fixtures. Publishing records and insight rows are written straight
 * into MongoDB with exact values and timestamps, so every expected number is known.
 */

export const analyticsModels = [AccountInsight, PostInsight, AnalyticsSyncRun];

export const analyticsUrl = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/analytics${suffix}`;

export const grant = (member, accounts, mode = 'SELECTED') =>
  Membership.updateOne(
    { _id: member.membershipId },
    {
      $set: {
        accountAccess: { mode, socialAccounts: mode === 'ALL' ? [] : accounts.map((a) => a._id) },
      },
    },
  );

/**
 * One publish job with one destination per entry:
 *   { account, state, attempts = 1, durationMs = 2000, completedAt }
 * `simulated` and `createdAt` apply to the whole job.
 */
export async function makeJob(
  workspaceId,
  { destinations, simulated = true, createdAt, caption = 'Fixture post', status, media = [] },
) {
  const jobId = new mongoose.Types.ObjectId();
  const created = new Date(createdAt);
  await PublishJob.collection.insertOne({
    _id: jobId,
    workspace: new mongoose.Types.ObjectId(workspaceId),
    contentPackage: new mongoose.Types.ObjectId(),
    contentVersion: 1,
    content: { caption, platformCaptions: {}, hashtags: [], hashtagPlacement: 'CAPTION', media },
    mode: simulated ? 'SIMULATED' : 'LIVE',
    status: status ?? 'PUBLISHED',
    counts: {},
    destinationCount: destinations.length,
    idempotencyKey: `fixture-${jobId}`,
    requestHash: 'x',
    createdBy: new mongoose.Types.ObjectId(),
    createdAt: created,
    updatedAt: created,
    syncSeq: 0,
  });
  const docs = destinations.map((d) => {
    const attempts = d.attempts ?? (d.state === 'SCHEDULED' || d.state === 'CANCELLED' ? 0 : 1);
    const completedAt = d.completedAt ? new Date(d.completedAt) : undefined;
    const firstStart = completedAt
      ? new Date(completedAt.getTime() - (d.durationMs ?? 2000))
      : undefined;
    return {
      _id: new mongoose.Types.ObjectId(),
      workspace: new mongoose.Types.ObjectId(workspaceId),
      job: jobId,
      contentPackage: new mongoose.Types.ObjectId(),
      socialAccount: d.account._id,
      platform: d.account.platform,
      accountName: d.account.name,
      state: d.state,
      simulated,
      attemptCount: attempts,
      maxAttempts: 4,
      queueSeq: 1,
      createdAt: created,
      updatedAt: created,
      ...(completedAt ? { completedAt } : {}),
      attempts: firstStart ? [{ number: 1, startedAt: firstStart, finishedAt: completedAt }] : [],
      ...(d.externalPostId ? { externalPostId: d.externalPostId } : {}),
      ...(d.externalUrl ? { externalUrl: d.externalUrl } : {}),
      warnings: [],
    };
  });
  await PublishDestination.collection.insertMany(docs);
  return { jobId: String(jobId), destinations: docs.map((d) => ({ ...d, id: String(d._id) })) };
}

export async function insight(workspaceId, account, day, metrics, source = 'META') {
  await AccountInsight.create({
    workspace: workspaceId,
    socialAccount: account._id,
    platform: account.platform,
    source,
    day,
    metrics,
    fetchedAt: new Date(),
  });
}

export async function postInsight(workspaceId, destination, metrics, source = 'META') {
  await PostInsight.create({
    workspace: workspaceId,
    socialAccount: destination.socialAccount,
    publishDestination: destination._id,
    platform: destination.platform,
    source,
    metrics,
    fetchedAt: new Date(),
  });
}

/** A TEST-ONLY stand-in for the Redis queue that delivers entries to the real sync processor. */
export function createAnalyticsTestQueue({ status = QUEUE_STATUS.READY } = {}) {
  const queue = {
    state: status,
    entries: [],
    failEnqueue: false,
    status: () => queue.state,
    lastError: () => null,
    async enqueue({ destinationId, seq, delayMs = 0 }) {
      if (queue.state !== QUEUE_STATUS.READY || queue.failEnqueue)
        throw new QueueUnavailableError();
      const id = `${destinationId}-${seq}`;
      if (queue.entries.some((e) => e.id === id)) return;
      queue.entries.push({ id, runId: String(destinationId), seq, delayMs, delivered: false });
    },
    async remove() {
      return false;
    },
    async counts() {
      return { waiting: queue.pending().length, active: 0, delayed: 0 };
    },
    async workerCount() {
      return 1;
    },
    startWorker() {
      return { isRunning: () => true, close: async () => {} };
    },
    async close() {},
    pending: () => queue.entries.filter((e) => !e.delivered),
    async deliver({ now = new Date(), random = () => 0 } = {}) {
      const outcomes = [];
      for (const entry of queue.pending()) {
        entry.delivered = true;
        outcomes.push(await processSyncRun(entry.runId, { now, random }));
      }
      return outcomes;
    },
  };
  return queue;
}
