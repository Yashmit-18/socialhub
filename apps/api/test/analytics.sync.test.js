import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUE_STATUS } from '@socialhub/shared';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { AccountInsight } from '../src/models/AccountInsight.js';
import { AnalyticsSyncRun } from '../src/models/AnalyticsSyncRun.js';
import { PostInsight } from '../src/models/PostInsight.js';
import { ActivityLog, SocialAccount, SocialConnection } from '../src/models/index.js';
import { recoverAnalyticsSync } from '../src/modules/analytics/analyticsSync.processor.js';
import { setAnalyticsSettingsForTests } from '../src/modules/analytics/analytics.settings.js';
import { setAnalyticsQueueForTests } from '../src/queue/analyticsQueue.js';
import { as, seedSocialAccounts, seedTeam } from './helpers.js';
import { giveTokens } from './publishFixtures.js';
import {
  analyticsModels,
  analyticsUrl,
  createAnalyticsTestQueue,
  grant,
  makeJob,
} from './analyticsFixtures.js';

/**
 * Insights synchronization: the real API, processor and MongoDB, with a TEST-ONLY queue
 * (analyticsFixtures.js; it proves nothing about Redis) and either the simulated adapter or
 * the Meta adapter talking to a SIMULATED Meta transport. Nothing here contacts Meta or Redis.
 */

const TOKEN = 'page-token-SECRET-0123456789abcdef';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let team;
let ws;
let accounts;
let pageA;
let pageB;
let ig;
let connection;
let queue;

const sync = (token, body = {}) => as(token).post(analyticsUrl(ws, '/sync')).send(body);
const setExternal = async (account, externalId) => {
  await SocialAccount.updateOne({ _id: account._id }, { $set: { externalId } });
  return SocialAccount.findById(account._id);
};

beforeAll(async () => {
  await Promise.all(analyticsModels.map((Model) => Model.init()));
});

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  connection = seeded.connection;
  accounts = seeded.accounts;
  [pageA, pageB, ig] = accounts;
  await giveTokens(accounts, TOKEN);
  queue = createAnalyticsTestQueue();
  setAnalyticsQueueForTests(queue);
  setAnalyticsSettingsForTests({ mode: 'SIMULATED', maxAttempts: 4, retryBaseMs: 1000 });
});

afterEach(() => {
  setAnalyticsQueueForTests(undefined);
  setAnalyticsSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
});

describe('starting a sync', () => {
  it('is refused while analytics are switched off, and writes nothing', async () => {
    setAnalyticsSettingsForTests({ mode: 'DISABLED' });
    const res = await sync(team.owner.token);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ANALYTICS_DISABLED');
    expect(await AnalyticsSyncRun.countDocuments()).toBe(0);
  });

  it.each([
    ['without Redis configured', null, /REDIS_URL is not set/],
    ['while Redis is unreachable', 'down', /cannot be reached/],
  ])(
    'answers 503 QUEUE_UNAVAILABLE %s, with no in-memory fallback',
    async (_label, kind, message) => {
      if (kind === null) setAnalyticsQueueForTests(null);
      else queue.state = QUEUE_STATUS.UNAVAILABLE;
      const res = await sync(team.owner.token);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');
      expect(res.body.error.message).toMatch(message);
      expect(await AnalyticsSyncRun.countDocuments()).toBe(0);
    },
  );

  it('queues one run per account, carrying only the run id', async () => {
    const res = await sync(team.owner.token);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ source: 'SIMULATED', simulated: true });
    expect(res.body.queued).toHaveLength(3);
    expect(res.body.queued[0]).toMatchObject({
      since: daysAgo(29),
      until: today(),
      status: 'QUEUED',
    });
    expect(queue.pending()).toHaveLength(3);
    const runIds = (await AnalyticsSyncRun.find()).map((r) => String(r._id)).sort();
    expect(
      queue
        .pending()
        .map((e) => e.runId)
        .sort(),
    ).toEqual(runIds);
    expect(JSON.stringify(queue.entries)).not.toMatch(/SECRET|Page 0|token/i);
    const entry = await ActivityLog.findOne({ action: 'analytics.sync_requested' });
    expect(entry.metadata).toEqual({ accountCount: 3, simulated: true });
  });

  it('never runs two syncs of one account at once, even for simultaneous requests', async () => {
    const answers = await Promise.all([
      sync(team.owner.token),
      sync(team.owner.token),
      sync(team.admin.token),
    ]);
    const queued = answers.flatMap((r) => r.body.queued);
    const already = answers.flatMap((r) => r.body.alreadyRunning);
    expect(queued).toHaveLength(3);
    expect(already).toHaveLength(6);
    expect(await AnalyticsSyncRun.countDocuments({ active: true })).toBe(3);
  });

  it('lets an editor sync only accounts they may use', async () => {
    await grant(team.editor, [pageA]);
    const other = await sync(team.editor.token, { accountIds: [String(pageB._id)] });
    expect(other.status).toBe(404);
    const own = await sync(team.editor.token);
    expect(own.body.queued.map((r) => r.accountId)).toEqual([String(pageA._id)]);
  });

  it('skips accounts whose login must be reconnected', async () => {
    await SocialAccount.updateOne({ _id: pageB._id }, { $set: { connectionStatus: 'EXPIRED' } });
    const res = await sync(team.owner.token);
    expect(res.body.skipped).toEqual([
      { accountId: String(pageB._id), accountName: 'Page 1', reason: 'NEEDS_RECONNECT' },
    ]);
    expect(res.body.queued).toHaveLength(2);
  });
});

describe('running a simulated sync', () => {
  it('stores demo insights per day and for simulated posts only, labelled SIMULATED', async () => {
    const live = await makeJob(ws, {
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      simulated: false,
      destinations: [
        {
          account: pageA,
          state: 'PUBLISHED',
          completedAt: new Date().toISOString(),
          externalPostId: '1_2',
        },
      ],
    });
    const simulated = await makeJob(ws, {
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      destinations: [{ account: ig, state: 'PUBLISHED', completedAt: new Date().toISOString() }],
    });
    await sync(team.owner.token);
    expect(await queue.deliver()).toEqual(['succeeded', 'succeeded', 'succeeded']);

    const rows = await AccountInsight.find({ socialAccount: pageA._id });
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.source === 'SIMULATED')).toBe(true);
    // Facebook Pages have no saves or profile visits here: absent, not 0.
    expect(rows[0].metrics.saves).toBeUndefined();
    expect(rows[0].metrics.profileVisits).toBeUndefined();
    const igRow = await AccountInsight.findOne({ socialAccount: ig._id });
    expect(typeof igRow.metrics.saves).toBe('number');

    const posts = await PostInsight.find();
    expect(posts.map((p) => String(p.publishDestination))).toEqual([simulated.destinations[0].id]);
    expect(posts[0].source).toBe('SIMULATED');
    expect(await PostInsight.countDocuments({ publishDestination: live.destinations[0]._id })).toBe(
      0,
    );

    const run = await AnalyticsSyncRun.findOne({ socialAccount: pageA._id });
    expect(run).toMatchObject({ status: 'SUCCEEDED', attemptCount: 1 });
    expect(run.active).toBeUndefined();
    expect(run.result.unavailable).toEqual(expect.arrayContaining(['saves', 'profileVisits']));
  });

  it('is deterministic and does not duplicate rows when synced again', async () => {
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    await queue.deliver();
    const first = (
      await AccountInsight.find({ socialAccount: pageA._id }).sort({ day: 1 }).lean()
    ).map((r) => r.metrics);
    const again = await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    // Incremental: from two days before the last synced day.
    expect(again.body.queued[0]).toMatchObject({ since: daysAgo(2), until: today() });
    await queue.deliver();
    const second = (
      await AccountInsight.find({ socialAccount: pageA._id }).sort({ day: 1 }).lean()
    ).map((r) => r.metrics);
    expect(second).toEqual(first);
  });

  it('retries a temporary failure with backoff, then succeeds', async () => {
    // A one-minute first retry, so an early delivery is clearly early (the worker accepts an
    // entry up to 5 s before its time, because queue timers are not exact).
    setAnalyticsSettingsForTests({ mode: 'SIMULATED', maxAttempts: 4, retryBaseMs: 60_000 });
    pageA = await setExternal(pageA, 'sim-flaky-page');
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['retry']);
    const waiting = await AnalyticsSyncRun.findOne();
    expect(waiting).toMatchObject({ status: 'RETRY_SCHEDULED', queueSeq: 2, active: true });
    expect(waiting.error).toMatchObject({ code: 'PLATFORM_UNAVAILABLE', retryable: true });
    expect(queue.pending()[0].delayMs).toBeGreaterThanOrEqual(60_000);
    // Delivered early, nothing happens; on time, it runs.
    expect(await queue.deliver({ now: new Date() })).toEqual(['skipped']);
    await AnalyticsSyncRun.updateOne({}, { $set: { dueAt: new Date() } });
    queue.entries.forEach((e) => (e.delivered = false));
    expect(await queue.deliver()).toContain('succeeded');
    expect((await AnalyticsSyncRun.findOne()).attemptCount).toBe(2);
  });

  it('gives up after the allowed attempts, waiting longer each time', async () => {
    pageA = await setExternal(pageA, 'sim-down-page');
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    const outcomes = [];
    const delays = [];
    for (let i = 0; i < 4; i += 1) {
      await AnalyticsSyncRun.updateOne({}, { $set: { dueAt: new Date() } });
      outcomes.push(...(await queue.deliver()));
      if (queue.pending()[0]) delays.push(queue.pending()[0].delayMs);
    }
    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'failed']);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    const run = await AnalyticsSyncRun.findOne();
    expect(run).toMatchObject({ status: 'FAILED', attemptCount: 4 });
    expect(run.active).toBeUndefined();
    // A finished run frees the account for a new sync.
    expect(
      (await sync(team.owner.token, { accountIds: [String(pageA._id)] })).body.queued,
    ).toHaveLength(1);
  });

  it('never retries a refusal', async () => {
    pageA = await setExternal(pageA, 'sim-fail-page');
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['failed']);
    expect((await AnalyticsSyncRun.findOne()).error.code).toBe('PLATFORM_REJECTED');
  });

  it('keeps account results when post insights fail (PARTIAL)', async () => {
    pageA = await setExternal(pageA, 'sim-partial-page');
    await makeJob(ws, {
      createdAt: new Date().toISOString(),
      destinations: [{ account: pageA, state: 'PUBLISHED', completedAt: new Date().toISOString() }],
    });
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['partial']);
    expect(await AccountInsight.countDocuments({ socialAccount: pageA._id })).toBe(30);
    expect(await PostInsight.countDocuments()).toBe(0);
    expect((await AnalyticsSyncRun.findOne()).status).toBe('PARTIAL');
  });

  it('refuses to finish a run as another source when the server mode changed', async () => {
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    setAnalyticsSettingsForTests({ mode: 'DISABLED' });
    expect(await queue.deliver()).toEqual(['failed']);
    expect((await AnalyticsSyncRun.findOne()).error.code).toBe('LIVE_ANALYTICS_DISABLED');
    expect(await AccountInsight.countDocuments()).toBe(0);
  });
});

describe('recovery', () => {
  it('queues a run again when Redis dropped while it was being created', async () => {
    queue.failEnqueue = true;
    const res = await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(res.status).toBe(202);
    expect(queue.pending()).toHaveLength(0);
    queue.failEnqueue = false;
    const result = await recoverAnalyticsSync({ now: new Date(Date.now() + 3 * 60_000) });
    expect(result.requeued).toBe(1);
    expect(await queue.deliver()).toEqual(['succeeded']);
  });

  it('runs an interrupted sync again (reading is safe to repeat), within the attempt limit', async () => {
    await sync(team.owner.token, { accountIds: [String(pageA._id), String(pageB._id)] });
    queue.entries.forEach((e) => (e.delivered = true));
    const past = new Date(Date.now() - 60_000);
    const [a, b] = await AnalyticsSyncRun.find().sort({ accountName: 1 });
    await AnalyticsSyncRun.updateOne(
      { _id: a._id },
      { $set: { status: 'RUNNING', lockToken: 'x', lockedUntil: past, attemptCount: 1 } },
    );
    await AnalyticsSyncRun.updateOne(
      { _id: b._id },
      { $set: { status: 'RUNNING', lockToken: 'y', lockedUntil: past, attemptCount: 4 } },
    );
    const result = await recoverAnalyticsSync();
    expect(result).toEqual({ requeued: 1, interrupted: 1 });
    expect((await AnalyticsSyncRun.findById(b._id)).error.code).toBe('INTERRUPTED');
    expect(await queue.deliver()).toEqual(['succeeded']);
  });
});

describe('sync status and secrets', () => {
  it('reports the last and last successful sync per account, and never a token', async () => {
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    let status = (await as(team.owner.token).get(analyticsUrl(ws, '/sync-status'))).body;
    expect(status.analytics).toMatchObject({
      mode: 'SIMULATED',
      source: 'SIMULATED',
      canSync: true,
    });
    expect(status.items.find((i) => i.account.id === String(pageA._id))).toMatchObject({
      active: true,
      lastSuccess: null,
    });
    await queue.deliver();
    status = (await as(team.owner.token).get(analyticsUrl(ws, '/sync-status'))).body;
    const item = status.items.find((i) => i.account.id === String(pageA._id));
    expect(item).toMatchObject({
      active: false,
      last: { status: 'SUCCEEDED' },
      lastSuccess: { status: 'SUCCEEDED' },
    });
    const stored = await AnalyticsSyncRun.find().lean();
    for (const value of [status, stored, queue.entries, await AccountInsight.find().lean()]) {
      expect(JSON.stringify(value)).not.toMatch(/SECRET|lockToken/);
    }
  });
});

/* ----------------------------------------------------------------- Meta adapter */

const INSIGHT_SCOPES = [
  'pages_show_list',
  'read_insights',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_insights',
];

/** A SIMULATED Meta: answers the Graph API calls the adapter makes, and records them. */
function fakeMeta(handlers) {
  const calls = [];
  setMetaTransportForTests(async (url) => {
    const u = new URL(url);
    calls.push(u);
    for (const [test, respond] of handlers) {
      if (test(u)) {
        const { status = 200, body } = respond(u);
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: { message: 'Unknown path', code: 100 } }), {
      status: 400,
    });
  });
  return calls;
}

const endTime = (day) =>
  `${new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T08:00:00+0000`;

describe('Meta insights adapter (simulated Meta; live mode only through the test override)', () => {
  beforeEach(async () => {
    setAnalyticsSettingsForTests({ mode: 'LIVE', maxAttempts: 4, retryBaseMs: 1000 });
  });

  it('refuses before calling Meta when the insights permissions were not granted', async () => {
    const calls = fakeMeta([]);
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['failed']);
    const run = await AnalyticsSyncRun.findOne();
    expect(run.source).toBe('META');
    expect(run.error.code).toBe('PERMISSION_MISSING');
    expect(run.error.message).toMatch(/read_insights/);
    expect(calls).toHaveLength(0);
  });

  it('reads Page insights with current metric names, by reported day, and leaves the rest unavailable', async () => {
    await SocialConnection.updateOne(
      { _id: connection._id },
      { $set: { grantedScopes: INSIGHT_SCOPES } },
    );
    const d1 = daysAgo(2);
    const d2 = daysAgo(1);
    const calls = fakeMeta([
      [
        (u) => u.pathname.endsWith(`/${pageA.externalId}/insights`),
        (u) => {
          const metrics = u.searchParams.get('metric').split(',');
          // Meta refuses the whole request if one metric is retired (error 100).
          if (metrics.length > 1 && metrics.includes('page_views_total')) {
            return { status: 400, body: { error: { message: 'Invalid metric', code: 100 } } };
          }
          if (metrics.includes('page_views_total')) {
            return { status: 400, body: { error: { message: 'Invalid metric', code: 100 } } };
          }
          const values = {
            page_media_view: [300, 320],
            page_total_media_view_unique: [120, 130],
            page_post_engagements: [9, 11],
            page_follows: [500, 502],
          };
          return {
            body: {
              data: metrics.map((name) => ({
                name,
                period: 'day',
                values: [
                  { value: values[name][0], end_time: endTime(d1) },
                  { value: values[name][1], end_time: endTime(d2) },
                ],
              })),
            },
          };
        },
      ],
    ]);
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['succeeded']);
    const rows = await AccountInsight.find({ socialAccount: pageA._id }).sort({ day: 1 }).lean();
    expect(rows.map((r) => r.day)).toEqual([d1, d2]);
    expect(rows[0]).toMatchObject({
      source: 'META',
      metrics: { views: 300, reach: 120, engagement: 9, followers: 500 },
    });
    expect(rows[0].metrics.profileVisits).toBeUndefined();
    const run = await AnalyticsSyncRun.findOne();
    expect(run.result.unavailable).toEqual(['profileVisits']);
    // Official host, versioned path, token only as a query parameter with its app-secret proof.
    expect(
      calls.every(
        (u) => u.origin === 'https://graph.facebook.com' && u.pathname.startsWith('/v27.0/'),
      ),
    ).toBe(true);
    expect(calls.every((u) => u.searchParams.get('appsecret_proof'))).toBe(true);
    expect(calls[0].searchParams.get('period')).toBe('day');
    expect(JSON.stringify(await AnalyticsSyncRun.find().lean())).not.toMatch(/SECRET/);
  });

  it('reads Instagram insights one day at a time, and followers for today only', async () => {
    await SocialConnection.updateOne(
      { _id: connection._id },
      { $set: { grantedScopes: INSIGHT_SCOPES } },
    );
    await AnalyticsSyncRun.create({
      workspace: ws,
      socialAccount: ig._id,
      platform: ig.platform,
      accountName: ig.name,
      source: 'META',
      status: 'SUCCEEDED',
      since: daysAgo(5),
      until: daysAgo(1),
      maxAttempts: 4,
    });
    const calls = fakeMeta([
      [
        (u) => u.pathname.endsWith(`/${ig.externalId}/insights`),
        (u) => ({
          body: {
            data: [
              { name: 'reach', period: 'day', total_value: { value: 40 } },
              {
                name: 'likes',
                period: 'day',
                total_value: { value: Number(u.searchParams.get('since')) % 7 },
              },
            ],
          },
        }),
      ],
      [
        (u) => u.pathname.endsWith(`/${ig.externalId}`),
        () => ({ body: { followers_count: 1234, id: ig.externalId } }),
      ],
    ]);
    await sync(team.owner.token, { accountIds: [String(ig._id)] });
    expect(await queue.deliver()).toEqual(['succeeded']);
    const insightCalls = calls.filter((u) => u.pathname.endsWith('/insights'));
    // Incremental range: 3 days (two days before the last synced day up to today).
    expect(insightCalls).toHaveLength(4);
    expect(insightCalls.every((u) => u.searchParams.get('metric_type') === 'total_value')).toBe(
      true,
    );
    const rows = await AccountInsight.find({ socialAccount: ig._id }).sort({ day: 1 }).lean();
    expect(rows.at(-1).metrics.followers).toBe(1234);
    expect(rows[0].metrics.followers).toBeUndefined();
    expect(rows[0].metrics.views).toBeUndefined();
  });

  it('reads post insights only for real posts, never for simulated ones', async () => {
    await SocialConnection.updateOne(
      { _id: connection._id },
      { $set: { grantedScopes: INSIGHT_SCOPES } },
    );
    const real = await makeJob(ws, {
      createdAt: new Date().toISOString(),
      simulated: false,
      destinations: [
        {
          account: pageA,
          state: 'PUBLISHED',
          completedAt: new Date().toISOString(),
          externalPostId: '111_222',
        },
      ],
    });
    await makeJob(ws, {
      createdAt: new Date().toISOString(),
      destinations: [{ account: pageA, state: 'PUBLISHED', completedAt: new Date().toISOString() }],
    });
    const calls = fakeMeta([
      [(u) => u.pathname.endsWith(`/${pageA.externalId}/insights`), () => ({ body: { data: [] } })],
      [
        (u) => u.pathname.endsWith('/111_222/insights'),
        () => ({
          body: {
            data: [
              { name: 'post_media_view', period: 'lifetime', values: [{ value: 900 }] },
              {
                name: 'post_total_media_view_unique',
                period: 'lifetime',
                values: [{ value: 700 }],
              },
            ],
          },
        }),
      ],
      [
        (u) => u.pathname.endsWith('/111_222'),
        () => ({
          body: {
            reactions: { summary: { total_count: 44 } },
            comments: { summary: { total_count: 5 } },
            shares: { count: 3 },
          },
        }),
      ],
    ]);
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['succeeded']);
    const posts = await PostInsight.find().lean();
    expect(posts).toHaveLength(1);
    expect(String(posts[0].publishDestination)).toBe(real.destinations[0].id);
    expect(posts[0]).toMatchObject({
      source: 'META',
      externalPostId: '111_222',
      metrics: { views: 900, reach: 700, likes: 44, comments: 5, shares: 3 },
    });
    // Facebook reports no single "engagement" for a post: left unavailable, not summed up.
    expect(posts[0].metrics.engagement).toBeUndefined();
    expect(calls.some((u) => /\/[a-f0-9]{24}/.test(u.pathname))).toBe(false);
  });

  it('waits after a rate limit and stops on an expired token', async () => {
    await SocialConnection.updateOne(
      { _id: connection._id },
      { $set: { grantedScopes: INSIGHT_SCOPES } },
    );
    fakeMeta([
      [
        () => true,
        () => ({
          status: 400,
          body: { error: { message: 'User request limit reached', code: 32 } },
        }),
      ],
    ]);
    await sync(team.owner.token, { accountIds: [String(pageA._id)] });
    expect(await queue.deliver()).toEqual(['retry']);
    const waiting = await AnalyticsSyncRun.findOne();
    expect(waiting.error.code).toBe('RATE_LIMITED');
    expect(waiting.dueAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    fakeMeta([
      [
        () => true,
        () => ({ status: 401, body: { error: { message: 'Session has expired', code: 190 } } }),
      ],
    ]);
    await AnalyticsSyncRun.updateOne({}, { $set: { dueAt: new Date() } });
    queue.entries.forEach((e) => (e.delivered = false));
    expect(await queue.deliver()).toContain('failed');
    const failed = await AnalyticsSyncRun.findOne();
    expect(failed.error.code).toBe('NEEDS_RECONNECT');
    expect(JSON.stringify(failed)).not.toMatch(/SECRET/);
  });
});
