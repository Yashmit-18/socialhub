import mongoose from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountInsight, PostInsight, PublishJob, Workspace } from '../src/models/index.js';
import { setHealthDetailsTokenForTests } from '../src/app.js';
import { api, as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';
import {
  analyticsModels,
  analyticsUrl,
  grant,
  insight,
  makeJob,
  postInsight,
} from './analyticsFixtures.js';

/**
 * Analytics reads through the real API and MongoDB, with deterministic fixtures. No Meta, no
 * Redis: publishing figures come from fixture publishing records, insights from fixture rows
 * (source META or SIMULATED), exactly as the sync would store them.
 */

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const at = (n, time = '10:00:00') => `${day(n)}T${time}Z`;
const RANGE = `?startDate=${day(15)}&endDate=${day(0)}`;

let team;
let ws;
let pageA;
let pageB;
let ig;
let jobs;

const get = (token, path, query = RANGE) => as(token).get(analyticsUrl(ws, `${path}${query}`));

beforeAll(async () => {
  await Promise.all(analyticsModels.map((Model) => Model.init()));
});

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  [pageA, pageB, ig] = seeded.accounts;
  jobs = {
    j1: await makeJob(ws, {
      createdAt: at(10),
      destinations: [
        { account: pageA, state: 'PUBLISHED', completedAt: at(10, '10:01:00'), durationMs: 2000 },
        {
          account: ig,
          state: 'PUBLISHED',
          completedAt: at(10, '10:02:00'),
          durationMs: 4000,
          attempts: 2,
        },
      ],
    }),
    j2: await makeJob(ws, {
      createdAt: at(9),
      status: 'PARTIALLY_PUBLISHED',
      destinations: [
        { account: pageA, state: 'FAILED', completedAt: at(9, '11:00:00'), attempts: 3 },
        { account: pageB, state: 'PUBLISHED', completedAt: at(9, '11:00:00') },
      ],
    }),
    j3: await makeJob(ws, {
      createdAt: at(8),
      simulated: false,
      destinations: [
        {
          account: pageA,
          state: 'PUBLISHED',
          completedAt: at(8, '12:00:00'),
          externalPostId: '123_456',
          externalUrl: 'https://www.facebook.com/123_456',
        },
      ],
    }),
    // Outside the range.
    j4: await makeJob(ws, {
      createdAt: at(30),
      destinations: [{ account: pageA, state: 'PUBLISHED', completedAt: at(30, '10:01:00') }],
    }),
    j5: await makeJob(ws, {
      createdAt: at(5),
      status: 'PROCESSING',
      destinations: [
        { account: pageA, state: 'SCHEDULED' },
        { account: pageB, state: 'CANCELLED' },
      ],
    }),
  };
  await insight(ws, pageA, day(3), { reach: 100, views: 150, followers: 500 });
  await insight(ws, pageA, day(2), { reach: 50, followers: 510 });
  await insight(ws, pageA, day(1), { views: 30 });
  await insight(ws, ig, day(2), { reach: 200, likes: 20, followers: 1000 });
  // Demo data must never show up in Meta figures.
  await insight(ws, pageA, day(2), { reach: 99_999 }, 'SIMULATED');
  await postInsight(ws, jobs.j3.destinations[0], { reach: 400, engagement: 40, likes: 30 });
  await postInsight(ws, jobs.j1.destinations[1], { reach: 10, engagement: 5 }, 'SIMULATED');
});

describe('publishing performance (SocialHub records)', () => {
  it('counts posts and deliveries per state, separately for simulated and live publishing', async () => {
    const res = await get(team.owner.token, '/overview');
    expect(res.status).toBe(200);
    const [live, simulated] = res.body.publishing;
    expect(simulated).toMatchObject({
      mode: 'SIMULATED',
      simulated: true,
      jobs: { total: 3 },
      destinations: {
        total: 6,
        byState: { PUBLISHED: 3, FAILED: 1, SCHEDULED: 1, CANCELLED: 1 },
      },
      // Published ÷ (published + failed): 3 ÷ 4.
      successRate: 75,
      // (2 s + 4 s + 2 s) ÷ 3 published deliveries.
      averageDurationSec: 2.7,
      retries: { destinationsRetried: 2, extraAttempts: 3 },
    });
    expect(simulated.jobs.byStatus).toMatchObject({
      PUBLISHED: 1,
      PARTIALLY_PUBLISHED: 1,
      PROCESSING: 1,
    });
    expect(live).toMatchObject({
      mode: 'LIVE',
      simulated: false,
      jobs: { total: 1 },
      destinations: { total: 1, byState: { PUBLISHED: 1 } },
      successRate: 100,
      averageDurationSec: 2,
    });
  });

  it('applies the date range, platform and account filters', async () => {
    const all = (
      await get(team.owner.token, '/overview', `?startDate=${day(40)}&endDate=${day(0)}`)
    ).body;
    expect(all.publishing.find((m) => m.simulated).jobs.total).toBe(4);

    const instagram = (
      await get(team.owner.token, '/overview', `${RANGE}&platform=INSTAGRAM_ACCOUNT`)
    ).body;
    expect(instagram.publishing).toHaveLength(1);
    expect(instagram.publishing[0].destinations.byState.PUBLISHED).toBe(1);
    expect(instagram.accountCount).toBe(1);

    const one = (await get(team.owner.token, '/overview', `${RANGE}&accountId=${pageB._id}`)).body;
    expect(one.publishing[0].destinations.byState).toMatchObject({ PUBLISHED: 1, CANCELLED: 1 });
  });

  it('has a result per day in the workspace time zone, with true zeros', async () => {
    const res = await get(team.owner.token, '/trends');
    const simulated = res.body.publishing.find((m) => m.simulated);
    expect(simulated.series).toHaveLength(16);
    const point = (n) => simulated.series.find((p) => p.day === day(n));
    expect(point(10)).toMatchObject({ created: 2, published: 2, failed: 0 });
    expect(point(9)).toMatchObject({ created: 2, published: 1, failed: 1 });
    expect(point(4)).toMatchObject({ created: 0, published: 0, failed: 0 });
  });

  it('counts a delivery on the day it happened in the workspace time zone', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { timezone: 'Asia/Kolkata' } });
    // 20:00 UTC is 01:30 the next day in India.
    await makeJob(ws, {
      createdAt: `${day(4)}T20:00:00Z`,
      destinations: [{ account: pageB, state: 'PUBLISHED', completedAt: `${day(4)}T20:05:00Z` }],
    });
    const res = await get(team.owner.token, '/trends', `?startDate=${day(6)}&endDate=${day(1)}`);
    const series = res.body.publishing.find((m) => m.simulated).series;
    expect(series.find((p) => p.day === day(3))).toMatchObject({ created: 1, published: 1 });
    expect(series.find((p) => p.day === day(4))).toMatchObject({ created: 0, published: 0 });
    expect(res.body.range.timeZone).toBe('Asia/Kolkata');
  });
});

describe('insights', () => {
  it('adds up what was reported and leaves the rest unavailable, never 0', async () => {
    const { insights } = (await get(team.owner.token, '/overview')).body;
    expect(insights).toMatchObject({ source: 'META', simulated: false, hasData: true });
    expect(insights.metrics.reach).toEqual({
      value: 350,
      accountsReporting: 2,
      accountsInScope: 3,
    });
    expect(insights.metrics.views).toEqual({
      value: 180,
      accountsReporting: 1,
      accountsInScope: 3,
    });
    // Followers is a level: the latest value per account, then added up.
    expect(insights.metrics.followers).toEqual({
      value: 1510,
      accountsReporting: 2,
      accountsInScope: 3,
    });
    // Growth needs a first and a last value: only Page A has both (510 − 500).
    expect(insights.metrics.followerGrowth).toEqual({
      value: 10,
      accountsReporting: 1,
      accountsInScope: 3,
    });
    expect(insights.metrics.comments).toEqual({
      value: null,
      accountsReporting: 0,
      accountsInScope: 3,
    });
    expect(insights.metrics.saves.value).toBeNull();
    expect(insights.metrics).not.toHaveProperty('avgWatchTimeSec');
  });

  it('keeps demo data apart from Meta data', async () => {
    const meta = (await get(team.owner.token, '/overview')).body.insights;
    expect(meta.metrics.reach.value).toBe(350);
    const demo = (await get(team.owner.token, '/overview', `${RANGE}&source=SIMULATED`)).body
      .insights;
    expect(demo).toMatchObject({ source: 'SIMULATED', simulated: true });
    expect(demo.metrics.reach).toEqual({ value: 99_999, accountsReporting: 1, accountsInScope: 3 });
    expect(demo.metrics.followers.value).toBeNull();
  });

  it('draws a trend with gaps where nothing was reported', async () => {
    const { series } = (await get(team.owner.token, '/trends')).body.insights;
    const point = (n) => series.find((p) => p.day === day(n));
    expect(point(3).metrics.reach).toBe(100);
    expect(point(2).metrics.reach).toBe(250);
    expect(point(2).accountsReporting).toBe(2);
    expect(point(1).metrics.reach).toBeNull();
    expect(point(1).metrics.views).toBe(30);
    expect(point(6).metrics.reach).toBeNull();
  });

  it('reports an empty range honestly', async () => {
    const res = await get(
      team.owner.token,
      '/overview',
      `?startDate=${day(60)}&endDate=${day(50)}`,
    );
    expect(res.body.publishing).toEqual([]);
    expect(res.body.insights.hasData).toBe(false);
    expect(res.body.insights.metrics.reach.value).toBeNull();
  });

  it('compares accounts side by side', async () => {
    const { items } = (await get(team.owner.token, '/accounts')).body;
    expect(items.map((i) => i.account.name)).toEqual(['Page 0', 'Page 1', 'Instagram 0']);
    const a = items[0];
    expect(a.insights.metrics.reach.value).toBe(150);
    expect(a.insights.daysReported).toBe(3);
    // Live and simulated are separate entries, always in the same order (LIVE first).
    expect(a.publishing.map((p) => p.mode)).toEqual(['LIVE', 'SIMULATED']);
    expect(a.publishing[0]).toMatchObject({ simulated: false, total: 1, successRate: 100 });
    expect(a.publishing.find((p) => p.mode === 'SIMULATED').byState).toMatchObject({
      PUBLISHED: 1,
      FAILED: 1,
      SCHEDULED: 1,
    });
    expect(items[1].insights.metrics.reach.value).toBeNull();
    expect(a.sync).toBeNull();
  });
});

describe('posts', () => {
  it('lists published posts with their metrics, unavailable ones as null, paged', async () => {
    const res = await get(team.owner.token, '/posts', `${RANGE}&sortBy=engagement&limit=2`);
    expect(res.body).toMatchObject({ total: 4, pages: 2, page: 1, limit: 2 });
    const [top, next] = res.body.items;
    expect(top).toMatchObject({
      id: jobs.j3.destinations[0].id,
      simulated: false,
      url: 'https://www.facebook.com/123_456',
      metricsSource: 'META',
      engagementRate: 10,
    });
    expect(top.metrics).toMatchObject({ reach: 400, engagement: 40, likes: 30, comments: null });
    // A post without Meta metrics: all null, and a simulated post never has a link.
    expect(next.metricsSource).toBeNull();
    expect(Object.values(next.metrics).every((v) => v === null)).toBe(true);
    expect(next.engagementRate).toBeNull();
    const page2 = await get(
      team.owner.token,
      '/posts',
      `${RANGE}&sortBy=engagement&limit=2&page=2`,
    );
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items.every((p) => p.url === null)).toBe(true);
  });

  it('ranks only posts that have the metric, per source', async () => {
    const meta = (await get(team.owner.token, '/top-posts', `${RANGE}&metric=engagement`)).body;
    expect(meta.items.map((p) => p.id)).toEqual([jobs.j3.destinations[0].id]);
    const demo = (
      await get(team.owner.token, '/top-posts', `${RANGE}&metric=engagement&source=SIMULATED`)
    ).body;
    expect(demo.items.map((p) => p.id)).toEqual([jobs.j1.destinations[1].id]);
    expect(demo.items[0]).toMatchObject({ simulated: true, metricsSource: 'SIMULATED', url: null });
  });
});

describe('validation', () => {
  it.each([
    ['an end before the start', `?startDate=${day(1)}&endDate=${day(5)}`],
    ['only one date', `?startDate=${day(1)}`],
    ['more than 366 days', `?startDate=${day(400)}&endDate=${day(0)}`],
    ['an end in the future', `?startDate=${day(1)}&endDate=${day(-5)}`],
    ['a malformed date', '?startDate=yesterday&endDate=today'],
    ['an unknown platform', '?platform=TIKTOK'],
    ['a malformed account id', '?accountId=1'],
  ])('refuses %s', async (_label, query) => {
    const res = await get(team.owner.token, '/overview', query);
    expect(res.status).toBe(422);
  });

  it('refuses unknown sort fields and oversized pages', async () => {
    expect((await get(team.owner.token, '/posts', '?sortBy=password')).status).toBe(422);
    expect((await get(team.owner.token, '/posts', '?limit=500')).status).toBe(422);
    expect((await get(team.owner.token, '/posts', '?sortBy[$gt]=x')).status).toBe(422);
  });
});

describe('access', () => {
  it('limits an editor to their accounts and leaves out jobs that touch other accounts', async () => {
    await grant(team.editor, [pageA]);
    const overview = (await get(team.editor.token, '/overview')).body;
    expect(overview.accountCount).toBe(1);
    // Only job 3 is entirely on Page A; jobs 1, 2 and 5 also touch other accounts.
    expect(overview.publishing).toHaveLength(1);
    expect(overview.publishing[0]).toMatchObject({ mode: 'LIVE', jobs: { total: 1 } });
    expect(overview.insights.metrics.reach).toEqual({
      value: 150,
      accountsReporting: 1,
      accountsInScope: 1,
    });
    const posts = (await get(team.editor.token, '/posts')).body;
    expect(posts.items.map((p) => p.id)).toEqual([jobs.j3.destinations[0].id]);
    const accounts = (await get(team.editor.token, '/accounts')).body.items;
    expect(accounts.map((a) => a.account.name)).toEqual(['Page 0']);
  });

  it('answers 404 for an account the member may not use, like an unknown one', async () => {
    await grant(team.editor, [pageA]);
    const hidden = await get(team.editor.token, '/overview', `${RANGE}&accountId=${pageB._id}`);
    const unknown = await get(
      team.editor.token,
      '/overview',
      `${RANGE}&accountId=${'a'.repeat(24)}`,
    );
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.message).toBe(unknown.body.error.message);
  });

  it('lets viewers read but not sync', async () => {
    await grant(team.viewer, [], 'ALL');
    expect((await get(team.viewer.token, '/overview')).status).toBe(200);
    expect((await as(team.viewer.token).post(analyticsUrl(ws, '/sync')).send({})).status).toBe(403);
  });

  it('keeps workspaces apart and requires a session', async () => {
    const stranger = await registerUser({ name: 'Stranger' });
    const other = (await createWorkspace(stranger.token, { name: 'Other' })).workspace.id;
    expect((await get(stranger.token, '/overview')).status).toBe(404);
    const own = await as(stranger.token).get(analyticsUrl(other, `/overview${RANGE}`));
    expect(own.status).toBe(200);
    expect(own.body.publishing).toEqual([]);
    expect(own.body.accountCount).toBe(0);
    const cross = await as(stranger.token).get(
      analyticsUrl(other, `/overview${RANGE}&accountId=${pageA._id}`),
    );
    expect(cross.status).toBe(404);
    expect((await api().get(analyticsUrl(ws, '/overview'))).status).toBe(401);
  });
});

describe('the same job visibility as the Publishing screen', () => {
  it('leaves out a post whose draft also targeted an account the member may not use', async () => {
    await grant(team.editor, [pageA]);
    // Job 3 went to Page A only, but its draft had targeted Page B as well.
    await PublishJob.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(jobs.j3.jobId) },
      { $set: { draftTargetAccounts: [pageA._id, pageB._id] } },
    );
    const editorPosts = (await get(team.editor.token, '/posts')).body;
    expect(editorPosts.items).toEqual([]);
    const ownerPosts = (await get(team.owner.token, '/posts')).body;
    expect(ownerPosts.items.map((p) => p.id)).toContain(jobs.j3.destinations[0].id);
  });
});

describe('monitoring details', () => {
  it('include the analytics mode and queue, only with the monitoring token', async () => {
    const token = 'analytics-monitoring-'.padEnd(48, 'x');
    setHealthDetailsTokenForTests(token);
    try {
      const res = await api().get('/api/v1/health/details').set('Authorization', `Bearer ${token}`);
      expect(res.body.analytics).toEqual({
        mode: expect.any(String),
        queue: expect.any(String),
      });
      expect((await api().get('/api/v1/health')).body.analytics).toBeUndefined();
    } finally {
      setHealthDetailsTokenForTests(undefined);
    }
  });
});

describe('removing an account', () => {
  it("deletes that account's insights, and nobody else's", async () => {
    expect(await AccountInsight.countDocuments({ socialAccount: pageA._id })).toBeGreaterThan(0);
    expect(await PostInsight.countDocuments({ socialAccount: pageA._id })).toBeGreaterThan(0);
    const res = await as(team.owner.token).delete(
      `/api/v1/workspaces/${ws}/social-accounts/${pageA._id}`,
    );
    expect(res.status).toBeLessThan(300);
    expect(await AccountInsight.countDocuments({ socialAccount: pageA._id })).toBe(0);
    expect(await PostInsight.countDocuments({ socialAccount: pageA._id })).toBe(0);
    expect(await AccountInsight.countDocuments({ socialAccount: ig._id })).toBe(1);
  });
});

describe('CSV exports', () => {
  it('exports accounts, posts and publishing history under the same rules', async () => {
    const accounts = await get(team.owner.token, '/export', `${RANGE}&type=accounts`);
    expect(accounts.status).toBe(200);
    expect(accounts.headers['content-type']).toMatch(/text\/csv/);
    // Starts with the byte order mark itself (one character), then the header row.
    expect(accounts.text.charCodeAt(0)).toBe(0xfeff);
    const lines = accounts.text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Account,/);
    expect(lines[0]).toContain('Daily reach, added up');
    // Page 1 has no insights: empty cells, not 0.
    expect(lines[2]).toMatch(/^Page 1,Facebook Page,Meta,0,,/);

    const publishing = await get(team.owner.token, '/export', `${RANGE}&type=publishing`);
    expect(publishing.text.trim().split('\r\n')).toHaveLength(1 + 7);

    await grant(team.editor, [pageA]);
    const editorPosts = await get(team.editor.token, '/export', `${RANGE}&type=posts`);
    expect(editorPosts.text.trim().split('\r\n')).toHaveLength(2);
  });

  it('neutralises spreadsheet formulas in captions', async () => {
    await makeJob(ws, {
      createdAt: at(2),
      caption: '=HYPERLINK("http://evil.example","click")',
      destinations: [{ account: pageB, state: 'PUBLISHED', completedAt: at(2, '10:01:00') }],
    });
    const res = await get(team.owner.token, '/export', `${RANGE}&type=posts`);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });

  it('keeps a negative follower growth a number, not neutralised text', async () => {
    // Followers fall from 500 to 497 for Page 1 (which has no other insights) over the range.
    await insight(ws, pageB, day(5), { followers: 500 });
    await insight(ws, pageB, day(1), { followers: 497 });
    const res = await get(team.owner.token, '/export', `${RANGE}&type=accounts`);
    const row = res.text
      .slice(1)
      .split('\r\n')
      .find((line) => line.startsWith('Page 1,'));
    // Followers 497 (latest) and growth -3, as numbers; never the neutralised text '-3.
    expect(row).toMatch(/,497,/);
    expect(row).toMatch(/,-3,/);
    expect(res.text).not.toContain("'-3");
  });
});
