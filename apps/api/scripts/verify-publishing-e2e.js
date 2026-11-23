/**
 * End-to-end check of the publishing engine through the REAL Redis server and a REAL worker
 * process, in SIMULATION mode.
 *
 *   npm run publishing:verify -w @socialhub/api
 *   npm run publishing:verify -w @socialhub/api -- --hold 600     keep it running 10 minutes
 *
 * What is real: Redis (REDIS_URL), BullMQ, the API process (src/server.js), the worker
 * process (scripts/publish-worker.js), MongoDB writes, media files in the configured storage.
 * What is not: Meta. Only the simulated adapter runs; nothing is sent to Facebook or
 * Instagram, and the test accounts are made up for this check (their ids start with "sim-").
 *
 * It keeps away from your data:
 *  - MongoDB: a temporary private database server, not MONGODB_URI.
 *  - Redis: logical database 15 of the configured server, which must be empty. It is emptied
 *    again at the end. Your normal queue (database 0) is not touched.
 *  - Storage: one small test image in the configured folder, removed at the end.
 *
 * `--hold N` leaves the API running for N seconds afterwards, with jobs in every state, so the
 * Publishing screen can be looked at against real data. It prints where to connect.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_PERMISSIONS, PAGE_PUBLISHING_TASK } from '@socialhub/shared';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  ActivityLog,
  PublishDestination,
  PublishJob,
  SocialAccount,
  SocialConnection,
} from '../src/models/index.js';
import { PUBLISH_QUEUE_NAME, createBullQueue, redactRedisUrl } from '../src/queue/publishQueue.js';
import { closeClients } from './redisClients.js';

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const holdSeconds = Number(flag('--hold') ?? 0);
const infoFile = flag('--info');
const TOKEN = `E2E-SECRET-TOKEN-${randomBytes(8).toString('hex')}`;

const results = [];
let section = '';
const title = (text) => {
  section = text;
  console.log(`\n== ${text}`);
};
const check = (ok, name, detail = '') => {
  results.push({ ok: Boolean(ok), name: `${section}: ${name}` });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};
const skip = (name, why) => console.log(`SKIP ${name} — ${why}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, ms, every = 150) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await Promise.resolve(predicate()).catch(() => null);
    if (value) return value;
    await sleep(every);
  }
  return null;
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** A minimal but structurally valid JPEG (1080×1350). */
function jpegBytes() {
  const u16 = (n) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    u16(16),
    Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
    Buffer.from([0xff, 0xc0]),
    u16(17),
    Buffer.from([8]),
    u16(1350),
    u16(1080),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    randomBytes(128),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function start(script, env, label) {
  const child = spawn(process.execPath, [script], {
    cwd: apiDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.label = label;
  child.output = '';
  child.stdout.on('data', (chunk) => (child.output += chunk));
  child.stderr.on('data', (chunk) => (child.output += chunk));
  child.exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return child;
}
/** Asks for a clean stop (the "shutdown" message) and waits. Returns the exit code. */
async function stopGracefully(child, ms = 40_000) {
  if (!child || child.exitCode !== null) return child?.exitCode ?? null;
  child.send('shutdown');
  const code = await Promise.race([child.exited, sleep(ms).then(() => 'timeout')]);
  if (code === 'timeout') child.kill();
  return code;
}
async function kill(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await child.exited;
}

async function main() {
  const configured = process.env.REDIS_URL;
  if (!configured) {
    console.log('REDIS_URL is not set in apps/api/.env. Install Redis and set it first.');
    process.exitCode = 2;
    return;
  }
  const redisUrl = new URL(configured);
  redisUrl.pathname = '/15';
  const REDIS = redisUrl.toString();
  console.log(`Redis: ${redactRedisUrl(configured)} (logical database 15 for this check)`);

  const redis = new Redis(REDIS, {
    maxRetriesPerRequest: 2,
    retryStrategy: (n) => (n > 20 ? null : 500),
  });
  redis.on('error', () => {});
  const alive = await redis.ping().catch(() => null);
  if (alive !== 'PONG') {
    console.log('Redis does not answer at REDIS_URL. Start it, then run this again.');
    redis.disconnect();
    process.exitCode = 2;
    return;
  }
  if ((await redis.dbsize()) > 0) {
    console.log(
      'Redis database 15 is not empty, so this check will not use it. Empty it or use another server.',
    );
    redis.disconnect();
    process.exitCode = 2;
    return;
  }

  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongo.getUri('socialhub_publishing_check');
  const port = await freePort();
  const HEALTH_TOKEN = randomBytes(32).toString('base64url');
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/api/v1`;
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    PORT: String(port),
    MONGODB_URI: mongoUri,
    API_PUBLIC_URL: origin,
    CLIENT_ORIGIN: `${process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'},http://127.0.0.1:5394`,
    REDIS_URL: REDIS,
    PUBLISHING_MODE: 'simulated',
    PUBLISHING_WORKER_INLINE: 'false',
    PUBLISHING_MAX_ATTEMPTS: '3',
    PUBLISHING_RETRY_BASE_SECONDS: '2',
    PUBLISHING_CLAIM_SECONDS: '15',
    PUBLISHING_REQUEUE_SECONDS: '5',
    PUBLISHING_RECOVERY_INTERVAL_SECONDS: '3',
    AUTH_RATE_LIMIT_MAX: '1000',
    API_RATE_LIMIT_PER_MINUTE: '100000',
    // Server-wide queue figures are only on /health/details, behind this token.
    HEALTH_DETAILS_TOKEN: HEALTH_TOKEN,
  };
  const processes = [];
  const responses = [];
  const redisDumps = [];

  let worker;
  let ws;
  let token;
  const storageFiles = [];

  const call = async (method, url, body, auth = token) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    responses.push({ method, url, text });
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  /** Monitoring view: server-wide queue counts and workers (needs HEALTH_DETAILS_TOKEN). */
  const details = async () => (await call('GET', '/health/details', null, HEALTH_TOKEN)).body;
  const startApi = async (extra = {}, atPort = port) => {
    const child = start('src/server.js', { ...env, PORT: String(atPort), ...extra }, 'api');
    processes.push(child);
    const up = await until(
      async () => (await fetch(`http://127.0.0.1:${atPort}/api/v1/health`).catch(() => null))?.ok,
      60_000,
      400,
    );
    if (!up) throw new Error(`API did not start: ${child.output.slice(-400)}`);
    return child;
  };
  const startWorker = async () => {
    const child = start('scripts/publish-worker.js', env, 'worker');
    processes.push(child);
    const up = await until(
      () => /Publish worker started/.test(child.output) || child.exitCode !== null,
      30_000,
    );
    if (!up || child.exitCode !== null)
      throw new Error(`Worker did not start: ${child.output.slice(-400)}`);
    return child;
  };
  const dumpRedis = async () => {
    const keys = await redis.keys('*');
    const parts = [];
    for (const key of keys) {
      const type = await redis.type(key);
      let value = '';
      if (type === 'hash') value = JSON.stringify(await redis.hgetall(key));
      else if (type === 'string') value = await redis.get(key);
      else if (type === 'list') value = JSON.stringify(await redis.lrange(key, 0, -1));
      else if (type === 'zset') value = JSON.stringify(await redis.zrange(key, 0, -1));
      else if (type === 'set') value = JSON.stringify(await redis.smembers(key));
      else if (type === 'stream')
        value = JSON.stringify(await redis.xrange(key, '-', '+', 'COUNT', 200));
      parts.push(`${key}=${value}`);
    }
    redisDumps.push(parts.join('\n'));
    return keys;
  };
  const jobOf = async (id) =>
    (await call('GET', `/workspaces/${ws}/publish-jobs/${id}`)).body.publishJob;
  const waitJob = (id, predicate, ms = 30_000) =>
    until(async () => {
      const job = await jobOf(id);
      return predicate(job) ? job : null;
    }, ms);
  const settled = (job) => !['SCHEDULED', 'QUEUED', 'PROCESSING'].includes(job.status);
  let keyCounter = 0;
  const key = () => `e2e-${Date.now()}-${(keyCounter += 1)}`.padEnd(22, 'x');
  const draft = async (caption, media = []) =>
    (await call('POST', `/workspaces/${ws}/content-packages`, { caption, media })).body
      .contentPackage.id;
  const publish = (contentPackageId, accounts, extra = {}) =>
    call('POST', `/workspaces/${ws}/publish-jobs`, {
      contentPackageId,
      socialAccountIds: accounts.map((a) => String(a._id)),
      idempotencyKey: key(),
      ...extra,
    });

  try {
    /* ---------------------------------------------------------------- setup */
    title('Setup');
    await startApi();
    const health = (await call('GET', '/health', null, null)).body;
    const monitoring = await details();
    check(
      monitoring?.publishing?.mode === 'SIMULATED' && monitoring.publishing.queue === 'READY',
      'API is up in SIMULATED mode with the queue READY (monitoring details, with the token)',
      JSON.stringify(monitoring?.publishing),
    );
    check(
      JSON.stringify(health) === JSON.stringify({ status: 'ok', database: 'connected' }) &&
        (await call('GET', '/health/details', null, null)).status === 404,
      'Public health shows only that the API and database are up; the details need the token',
      JSON.stringify(health),
    );
    // A throwaway account in the temporary database.
    const email = `publishing.check.${Date.now()}@example.com`;
    const password = `Check-${randomBytes(9).toString('base64url')}1!`;
    const registered = await call(
      'POST',
      '/auth/register',
      { name: 'Publishing Check', email, password },
      null,
    );
    token = registered.body.accessToken;
    ws = (await call('POST', '/workspaces', { name: 'Publishing check' })).body.workspace.id;

    // Made-up test accounts, written straight into the temporary database.
    await mongoose.connect(mongoUri);
    const owner = registered.body.user.id;
    // Shaped like a healthy, synced Facebook Login: the publishing permissions are granted
    // and every destination has the CREATE_CONTENT Page task. The web app computes readiness
    // from these, the API from publishingStatus (READY by default); both must agree.
    const connection = await SocialConnection.create({
      workspace: ws,
      provider: 'FACEBOOK_LOGIN',
      externalUserId: 'sim-identity',
      displayName: 'Simulated login',
      connectedBy: owner,
      grantedScopes: [
        ...new Set([
          ...META_PERMISSIONS.FACEBOOK.REQUIRED,
          ...META_PERMISSIONS.FACEBOOK.PAGE_PUBLISHING,
          ...META_PERMISSIONS.FACEBOOK.INSTAGRAM_PUBLISHING,
        ]),
      ],
    });
    const account = {};
    for (const [name, platform, externalId] of [
      ['ok1', 'FACEBOOK_PAGE', 'sim-ok-page-1'],
      ['ok2', 'FACEBOOK_PAGE', 'sim-ok-page-2'],
      ['ig', 'INSTAGRAM_ACCOUNT', 'sim-ok-instagram'],
      ['fail', 'FACEBOOK_PAGE', 'sim-fail-page'],
      ['flaky', 'FACEBOOK_PAGE', 'sim-flaky-page'],
      ['down', 'FACEBOOK_PAGE', 'sim-down-page'],
      ['unknown', 'FACEBOOK_PAGE', 'sim-unknown-page'],
      ['slow', 'FACEBOOK_PAGE', 'sim-slow-page'],
      ['slower', 'FACEBOOK_PAGE', 'sim-slower-page'],
    ]) {
      const doc = new SocialAccount({
        workspace: ws,
        connection: connection._id,
        platform,
        externalId,
        name: `Test ${externalId}`,
        connectedBy: owner,
        tasks: [PAGE_PUBLISHING_TASK],
      });
      doc.setAccessToken(`${TOKEN}-${externalId}`);
      await doc.save();
      account[name] = doc;
    }
    console.log(`     workspace ${ws}, ${Object.keys(account).length} simulated test accounts`);

    // One real image through the real storage, so the Instagram account has media.
    const image = jpegBytes();
    const slot = await call('POST', `/workspaces/${ws}/media/uploads`, {
      fileName: 'check.jpg',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      sizeBytes: image.length,
    });
    if (slot.status === 201) {
      await fetch(slot.body.upload.url, {
        method: 'PUT',
        headers: slot.body.upload.headers,
        body: image,
      });
      await call('POST', `/workspaces/${ws}/media/${slot.body.media.id}/complete`);
      storageFiles.push(slot.body.media.id);
    }
    const mediaId = slot.body?.media?.id;
    check(
      slot.status === 201 && Boolean(mediaId),
      'Test image stored through the real storage',
      `HTTP ${slot.status}`,
    );

    /* ------------------------------------------- 1–4: create, save, queue */
    title('Create a job with the worker stopped (steps 1–4)');
    const d1 = await draft('End-to-end check: three accounts', [{ mediaId }]);
    const created = await publish(d1, [account.ok1, account.ok2, account.ig]);
    const j1 = created.body.publishJob;
    check(
      created.status === 201 && j1.destinations.length === 3,
      'Job created for 3 destinations',
      `HTTP ${created.status}`,
    );
    check(j1.simulated === true && j1.mode === 'SIMULATED', 'Job is marked as simulated');
    const savedJob = await PublishJob.findById(j1.id).lean();
    const savedDestinations = await PublishDestination.find({ job: j1.id }).lean();
    check(
      savedJob?.status === 'QUEUED' &&
        savedDestinations.length === 3 &&
        savedDestinations.every((d) => d.state === 'QUEUED'),
      'Job and one record per destination are in MongoDB, state QUEUED',
    );
    const keys = await dumpRedis();
    const entries = [];
    for (const d of savedDestinations) {
      entries.push(await redis.hget(`bull:${PUBLISH_QUEUE_NAME}:${d._id}-${d.queueSeq}`, 'data'));
    }
    check(
      entries.every(
        (data, i) => data === JSON.stringify({ destinationId: String(savedDestinations[i]._id) }),
      ),
      'Redis holds one entry per destination, containing only the destination id',
      `${keys.length} Redis keys`,
    );
    const idle = (await call('GET', `/workspaces/${ws}/publishing/status`)).body;
    const idleDetails = await details();
    check(
      idle.queue.status === 'READY' &&
        idle.worker.status === 'NOT_RUNNING' &&
        idleDetails.publishing.counts?.waiting === 3,
      'Status: queue READY, worker NOT_RUNNING; monitoring sees 3 waiting',
      JSON.stringify({
        queue: idle.queue,
        worker: idle.worker,
        counts: idleDetails.publishing.counts,
      }),
    );
    check(
      !/counts|waiting|"count"|driver/.test(JSON.stringify(idle)),
      "A member's status shows no server-wide counts, worker numbers or storage driver",
    );
    await sleep(2500);
    check((await jobOf(j1.id)).status === 'QUEUED', 'Without a worker nothing is processed');

    /* --------------------------------------------- 5–9: worker processes */
    title('Start the worker (steps 5–9, 15)');
    worker = await startWorker();
    check(
      /SIMULATION mode: nothing is sent to Meta/.test(worker.output),
      'Worker process started and says it is in simulation mode',
    );
    const done1 = await waitJob(j1.id, settled);
    check(done1?.status === 'PUBLISHED', 'Job status became PUBLISHED', done1?.status);
    check(
      done1?.destinations.every(
        (d) => d.state === 'PUBLISHED' && d.simulated && d.attemptCount === 1,
      ),
      'Each of the 3 destinations was processed on its own (1 attempt each, simulated)',
    );
    const raw1 = await PublishDestination.find({ job: j1.id }).lean();
    check(
      done1?.destinations.every((d) => d.externalPostId === null && d.externalUrl === null) &&
        raw1.every((d) => d.externalPostId === undefined && d.externalUrl === undefined),
      'No post id or link exists anywhere for a simulated destination (API and MongoDB)',
    );
    const running = (await call('GET', `/workspaces/${ws}/publishing/status`)).body;
    const runningDetails = await details();
    check(
      running.worker.status === 'RUNNING' && runningDetails.publishing.workers === 1,
      'Status: worker RUNNING (monitoring: 1 worker)',
      JSON.stringify({ worker: running.worker, workers: runningDetails.publishing.workers }),
    );
    await dumpRedis();

    /* ------------------------------------------------ 10: partial failure */
    title('Partial failure (step 10)');
    const d2 = await draft('End-to-end check: one account refuses');
    const j2 = (await publish(d2, [account.ok1, account.fail])).body.publishJob;
    const done2 = await waitJob(j2.id, settled);
    const failed2 = done2?.destinations.find((d) => d.state === 'FAILED');
    check(
      done2?.status === 'PARTIALLY_PUBLISHED',
      'Job is PARTIALLY_PUBLISHED, not FAILED',
      done2?.status,
    );
    check(
      done2?.destinations.some((d) => d.state === 'PUBLISHED') &&
        failed2?.error.code === 'PLATFORM_REJECTED' &&
        failed2.attemptCount === 1,
      'One destination published, the other failed for good after 1 attempt',
      failed2?.error.message,
    );

    /* ------------------------------------------------------- 11: retries */
    title('Retries with backoff (step 11)');
    const d3 = await draft('End-to-end check: temporary problem');
    const j3 = (await publish(d3, [account.flaky])).body.publishJob;
    const waiting3 = await waitJob(
      j3.id,
      (job) => job.destinations[0].state === 'RETRY_SCHEDULED' || settled(job),
      15_000,
    );
    check(
      waiting3?.destinations[0].state === 'RETRY_SCHEDULED' && waiting3.status === 'PROCESSING',
      'After a temporary failure the destination waits for a retry',
      waiting3?.destinations[0].state,
    );
    const done3 = await waitJob(j3.id, settled);
    check(
      done3?.status === 'PUBLISHED' &&
        done3.destinations[0].attemptCount === 2 &&
        done3.destinations[0].attempts.map((a) => a.outcome).join(',') === 'RETRY,PUBLISHED',
      'The retry was delivered through Redis and succeeded on attempt 2',
    );
    const d4 = await draft('End-to-end check: problem that stays');
    const j4 = (await publish(d4, [account.down])).body.publishJob;
    const done4 = await waitJob(j4.id, settled, 60_000);
    const attempts4 = done4?.destinations[0].attempts ?? [];
    const gaps = attempts4
      .slice(1)
      .map((a, i) => new Date(a.startedAt) - new Date(attempts4[i].finishedAt));
    check(
      done4?.status === 'FAILED' && attempts4.length === 3,
      'It gives up after the allowed 3 attempts',
      `${attempts4.length} attempts`,
    );
    check(
      gaps.length === 2 && gaps[1] > gaps[0] * 1.4,
      'The wait grows between attempts (exponential backoff)',
      `${gaps.map((g) => `${(g / 1000).toFixed(1)} s`).join(', then ')}`,
    );
    const retryUrl = `/workspaces/${ws}/publish-jobs/${j2.id}/destinations/${failed2.id}/retry`;
    const manual = await call('POST', retryUrl, {});
    const again = await call('POST', retryUrl, {});
    const done2b = await waitJob(
      j2.id,
      (job) => settled(job) && job.destinations.find((d) => d.id === failed2.id).attemptCount === 2,
    );
    check(
      manual.status === 200 && again.status === 409,
      'A person can retry a failed destination; a second click is refused',
      `HTTP ${manual.status}, ${again.status}`,
    );
    check(Boolean(done2b), 'The manual retry ran through the queue (attempt 2 recorded)');

    /* -------------------------------------------- 12: duplicate prevention */
    title('Duplicate prevention (step 12)');
    const d5 = await draft('End-to-end check: duplicates');
    const body5 = {
      contentPackageId: d5,
      socialAccountIds: [String(account.ok1._id)],
      idempotencyKey: key(),
    };
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => call('POST', `/workspaces/${ws}/publish-jobs`, body5)),
    );
    const ids5 = new Set(burst.map((r) => r.body.publishJob?.id));
    check(
      ids5.size === 1 &&
        burst.filter((r) => r.status === 201).length === 1 &&
        (await PublishJob.countDocuments({ contentPackage: d5 })) === 1,
      'The same request sent 5 times at once created exactly one job',
      burst
        .map((r) => r.status)
        .sort()
        .join(', '),
    );
    await waitJob([...ids5][0], settled);
    const repeat = await publish(d5, [account.ok1]);
    check(
      repeat.status === 409 && repeat.body.error.details.reason === 'ALREADY_PUBLISHED',
      'Publishing the same post to the same account again is refused',
      `HTTP ${repeat.status}`,
    );

    // The same destination delivered many times by the queue is published once.
    const d6 = await draft('End-to-end check: repeated delivery');
    const j6 = (await publish(d6, [account.slow])).body.publishJob;
    const extra = createBullQueue({ redisUrl: REDIS });
    await until(() => extra.status() === 'READY', 5000);
    for (let seq = 90; seq < 95; seq += 1)
      await extra.enqueue({ destinationId: j6.destinations[0].id, seq });
    await extra.close();
    const done6 = await waitJob(j6.id, settled, 40_000);
    await sleep(1500);
    const raw6 = await PublishDestination.findById(j6.destinations[0].id).lean();
    check(
      done6?.status === 'PUBLISHED' && raw6.attemptCount === 1 && raw6.attempts.length === 1,
      'A destination with 6 queue entries was published once (1 attempt)',
      `${raw6.attemptCount} attempt(s)`,
    );

    /* ---------------------------------------------------- 13: cancellation */
    title('Cancellation (step 13)');
    const d7 = await draft('End-to-end check: scheduled, then cancelled');
    const scheduled = await publish(d7, [account.ok1, account.ok2], {
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const j7 = scheduled.body.publishJob;
    const delayedBefore = (await details()).publishing.counts.delayed;
    const active = await publish(d7, [account.ok1], { republish: true });
    check(
      j7.status === 'SCHEDULED' && delayedBefore >= 2,
      'A scheduled job waits in Redis as delayed entries',
      `${delayedBefore} delayed`,
    );
    check(
      active.status === 409 && active.body.error.details.reason === 'IN_PROGRESS',
      'A second job for a post that is already on its way is refused',
    );
    const cancelled = await call('POST', `/workspaces/${ws}/publish-jobs/${j7.id}/cancel`);
    const delayedAfter = (await details()).publishing.counts.delayed;
    check(
      cancelled.body.publishJob?.status === 'CANCELLED' && delayedAfter === delayedBefore - 2,
      'Cancelling removed both entries from Redis and marked the job CANCELLED',
      `${delayedAfter} delayed`,
    );
    check(
      (await call('POST', `/workspaces/${ws}/publish-jobs/${j7.id}/cancel`)).status === 409,
      'Nothing is left to cancel afterwards',
    );

    /* ------------------------------------------------- uncertain outcomes */
    title('Uncertain outcome');
    const d8 = await draft('End-to-end check: no answer after sending');
    const j8 = (await publish(d8, [account.unknown])).body.publishJob;
    const done8 = await waitJob(j8.id, settled);
    await sleep(3000);
    const dest8 = (await jobOf(j8.id)).destinations[0];
    check(
      dest8.state === 'FAILED' &&
        dest8.error.code === 'OUTCOME_UNKNOWN' &&
        dest8.error.uncertain &&
        dest8.attemptCount === 1,
      'It is not retried automatically',
      `${dest8.attemptCount} attempt, ${done8?.status}`,
    );
    const risky = await call(
      'POST',
      `/workspaces/${ws}/publish-jobs/${j8.id}/destinations/${dest8.id}/retry`,
      {},
    );
    check(
      risky.status === 409 && risky.body.error.details.reason === 'DUPLICATE_RISK',
      'A manual retry needs an explicit confirmation first',
      `HTTP ${risky.status}`,
    );

    /* ------------------------------------------------- graceful shutdown */
    title('Worker: clean stop while publishing');
    const d9 = await draft('End-to-end check: clean stop');
    // 12 s to publish: longer than the old 10 s shutdown limit, which cut such posts off.
    const j9 = (await publish(d9, [account.slower])).body.publishJob;
    await waitJob(j9.id, (job) => job.destinations[0].state === 'PROCESSING', 10_000);
    const stopAt = Date.now();
    const exitCode = await stopGracefully(worker, 120_000);
    const waited = (Date.now() - stopAt) / 1000;
    const after9 = await jobOf(j9.id);
    const raw9 = await PublishDestination.findById(after9.destinations[0].id).lean();
    const took = raw9?.completedAt ? (raw9.completedAt - raw9.processingAt) / 1000 : 0;
    check(
      exitCode === 0 && after9.destinations[0].state === 'PUBLISHED' && took > 10,
      'The worker finished a post that took longer than 10 s, then exited cleanly',
      `exit code ${exitCode}, publishing took ${took.toFixed(1)} s, stop waited ${waited.toFixed(1)} s`,
    );
    check(
      (await call('GET', `/workspaces/${ws}/publishing/status`)).body.worker.status ===
        'NOT_RUNNING',
      'Status shows the worker is gone',
    );

    /* --------------------------------------------- restart picks work up */
    title('Worker restart');
    const d10 = await draft('End-to-end check: queued while the worker is off');
    const j10 = (await publish(d10, [account.ok1, account.ok2])).body.publishJob;
    await sleep(1500);
    const waiting10 = await jobOf(j10.id);
    worker = await startWorker();
    const done10 = await waitJob(j10.id, settled);
    check(
      waiting10.status === 'QUEUED' && done10?.status === 'PUBLISHED',
      'Jobs created while the worker was off are processed after it restarts',
    );

    /* ------------------------------------------ stalled / interrupted job */
    title('Worker killed in the middle of publishing (stalled job)');
    const d11 = await draft('End-to-end check: worker killed');
    const j11 = (await publish(d11, [account.slow])).body.publishJob;
    await waitJob(j11.id, (job) => job.destinations[0].state === 'PROCESSING', 10_000);
    await kill(worker); // hard stop: no clean-up at all
    worker = await startWorker();
    await sleep(4000);
    const during = (await jobOf(j11.id)).destinations[0];
    check(
      during.state === 'PROCESSING',
      'A new worker does not touch a destination another worker still holds',
    );
    const done11 = await waitJob(j11.id, settled, 90_000, 500);
    const dest11 = done11?.destinations[0];
    await sleep(3000);
    const raw11 = await PublishDestination.findById(dest11?.id).lean();
    check(
      dest11?.state === 'FAILED' && dest11.error.code === 'INTERRUPTED' && dest11.error.uncertain,
      'After the claim ran out it was marked INTERRUPTED (the post may or may not exist)',
      dest11?.error?.code,
    );
    check(
      raw11?.attemptCount === 1 && raw11.state === 'FAILED',
      'It was not published a second time by the queue redelivering it',
      `${raw11?.attemptCount} attempt`,
    );

    /* ------------------------------------------------- Redis loses its data */
    title('Recovery after Redis loses its queue data');
    await stopGracefully(worker);
    const d12 = await draft('End-to-end check: queue data lost');
    const j12 = (await publish(d12, [account.ok1, account.ok2])).body.publishJob;
    await dumpRedis();
    await redis.flushdb();
    check((await redis.dbsize()) === 0, 'Redis database emptied: the queue entries are gone');
    worker = await startWorker();
    const done12 = await waitJob(j12.id, settled, 60_000, 500);
    check(
      done12?.status === 'PUBLISHED',
      'The recovery sweep queued the waiting destinations again from MongoDB, and they were published',
      done12?.status,
    );
    check(
      /Publishing recovery sweep/.test(worker.output),
      'The worker log shows the recovery sweep',
    );

    /* ------------------------------------------------ Redis server restart */
    title('Redis connection lost and restored');
    // Only connections to database 15 are closed: that database belongs to this check (it must
    // be empty when the check starts). Other clients of the server, such as a running API on
    // database 0, are not touched.
    const { closed: victims } = await closeClients(redis, (client) => client.db === '15');
    await sleep(300);
    const back = await until(
      async () => {
        const status = (await call('GET', `/workspaces/${ws}/publishing/status`)).body;
        return status.queue.status === 'READY' && status.worker.status === 'RUNNING';
      },
      30_000,
      500,
    );
    const d13 = await draft('End-to-end check: after reconnecting');
    const j13 = (await publish(d13, [account.ok1])).body.publishJob;
    const done13 = j13 ? await waitJob(j13.id, settled, 30_000) : null;
    check(
      Boolean(back) && done13?.status === 'PUBLISHED',
      'After every connection was cut by the server, the API and the worker reconnected and published a new job',
      `${victims} connection(s) cut`,
    );
    skip(
      'Stopping and starting the Redis Windows service',
      'needs an administrator; see README for the manual check',
    );

    /* -------------------------------------------- 14: activity and secrets */
    title('Activity log and secrets (step 14)');
    const actions = (await ActivityLog.find({ workspace: ws }).lean()).map((entry) => entry.action);
    const wanted = [
      'publish_job.created',
      'publish_job.finished',
      'publish_job.cancelled',
      'publish_destination.retried',
    ];
    check(
      wanted.every((action) => actions.includes(action)),
      'Activity entries were written',
      wanted.map((a) => `${a} ×${actions.filter((x) => x === a).length}`).join(', '),
    );
    const feed = await call('GET', `/workspaces/${ws}/activity`);
    check(
      feed.status === 200 &&
        feed.body.items.some(
          (item) => item.action === 'publish_job.finished' && item.metadata?.simulated === true,
        ),
      'The activity feed marks finished jobs as simulated',
    );
    await dumpRedis();
    // The Meta token of the test accounts (E2E-SECRET-TOKEN-…) and the stored, encrypted form of
    // any token must appear nowhere. A field named "accessToken" may appear only in sign-in
    // answers (/auth/…), where it is SocialHub's own session token, by design.
    const isSignIn = (r) => r.url.startsWith('/auth/');
    const haystacks = {
      'Redis (every key, at 5 points in time)': { all: redisDumps.join('\n') },
      'API answers': {
        all: responses.map((r) => r.text).join('\n'),
        noSignIn: responses
          .filter((r) => !isSignIn(r))
          .map((r) => r.text)
          .join('\n'),
      },
      'API and worker logs': { all: processes.map((p) => p.output).join('\n') },
    };
    const count = (text, pattern) => (text.match(pattern) ?? []).length;
    for (const [where, { all, noSignIn = all }] of Object.entries(haystacks)) {
      const metaToken = count(all, /E2E-SECRET-TOKEN/g);
      const encrypted = count(all, /ciphertext/g);
      const tokenField = count(noSignIn, /accessToken"/g);
      check(
        metaToken + encrypted + tokenField === 0,
        `No access token in: ${where}`,
        `${all.length.toLocaleString('en-US')} characters searched; Meta test token ${metaToken}, encrypted token ${encrypted}, "accessToken" field outside sign-in ${tokenField}`,
      );
    }
    const metaCalls = processes
      .map((p) => p.output)
      .join('\n')
      .match(/graph\.(facebook|instagram)\.com/g);
    check(!metaCalls, 'No request to the Meta Graph API appears in any log');
    const everyDestination = await PublishDestination.find({ workspace: ws }).lean();
    check(
      everyDestination.length > 0 &&
        everyDestination.every((d) => d.externalPostId === undefined && d.simulated === true),
      `None of the ${everyDestination.length} destinations has a post id; all are marked simulated`,
    );

    /* ------------------------------------------------------------- hold */
    if (holdSeconds > 0) {
      title(`Holding for ${holdSeconds} seconds for the Publishing screen`);
      // Leave something in every tab: a scheduled job, and one waiting for a retry.
      const d14 = await draft('Scheduled for later (real Redis delayed entries)');
      await publish(d14, [account.ok1, account.ig].slice(0, 1), {
        scheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
      });
      const d15 = await draft('One account published, one waiting for a retry');
      const j15 = (await publish(d15, [account.ok2, account.down])).body.publishJob;
      await waitJob(
        j15.id,
        (job) =>
          job.destinations.some((d) => d.state === 'RETRY_SCHEDULED') &&
          job.destinations.some((d) => d.state === 'PUBLISHED'),
        20_000,
      );
      await kill(worker); // so the retry stays visible as "Processing"
      const d16 = await draft('Waiting in the queue (worker stopped)');
      await publish(d16, [account.ok1, account.ok2]);
      const d17 = await draft('A saved draft that has not been published yet', [{ mediaId }]);
      await call('PATCH', `/workspaces/${ws}/content-packages/${d17}`, {
        caption: 'A saved draft that has not been published yet',
        media: [{ mediaId }],
        targetAccountIds: [String(account.ok1._id), String(account.ig._id)],
        version: 1,
      });
      // A second API whose Redis address is wrong, to show the "queue unavailable" state.
      const downPort = await freePort();
      await startApi({ REDIS_URL: 'redis://127.0.0.1:6398' }, downPort);
      const session = {
        apiPort: port,
        apiPortQueueDown: downPort,
        workspaceId: ws,
        login: { email, password },
      };
      if (infoFile) await writeFile(infoFile, JSON.stringify(session, null, 2));
      console.log(`     API with real Redis:      ${origin}`);
      console.log(`     API with Redis unreachable: http://127.0.0.1:${downPort}`);
      console.log(`     workspace ${ws}${infoFile ? `, session details in ${infoFile}` : ''}`);
      const end = Date.now() + holdSeconds * 1000;
      // Ends early when the session file is deleted.
      while (Date.now() < end) {
        await sleep(1000);
        if (infoFile) {
          const names = await readdir(path.dirname(infoFile)).catch(() => []);
          if (!names.includes(path.basename(infoFile))) break;
        }
      }
    }
  } finally {
    /* ------------------------------------------------------------ clean up */
    for (const child of processes) await kill(child);
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
    await redis.flushdb().catch(() => {});
    redis.disconnect();
    const root = path.resolve(apiDir, process.env.STORAGE_LOCAL_DIR ?? './storage-data');
    if (ws && process.env.STORAGE_DRIVER === 'local') {
      for (const area of ['uploads', 'workspaces']) {
        await rm(path.join(root, area, ws), { recursive: true, force: true });
        await rmdir(path.join(root, area, ws)).catch(() => {});
      }
    }
  }
}

await main().catch((err) => check(false, 'Check aborted', err.stack ?? err.message));
const failed = results.filter((r) => !r.ok);
if (results.length) {
  console.log(
    `\n${failed.length === 0 ? 'All checks passed' : `${failed.length} check(s) FAILED`} (${results.length - failed.length} passed).`,
  );
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
setTimeout(() => process.exit(), 1000).unref();
