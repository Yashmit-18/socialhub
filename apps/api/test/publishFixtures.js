import { CONNECTION_STATUS, QUEUE_STATUS } from '@socialhub/shared';
import { ContentPackage, SocialAccount, SocialConnection } from '../src/models/index.js';
import { processDestination } from '../src/modules/publishing/publishing.processor.js';
import { QueueUnavailableError } from '../src/queue/publishQueue.js';
import { as } from './helpers.js';
import { jpegBytes, mp4Bytes, uploadMedia } from './mediaFixtures.js';

/**
 * Publishing test fixtures.
 *
 * NOTE: `createTestQueue` is a TEST-ONLY stand-in for the Redis queue. It records what the
 * API hands to the queue and lets a test deliver those entries to the real processor, so the
 * engine's logic (claims, retries, cancellation, idempotency) can be tested without Redis.
 * It proves nothing about BullMQ or Redis; `npm run queue:verify` checks those for real. It
 * lives in the test folder and cannot be selected by any configuration.
 */
export function createTestQueue({ status = QUEUE_STATUS.READY } = {}) {
  const queue = {
    name: 'test',
    state: status,
    entries: [],
    removed: [],
    failEnqueue: false,
    workers: 1,
    status: () => queue.state,
    lastError: () => null,
    async enqueue({ destinationId, seq, delayMs = 0 }) {
      if (queue.state !== QUEUE_STATUS.READY || queue.failEnqueue)
        throw new QueueUnavailableError();
      const id = `${destinationId}-${seq}`;
      // Like BullMQ: an entry with an id that already exists is ignored.
      if (queue.entries.some((entry) => entry.id === id)) return;
      queue.entries.push({
        id,
        destinationId: String(destinationId),
        seq,
        delayMs,
        delivered: false,
      });
    },
    async remove({ destinationId, seq }) {
      const id = `${destinationId}-${seq}`;
      const entry = queue.entries.find((e) => e.id === id && !e.delivered);
      if (!entry) return false;
      entry.delivered = true;
      queue.removed.push(id);
      return true;
    },
    async counts() {
      if (queue.state !== QUEUE_STATUS.READY) throw new QueueUnavailableError();
      const waiting = queue.entries.filter((e) => !e.delivered);
      return {
        waiting: waiting.filter((e) => e.delayMs === 0).length,
        active: 0,
        delayed: waiting.filter((e) => e.delayMs > 0).length,
      };
    },
    async workerCount() {
      if (queue.state !== QUEUE_STATUS.READY) throw new QueueUnavailableError();
      return queue.workers;
    },
    startWorker() {
      return { isRunning: () => true, close: async () => {} };
    },
    async close() {},
    /** Entries not yet delivered. */
    pending: () => queue.entries.filter((e) => !e.delivered),
    /**
     * Delivers every pending entry once to the real processor, as a worker would, at time
     * `now`. Returns the processor's outcomes in delivery order.
     */
    async deliver({ now = new Date(), random = () => 0 } = {}) {
      const outcomes = [];
      for (const entry of queue.pending()) {
        entry.delivered = true;
        outcomes.push(await processDestination(entry.destinationId, { now, random }));
      }
      return outcomes;
    },
  };
  return queue;
}

/** Gives fixture accounts a stored (encrypted) token, as the OAuth flow would. */
export async function giveTokens(accounts, token = 'page-token-SECRET-0123456789abcdef') {
  for (const account of accounts) {
    const doc = await SocialAccount.findById(account._id).select('+accessToken');
    doc.setAccessToken(`${token}-${doc.externalId}`);
    await doc.save();
  }
}

export const publishUrl = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/publish-jobs${suffix}`;

let keyCounter = 0;
export const newKey = () => `test-key-${Date.now()}-${(keyCounter += 1)}`.padEnd(24, '0');

/**
 * Saves a draft through the API. `media`: 'image' | 'video' | an uploadMedia options object
 * (`{ bytes, fileName, mimeType, kind }`) | an array of those | none.
 */
export async function createDraft(token, workspaceId, { accounts = [], media = [], ...rest } = {}) {
  const items = [];
  for (const kind of [].concat(media)) {
    const uploaded =
      typeof kind === 'object'
        ? await uploadMedia(token, workspaceId, kind)
        : kind === 'video'
          ? await uploadMedia(token, workspaceId, {
              bytes: mp4Bytes(),
              fileName: 'clip.mp4',
              kind: 'VIDEO',
              mimeType: 'video/mp4',
            })
          : await uploadMedia(token, workspaceId, { bytes: jpegBytes() });
    items.push({ mediaId: uploaded.id ?? uploaded.media?.id });
  }
  const res = await as(token)
    .post(`/api/v1/workspaces/${workspaceId}/content-packages`)
    .send({
      caption: 'Hello from the test',
      media: items,
      targetAccountIds: accounts.map((a) => String(a._id ?? a.id ?? a)),
      ...rest,
    });
  if (res.status !== 201)
    throw new Error(`draft failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.contentPackage;
}

export function publish(token, workspaceId, body) {
  return as(token)
    .post(publishUrl(workspaceId))
    .send({ idempotencyKey: newKey(), ...body });
}

export async function markConnection(connection, status = CONNECTION_STATUS.EXPIRED) {
  await SocialConnection.updateOne({ _id: connection._id }, { $set: { status } });
}

export const draftDoc = (id) => ContentPackage.findById(id);
