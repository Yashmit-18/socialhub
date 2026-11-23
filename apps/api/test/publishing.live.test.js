import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import { PublishDestination, PublishJob, SocialConnection } from '../src/models/index.js';
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
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish,
  publishUrl,
} from './publishFixtures.js';

/**
 * The REAL Facebook and Instagram adapters, driven against a SIMULATED Meta (a fetch
 * stand-in defined below). LIVE mode cannot be configured on a running server; these tests
 * switch it on through the test-only override.
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
      const { status = 200, ...body } = answer;
      return new Response(JSON.stringify(body), { status });
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
  meta = createFakeMeta();
  setMetaTransportForTests(meta.transport);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
  setMetaSettingsForTests(undefined);
  setStorageForTests(undefined);
});

describe('real publishing is disabled on a running server', () => {
  it('has no configuration value that turns LIVE mode on', () => {
    const base = {
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(loadConfig(base).publishing.mode).toBe('DISABLED');
    expect(loadConfig({ ...base, PUBLISHING_MODE: 'simulated' }).publishing.mode).toBe('SIMULATED');
    for (const value of ['live', 'LIVE', 'real', 'production', 'enabled', 'true']) {
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
    expect(res.body.error.details.fields.content).toMatch(/stored on this server only/);
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
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob).toMatchObject({ mode: 'LIVE', simulated: false });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls).toHaveLength(1);
    const [call] = meta.calls;
    expect(call).toMatchObject({
      method: 'POST',
      host: 'graph.facebook.com',
      path: '/fb-user-1-page-0/feed',
    });
    expect(call.form.message).toBe('Hello from the test\n\n#news');
    expect(call.query.access_token).toBe(`${TOKEN}-fb-user-1-page-0`);
    expect(call.query.appsecret_proof).toMatch(/^[a-f0-9]{64}$/);

    const job = (await as(team.owner.token).get(publishUrl(ws, `/${res.body.publishJob.id}`))).body
      .publishJob;
    expect(job.destinations[0]).toMatchObject({
      state: 'PUBLISHED',
      simulated: false,
      externalPostId: '101',
      externalUrl: 'https://www.facebook.com/101',
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

  it('publishes a video through /videos', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'video' });
    usePublicStorage();
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.calls[0].path).toBe('/fb-user-1-page-0/videos');
    expect(meta.calls[0].form.file_url).toMatch(/\.mp4$/);
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
