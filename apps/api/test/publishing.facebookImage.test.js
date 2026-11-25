import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { PublishDestination, Workspace } from '../src/models/index.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
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
 * One image to one Facebook Page: the exact path of a first real test post
 * (POST /{page-id}/photos with url + caption). The REAL adapter and processor run against a
 * SIMULATED Meta, so this proves how SocialHub reacts to each answer, not what Meta answers.
 *
 * The rule under test: a post is recorded as published only with the id Meta returned, and
 * an answer that does not prove the post was NOT created is never retried automatically.
 */

const TOKEN = 'page-token-SECRET-0123456789abcdef';
const PHOTOS = 'POST /fb-user-1-page-0/photos';
let team;
let ws;
let queue;
let page;
let meta;

function createFakeMeta() {
  const fake = {
    calls: [],
    routes: {},
    transport: async (url, init) => {
      const target = new URL(url);
      const call = {
        method: init.method,
        path: target.pathname.replace(/^\/v\d+\.\d+/, ''),
        query: Object.fromEntries(target.searchParams),
        form: Object.fromEntries(new URLSearchParams(init.body ?? '')),
      };
      fake.calls.push(call);
      const route = fake.routes[`${call.method} ${call.path}`];
      const answer = route ? route(call) : { id: 'unexpected' };
      if (answer instanceof Error) throw answer;
      const { status = 200, ...body } = answer;
      return new Response(JSON.stringify(body), { status });
    },
    photoPosts: () => fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/photos')),
  };
  return fake;
}

const stored = async (jobId) => (await PublishDestination.find({ job: jobId }))[0];

async function publishOneImage() {
  const draft = await createDraft(team.owner.token, ws, { accounts: [page], media: 'image' });
  const local = getStorage();
  // Public HTTPS storage, as the tunnel address provides it on a real server.
  setStorageForTests({
    ...local,
    name: local.name,
    publicUrls: true,
    publicUrl: (key) => `https://media.example.test/${key}?expires=1&signature=sig`,
  });
  // The person confirmed the real post (requests without it: publishing.confirmation.test.js).
  const res = await publish(team.owner.token, ws, {
    contentPackageId: draft.id,
    confirmRealPost: true,
  });
  expect(res.status).toBe(201);
  return res.body.publishJob.id;
}

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 1 });
  [page] = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  await giveTokens(seeded.accounts, TOKEN);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests({ mode: 'LIVE', maxAttempts: 3, retryBaseMs: 30_000 });
  await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
  meta = createFakeMeta();
  setMetaTransportForTests(meta.transport);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
  setStorageForTests(undefined);
});

describe('one image to a Facebook Page', () => {
  it('sends one /photos request and records the feed post id Meta returned', async () => {
    meta.routes[PHOTOS] = () => ({ id: '9001', post_id: 'fb-user-1-page-0_9002' });
    const jobId = await publishOneImage();
    expect(await queue.deliver()).toEqual(['published']);

    const [call] = meta.photoPosts();
    expect(meta.photoPosts()).toHaveLength(1);
    expect(call.form.url).toMatch(/^https:\/\/media\.example\.test\/workspaces\//);
    expect(call.form.caption).toBe('Hello from the test');
    // The Page's own token (giveTokens gives every account a distinct one).
    expect(call.query.access_token).toBe(`${TOKEN}-fb-user-1-page-0`);
    const destination = await stored(jobId);
    expect(destination.state).toBe('PUBLISHED');
    expect(destination.simulated).toBe(false);
    // The feed post ("pageid_postid"), not the photo id.
    expect(destination.externalPostId).toBe('fb-user-1-page-0_9002');
    expect(destination.externalUrl).toBe('https://www.facebook.com/fb-user-1-page-0_9002');
  });

  const failures = [
    [
      'invalid token',
      { status: 400, error: { code: 190, message: 'Invalid OAuth access token' } },
      'failed',
      'ACCOUNT_NEEDS_RECONNECT',
    ],
    [
      'expired token',
      { status: 400, error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
      'failed',
      'ACCOUNT_NEEDS_RECONNECT',
    ],
    [
      'missing permission (#10)',
      { status: 403, error: { code: 10, message: 'Application does not have permission' } },
      'failed',
      'PERMISSION_DENIED',
    ],
    [
      'missing permission (#200)',
      { status: 403, error: { code: 200, message: 'Requires pages_manage_posts' } },
      'failed',
      'PERMISSION_DENIED',
    ],
    [
      'image Meta could not download',
      { status: 400, error: { code: 324, message: 'Missing or invalid image file' } },
      'failed',
      'PLATFORM_REJECTED',
    ],
    [
      'outage Meta marks as not carried out',
      { status: 503, error: { code: 2, message: 'Service temporarily unavailable' } },
      'retry',
      'PLATFORM_UNAVAILABLE',
    ],
    [
      'server error without "transient"',
      { status: 500, error: { code: 1, message: 'An unknown error occurred' } },
      'failed',
      'OUTCOME_UNKNOWN',
    ],
    [
      'timeout after sending',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'failed',
      'OUTCOME_UNKNOWN',
    ],
    ['connection dropped after sending', new Error('socket hang up'), 'failed', 'OUTCOME_UNKNOWN'],
    ['success without an id', { success: true }, 'failed', 'OUTCOME_UNKNOWN'],
  ];

  it.each(failures)('%s → %s with %s, sent exactly once', async (_, answer, outcome, code) => {
    meta.routes[PHOTOS] = () => answer;
    const jobId = await publishOneImage();
    expect(await queue.deliver()).toEqual([outcome]);

    const destination = await stored(jobId);
    expect(destination.error.code).toBe(code);
    expect(destination.externalPostId).toBeUndefined();
    expect(JSON.stringify(destination.error)).not.toMatch(/SECRET|signature=sig/);
    expect(meta.photoPosts()).toHaveLength(1);
    if (outcome === 'failed') {
      expect(destination.state).toBe('FAILED');
      // Nothing waits to send it again.
      expect(queue.pending()).toHaveLength(0);
    } else {
      // Meta said the request was not carried out: a later attempt is safe.
      expect(destination.error.retryable).toBe(true);
    }
  });

  it('after an uncertain outcome only a person retries, and only after accepting the risk', async () => {
    meta.routes[PHOTOS] = () =>
      new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const jobId = await publishOneImage();
    expect(await queue.deliver()).toEqual(['failed']);
    const destination = await stored(jobId);
    const retryUrl = publishUrl(ws, `/${jobId}/destinations/${destination._id}/retry`);

    const refused = await as(team.owner.token).post(retryUrl).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('DUPLICATE_RISK');
    expect(queue.pending()).toHaveLength(0);
    expect(meta.photoPosts()).toHaveLength(1);

    // Accepting the risk is not enough for a real post: it is a real public post again.
    const unconfirmed = await as(team.owner.token)
      .post(retryUrl)
      .send({ acknowledgeDuplicateRisk: true });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error.code).toBe('REAL_POST_CONFIRMATION_REQUIRED');
    expect(queue.pending()).toHaveLength(0);

    meta.routes[PHOTOS] = () => ({ id: '9101', post_id: 'fb-user-1-page-0_9102' });
    const accepted = await as(team.owner.token)
      .post(retryUrl)
      .send({ acknowledgeDuplicateRisk: true, confirmRealPost: true });
    expect(accepted.status).toBe(200);
    expect(await queue.deliver()).toEqual(['published']);
    expect(meta.photoPosts()).toHaveLength(2);
    expect((await stored(jobId)).externalPostId).toBe('fb-user-1-page-0_9102');
  });
});
