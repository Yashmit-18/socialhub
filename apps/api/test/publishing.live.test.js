import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import {
  PublishDestination,
  PublishJob,
  SocialConnection,
  Workspace,
} from '../src/models/index.js';
import { adapterFor } from '../src/modules/publishing/adapters/index.js';
import { retryDelayMs } from '../src/modules/publishing/backoff.js';
import { sanitizeProviderText } from '../src/modules/publishing/publishError.js';
import {
  publishingSettings,
  setPublishingSettingsForTests,
} from '../src/modules/publishing/publishing.settings.js';
import {
  createBullQueue,
  redactRedisUrl,
  setPublishQueueForTests,
} from '../src/queue/publishQueue.js';
import { getStorage, setStorageForTests } from '../src/storage/index.js';
import { as, seedSocialAccounts, seedTeam } from './helpers.js';
import { jpegBytes, mp4Bytes, pngBytes } from './mediaFixtures.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish as publishRequest,
  publishUrl,
} from './publishFixtures.js';

/**
 * These tests are about what happens to a CONFIRMED real post, so every request carries the
 * person's confirmation. Requests without it are tested in publishing.confirmation.test.js.
 */
const publish = (token, workspaceId, body) =>
  publishRequest(token, workspaceId, { confirmRealPost: true, ...body });

/**
 * The REAL Facebook and Instagram adapters, driven against a SIMULATED Meta (a fetch
 * stand-in defined below). These tests switch the server to LIVE through the test-only
 * override and the test workspace to LIVE directly in the database (the API route for that
 * is tested in publishing.mode.test.js).
 *
 * They prove how the adapters build requests and react to answers. They do NOT prove that
 * Meta accepts those requests: nothing here has run against the real Graph API.
 */

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'page-token-SECRET-0123456789abcdef';
let team;
let ws;
let queue;
let pages;
let instagram;
let meta;

/** Simulated Meta: records calls and answers from `routes` ("METHOD /path-suffix"). */
function createFakeMeta() {
  const fake = {
    calls: [],
    routes: {},
    counter: 100,
    transport: async (url, init) => {
      const target = new URL(url);
      const form = Object.fromEntries(new URLSearchParams(init.body ?? ''));
      const call = {
        method: init.method,
        host: target.host,
        path: target.pathname.replace(/^\/v\d+\.\d+/, ''),
        query: Object.fromEntries(target.searchParams),
        form,
      };
      fake.calls.push(call);
      const key = Object.keys(fake.routes).find(
        (route) =>
          route === `${call.method} ${call.path}` ||
          (route.endsWith('*') && `${call.method} ${call.path}`.startsWith(route.slice(0, -1))),
      );
      const answer = key ? fake.routes[key](call) : { id: String((fake.counter += 1)) };
      if (answer instanceof Error) throw answer;
      // `{ json, status }` answers with exactly that body (for bodies with a "status" field).
      if (answer.json) {
        return new Response(JSON.stringify(answer.json), {
          status: answer.status ?? 200,
          headers: answer.headers,
        });
      }
      const { status = 200, headers, ...body } = answer;
      return new Response(JSON.stringify(body), { status, headers });
    },
    posts: (suffix) => fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix)),
  };
  return fake;
}

/** The local driver, presented as public HTTPS storage (what S3 with a public URL provides). */
function usePublicStorage() {
  const local = getStorage();
  setStorageForTests({
    ...local,
    name: local.name,
    publicUrls: true,
    publicUrl: (key) => `https://cdn.example.test/${key}`,
  });
}

const stored = (jobId) => PublishDestination.find({ job: jobId }).sort({ accountName: 1 });

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  pages = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  instagram = seeded.accounts.filter((a) => a.platform === 'INSTAGRAM_ACCOUNT');
  await giveTokens(seeded.accounts, TOKEN);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests({
    mode: 'LIVE',
    maxAttempts: 3,
    retryBaseMs: 30_000,
    retryMaxMs: 900_000,
  });
  await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
  meta = createFakeMeta();
  // Instagram's 24-hour limit, checked before every new container: plenty left by default.
  meta.routes['GET /fb-user-1-ig-0/content_publishing_limit'] = () => ({
    data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }],
  });
  setMetaTransportForTests(meta.transport);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
  setMetaSettingsForTests(undefined);
  setStorageForTests(undefined);
});

describe('real publishing is never on by default', () => {
  it('only PUBLISHING_MODE=live makes it available; nothing else does', () => {
    const base = {
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(loadConfig(base).publishing.mode).toBe('DISABLED');
    expect(loadConfig({ ...base, PUBLISHING_MODE: 'simulated' }).publishing.mode).toBe('SIMULATED');
    expect(loadConfig({ ...base, PUBLISHING_MODE: 'live' }).publishing.mode).toBe('LIVE');
    for (const value of ['LIVE', 'real', 'production', 'enabled', 'true', 'on']) {
      expect(() => loadConfig({ ...base, PUBLISHING_MODE: value })).toThrow(/PUBLISHING_MODE/);
    }
    expect(() =>
      loadConfig({ ...base, PUBLISHING_MODE: 'simulated', NODE_ENV: 'production' }),
    ).toThrow(/development only/);
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
    expect(loadConfig({ ...base, REDIS_URL: 'redis://127.0.0.1:6379' }).publishing.redisUrl).toBe(
      'redis://127.0.0.1:6379',
    );
  });

  it('real Meta analytics are off unless ANALYTICS_MODE=live, which is never implied', () => {
    const base = {
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(loadConfig(base).analytics.mode).toBe('DISABLED');
    expect(loadConfig({ ...base, ANALYTICS_MODE: 'simulated' }).analytics.mode).toBe('SIMULATED');
    expect(loadConfig({ ...base, ANALYTICS_MODE: 'live' }).analytics.mode).toBe('LIVE');
    // Real publishing does not switch real analytics on, and vice versa.
    expect(loadConfig({ ...base, PUBLISHING_MODE: 'live' }).analytics.mode).toBe('DISABLED');
    expect(loadConfig({ ...base, ANALYTICS_MODE: 'live' }).publishing.mode).toBe('DISABLED');
    for (const value of ['LIVE', 'real', 'enabled', 'true']) {
      expect(() => loadConfig({ ...base, ANALYTICS_MODE: value })).toThrow(/ANALYTICS_MODE/);
    }
  });

  it('refuses the test overrides outside the test environment', () => {
    const script = `
      const s = await import('./src/modules/publishing/publishing.settings.js');
      const a = await import('./src/modules/publishing/adapters/simulated.js');
      const q = await import('./src/queue/publishQueue.js');
      let refused = 0;
      for (const fn of [() => s.setPublishingSettingsForTests({ mode: 'LIVE' }), () => a.setSimulatedBehaviourForTests(() => {}), () => q.setPublishQueueForTests({})]) {
        try { fn(); } catch { refused += 1; }
      }
      console.log(refused, s.publishingSettings().mode);
      process.exit(0);
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: apiDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        PUBLISHING_MODE: '',
        REDIS_URL: '',
      },
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('3 DISABLED');
  });

  it('the test environment itself starts with publishing disabled', () => {
    setPublishingSettingsForTests(undefined);
    expect(publishingSettings().mode).toBe('DISABLED');
  });

  it('only a LIVE job can get a real adapter', () => {
    expect(adapterFor('SIMULATED', 'FACEBOOK_PAGE').simulated).toBe(true);
    expect(adapterFor('SIMULATED', 'INSTAGRAM_ACCOUNT').simulated).toBe(true);
    expect(adapterFor('DISABLED', 'FACEBOOK_PAGE')).toBeNull();
    expect(adapterFor('LIVE', 'FACEBOOK_PAGE').simulated).toBe(false);
  });
});

describe('local media can never be sent to real publishing', () => {
  it('rejects the job when media is on local storage, and never calls Meta', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages, media: 'image' });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.content).toMatch(
      /stored where Facebook and Instagram cannot fetch them/,
    );
    expect(await PublishJob.countDocuments()).toBe(0);
    expect(meta.calls).toHaveLength(0);
  });

  it('fails the destination at publish time if storage stopped being public, without calling Meta', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    setStorageForTests(undefined); // back to local disk
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error).toMatchObject({ code: 'MEDIA_NOT_PUBLIC', retryable: false });
    expect(meta.calls).toHaveLength(0);
  });

  it('rejects public storage that is not HTTPS', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    const local = getStorage();
    setStorageForTests({
      ...local,
      publicUrls: true,
      publicUrl: (key) => `http://cdn.example.test/${key}`,
    });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(meta.calls).toHaveLength(0);
  });

  it('fails without calling Meta when the Meta app is not configured', async () => {
    setMetaSettingsForTests({ facebook: null });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('LIVE_PUBLISHING_DISABLED');
    expect(meta.calls).toHaveLength(0);
  });
});

describe('Facebook Page adapter (simulated Meta)', () => {
  it('publishes a text post to the Page feed with the Page token', async () => {
    const draft = await createDraft(team.owner.token, ws, {
      accounts: [pages[0]],
      hashtags: ['news'],
    });
    // The post is read back (GET) for its real link once Meta returned its id.
    meta.routes['GET /101'] = () => ({
      id: '101',
      permalink_url: 'https://www.facebook.com/acme/posts/pfbid0101',
    });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob).toMatchObject({ mode: 'LIVE', simulated: false });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls).toHaveLength(2);
    const [call, readBack] = meta.calls;
    expect(call).toMatchObject({
      method: 'POST',
      host: 'graph.facebook.com',
      path: '/fb-user-1-page-0/feed',
    });
    expect(call.form.message).toBe('Hello from the test\n\n#news');
    expect(call.query.access_token).toBe(`${TOKEN}-fb-user-1-page-0`);
    expect(call.query.appsecret_proof).toMatch(/^[a-f0-9]{64}$/);
    expect(readBack).toMatchObject({ method: 'GET', path: '/101' });
    expect(readBack.query.fields).toBe('permalink_url');
    expect(readBack.query.access_token).toBe(`${TOKEN}-fb-user-1-page-0`);

    const job = (await as(team.owner.token).get(publishUrl(ws, `/${res.body.publishJob.id}`))).body
      .publishJob;
    expect(job.destinations[0]).toMatchObject({
      state: 'PUBLISHED',
      simulated: false,
      externalPostId: '101',
      externalUrl: 'https://www.facebook.com/acme/posts/pfbid0101',
    });
    expect(JSON.stringify(job)).not.toContain(TOKEN);
  });

  it('publishes one image through /photos and several through unpublished photos + feed', async () => {
    const single = await createDraft(team.owner.token, ws, {
      accounts: [pages[0]],
      media: 'image',
    });
    const multi = await createDraft(team.owner.token, ws, {
      accounts: [pages[1]],
      media: ['image', 'image'],
    });
    usePublicStorage();
    await publish(team.owner.token, ws, { contentPackageId: single.id });
    await publish(team.owner.token, ws, { contentPackageId: multi.id });
    expect(await queue.deliver()).toEqual(['published', 'published']);

    const one = meta.calls.filter((c) => c.path.startsWith('/fb-user-1-page-0'));
    expect(one).toHaveLength(1);
    expect(one[0].path).toBe('/fb-user-1-page-0/photos');
    expect(one[0].form.url).toMatch(/^https:\/\/cdn\.example\.test\/workspaces\//);
    expect(one[0].form.caption).toBe('Hello from the test');

    const many = meta.calls.filter((c) => c.path.startsWith('/fb-user-1-page-1'));
    expect(many.map((c) => c.path)).toEqual([
      '/fb-user-1-page-1/photos',
      '/fb-user-1-page-1/photos',
      '/fb-user-1-page-1/feed',
    ]);
    expect(many[0].form.published).toBe('false');
    expect(JSON.parse(many[2].form['attached_media[0]'])).toEqual({
      media_fbid: many.length ? expect.any(String) : '',
    });
    expect(many[2].form['attached_media[1]']).toBeDefined();
  });

  it('publishes a video through /videos, and only once Facebook says it is processed', async () => {
    let checks = 0;
    meta.routes['GET /101'] = (call) => {
      checks += 1;
      expect(call.query.fields).toBe('status,permalink_url');
      return checks < 2
        ? {
            json: {
              status: { video_status: 'processing', processing_phase: { status: 'in_progress' } },
            },
          }
        : {
            json: {
              status: {
                video_status: 'ready',
                processing_phase: { status: 'complete' },
                publishing_phase: { status: 'complete', publish_status: 'published' },
              },
              permalink_url: '/page/videos/101/',
            },
          };
    };
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'video' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls[0].path).toBe('/fb-user-1-page-0/videos');
    expect(meta.calls[0].form.file_url).toMatch(/\.mp4$/);
    expect(checks).toBe(2);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination).toMatchObject({
      state: 'PUBLISHED',
      externalPostId: '101',
      externalUrl: 'https://www.facebook.com/page/videos/101/',
    });
    expect(destination.providerState).toBeUndefined();
  });

  it('maps Meta errors: expired token, permission, rejection, rate limit, outage', async () => {
    const cases = [
      [
        {
          status: 400,
          error: { code: 190, message: 'Error validating access token', error_subcode: 463 },
        },
        'failed',
        'ACCOUNT_NEEDS_RECONNECT',
      ],
      [
        { status: 403, error: { code: 200, message: 'Permissions error' } },
        'failed',
        'PERMISSION_DENIED',
      ],
      [
        {
          status: 400,
          error: { code: 100, message: 'Invalid parameter access_token=EAAsecretsecretsecret123' },
        },
        'failed',
        'PLATFORM_REJECTED',
      ],
      [
        { status: 400, error: { code: 32, message: 'Page request limit reached' } },
        'retry',
        'RATE_LIMITED',
      ],
      [
        { status: 503, error: { code: 2, message: 'Service temporarily unavailable' } },
        'retry',
        'PLATFORM_UNAVAILABLE',
      ],
    ];
    for (const [answer, outcome, code] of cases) {
      meta.routes['POST /fb-user-1-page-0/feed'] = () => answer;
      const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
      const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
      expect(await queue.deliver()).toEqual([outcome]);
      const [destination] = await stored(res.body.publishJob.id);
      expect(destination.error.code).toBe(code);
      expect(destination.externalPostId).toBeUndefined();
      expect(destination.error.message).not.toMatch(/EAAsecret|SECRET/);
      if (outcome === 'retry') {
        await as(team.owner.token).post(publishUrl(ws, `/${res.body.publishJob.id}/cancel`));
      }
    }
  });

  it('never retries by itself when the publishing call got no answer (the post may exist)', async () => {
    meta.routes['POST /fb-user-1-page-0/feed'] = () => new Error('socket hang up');
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
    expect(queue.pending()).toHaveLength(0);
    expect(meta.posts('/feed')).toHaveLength(1);
  });

  it('one Page failing leaves the other published', async () => {
    meta.routes['POST /fb-user-1-page-1/feed'] = () => ({
      status: 400,
      error: { code: 100, message: 'Nope' },
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const job = await PublishJob.findById(res.body.publishJob.id);
    expect(job.status).toBe('PARTIALLY_PUBLISHED');
  });
});

describe('Instagram adapter (simulated Meta)', () => {
  const ig = '/fb-user-1-ig-0';

  it('creates a container, waits for it, then publishes it', async () => {
    let polls = 0;
    meta.routes['GET /*'] = (call) =>
      call.query.fields === 'permalink'
        ? { permalink: 'https://www.instagram.com/p/abc/' }
        : { status_code: (polls += 1) < 3 ? 'IN_PROGRESS' : 'FINISHED' };
    const draft = await createDraft(team.owner.token, ws, {
      accounts: instagram,
      media: 'video',
      caption: 'Reel',
    });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);

    const posts = meta.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual([`${ig}/media`, `${ig}/media_publish`]);
    expect(posts[0].form).toMatchObject({ media_type: 'REELS', caption: 'Reel' });
    expect(posts[0].form.video_url).toMatch(/^https:\/\/cdn\.example\.test\//);
    expect(posts[1].form.creation_id).toBe('101');
    expect(polls).toBe(3);
    // Reached through a Facebook Page, so the Facebook graph host is used.
    expect(meta.calls.every((c) => c.host === 'graph.facebook.com')).toBe(true);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination).toMatchObject({
      state: 'PUBLISHED',
      externalPostId: '102',
      externalUrl: 'https://www.instagram.com/p/abc/',
    });
    expect(destination.providerState).toBeUndefined();
  });

  it('builds a carousel from several files', async () => {
    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    const draft = await createDraft(team.owner.token, ws, {
      accounts: instagram,
      media: ['image', 'image'],
    });
    usePublicStorage();
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    const containers = meta.posts('/media');
    expect(containers).toHaveLength(3);
    expect(containers[0].form.is_carousel_item).toBe('true');
    expect(containers[2].form).toMatchObject({ media_type: 'CAROUSEL', children: '101,102' });
  });

  it('uses graph.instagram.com for accounts connected with Instagram Login', async () => {
    await SocialConnection.updateMany({}, { $set: { provider: 'INSTAGRAM_LOGIN' } });
    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls.every((c) => c.host === 'graph.instagram.com')).toBe(true);
    expect(meta.calls[0].query.appsecret_proof).toBeUndefined();
  });

  it('uses graph.facebook.com with appsecret_proof for accounts connected with Unified Login', async () => {
    await SocialConnection.updateMany({}, { $set: { provider: 'INSTAGRAM_UNIFIED_LOGIN' } });
    setMetaSettingsForTests({
      instagramUnified: {
        appId: process.env.META_APP_ID,
        appSecret: process.env.META_APP_SECRET,
        configId: '3333333333',
        redirectUri: 'http://localhost:4000/api/v1/oauth/instagram-unified/callback',
      },
    });
    meta.routes['GET /*'] = (call) =>
      call.query.fields === 'permalink'
        ? { permalink: 'https://www.instagram.com/p/unified/' }
        : { status_code: 'FINISHED' };
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /fb-user-1-ig-0/content_publishing_limit',
      'POST /fb-user-1-ig-0/media',
      'GET /101',
      'POST /fb-user-1-ig-0/media_publish',
      'GET /102',
    ]);
    expect(meta.calls.every((c) => c.host === 'graph.facebook.com')).toBe(true);
    expect(meta.calls.every((c) => c.query.appsecret_proof)).toBe(true);
    expect(meta.posts('/media')[0].form.image_url).toMatch(/^https:\/\/cdn\.example\.test\//);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination).toMatchObject({
      state: 'PUBLISHED',
      externalPostId: '102',
      externalUrl: 'https://www.instagram.com/p/unified/',
    });
  });

  it('refuses an expired Unified Login token without calling Meta', async () => {
    await SocialConnection.updateMany(
      {},
      {
        $set: {
          provider: 'INSTAGRAM_UNIFIED_LOGIN',
          tokenExpiresAt: new Date(Date.now() - 60_000),
        },
      },
    );
    setMetaSettingsForTests({
      instagramUnified: {
        appId: process.env.META_APP_ID,
        appSecret: process.env.META_APP_SECRET,
        configId: '3333333333',
        redirectUri: 'http://localhost:4000/api/v1/oauth/instagram-unified/callback',
      },
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('ACCOUNT_NEEDS_RECONNECT');
    expect(meta.calls).toHaveLength(0);
  });

  it('resumes with the saved container on a retry instead of creating another one', async () => {
    let ready = false;
    meta.routes['GET /*'] = () => ({ status_code: ready ? 'FINISHED' : 'IN_PROGRESS' });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'video' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['retry']);
    let [destination] = await stored(res.body.publishJob.id);
    expect(destination.providerState).toEqual({ containerId: '101' });
    ready = true;
    expect(await queue.deliver({ now: destination.nextAttemptAt })).toEqual(['published']);
    expect(meta.posts('/media')).toHaveLength(1);
    expect(meta.posts('/media_publish')).toHaveLength(1);
    [destination] = await stored(res.body.publishJob.id);
    expect(destination.attemptCount).toBe(2);
  });

  it('fails when Instagram cannot process the media', async () => {
    meta.routes['GET /*'] = () => ({ status_code: 'ERROR' });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('PLATFORM_REJECTED');
    expect(meta.posts('/media_publish')).toHaveLength(0);
  });
});

describe('real publishing needs both switches, and never falls back silently', () => {
  it('a workspace that did not switch to live gets simulated jobs on a LIVE server; Meta is never called', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob).toMatchObject({ mode: 'SIMULATED', simulated: true });
    expect(await queue.deliver()).toEqual(['published']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.simulated).toBe(true);
    expect(destination.externalPostId).toBeUndefined();
    expect(meta.calls).toHaveLength(0);
  });

  it('a LIVE job is refused (not simulated) when the workspace switches back before it is sent', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob.mode).toBe('LIVE');
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error).toMatchObject({ code: 'LIVE_PUBLISHING_DISABLED', retryable: false });
    expect(destination.error.message).toMatch(/switched off for this workspace/);
    expect(destination.simulated).toBe(false);
    expect(meta.calls).toHaveLength(0);
    const retry = await as(team.owner.token)
      .post(publishUrl(ws, `/${res.body.publishJob.id}/destinations/${destination._id}/retry`))
      .send({});
    expect(retry.status).toBe(409);
    expect(retry.body.error.details.reason).toBe('MODE_CHANGED');
  });

  it('a LIVE job is refused when the server stops offering real publishing', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    setPublishingSettingsForTests({ mode: 'SIMULATED', maxAttempts: 3 });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('LIVE_PUBLISHING_DISABLED');
    expect(destination.error.message).toMatch(/switched off on this server/);
    expect(meta.calls).toHaveLength(0);
  });

  it('a simulated job stays simulated after the workspace switches to live', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
    expect(await queue.deliver()).toEqual(['published']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.simulated).toBe(true);
    expect(meta.calls).toHaveLength(0);
  });
});

describe('files are checked against each platform before anything is sent', () => {
  it('refuses a PNG for Instagram (JPEG only) but accepts it for a Facebook Page', async () => {
    usePublicStorage();
    const png = { bytes: pngBytes(), fileName: 'art.png', mimeType: 'image/png' };
    const toInstagram = await createDraft(team.owner.token, ws, {
      accounts: instagram,
      media: png,
    });
    const refused = await publish(team.owner.token, ws, { contentPackageId: toInstagram.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.fields.content).toMatch(/PNG; Instagram accepts JPEG images/);

    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    const toPage = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: png });
    expect((await publish(team.owner.token, ws, { contentPackageId: toPage.id })).status).toBe(201);
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.posts('/photos')).toHaveLength(1);
  });

  it('refuses an Instagram image outside the 4:5 to 1.91:1 aspect ratio', async () => {
    usePublicStorage();
    const tall = { bytes: jpegBytes(1080, 1920), fileName: 'tall.jpg', mimeType: 'image/jpeg' };
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: tall });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.content).toMatch(/1080×1920.*aspect ratio/);
    expect(meta.calls).toHaveLength(0);
  });

  it('refuses a reel shorter than 3 seconds', async () => {
    usePublicStorage();
    const short = {
      bytes: mp4Bytes({ durationSec: 2 }),
      fileName: 'short.mp4',
      mimeType: 'video/mp4',
      kind: 'VIDEO',
    };
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: short });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.content).toMatch(/shorter than 3 seconds/);
  });

  it('local storage behind a public HTTPS address counts as public; localhost never does', async () => {
    const { isPublicHttpsUrl } = await import('../src/storage/localStorage.js');
    expect(isPublicHttpsUrl('https://example-tunnel.trycloudflare.com/api/v1')).toBe(true);
    expect(isPublicHttpsUrl('https://social.example.com/api/v1')).toBe(true);
    for (const url of [
      'http://example.com/api/v1',
      'https://localhost:4000/api/v1',
      'https://127.0.0.1/api/v1',
      'https://192.168.1.20/api/v1',
      'https://10.0.0.5/api/v1',
      'https://172.20.0.1/api/v1',
      'https://my-pc.local/api/v1',
      'https://[::1]/api/v1',
      'not a url',
    ]) {
      expect(isPublicHttpsUrl(url)).toBe(false);
    }
  });
});

describe('Facebook video: published only when Facebook confirms it', () => {
  const page = '/fb-user-1-page-0';

  it('keeps checking the same uploaded video on the next attempt instead of uploading it again', async () => {
    let ready = false;
    meta.routes['GET /101'] = () => ({
      json: {
        status: ready
          ? { video_status: 'ready', publishing_phase: { status: 'complete' } }
          : { video_status: 'processing', processing_phase: { status: 'in_progress' } },
      },
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'video' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['retry']);
    let [destination] = await stored(res.body.publishJob.id);
    expect(destination.providerState).toEqual({ videoId: '101' });
    expect(destination.error.message).toMatch(/still processing the video \(id 101\)/);
    expect(destination.externalPostId).toBeUndefined();

    ready = true;
    expect(await queue.deliver({ now: destination.nextAttemptAt })).toEqual(['published']);
    expect(meta.posts('/videos')).toHaveLength(1);
    [destination] = await stored(res.body.publishJob.id);
    expect(destination).toMatchObject({
      state: 'PUBLISHED',
      externalPostId: '101',
      externalUrl: 'https://www.facebook.com/101',
    });
    expect(meta.calls.filter((c) => c.path.startsWith(page))).toHaveLength(1);
  });

  it('fails without a post when Facebook cannot process the video', async () => {
    meta.routes['GET /101'] = () => ({ json: { status: { video_status: 'error' } } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'video' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error).toMatchObject({ code: 'PLATFORM_REJECTED', retryable: false });
    expect(destination.providerState).toBeUndefined();
    expect(destination.externalPostId).toBeUndefined();
  });

  it('marks the outcome unknown (never published, never re-uploaded) when no status is reported', async () => {
    meta.routes['GET /101'] = () => ({ id: '101' });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'video' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
    expect(destination.error.message).toMatch(/id 101/);
    expect(destination.externalPostId).toBeUndefined();
    // A confirmed manual retry checks the same video again; it does not upload a second one.
    meta.routes['GET /101'] = () => ({ json: { status: { video_status: 'ready' } } });
    const retry = await as(team.owner.token)
      .post(publishUrl(ws, `/${res.body.publishJob.id}/destinations/${destination._id}/retry`))
      .send({ acknowledgeDuplicateRisk: true, confirmRealPost: true });
    expect(retry.status).toBe(200);
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.posts('/videos')).toHaveLength(1);
  });
});

describe('duplicate prevention and confirmation', () => {
  it('never reports a post as published when Meta answers without an id', async () => {
    meta.routes['POST /fb-user-1-page-0/feed'] = () => ({ success: true });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.state).toBe('FAILED');
    expect(destination.error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
  });

  it('treats a server error on the publishing call as "maybe published" unless Meta marks it transient', async () => {
    meta.routes['POST /fb-user-1-page-0/feed'] = () => ({
      status: 500,
      error: { code: 1, message: 'An unknown error occurred' },
    });
    const first = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const unknown = await publish(team.owner.token, ws, { contentPackageId: first.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [maybe] = await stored(unknown.body.publishJob.id);
    expect(maybe.error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });

    meta.routes['POST /fb-user-1-page-1/feed'] = () => ({
      status: 500,
      error: { code: 1, message: 'Please retry', is_transient: true },
    });
    const second = await createDraft(team.owner.token, ws, { accounts: [pages[1]] });
    const transient = await publish(team.owner.token, ws, { contentPackageId: second.id });
    expect(await queue.deliver()).toEqual(['retry']);
    const [later] = await stored(transient.body.publishJob.id);
    expect(later.error.code).toBe('PLATFORM_UNAVAILABLE');
  });

  it("waits as long as Meta's usage header says after a rate limit", async () => {
    meta.routes['POST /fb-user-1-page-0/feed'] = () => ({
      status: 400,
      headers: {
        'x-business-use-case-usage': JSON.stringify({
          'fb-user-1-page-0': [
            { type: 'pages', call_count: 100, estimated_time_to_regain_access: 45 },
          ],
        }),
      },
      error: { code: 80001, message: 'There have been too many calls to this Page' },
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const before = Date.now();
    expect(await queue.deliver()).toEqual(['retry']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('RATE_LIMITED');
    expect(destination.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(45 * 60_000 - 5000);
  });
});

describe('Instagram: limits, reels and partial results', () => {
  const ig = '/fb-user-1-ig-0';

  it('does not create anything when the 24-hour publishing limit is used up', async () => {
    meta.routes[`GET ${ig}/content_publishing_limit`] = () => ({
      data: [{ quota_usage: 50, config: { quota_total: 50, quota_duration: 86400 } }],
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['retry']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('RATE_LIMITED');
    expect(destination.error.message).toMatch(/50 of its 50 posts/);
    expect(meta.posts('/media')).toHaveLength(0);
    expect(destination.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(50 * 60_000);
  });

  it('treats the "publishing limit reached" error as a rate limit, not a rejection', async () => {
    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    meta.routes[`POST ${ig}/media_publish`] = () => ({
      status: 400,
      error: { code: 9, error_subcode: 2207042, message: 'Reached publishing limit' },
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['retry']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('RATE_LIMITED');
    expect(destination.providerState).toEqual({ containerId: '101' });
  });

  it('publishes a single video as a reel shown in the feed too', async () => {
    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'video' });
    usePublicStorage();
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.posts('/media')[0].form).toMatchObject({
      media_type: 'REELS',
      share_to_feed: 'true',
    });
  });

  it('records what Instagram could not apply as a warning on a published post', async () => {
    meta.routes['GET /*'] = () => ({ status_code: 'FINISHED' });
    meta.routes[`POST ${ig}/media_publish`] = () => ({
      id: '9001',
      config_issue: ['CAPTION_NOT_ATTACHED'],
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination).toMatchObject({ state: 'PUBLISHED', externalPostId: '9001' });
    expect(destination.warnings).toContain('CAPTION_NOT_ATTACHED');
  });

  it('refuses an expired Instagram Login token without calling Meta', async () => {
    await SocialConnection.updateMany(
      {},
      { $set: { provider: 'INSTAGRAM_LOGIN', tokenExpiresAt: new Date(Date.now() - 60_000) } },
    );
    setMetaSettingsForTests({ instagram: { appId: '1', appSecret: 'ig-secret-0123456789' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: instagram, media: 'image' });
    usePublicStorage();
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await stored(res.body.publishJob.id);
    expect(destination.error.code).toBe('ACCOUNT_NEEDS_RECONNECT');
    expect(meta.calls).toHaveLength(0);
  });
});

describe('small parts', () => {
  it('backoff doubles, is capped, and adds bounded jitter', () => {
    const options = { baseMs: 30_000, maxMs: 900_000, random: () => 0 };
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelayMs(n, options))).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000,
    ]);
    expect(retryDelayMs(1, { ...options, random: () => 1 })).toBe(36_000);
    expect(retryDelayMs(0, options)).toBe(30_000);
  });

  it('strips credentials from provider text', () => {
    const text = sanitizeProviderText(
      'Bad request https://graph.facebook.com/x?access_token=EAAB1234567890abcdefgh&appsecret_proof=abc Bearer xyz.123 EAAZZZZZZZZZZZZZZZZZZZZ',
    );
    expect(text).not.toMatch(/EAAB1234|abc\b.*proof=abc|xyz\.123|EAAZZZ/);
    expect(text).toMatch(/access_token=\[removed\]/);
    expect(sanitizeProviderText('x'.repeat(1000)).length).toBe(240);
  });

  it('never shows a Redis password', () => {
    expect(redactRedisUrl('redis://user:hunter2@cache.example.com:6380/0')).toBe(
      'redis://cache.example.com:6380',
    );
    expect(redactRedisUrl('rediss://:pw@host')).toBe('rediss://host:6379');
  });

  it('the real queue reports UNAVAILABLE and fails fast when Redis cannot be reached', async () => {
    const real = createBullQueue({
      redisUrl: 'redis://127.0.0.1:6',
      name: 'socialhub-test-unreachable',
    });
    try {
      expect(real.status()).toBe('CONNECTING');
      await expect(real.enqueue({ destinationId: 'a'.repeat(24), seq: 1 })).rejects.toThrow(
        /not reachable/,
      );
      for (let i = 0; i < 100 && real.status() === 'CONNECTING'; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(real.status()).toBe('UNAVAILABLE');
      const started = Date.now();
      await expect(real.enqueue({ destinationId: 'a'.repeat(24), seq: 1 })).rejects.toThrow(
        /not reachable/,
      );
      await expect(real.counts()).rejects.toThrow(/not reachable/);
      expect(await real.remove({ destinationId: 'a'.repeat(24), seq: 1 })).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await real.close();
    }
  });
});
