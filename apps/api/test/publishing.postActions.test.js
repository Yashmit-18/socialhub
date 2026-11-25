import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { ActivityLog, PublishDestination, Workspace } from '../src/models/index.js';
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
 * Editing the text of, and deleting, a REAL published Facebook Page post (POST and DELETE
 * /{post-id}). Meta is SIMULATED (a fetch stand-in); a request to the real Meta would be
 * blocked and fail the test (test/setup.js). This proves SocialHub's checks and how it reacts
 * to Meta's answers, not what the real Meta answers.
 */

const TOKEN = 'page-token-SECRET-0123456789abcdef';
const POST_ID = 'fb-user-1-page-0_7002';
let team;
let ws;
let queue;
let page;
let meta;

function fakeMeta() {
  const fake = { calls: [], routes: {} };
  fake.transport = async (url, init) => {
    const target = new URL(url);
    const call = {
      method: init.method,
      path: target.pathname.replace(/^\/v\d+\.\d+/, ''),
      query: Object.fromEntries(target.searchParams),
      form: Object.fromEntries(new URLSearchParams(init.body ?? '')),
    };
    fake.calls.push(call);
    const route = fake.routes[`${call.method} ${call.path}`];
    let answer;
    if (route) answer = route(call);
    else if (call.path.endsWith('/photos')) answer = { id: '7001', post_id: POST_ID };
    else if (call.method === 'GET') answer = { id: call.path.slice(1) };
    else answer = { success: true };
    if (answer instanceof Error) throw answer;
    const { status = 200, ...body } = answer;
    return new Response(JSON.stringify(body), { status });
  };
  fake.writes = () => fake.calls.filter((c) => c.method !== 'GET');
  return fake;
}

const postUrl = (jobId, destinationId) =>
  publishUrl(ws, `/${jobId}/destinations/${destinationId}/post`);
const edit = (token, jobId, destinationId, body) =>
  as(token).patch(postUrl(jobId, destinationId)).send(body);
const remove = (token, jobId, destinationId, body) =>
  as(token).delete(postUrl(jobId, destinationId)).send(body);

/** One real Facebook Page post, published through the simulated Meta. */
async function publishedPost({ media = 'image' } = {}) {
  const draft = await createDraft(team.owner.token, ws, { accounts: [page], media });
  const res = await publish(team.owner.token, ws, {
    contentPackageId: draft.id,
    confirmRealPost: true,
  });
  expect(res.status).toBe(201);
  expect(await queue.deliver()).toEqual(['published']);
  const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
  meta.calls.length = 0;
  return { jobId: res.body.publishJob.id, destinationId: String(destination._id) };
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
  meta = fakeMeta();
  setMetaTransportForTests(meta.transport);
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

describe('editing a real published Facebook post', () => {
  it('needs the confirmation, then changes the text on Facebook once and records it', async () => {
    const { jobId, destinationId } = await publishedPost();
    const shown = (await as(team.owner.token).get(publishUrl(ws, `/${jobId}`))).body.publishJob;
    expect(shown.destinations[0]).toMatchObject({
      canEditPost: true,
      canDeletePost: true,
      postText: 'Hello from the test',
      postEditedAt: null,
    });

    const refused = await edit(team.owner.token, jobId, destinationId, { message: 'New text' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('REAL_POST_CONFIRMATION_REQUIRED');
    expect(refused.body.error.message).toMatch(/Nothing was changed/);
    expect(meta.writes()).toHaveLength(0);

    const res = await edit(team.owner.token, jobId, destinationId, {
      message: '  New text  ',
      confirmRealPost: true,
    });
    expect(res.status).toBe(200);
    expect(meta.writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: `/${POST_ID}`,
        form: { message: 'New text' },
      }),
    ]);
    expect(meta.writes()[0].query.access_token).toBe(`${TOKEN}-fb-user-1-page-0`);
    expect(meta.writes()[0].query.appsecret_proof).toMatch(/^[a-f0-9]{64}$/);
    const destination = res.body.publishJob.destinations[0];
    expect(destination).toMatchObject({ postText: 'New text', canEditPost: true });
    expect(destination.postEditedAt).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(await ActivityLog.countDocuments({ action: 'publish_destination.post_edited' })).toBe(1);
  });

  it('refuses empty text, and text for a video (whose text is changed differently)', async () => {
    const { jobId, destinationId } = await publishedPost();
    const empty = await edit(team.owner.token, jobId, destinationId, {
      message: '   ',
      confirmRealPost: true,
    });
    expect(empty.status).toBe(422);

    meta.routes['POST /fb-user-1-page-0/photos'] = () => ({ id: '7001', post_id: POST_ID });
    await PublishDestination.updateOne({ _id: destinationId }, { externalPostId: '880011' });
    const video = await edit(team.owner.token, jobId, destinationId, {
      message: 'New text',
      confirmRealPost: true,
    });
    expect(video.status).toBe(409);
    expect(video.body.error.details.reason).toBe('EDIT_NOT_SUPPORTED');
    expect(meta.writes()).toHaveLength(0);
  });
});

describe('deleting a real published Facebook post', () => {
  it('needs the confirmation, deletes it once on Facebook, and allows nothing after', async () => {
    const { jobId, destinationId } = await publishedPost();
    const refused = await remove(team.owner.token, jobId, destinationId, {});
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/cannot be undone.*Nothing was deleted/);
    expect(meta.writes()).toHaveLength(0);

    const res = await remove(team.owner.token, jobId, destinationId, { confirmRealPost: true });
    expect(res.status).toBe(200);
    expect(meta.writes()).toEqual([
      expect.objectContaining({ method: 'DELETE', path: `/${POST_ID}` }),
    ]);
    const destination = res.body.publishJob.destinations[0];
    expect(destination.postDeletedAt).toEqual(expect.any(String));
    expect(destination).toMatchObject({ canEditPost: false, canDeletePost: false, postText: null });
    expect(await ActivityLog.countDocuments({ action: 'publish_destination.post_deleted' })).toBe(
      1,
    );

    const again = await remove(team.owner.token, jobId, destinationId, { confirmRealPost: true });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('POST_DELETED');
    const editAfter = await edit(team.owner.token, jobId, destinationId, {
      message: 'x',
      confirmRealPost: true,
    });
    expect(editAfter.status).toBe(409);
    expect(meta.writes()).toHaveLength(1);
  });
});

describe("Meta's answers", () => {
  it('records nothing when Meta does not confirm, says so, and frees the post for a retry', async () => {
    const { jobId, destinationId } = await publishedPost();
    meta.routes[`DELETE /${POST_ID}`] = () => ({ success: false });
    const unsure = await remove(team.owner.token, jobId, destinationId, { confirmRealPost: true });
    expect(unsure.status).toBe(502);
    expect(unsure.body.error.code).toBe('OUTCOME_UNKNOWN');
    expect(unsure.body.error.details.uncertain).toBe(true);
    expect((await PublishDestination.findById(destinationId)).postDeletedAt).toBeUndefined();

    meta.routes[`DELETE /${POST_ID}`] = () =>
      new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const timeout = await remove(team.owner.token, jobId, destinationId, { confirmRealPost: true });
    expect(timeout.status).toBe(502);
    expect(timeout.body.error.code).toBe('OUTCOME_UNKNOWN');
    // Each attempt was the person's own click; nothing was sent again by itself.
    expect(meta.writes()).toHaveLength(2);
    expect((await PublishDestination.findById(destinationId)).postActionAt).toBeUndefined();
  });

  it('reports an expired login or a missing permission without recording anything', async () => {
    const { jobId, destinationId } = await publishedPost();
    meta.routes[`POST /${POST_ID}`] = () => ({
      status: 400,
      error: { code: 190, message: 'Error validating access token', error_subcode: 463 },
    });
    const expired = await edit(team.owner.token, jobId, destinationId, {
      message: 'x',
      confirmRealPost: true,
    });
    expect(expired.status).toBe(502);
    expect(expired.body.error.code).toBe('ACCOUNT_NEEDS_RECONNECT');

    meta.routes[`POST /${POST_ID}`] = () => ({
      status: 403,
      error: { code: 200, message: 'Requires pages_manage_posts' },
    });
    const denied = await edit(team.owner.token, jobId, destinationId, {
      message: 'x',
      confirmRealPost: true,
    });
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
    expect(JSON.stringify(denied.body)).not.toContain('SECRET');
    expect((await PublishDestination.findById(destinationId)).postEditedAt).toBeUndefined();
  });
});

describe('who and when', () => {
  it('only a real post, only while real publishing is on, only for members who may publish', async () => {
    const { jobId, destinationId } = await publishedPost();
    const viewer = await remove(team.viewer.token, jobId, destinationId, {
      confirmRealPost: true,
    });
    expect(viewer.status).toBe(403);

    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    const off = await remove(team.owner.token, jobId, destinationId, { confirmRealPost: true });
    expect(off.status).toBe(409);
    expect(off.body.error.details.reason).toBe('MODE_CHANGED');
    expect(meta.writes()).toHaveLength(0);

    const draft = await createDraft(team.owner.token, ws, { accounts: [page] });
    const simulated = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
    const [sim] = await PublishDestination.find({ job: simulated.body.publishJob.id });
    expect(simulated.body.publishJob.destinations[0].canDeletePost).toBe(false);
    const notReal = await remove(team.owner.token, simulated.body.publishJob.id, String(sim._id), {
      confirmRealPost: true,
    });
    expect(notReal.status).toBe(409);
    expect(notReal.body.error.details.reason).toBe('NOT_REAL');
    expect(meta.writes()).toHaveLength(0);
  });

  it('sends one change at a time per post', async () => {
    const { jobId, destinationId } = await publishedPost();
    await PublishDestination.updateOne({ _id: destinationId }, { postActionAt: new Date() });
    const busy = await edit(team.owner.token, jobId, destinationId, {
      message: 'x',
      confirmRealPost: true,
    });
    expect(busy.status).toBe(409);
    expect(busy.body.error.details.reason).toBe('IN_PROGRESS');
    expect(meta.writes()).toHaveLength(0);
  });

  it('cannot reach a post in another workspace', async () => {
    const { jobId, destinationId } = await publishedPost();
    const other = await seedTeam();
    const res = await as(other.owner.token)
      .delete(
        `/api/v1/workspaces/${other.workspace.id}/publish-jobs/${jobId}/destinations/${destinationId}/post`,
      )
      .send({ confirmRealPost: true });
    expect(res.status).toBe(404);
    expect(meta.writes()).toHaveLength(0);
  });
});
