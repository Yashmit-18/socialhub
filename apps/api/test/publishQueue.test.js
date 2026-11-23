import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for a bug found by `npm run queue:verify` against a real Redis
 * (Memurai 4.1.2, 2026-11-23): with `skipWaitingForReady: true` and the offline queue off,
 * BullMQ sent its version check before the socket was open, the check failed, and BullMQ kept
 * that failure, so the queue answered "Stream isn't writeable" forever, even once Redis was up.
 *
 * The automated tests cannot run Redis, so this checks how the Queue is built. The behaviour
 * itself is checked against a real server by `npm run queue:verify -w @socialhub/api`.
 */

const created = [];
vi.mock('bullmq', () => {
  class Queue {
    constructor(name, options) {
      created.push({ name, options });
    }
    on() {}
    close() {
      return Promise.resolve();
    }
  }
  class Worker {}
  return { Queue, Worker };
});

const { createBullQueue } = await import('../src/queue/publishQueue.js');

afterEach(() => {
  created.length = 0;
});

describe('publish queue construction', () => {
  it('lets BullMQ wait for the connection before it prepares the queue', async () => {
    // Port 1 refuses connections: the client keeps retrying, as when Redis is down.
    const queue = createBullQueue({ redisUrl: 'redis://127.0.0.1:1', name: 'guard' });
    try {
      expect(created).toHaveLength(1);
      const { options } = created[0];
      expect(options.skipWaitingForReady).toBeFalsy();
      // The connection handed to BullMQ is the fail-fast one (no offline queue), so waiting is
      // only ever done by BullMQ's own setup, never by an API request.
      expect(options.connection.options.enableOfflineQueue).toBe(false);
      expect(options.connection.options.maxRetriesPerRequest).toBeNull();
      expect(options.defaultJobOptions.attempts).toBe(1);
    } finally {
      await queue.close();
    }
  });

  it('refuses work at once while Redis is not reachable', async () => {
    const queue = createBullQueue({ redisUrl: 'redis://127.0.0.1:1', name: 'guard' });
    try {
      const started = Date.now();
      await expect(queue.enqueue({ destinationId: 'a'.repeat(24), seq: 1 })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await queue.close();
    }
  });
});
