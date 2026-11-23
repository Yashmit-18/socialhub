/**
 * Checks insights sync (docs/ANALYTICS.md) against the REAL Redis configured in REDIS_URL, with
 * the real API and the real worker, each in its own process:
 *
 *   npm run analytics:verify -w @socialhub/api
 *
 * Real: Redis and BullMQ (logical database 14 of the configured server, which must be empty; it
 * is emptied again at the end, so your normal queue in database 0 is not touched), the API
 * (src/server.js) and the worker (scripts/publish-worker.js) as separate processes, MongoDB (a
 * temporary private server, not MONGODB_URI).
 *
 * Simulated: Meta. Both processes run with ANALYTICS_MODE=simulated, so insights are DEMO values
 * that SocialHub makes up and labels as such; nothing is read from Meta. Publishing is switched
 * off in both processes, so no publish worker starts.
 *
 * Two situations are staged by writing to the temporary database, and the output says so: a
 * worker that stopped in the middle of a sync, and time passing after Redis lost a queue entry.
 *
 * Exit code 0 only when every check passes; 2 when the check could not run (no REDIS_URL, or
 * database 14 is not empty).
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { closeClients } from './redisClients.js';

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB = 14;
const QUEUE = 'socialhub-analytics';
const TERMINAL = ['SUCCEEDED', 'PARTIAL', 'FAILED'];

const results = [];
const check = (ok, name, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};
const note = (text) => console.log(`\n== ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await Promise.resolve(predicate()).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/** Starts `node <script>` in apps/api with `env`. stop() asks for a clean shutdown over IPC. */
function startProcess(label, script, env) {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', script], {
    cwd: apiDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const lines = [];
  const keep = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line);
    if (lines.length > 300) lines.splice(0, lines.length - 300);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    label,
    lines,
    running: () => child.exitCode === null && child.signalCode === null,
    said: (text) => lines.some((line) => line.includes(text)),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
      try {
        child.send('shutdown');
      } catch {
        // The IPC channel is already gone.
      }
      const code = await Promise.race([exited, sleep(30_000).then(() => 'timeout')]);
      if (code !== 'timeout') return code;
      child.kill();
      await exited;
      return 'killed';
    },
    tail(n = 25) {
      return lines.slice(-n).join('\n');
    },
  };
}

async function main() {
  const configured = process.env.REDIS_URL;
  if (!configured) {
    console.log('REDIS_URL is not set in apps/api/.env. Set it, then run this again.');
    process.exitCode = 2;
    return;
  }
  const redisUrl = new URL(configured);
  redisUrl.pathname = `/${DB}`;
  const REDIS = redisUrl.toString();

  const admin = new Redis(REDIS, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectionName: `analytics-verify-admin-${process.pid}`,
  });
  admin.on('error', () => {});
  const info = await admin.info('server').catch(() => null);
  if (!check(Boolean(info), 'Redis answers', info ? '' : 'no server at this address')) {
    admin.disconnect();
    process.exitCode = 2;
    return;
  }
  const field = (name) => info.match(new RegExp(`^${name}:(.*)$`, 'm'))?.[1]?.trim();
  const product = field('memurai_version') ? `Memurai ${field('memurai_version')}` : 'Redis';
  if ((await admin.dbsize()) !== 0) {
    console.log(
      `Redis database ${DB} is not empty, so this check will not use it. Empty it or use another server.`,
    );
    admin.disconnect();
    process.exitCode = 2;
    return;
  }

  // Never 27017 or another fixed port: the operating system picks a free one.
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ port: await freePort() }],
  });
  const mongoUri = mongo.getUri('socialhub_analytics_verify');
  const apiPort = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    MONGODB_URI: mongoUri,
    REDIS_URL: REDIS,
    PUBLISHING_MODE: 'disabled',
    PUBLISHING_WORKER_INLINE: 'false',
    ANALYTICS_MODE: 'simulated',
    ANALYTICS_WORKER_INLINE: 'false',
    ANALYTICS_MAX_ATTEMPTS: '3',
    ANALYTICS_RETRY_BASE_SECONDS: '1',
    AUTH_RATE_LIMIT_MAX: '1000',
    // The API only: this check has no use for a web build.
    SERVE_WEB_DIST: '',
  };
  // This process loads the same models (to stage data), so it gets the same settings first.
  // Its own logger stays quiet; the API and worker processes keep logging at info.
  Object.assign(process.env, env, { LOG_LEVEL: 'error' });
  const { createBullQueue, redactRedisUrl } = await import('../src/queue/publishQueue.js');
  const { SocialAccount, AnalyticsSyncRun, AccountInsight, PostInsight } =
    await import('../src/models/index.js');

  console.log(`Redis: ${redactRedisUrl(configured)} (logical database ${DB} for this check)`);
  console.log(`Server: ${product}, Redis API ${field('redis_version')}, ${field('os') ?? ''}`);
  console.log('MongoDB: a temporary private server (not MONGODB_URI)');
  console.log('Meta: SIMULATED. Insights below are demo values; nothing is read from Meta.');

  let api;
  let worker;
  try {
    note('API process (analytics worker and publish worker both off inside it)');
    api = startProcess('api', 'src/server.js', { ...env, PORT: String(apiPort) });
    const base = `http://127.0.0.1:${apiPort}/api/v1`;
    const healthy = await until(
      async () => (await fetch(`${base}/health`).catch(() => null))?.ok,
      60_000,
    );
    if (!check(healthy, 'API starts')) {
      console.log(api.tail());
      return;
    }

    const login = {
      email: `analytics.verify.${randomBytes(4).toString('hex')}@example.com`,
      password: 'Verify-Analytics-2026!',
    };
    const reg = await (
      await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Analytics Verify', ...login }),
      })
    ).json();
    const call = async (method, suffix, body) => {
      const res = await fetch(`${base}${suffix}`, {
        method,
        headers: { Authorization: `Bearer ${reg.accessToken}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON.
      }
      return { status: res.status, body: json, text };
    };
    const ws = (await call('POST', '/workspaces', { name: 'Analytics Verify', timezone: 'UTC' }))
      .body.workspace;
    const A = (suffix = '') => `/workspaces/${ws.id}/analytics${suffix}`;
    check(Boolean(reg.accessToken && ws?.id), 'A SocialHub user and workspace are created');

    // Made-up accounts in the temporary database. Each gets a made-up token, stored encrypted
    // like a real one, so the Redis scan at the end has something to look for.
    await mongoose.connect(mongoUri);
    const wsId = new mongoose.Types.ObjectId(ws.id);
    const userId = new mongoose.Types.ObjectId(reg.user.id);
    const connection = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection('socialconnections').insertOne({
      _id: connection,
      workspace: wsId,
      provider: 'FACEBOOK_LOGIN',
      externalUserId: 'analytics-verify',
      displayName: 'Analytics verify',
      status: 'ACTIVE',
      grantedScopes: [],
      connectedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tag = randomBytes(3).toString('hex');
    const specs = {
      page: ['FACEBOOK_PAGE', `verify-page-${tag}`, 'Verify Page'],
      insta: ['INSTAGRAM_ACCOUNT', `verify-ig-${tag}`, 'verify.instagram'],
      flaky: ['FACEBOOK_PAGE', `sim-flaky-${tag}`, 'Flaky Page (fails once)'],
      down: ['FACEBOOK_PAGE', `sim-down-${tag}`, 'Down Page (always fails)'],
      partial: ['INSTAGRAM_ACCOUNT', `sim-partial-${tag}`, 'partial.instagram'],
    };
    const tokens = [];
    const accounts = {};
    for (const [key, [platform, externalId, name]] of Object.entries(specs)) {
      const token = `EAAVERIFY${randomBytes(16).toString('hex')}`;
      tokens.push(token);
      const account = new SocialAccount({
        workspace: wsId,
        connection,
        platform,
        externalId,
        name,
        username: platform === 'INSTAGRAM_ACCOUNT' ? name : undefined,
        connectionStatus: 'ACTIVE',
        connectedBy: userId,
      });
      account.setAccessToken(token);
      await account.save();
      accounts[key] = account;
    }
    const stored = await mongoose.connection.db
      .collection('socialaccounts')
      .find({ workspace: wsId })
      .project({ accessToken: 1 })
      .toArray();
    const ciphertexts = stored.map((a) => a.accessToken?.ciphertext).filter(Boolean);
    check(ciphertexts.length === 5, 'Five test accounts with encrypted made-up tokens');

    // One simulated published post each for two accounts, so post insights are read too.
    const db = mongoose.connection.db;
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    for (const key of ['page', 'partial']) {
      const job = new mongoose.Types.ObjectId();
      await db.collection('publishjobs').insertOne({
        _id: job,
        workspace: wsId,
        contentPackage: new mongoose.Types.ObjectId(),
        contentVersion: 1,
        content: { caption: 'Verify post', media: [] },
        mode: 'SIMULATED',
        status: 'PUBLISHED',
        destinationCount: 1,
        idempotencyKey: `analytics-verify-${job}`,
        createdBy: userId,
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });
      await db.collection('publishdestinations').insertOne({
        workspace: wsId,
        job,
        contentPackage: new mongoose.Types.ObjectId(),
        socialAccount: accounts[key]._id,
        platform: accounts[key].platform,
        accountName: accounts[key].name,
        state: 'PUBLISHED',
        simulated: true,
        attemptCount: 1,
        maxAttempts: 4,
        queueSeq: 1,
        completedAt: twoDaysAgo,
        attempts: [],
        warnings: [],
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });
    }

    const runsOf = (key) =>
      AnalyticsSyncRun.find({ socialAccount: accounts[key]._id }).sort({ createdAt: 1 }).lean();
    const latest = async (key) => (await runsOf(key)).at(-1);
    const jobs = async () => {
      const out = [];
      for (const key of await admin.keys(`bull:${QUEUE}:*`)) {
        if ((await admin.type(key)) !== 'hash') continue;
        const data = await admin.hget(key, 'data');
        if (data !== null) out.push({ key, data: JSON.parse(data) });
      }
      return out;
    };
    const queueReady = async () =>
      (await call('GET', A('/sync-status'))).body?.analytics?.queue?.status === 'READY';
    const waitFor = (key, statuses, ms = 45_000) =>
      until(async () => statuses.includes((await latest(key))?.status), ms);

    note('Sync requests are queued in Redis (no worker running yet)');
    const ready = await until(queueReady, 15_000);
    const status = (await call('GET', A('/sync-status'))).body?.analytics;
    check(
      ready && status?.mode === 'SIMULATED' && status?.canSync === true,
      'The API reports demo mode and a ready analytics queue',
      `mode ${status?.mode}, queue ${status?.queue?.status}`,
    );
    const first = await call('POST', A('/sync'), {});
    check(
      first.status === 202 &&
        first.body?.source === 'SIMULATED' &&
        first.body?.simulated === true &&
        first.body?.queued?.length === 5,
      'POST /sync queues one run per account, labelled as demo data',
      `HTTP ${first.status}, ${first.body?.queued?.length} queued`,
    );
    const runIds = new Set(
      (await AnalyticsSyncRun.find({ workspace: wsId }).select('_id').lean()).map((r) =>
        String(r._id),
      ),
    );
    const queued = await jobs();
    check(
      queued.length === 5 &&
        queued.every(
          (j) =>
            JSON.stringify(Object.keys(j.data)) === '["destinationId"]' &&
            runIds.has(j.data.destinationId),
        ),
      'Each Redis entry holds only the sync run id',
      `${queued.length} entries; fields: ${[...new Set(queued.flatMap((j) => Object.keys(j.data)))].join(', ')}`,
    );
    const again = await call('POST', A('/sync'), {});
    check(
      again.body?.queued?.length === 0 &&
        again.body?.alreadyRunning?.length === 5 &&
        (await jobs()).length === 5 &&
        (await AnalyticsSyncRun.countDocuments({ workspace: wsId })) === 5,
      'Asking again while they wait adds nothing (no duplicate runs or entries)',
      `HTTP ${again.status}, ${again.body?.alreadyRunning?.length} already running`,
    );

    note('Worker process (analytics only; publishing is off)');
    worker = startProcess('worker', 'scripts/publish-worker.js', env);
    const all = ['page', 'insta', 'flaky', 'down', 'partial'];
    const settled = await until(
      async () => (await Promise.all(all.map(latest))).every((r) => TERMINAL.includes(r?.status)),
      60_000,
    );
    check(settled, 'The worker finishes every run');
    check(
      worker.said('SIMULATION mode') && worker.said('the publish worker was not started'),
      'The worker says it runs demo insights only, and that no publish worker started',
    );
    const page = await latest('page');
    check(
      page.status === 'SUCCEEDED' && page.attemptCount === 1 && page.result?.posts === 1,
      'Facebook Page: succeeded on the first attempt, with its one post',
      `${page.status}, ${page.result?.days} days, ${page.result?.posts} posts`,
    );
    const insta = await latest('insta');
    check(insta.status === 'SUCCEEDED', 'Instagram account: succeeded', insta.status);
    const flaky = await latest('flaky');
    check(
      flaky.status === 'SUCCEEDED' && flaky.attemptCount === 2,
      'A temporary failure is retried after a delay, then succeeds',
      `${flaky.status} after ${flaky.attemptCount} attempts`,
    );
    const down = await latest('down');
    check(
      down.status === 'FAILED' &&
        down.attemptCount === 3 &&
        down.error?.code === 'PLATFORM_UNAVAILABLE',
      'A failure on every attempt stops after the allowed attempts, with a readable reason',
      `${down.status} after ${down.attemptCount} attempts: ${down.error?.code}`,
    );
    const partial = await latest('partial');
    check(
      partial.status === 'PARTIAL' && partial.result?.days > 0 && partial.result?.posts === 0,
      'When post insights fail, the account insights are still kept (PARTIAL)',
      `${partial.status}, ${partial.result?.days} days kept`,
    );

    note('Demo data stays apart from Meta data');
    const demoRows = await AccountInsight.countDocuments({ workspace: wsId, source: 'SIMULATED' });
    const metaRows = await AccountInsight.countDocuments({ workspace: wsId, source: 'META' });
    const metaPosts = await PostInsight.countDocuments({ workspace: wsId, source: 'META' });
    check(
      demoRows > 0 && metaRows === 0 && metaPosts === 0,
      'Every stored insight is marked SIMULATED; none claims to come from Meta',
      `${demoRows} demo day rows, ${metaRows + metaPosts} Meta rows`,
    );
    const demo = await call('GET', A('/overview?source=SIMULATED'));
    const meta = await call('GET', A('/overview?source=META'));
    check(
      demo.body?.insights?.simulated === true &&
        demo.body?.insights?.hasData === true &&
        typeof demo.body?.insights?.metrics?.reach?.value === 'number',
      'The demo view shows the demo insights, labelled simulated',
    );
    check(
      meta.body?.insights?.hasData === false && meta.body?.insights?.metrics?.reach?.value === null,
      'The Meta view shows nothing: demo values never appear as Meta data',
    );
    const syncStatus = await call('GET', A('/sync-status'));
    check(
      syncStatus.status === 200 &&
        !/lockToken|accessToken|EAAVERIFY|ciphertext/.test(syncStatus.text),
      'Sync status answers without tokens or worker locks',
    );

    note('A request made while the worker is stopped waits in Redis');
    const stopped = await worker.stop();
    check(stopped === 0, 'The worker stops cleanly', `exit ${stopped}`);
    const before = page;
    const third = await call('POST', A('/sync'), { accountIds: [String(accounts.page._id)] });
    const waiting = await latest('page');
    await sleep(2000);
    check(
      third.status === 202 &&
        (await latest('page')).status === 'QUEUED' &&
        (await jobs()).some((j) => j.data.destinationId === String(waiting._id)),
      'With no worker, the run stays QUEUED and its entry stays in Redis',
    );
    check(
      waiting.since > before.since && waiting.until === before.until,
      'The next sync only reads the last few days again (incremental)',
      `first ${before.since}…${before.until}, next ${waiting.since}…${waiting.until}`,
    );
    worker = startProcess('worker', 'scripts/publish-worker.js', env);
    check(
      await waitFor('page', ['SUCCEEDED']),
      'A new worker process picks it up from Redis and finishes it',
    );

    note('Recovery (both situations are staged in the temporary database)');
    check((await worker.stop()) === 0, 'The worker stops cleanly');
    const helper = createBullQueue({ redisUrl: REDIS, name: QUEUE });
    await until(() => helper.status() === 'READY', 10_000);
    // 1. Redis lost a waiting entry, and more than two minutes have passed since.
    await call('POST', A('/sync'), { accountIds: [String(accounts.insta._id)] });
    const lost = await latest('insta');
    await helper.remove({ destinationId: lost._id, seq: lost.queueSeq });
    const threeMinutesAgo = new Date(Date.now() - 3 * 60_000);
    await AnalyticsSyncRun.updateOne(
      { _id: lost._id },
      { $set: { enqueuedAt: threeMinutesAgo, dueAt: threeMinutesAgo, createdAt: threeMinutesAgo } },
    );
    // 2. A worker stopped in the middle of a sync: the run is RUNNING and its claim expired.
    await call('POST', A('/sync'), { accountIds: [String(accounts.page._id)] });
    const cut = await latest('page');
    await helper.remove({ destinationId: cut._id, seq: cut.queueSeq });
    await AnalyticsSyncRun.updateOne(
      { _id: cut._id },
      {
        $set: {
          status: 'RUNNING',
          lockToken: 'stopped-worker',
          lockedUntil: new Date(Date.now() - 60_000),
          startedAt: new Date(Date.now() - 11 * 60_000),
          attemptCount: 1,
        },
        $unset: { dueAt: 1 },
      },
    );
    await helper.close();
    const entries = await jobs();
    check(
      !entries.some((j) => [String(lost._id), String(cut._id)].includes(j.data.destinationId)),
      'Staged: neither run has a Redis entry any more',
    );
    worker = startProcess('worker', 'scripts/publish-worker.js', env);
    const recovered =
      (await waitFor('insta', ['SUCCEEDED'])) && (await waitFor('page', ['SUCCEEDED']));
    const lostAfter = await AnalyticsSyncRun.findById(lost._id).lean();
    const cutAfter = await AnalyticsSyncRun.findById(cut._id).lean();
    check(
      recovered && lostAfter.status === 'SUCCEEDED' && lostAfter.queueSeq > lost.queueSeq,
      'The recovery sweep queues a run whose Redis entry was lost, and it finishes',
      `${lostAfter.status}, queue entry ${lost.queueSeq} → ${lostAfter.queueSeq}`,
    );
    check(
      cutAfter.status === 'SUCCEEDED' && cutAfter.attemptCount === 2,
      'The recovery sweep restarts an interrupted run (reading is safe to repeat)',
      `${cutAfter.status} after ${cutAfter.attemptCount} attempts`,
    );

    note('Redis connections dropped while the API and worker run');
    // SocialHub names its connections socialhub-…; BullMQ renames a worker's to bull:<queue>….
    const dropped = await closeClients(
      admin,
      (client) =>
        client.db === String(DB) &&
        (client.name?.startsWith('socialhub-') || client.name?.startsWith('bull:')),
    );
    check(
      dropped.closed >= 2,
      'Only this check’s API and worker connections are closed',
      `${dropped.closed} closed`,
    );
    check(await until(queueReady, 30_000), 'The API reconnects and reports the queue ready');
    const afterDrop = await call('POST', A('/sync'), { accountIds: [String(accounts.flaky._id)] });
    check(afterDrop.status === 202, 'A sync can be asked for again', `HTTP ${afterDrop.status}`);
    const flakyAgain = (await waitFor('flaky', ['SUCCEEDED'])) && (await latest('flaky'));
    check(
      flakyAgain?.attemptCount === 2,
      'The reconnected worker runs it, including a delayed retry',
      `${flakyAgain?.status} after ${flakyAgain?.attemptCount} attempts`,
    );

    note('Nothing secret in Redis');
    let dump = '';
    let keyCount = 0;
    let cursor = '0';
    do {
      const [next, keys] = await admin.scan(cursor, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        keyCount += 1;
        const type = await admin.type(key);
        let value = '';
        if (type === 'string') value = await admin.get(key);
        else if (type === 'hash') value = JSON.stringify(await admin.hgetall(key));
        else if (type === 'list') value = JSON.stringify(await admin.lrange(key, 0, -1));
        else if (type === 'set') value = JSON.stringify(await admin.smembers(key));
        else if (type === 'zset') value = JSON.stringify(await admin.zrange(key, 0, -1));
        else if (type === 'stream') value = JSON.stringify(await admin.xrange(key, '-', '+'));
        dump += `${key}\n${value}\n`;
      }
    } while (cursor !== '0');
    check(
      keyCount > 0 &&
        !tokens.some((t) => dump.includes(t)) &&
        !ciphertexts.some((c) => dump.includes(c)) &&
        !/accessToken|access_token|lockToken/i.test(dump),
      'No token (plain or encrypted) and no worker lock appears in any Redis key',
      `${keyCount} keys read`,
    );
    const everyJob = await jobs();
    check(
      everyJob.length > 0 &&
        everyJob.every((j) => JSON.stringify(Object.keys(j.data)) === '["destinationId"]'),
      'Every entry ever added (retries and recoveries too) holds only a run id',
      `${everyJob.length} entries`,
    );
  } finally {
    const stops = [];
    if (worker) stops.push(worker.stop());
    if (api) stops.push(api.stop());
    await Promise.all(stops);
    if (worker?.running() || api?.running()) {
      check(false, 'API and worker processes stopped');
    }
    await admin.flushdb().catch(() => {});
    check(
      (await admin.dbsize().catch(() => -1)) === 0,
      `Redis database ${DB} emptied: nothing of this check is left`,
    );
    admin.disconnect();
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
  }
}

try {
  await main();
} catch (err) {
  check(false, 'The check ran to the end', err?.message ?? String(err));
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (process.exitCode !== 2) process.exitCode = passed === results.length ? 0 : 1;
process.exit();
