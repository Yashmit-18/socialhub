/**
 * Checks the publishing queue against the REAL Redis configured in REDIS_URL.
 *
 *   npm run queue:verify -w @socialhub/api
 *
 * It uses the same queue code the API uses (src/queue/publishQueue.js: BullMQ + ioredis), on
 * a separate, temporary queue name, so a running API or worker is not disturbed. It touches
 * no MongoDB data and publishes nothing. Its keys are removed at the end.
 *
 * Exit code 0 only when every check passes. The automated tests do not use Redis, so this
 * script is the evidence that BullMQ works with this Redis server.
 */
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { QUEUE_STATUS } from '@socialhub/shared';
import { config } from '../src/config/env.js';
import { createBullQueue, redactRedisUrl } from '../src/queue/publishQueue.js';
import { closeClients } from './redisClients.js';

const results = [];
const check = (ok, name, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await Promise.resolve(predicate()).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
};
const id = (n) => `${n}`.padStart(24, 'a');

async function main() {
  const url = config.publishing.redisUrl;
  if (!url) {
    console.log(
      'REDIS_URL is not set in apps/api/.env. Install Redis, set REDIS_URL, then run this again.',
    );
    process.exitCode = 2;
    return;
  }
  console.log(`Redis: ${redactRedisUrl(url)}`);

  // A plain connection of this script's own, to ask the server about itself.
  const admin = new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: () => null });
  admin.on('error', () => {});
  const info = await admin.info('server').catch(() => null);
  if (!check(Boolean(info), 'Redis answers', info ? '' : 'no server at this address')) {
    admin.disconnect();
    return;
  }
  const field = (name) => info.match(new RegExp(`^${name}:(.*)$`, 'm'))?.[1]?.trim();
  const version = field('redis_version');
  const product = field('memurai_version') ? `Memurai ${field('memurai_version')}` : 'Redis';
  console.log(`Server: ${product}, Redis API ${version}, ${field('os') ?? 'unknown OS'}\n`);
  check(
    Number(version?.split('.')[0]) >= 5,
    'Server version is supported by BullMQ (5 or newer)',
    `${version}${Number(version?.split('.')[0]) < 6 ? ' (6.2 or newer is recommended)' : ''}`,
  );
  const policy = (await admin.config('GET', 'maxmemory-policy').catch(() => []))[1];
  if (policy && policy !== 'noeviction') {
    console.log(`NOTE maxmemory-policy is "${policy}"; BullMQ recommends "noeviction".`);
  }

  const name = `socialhub-verify-${randomBytes(4).toString('hex')}`;
  const queue = createBullQueue({ redisUrl: url, name });
  try {
    await until(() => queue.status() !== QUEUE_STATUS.CONNECTING, 8000);
    if (
      !check(
        queue.status() === QUEUE_STATUS.READY,
        'Queue connects',
        queue.status() === QUEUE_STATUS.READY
          ? ''
          : `status ${queue.status()} (${queue.lastError() ?? 'no answer'})`,
      )
    ) {
      return;
    }

    /* ---- insertion and retrieval, before any worker exists ---- */
    await queue.enqueue({ destinationId: id(1), seq: 1 });
    await queue.enqueue({ destinationId: id(1), seq: 1 }); // the same entry again
    await queue.enqueue({ destinationId: id(2), seq: 1, delayMs: 2500 });
    await queue.enqueue({ destinationId: id(3), seq: 1, delayMs: 60_000 });
    const before = await queue.counts();
    check(
      before.waiting === 1 && before.delayed === 2,
      'Entries are stored in Redis (1 waiting, 2 delayed; the duplicate was ignored)',
      `${before.waiting} waiting, ${before.delayed} delayed`,
    );
    const raw = await admin.hget(`bull:${name}:${id(1)}-1`, 'data');
    check(
      raw === JSON.stringify({ destinationId: id(1) }),
      'A stored entry holds the destination id and nothing else',
      raw ?? 'not found',
    );
    check((await queue.workerCount()) === 0, 'No worker yet: nothing is processed');

    /* ---- worker processing and completion ---- */
    const received = [];
    const started = Date.now();
    let failNext = true;
    const worker = queue.startWorker(async (destinationId) => {
      received.push({ destinationId, at: Date.now() });
      if (destinationId === id(4) && failNext) {
        failNext = false;
        throw new Error('simulated processor crash');
      }
      if (destinationId === id(5)) await sleep(1500);
    });
    check(
      await until(async () => (await queue.workerCount()) >= 1, 5000),
      'Worker is visible to the queue (health)',
    );
    check(
      await until(() => received.some((r) => r.destinationId === id(1)), 5000),
      'A waiting entry is delivered to the worker',
    );
    check(
      await until(async () => (await admin.zcard(`bull:${name}:completed`)) === 1, 5000),
      'The entry is recorded as completed',
    );
    check(
      await queue.remove({ destinationId: id(3), seq: 1 }),
      'A waiting entry can be removed (cancel)',
    );
    const delayed = await until(() => received.some((r) => r.destinationId === id(2)), 8000);
    const waited = received.find((r) => r.destinationId === id(2))?.at - started;
    check(delayed && waited >= 2300, 'A delayed entry arrives after its delay', `${waited} ms`);

    /* ---- failure and retry ---- */
    // BullMQ's own retry is off: the engine decides about retries and adds a NEW entry.
    await queue.enqueue({ destinationId: id(4), seq: 1 });
    check(
      await until(async () => (await admin.zcard(`bull:${name}:failed`)) === 1, 5000),
      'A crashing processor leaves the entry recorded as failed',
    );
    await sleep(800);
    check(
      received.filter((r) => r.destinationId === id(4)).length === 1,
      'A failed entry is not repeated by the queue on its own',
    );
    await queue.enqueue({ destinationId: id(4), seq: 2, delayMs: 500 });
    check(
      await until(() => received.filter((r) => r.destinationId === id(4)).length === 2, 5000),
      'A retry (new delayed entry for the same destination) is delivered',
    );

    /* ---- disconnection and reconnection ---- */
    // Only this script's connections are closed: its queue and worker connections (named with
    // this process id) and BullMQ's connections for its temporary queue. A running API or
    // worker on the same Redis server is not touched.
    const myId = await admin.client('ID');
    const bullName = `bull:${Buffer.from(name).toString('base64')}`;
    const { closed: killed } = await closeClients(
      admin,
      (client) =>
        client.name === `socialhub-queue-${process.pid}` ||
        client.name === `socialhub-worker-${process.pid}` ||
        client.name.startsWith(bullName),
    );
    const dropped = await until(() => queue.status() !== QUEUE_STATUS.READY, 3000);
    const failedFast = dropped
      ? await queue.enqueue({ destinationId: id(6), seq: 1 }).then(
          () => false,
          () => true,
        )
      : null;
    check(
      await until(() => queue.status() === QUEUE_STATUS.READY, 15_000),
      'After its connections are cut, the queue reconnects by itself',
      `${killed} of this check's connection(s) closed by the server (its own id ${myId} kept, other clients untouched)${dropped ? '' : '; reconnect was faster than the check'}`,
    );
    if (failedFast !== null) {
      check(failedFast, 'While disconnected, adding an entry fails at once instead of hanging');
    }
    await until(async () => (await queue.workerCount()) >= 1, 10_000);
    await queue.enqueue({ destinationId: id(7), seq: 1 });
    check(
      await until(() => received.some((r) => r.destinationId === id(7)), 10_000),
      'After reconnecting, new entries are delivered to the same worker',
    );

    /* ---- duplicates and graceful shutdown ---- */
    check(
      received.filter((r) => r.destinationId === id(1)).length === 1,
      'The same entry added twice was delivered once',
    );
    check(!received.some((r) => r.destinationId === id(3)), 'A removed entry was never delivered');

    await queue.enqueue({ destinationId: id(5), seq: 1 }); // takes 1.5 s
    await until(() => received.some((r) => r.destinationId === id(5)), 5000);
    const completedBefore = await admin.zcard(`bull:${name}:completed`);
    const closing = Date.now();
    await worker.close();
    const completedAfter = await admin.zcard(`bull:${name}:completed`);
    check(
      completedAfter === completedBefore + 1 && Date.now() - closing >= 1000,
      'Graceful shutdown: the worker finishes the entry it is working on before it stops',
      `waited ${Date.now() - closing} ms`,
    );
    check(
      await until(async () => (await queue.workerCount()) === 0, 5000),
      'After shutdown the queue reports no worker',
    );
    const after = await queue.counts();
    check(
      after.active === 0 && after.waiting === 0,
      'Nothing is left half-processed',
      JSON.stringify(after),
    );
  } finally {
    await queue.close();
    // Remove this check's keys only.
    const keys = await admin.keys(`bull:${name}:*`).catch(() => []);
    if (keys.length) await admin.del(...keys).catch(() => {});
    admin.disconnect();
  }
}

await main().catch((err) => check(false, 'Check aborted', err.message));
const failed = results.filter((ok) => !ok).length;
if (results.length) {
  console.log(
    `\n${failed === 0 ? 'All checks passed' : `${failed} check(s) FAILED`} (${results.length - failed} passed).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
setTimeout(() => process.exit(), 500).unref();
