import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { ActivityLog, PublishDestination, PublishJob, Workspace } from '../src/models/index.js';
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
 * A REAL post is only created when the request itself carries the person's confirmation
 * (`confirmRealPost: true`). The checkbox in the screens is not the enforcement: this is.
 *
 * Meta is SIMULATED throughout (a fetch stand-in); a request to the real Meta would also be
 * blocked and fail the test (test/setup.js).
 */

const CONFIRMATION_REQUIRED = 'REAL_POST_CONFIRMATION_REQUIRED';
let team;
let ws;
let queue;
let pages;
let metaCalls;

const inHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const nothingCreated = async () => {
  expect(await PublishJob.countDocuments()).toBe(0);
  expect(await PublishDestination.countDocuments()).toBe(0);
  expect(await ActivityLog.countDocuments({ action: 'publish_job.created' })).toBe(0);
  expect(queue.pending()).toHaveLength(0);
};
const expectConfirmationRequired = (res) => {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe(CONFIRMATION_REQUIRED);
  expect(res.body.error.message).toMatch(/real public post/);
  expect(res.body.error.message).toMatch(/Nothing was created/);
};

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2 });
  pages = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  await giveTokens(seeded.accounts, 'page-token-SECRET-0123456789abcdef');
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests({ mode: 'LIVE', maxAttempts: 3, retryBaseMs: 30_000 });
  await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
  metaCalls = [];
  setMetaTransportForTests(async (url, init) => {
    const target = new URL(url);
    metaCalls.push({ method: init.method, host: target.host, path: target.pathname });
    const body = target.pathname.endsWith('/photos')
      ? { id: '7001', post_id: `${target.pathname.split('/')[2]}_7002` }
      : { id: `${target.pathname.split('/')[2]}_7003` };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  // Public HTTPS media storage, which real publishing requires.
  const local = getStorage();
  setStorageForTests({
    ...local,
    name: local.name,
    publicUrls: true,
    publicUrl: (key) => `https://media.example.test/${key}`,
  });
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
  setStorageForTests(undefined);
});

describe('real publishing needs the confirmation in the request', () => {
  it('refuses a real post without it: 400, nothing created, nothing queued, Meta not called', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    expectConfirmationRequired(
      await publish(team.owner.token, ws, {
        contentPackageId: draft.id,
        socialAccountIds: [pages[0].id],
      }),
    );
    expectConfirmationRequired(
      await publish(team.owner.token, ws, { contentPackageId: draft.id, confirmRealPost: false }),
    );
    await nothingCreated();
    // Not quietly turned into a simulation either.
    expect(await PublishJob.countDocuments({ mode: 'SIMULATED' })).toBe(0);
    expect(metaCalls).toHaveLength(0);
  });

  it('accepts only the boolean true', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    for (const value of ['true', 1, 'yes']) {
      const res = await publish(team.owner.token, ws, {
        contentPackageId: draft.id,
        confirmRealPost: value,
      });
      expect(res.status).toBe(422);
    }
    await nothingCreated();
  });

  it('with it, the real job is created and published through the simulated Meta only', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob).toMatchObject({ mode: 'LIVE', simulated: false });
    expect(await queue.deliver()).toEqual(['published']);

    const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(destination.state).toBe('PUBLISHED');
    expect(destination.externalPostId).toBe('fb-user-1-page-0_7002');
    // One POST creates the post; then the post is only read back (GET) for its link.
    expect(metaCalls).toEqual([
      { method: 'POST', host: 'graph.facebook.com', path: expect.stringMatching(/\/photos$/) },
      { method: 'GET', host: 'graph.facebook.com', path: expect.stringMatching(/_7002$/) },
    ]);
  });

  it('"Publish a draft" (the draft\'s own accounts) needs it too', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    expectConfirmationRequired(await publish(team.owner.token, ws, { contentPackageId: draft.id }));
    await nothingCreated();

    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.destinationCount).toBe(2);
    expect(await queue.deliver()).toEqual(['published', 'published']);
  });

  it('scheduling a real post needs it at creation', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const scheduledAt = inHours(3);
    expectConfirmationRequired(
      await publish(team.owner.token, ws, { contentPackageId: draft.id, scheduledAt }),
    );
    await nothingCreated();

    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt,
      confirmRealPost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob).toMatchObject({ mode: 'LIVE', status: 'SCHEDULED' });
    expect(metaCalls).toHaveLength(0);
  });

  it('"publish again" (republish) needs it too', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id, confirmRealPost: true });
    expect(await queue.deliver()).toEqual(['published']);
    expectConfirmationRequired(
      await publish(team.owner.token, ws, { contentPackageId: draft.id, republish: true }),
    );
    expect(await PublishJob.countDocuments()).toBe(1);
  });

  it('is required of every role that may publish, and gives none to a role that may not', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    expectConfirmationRequired(
      await publish(team.editor.token, ws, { contentPackageId: draft.id }),
    );
    expectConfirmationRequired(await publish(team.admin.token, ws, { contentPackageId: draft.id }));
    const viewer = await publish(team.viewer.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(viewer.status).toBe(403);
    await nothingCreated();
  });
});

describe('simulated publishing does not need it', () => {
  it('a simulated workspace on a live server publishes without it, and Meta is never called', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    expect(res.body.publishJob).toMatchObject({ mode: 'SIMULATED', simulated: true });
    expect(await queue.deliver()).toEqual(['published']);
    expect(metaCalls).toHaveLength(0);
  });

  it('a simulated server publishes without it even for a workspace that chose live', async () => {
    setPublishingSettingsForTests({ mode: 'SIMULATED', maxAttempts: 3, retryBaseMs: 30_000 });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: inHours(2),
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.mode).toBe('SIMULATED');
    expect(metaCalls).toHaveLength(0);
  });

  it('the confirmation changes nothing for a simulated post', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.mode).toBe('SIMULATED');
    expect(await queue.deliver()).toEqual(['published']);
    expect(metaCalls).toHaveLength(0);
  });
});

describe('retrying a failed real destination needs the confirmation again', () => {
  const rejectOnce = () => {
    let first = true;
    setMetaTransportForTests(async (url, init) => {
      const target = new URL(url);
      metaCalls.push({ method: init.method, path: target.pathname });
      if (first) {
        first = false;
        return new Response(
          JSON.stringify({ error: { code: 100, message: 'Invalid parameter' } }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ id: `${target.pathname.split('/')[2]}_7101` }), {
        status: 200,
      });
    });
  };
  const failedRealPost = async () => {
    rejectOnce();
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(destination.error.code).toBe('PLATFORM_REJECTED');
    return publishUrl(ws, `/${res.body.publishJob.id}/destinations/${destination._id}/retry`);
  };

  it('refuses the retry without it (nothing queued), sends it once with it', async () => {
    const retryUrl = await failedRealPost();
    for (const body of [{}, { confirmRealPost: false }, { acknowledgeDuplicateRisk: true }]) {
      const refused = await as(team.owner.token).post(retryUrl).send(body);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe(CONFIRMATION_REQUIRED);
      expect(refused.body.error.message).toMatch(/Nothing was sent/);
    }
    expect(queue.pending()).toHaveLength(0);
    expect(metaCalls).toHaveLength(1);

    const posts = () => metaCalls.filter((call) => call.method === 'POST');
    const retried = await as(team.owner.token).post(retryUrl).send({ confirmRealPost: true });
    expect(retried.status).toBe(200);
    expect(await queue.deliver()).toEqual(['published']);
    expect(posts()).toHaveLength(2);
    // A second click is refused: the destination is no longer failed.
    const again = await as(team.owner.token).post(retryUrl).send({ confirmRealPost: true });
    expect(again.status).toBe(409);
    expect(posts()).toHaveLength(2);
  });

  it('a simulated retry needs no confirmation', async () => {
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob.mode).toBe('SIMULATED');
    await PublishDestination.updateOne(
      { job: res.body.publishJob.id },
      {
        $set: {
          state: 'FAILED',
          active: false,
          error: { code: 'PLATFORM_REJECTED', message: 'Simulated failure', retryable: false },
        },
      },
    );
    const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
    const retried = await as(team.owner.token)
      .post(publishUrl(ws, `/${res.body.publishJob.id}/destinations/${destination._id}/retry`))
      .send({});
    expect(retried.status).toBe(200);
    expect(metaCalls).toHaveLength(0);
  });
});

describe('idempotency and duplicate protection still hold', () => {
  it('the same confirmed request sent twice, or five times at once, creates one job', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const body = {
      contentPackageId: draft.id,
      idempotencyKey: 'confirmed-key-0123456789',
      confirmRealPost: true,
    };
    const first = await publish(team.owner.token, ws, body);
    const again = await publish(team.owner.token, ws, body);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body).toMatchObject({
      created: false,
      publishJob: { id: first.body.publishJob.id },
    });

    const other = await createDraft(team.owner.token, ws, { accounts: [pages[1]] });
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        publish(team.owner.token, ws, {
          contentPackageId: other.id,
          idempotencyKey: 'burst-key-0123456789ab',
          confirmRealPost: true,
        }),
      ),
    );
    expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await PublishJob.countDocuments()).toBe(2);
  });

  it('a replay without the confirmation is not answered with the real job', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const key = 'replay-key-0123456789ab';
    await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      idempotencyKey: key,
      confirmRealPost: true,
    });
    const replay = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      idempotencyKey: key,
    });
    expectConfirmationRequired(replay);
    expect(replay.body.publishJob).toBeUndefined();
    expect(await PublishJob.countDocuments()).toBe(1);
  });

  it('after a refusal, the same request confirmed (same key) creates the job once', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const key = 'retry-key-0123456789abcd';
    expectConfirmationRequired(
      await publish(team.owner.token, ws, { contentPackageId: draft.id, idempotencyKey: key }),
    );
    const confirmed = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      idempotencyKey: key,
      confirmRealPost: true,
    });
    expect(confirmed.status).toBe(201);
    expect(await PublishJob.countDocuments()).toBe(1);
  });

  it('an uncertain outcome is still never retried without the person accepting the risk', async () => {
    setMetaTransportForTests(async (url, init) => {
      metaCalls.push({ method: init.method, path: new URL(url).pathname });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      confirmRealPost: true,
    });
    expect(await queue.deliver()).toEqual(['failed']);
    const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(destination.error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
    expect(queue.pending()).toHaveLength(0);

    const retry = await as(team.owner.token)
      .post(publishUrl(ws, `/${res.body.publishJob.id}/destinations/${destination._id}/retry`))
      .send({});
    expect(retry.status).toBe(409);
    expect(retry.body.error.details.reason).toBe('DUPLICATE_RISK');
    expect(metaCalls).toHaveLength(1);
  });
});
