import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_STATUS } from '@socialhub/shared';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * The publishing queue: BullMQ on Redis. There is no in-memory substitute. When REDIS_URL is
 * not set, or Redis cannot be reached, `status()` says so and nothing can be queued.
 *
 * The queue is only a delivery mechanism. A queue entry carries one PublishDestination id and
 * nothing else (no content, no account data, no tokens); the destination document in MongoDB
 * is the source of truth, and the processor re-checks it before doing anything. Retries and
 * backoff are decided by the processor and stored in MongoDB, so BullMQ's own retry is off.
 */

export const PUBLISH_QUEUE_NAME = 'socialhub-publish';
export const PUBLISH_JOB_NAME = 'publish-destination';

/** BullMQ ids may not contain ":". One id per enqueue of a destination. */
export const queueJobId = (destinationId, seq) => `${destinationId}-${seq}`;

/** Never log the password embedded in a Redis URL. */
export function redactRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || 6379}`;
  } catch {
    return 'redis';
  }
}

/** Thrown when the queue cannot take or answer a request right now. */
export class QueueUnavailableError extends Error {
  constructor(message = 'The publishing queue is not reachable') {
    super(message);
    this.name = 'QueueUnavailableError';
  }
}

const OPERATION_TIMEOUT_MS = 5000;

function connect(url, { failFast, label }) {
  const client = new Redis(url, {
    // Required by BullMQ for the connections it blocks on.
    maxRetriesPerRequest: null,
    // The API must answer at once when Redis is down instead of holding requests.
    enableOfflineQueue: !failFast,
    // The process id tells connections apart in `CLIENT LIST`, so the verification scripts
    // can close their own connections without touching a running API or worker.
    connectionName: `socialhub-${label}-${process.pid}`,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  return client;
}

export function createBullQueue({ redisUrl, name = PUBLISH_QUEUE_NAME }) {
  let status = QUEUE_STATUS.CONNECTING;
  let lastError = null;
  const where = redactRedisUrl(redisUrl);

  const client = connect(redisUrl, { failFast: true, label: 'queue' });
  client.on('ready', () => {
    if (status !== QUEUE_STATUS.READY) logger.info({ redis: where }, 'Publishing queue connected');
    status = QUEUE_STATUS.READY;
    lastError = null;
  });
  const down = (reason) => () => {
    if (status === QUEUE_STATUS.READY || status === QUEUE_STATUS.CONNECTING) {
      logger.warn({ redis: where, reason }, 'Publishing queue is not reachable');
    }
    status = QUEUE_STATUS.UNAVAILABLE;
  };
  client.on('close', down('connection closed'));
  client.on('end', down('connection ended'));
  client.on('error', (err) => {
    lastError = err?.code ?? err?.message ?? 'error';
    down(lastError)();
  });

  // BullMQ prepares the connection (version check, scripts) ONCE, when the Queue is created,
  // and keeps the outcome. It must therefore wait for 'ready' (its default) and never use
  // `skipWaitingForReady`: with the offline queue off, that sends the version check before
  // the socket is open, the check fails, and the queue stays broken until the process
  // restarts ("Stream isn't writeable"), even after Redis is reachable. Found by
  // `queue:verify` against a real Redis (Memurai 4.1.2) on 2026-11-23. Waiting is safe:
  // `run()` below refuses every operation until the connection is READY, so the API still
  // answers 503 at once while Redis is down.
  const queue = new Queue(name, {
    connection: client,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600, count: 5000 },
    },
  });
  queue.on('error', (err) => {
    lastError = err?.code ?? err?.message ?? 'error';
  });

  const workers = new Set();

  /** Runs a queue command only while Redis is connected, and never waits for long. */
  async function run(operation) {
    if (status !== QUEUE_STATUS.READY) throw new QueueUnavailableError();
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new QueueUnavailableError()), OPERATION_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (err instanceof QueueUnavailableError) throw err;
      throw new QueueUnavailableError(err?.message);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'bullmq',
    status: () => status,
    lastError: () => lastError,

    /** Adds one entry for a destination. Throws when Redis is not reachable. */
    async enqueue({ destinationId, seq, delayMs = 0 }) {
      await run(() =>
        queue.add(
          PUBLISH_JOB_NAME,
          { destinationId: String(destinationId) },
          { jobId: queueJobId(destinationId, seq), delay: Math.max(0, Math.round(delayMs)) },
        ),
      );
    },

    /** Best effort: an entry that is already being processed cannot be removed. */
    async remove({ destinationId, seq }) {
      try {
        return (await run(() => queue.remove(queueJobId(destinationId, seq)))) === 1;
      } catch {
        return false;
      }
    },

    async counts() {
      const counts = await run(() => queue.getJobCounts('waiting', 'active', 'delayed'));
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
      };
    },

    /** Workers connected to this queue, in any process. */
    async workerCount() {
      return run(() => queue.getWorkersCount());
    },

    /**
     * Starts a worker in this process. `processor(destinationId)` must be safe to call more
     * than once for the same destination (BullMQ delivers at least once).
     */
    startWorker(processor, { concurrency = config.publishing.concurrency } = {}) {
      const connection = connect(redisUrl, { failFast: false, label: 'worker' });
      connection.on('error', () => {});
      const worker = new Worker(
        name,
        async (job) => {
          await processor(job.data.destinationId);
        },
        { connection, concurrency },
      );
      // Reconnect attempts repeat every few seconds: report the problem once, not each time.
      let reported = false;
      worker.on('error', (err) => {
        if (reported) return;
        reported = true;
        logger.warn({ reason: err?.code ?? err?.message }, 'Publish worker connection problem');
      });
      connection.on('ready', () => {
        reported = false;
      });
      worker.on('failed', (job, err) => {
        logger.error({ err, queueJobId: job?.id }, 'Publish worker could not process an entry');
      });
      workers.add(worker);
      const handle = {
        isRunning: () => worker.isRunning(),
        /** Stops taking entries and waits for the ones in hand, up to WORKER_DRAIN_MS. */
        async close() {
          workers.delete(worker);
          await Promise.race([
            worker.close().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, WORKER_DRAIN_MS).unref()),
          ]);
          connection.disconnect();
        },
      };
      return handle;
    },

    async close() {
      await Promise.all(
        [...workers].map((worker) =>
          Promise.race([
            worker.close().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, WORKER_DRAIN_MS).unref()),
          ]),
        ),
      );
      workers.clear();
      client.disconnect();
      await Promise.race([
        queue.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2000).unref()),
      ]);
    },
  };
}

/**
 * How long a stopping worker waits for the posts it is publishing to finish. An Instagram post
 * can take a minute (Meta processes the media before it can be published), so this is well
 * above that. A process manager must allow a little more than this before it kills the
 * process (server.js and scripts/publish-worker.js exit on their own 10 s after it). A post
 * cut off anyway is marked INTERRUPTED, never sent again automatically.
 */
export const WORKER_DRAIN_MS = 90_000;

let active;

/** The queue, or null when REDIS_URL is not configured. */
export function getPublishQueue() {
  if (active === undefined) {
    active = config.publishing.redisUrl
      ? createBullQueue({ redisUrl: config.publishing.redisUrl })
      : null;
  }
  return active;
}

export function publishQueueStatus() {
  return getPublishQueue()?.status() ?? QUEUE_STATUS.NOT_CONFIGURED;
}

/** Test hook: replace the queue (pass undefined to rebuild from configuration). */
export function setPublishQueueForTests(queue) {
  if (!config.isTest) throw new Error('setPublishQueueForTests is only available in tests');
  active = queue;
}

export async function closePublishQueue() {
  if (active) await active.close();
  active = undefined;
}
