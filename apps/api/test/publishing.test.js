import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_ERROR_CODES, QUEUE_STATUS } from '@socialhub/shared';
import {
  ActivityLog,
  Membership,
  PublishDestination,
  PublishJob,
  SocialAccount,
} from '../src/models/index.js';
import { cleanupMedia } from '../src/modules/media/media.service.js';
import { setSimulatedBehaviourForTests } from '../src/modules/publishing/adapters/simulated.js';
import { PublishError } from '../src/modules/publishing/publishError.js';
import {
  CLAIM_MS,
  processDestination,
  recoverPublishing,
  syncJob,
} from '../src/modules/publishing/publishing.processor.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { startPublishWorker } from '../src/modules/publishing/publishing.worker.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import mongoose from 'mongoose';
import { api, as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  markConnection,
  newKey,
  publish,
  publishUrl,
} from './publishFixtures.js';

/**
 * The publishing engine in SIMULATED mode: the real API, the real processor and real
 * MongoDB, with a test-only queue (see publishFixtures.js) and the simulated adapter.
 * Nothing here contacts Meta or Redis.
 */

let team;
let ws;
let queue;
let pages;
let instagram;
let connection;

const SETTINGS = { mode: 'SIMULATED', maxAttempts: 3, retryBaseMs: 30_000, retryMaxMs: 900_000 };
const transient = () =>
  new PublishError(PUBLISH_ERROR_CODES.PLATFORM_UNAVAILABLE, 'Temporary problem.', {
    retryable: true,
  });
const rejected = () => new PublishError(PUBLISH_ERROR_CODES.PLATFORM_REJECTED, 'Not accepted.');
const get = (token, suffix = '', workspaceId = ws) =>
  as(token).get(publishUrl(workspaceId, suffix));
const grant = (member, accounts) =>
  Membership.updateOne(
    { _id: member.membershipId },
    { $set: { accountAccess: { mode: 'SELECTED', socialAccounts: accounts.map((a) => a._id) } } },
  );

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  connection = seeded.connection;
  pages = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  instagram = seeded.accounts.filter((a) => a.platform === 'INSTAGRAM_ACCOUNT');
  await giveTokens(seeded.accounts);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests(SETTINGS);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setSimulatedBehaviourForTests(null);
});

describe('creating a publishing job', () => {
  it('creates one destination per account and queues each one', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    const job = res.body.publishJob;
    expect(job).toMatchObject({ status: 'QUEUED', mode: 'SIMULATED', simulated: true });
    expect(job.destinationCount).toBe(2);
    expect(job.counts.QUEUED).toBe(2);
    expect(job.destinations.map((d) => d.state)).toEqual(['QUEUED', 'QUEUED']);
    expect(job.destinations.map((d) => d.accountName).sort()).toEqual(['Page 0', 'Page 1']);
    expect(queue.pending()).toHaveLength(2);
    expect(await PublishDestination.countDocuments({ job: job.id })).toBe(2);
    const log = await ActivityLog.findOne({ action: 'publish_job.created' });
    expect(log.metadata).toMatchObject({ accountCount: 2, simulated: true });
  });

  it('puts nothing but the destination id into the queue', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    for (const entry of queue.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        'delayMs',
        'delivered',
        'destinationId',
        'id',
        'seq',
      ]);
      expect(JSON.stringify(entry)).not.toMatch(/token|SECRET|caption|Hello/i);
    }
  });

  it('uses explicit accounts instead of the draft accounts when given', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      socialAccountIds: [String(pages[1]._id)],
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.destinations.map((d) => d.accountName)).toEqual(['Page 1']);
  });

  it("leaves out a draft's account that was removed from the workspace since", async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await SocialAccount.deleteOne({ _id: pages[1]._id });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.destinations.map((d) => d.accountName)).toEqual(['Page 0']);
  });

  it('keeps a copy of the content, so later edits to the draft do not change the job', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await as(team.owner.token)
      .patch(`/api/v1/workspaces/${ws}/content-packages/${draft.id}`)
      .send({ caption: 'Changed afterwards', targetAccountIds: [], version: draft.version });
    const job = await PublishJob.findById(res.body.publishJob.id);
    expect(job.content.caption).toBe('Hello from the test');
    expect(
      (await get(team.owner.token, `/${job._id}`)).body.publishJob.content.captionPreview,
    ).toBe('Hello from the test');
  });

  it('rejects a draft without accounts, unknown drafts and invalid bodies', async () => {
    const empty = await createDraft(team.owner.token, ws);
    const none = await publish(team.owner.token, ws, { contentPackageId: empty.id });
    expect(none.status).toBe(422);
    expect(none.body.error.details.fields.socialAccountIds).toMatch(/at least one/);

    const unknown = await publish(team.owner.token, ws, { contentPackageId: 'a'.repeat(24) });
    expect(unknown.status).toBe(404);

    const noKey = await as(team.owner.token)
      .post(publishUrl(ws))
      .send({ contentPackageId: empty.id });
    expect(noKey.status).toBe(422);
    const extra = await publish(team.owner.token, ws, {
      contentPackageId: empty.id,
      accessToken: 'x',
    });
    expect(extra.status).toBe(422);
    expect(await PublishJob.countDocuments()).toBe(0);
  });

  it('rejects content a platform cannot take (Instagram needs media)', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [...pages, ...instagram] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.content).toMatch(/Instagram posts need/);
    expect(await PublishJob.countDocuments()).toBe(0);
  });

  it('rejects accounts that cannot receive posts right now', async () => {
    await SocialAccount.updateOne(
      { _id: pages[0]._id },
      { $set: { publishingStatus: 'RESTRICTED' } },
    );
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.socialAccountIds).toMatch(/Page 0/);
  });

  it('accepts a future time and refuses a past one', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const past = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(422);
    const at = new Date(Date.now() + 3_600_000);
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: at.toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.status).toBe('SCHEDULED');
    expect(queue.pending().every((e) => e.delayMs > 3_500_000)).toBe(true);

    // Delivered early, the processor does not touch it; at the right time it does.
    expect(await queue.deliver({ now: new Date() })).toEqual(['skipped', 'skipped']);
    const [first] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(first.state).toBe('SCHEDULED');
    expect(await processDestination(first._id, { now: at })).toBe('published');
  });
});

describe('queue and mode availability', () => {
  it('answers 503 PUBLISHING_DISABLED when publishing is switched off', async () => {
    setPublishingSettingsForTests({ ...SETTINGS, mode: 'DISABLED' });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PUBLISHING_DISABLED');
    expect(await PublishJob.countDocuments()).toBe(0);
    const status = await as(team.owner.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
    expect(status.body).toMatchObject({
      mode: 'DISABLED',
      canPublish: false,
      reason: 'PUBLISHING_DISABLED',
    });
  });

  it.each([
    [QUEUE_STATUS.UNAVAILABLE, /cannot be reached/],
    [QUEUE_STATUS.CONNECTING, /still connecting/],
  ])(
    'answers 503 QUEUE_UNAVAILABLE and writes nothing when Redis is %s',
    async (state, message) => {
      queue.state = state;
      const draft = await createDraft(team.owner.token, ws, { accounts: pages });
      const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');
      expect(res.body.error.message).toMatch(message);
      expect(await PublishJob.countDocuments()).toBe(0);
      expect(await PublishDestination.countDocuments()).toBe(0);
      const status = await as(team.owner.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
      expect(status.body).toMatchObject({ canPublish: false, reason: 'QUEUE_UNAVAILABLE' });
      expect(status.body.queue).toEqual({ status: state });
      expect(status.body.worker).toEqual({ status: 'UNKNOWN' });
    },
  );

  it('reports NOT_CONFIGURED when there is no Redis at all, and never starts a worker', async () => {
    setPublishQueueForTests(null);
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/REDIS_URL/);
    expect(startPublishWorker()).toBeNull();
    const status = await as(team.owner.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
    expect(status.body.queue).toEqual({ status: 'NOT_CONFIGURED' });
  });

  it('reports queue and worker health when everything is up', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const status = await as(team.viewer.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      mode: 'SIMULATED',
      workspaceMode: 'SIMULATED',
      liveAvailable: false,
      canPublish: true,
      reason: null,
      message: null,
      queue: { status: 'READY' },
      worker: { status: 'RUNNING' },
      storage: { publicUrls: false },
    });
    queue.workers = 0;
    const idle = await as(team.owner.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
    expect(idle.body.worker).toEqual({ status: 'NOT_RUNNING' });
  });

  it('never shows a member the queue counts, worker numbers or storage driver', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    for (const member of [team.owner, team.admin, team.editor, team.viewer]) {
      const res = await as(member.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
      expect(res.status).toBe(200);
      expect(res.body.queue).toEqual({ status: 'READY' });
      expect(JSON.stringify(res.body)).not.toMatch(/counts|waiting|delayed|"count"|driver|local/);
    }
    // Not a member of this workspace: the same 404 as an unknown workspace; no session: 401.
    const outsider = await registerUser();
    const other = await as(outsider.token).get(`/api/v1/workspaces/${ws}/publishing/status`);
    expect(other.status).toBe(404);
    expect((await api().get(`/api/v1/workspaces/${ws}/publishing/status`)).status).toBe(401);
  });

  it('keeps the job when Redis drops right after it was recorded, and queues it on recovery', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    queue.failEnqueue = true;
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    expect(queue.pending()).toHaveLength(0);
    queue.failEnqueue = false;
    // Too early: the sweep leaves fresh destinations alone.
    expect((await recoverPublishing({ now: new Date() })).requeued).toBe(0);
    const later = new Date(Date.now() + 5 * 60_000);
    expect((await recoverPublishing({ now: later })).requeued).toBe(2);
    expect(await queue.deliver({ now: later })).toEqual(['published', 'published']);
  });
});

describe('worker execution (simulated adapter)', () => {
  it('publishes every destination and finishes the job, clearly marked as simulated', async () => {
    const draft = await createDraft(team.owner.token, ws, {
      accounts: [...pages, ...instagram],
      media: 'image',
    });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published', 'published', 'published']);
    const job = (await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob;
    expect(job.status).toBe('PUBLISHED');
    expect(job.simulated).toBe(true);
    expect(job.completedAt).toBeTruthy();
    for (const destination of job.destinations) {
      expect(destination).toMatchObject({
        state: 'PUBLISHED',
        simulated: true,
        attemptCount: 1,
        // No post exists, so no id and no link may ever be reported.
        externalPostId: null,
        externalUrl: null,
        error: null,
      });
      expect(destination.attempts).toHaveLength(1);
      expect(destination.attempts[0].outcome).toBe('PUBLISHED');
    }
    const stored = await PublishDestination.find({ job: job.id });
    expect(stored.every((d) => d.externalPostId === undefined && d.active === undefined)).toBe(
      true,
    );
    const finished = await ActivityLog.find({ action: 'publish_job.finished' });
    expect(finished).toHaveLength(1);
    expect(finished[0].metadata).toMatchObject({
      status: 'PUBLISHED',
      simulated: true,
      published: 3,
    });
  });

  it('hands the adapter the right caption and media per platform', async () => {
    const seen = [];
    setSimulatedBehaviourForTests((context) => {
      seen.push({
        platform: context.account.platform,
        caption: context.caption,
        media: context.media,
        token: context.accessToken,
      });
    });
    const draft = await createDraft(team.owner.token, ws, {
      accounts: [pages[0], instagram[0]],
      media: ['image', 'image'],
      caption: 'Shared text',
      platformCaptions: { INSTAGRAM_ACCOUNT: 'Insta text' },
      hashtags: ['launch', 'news'],
      firstComment: 'First!',
    });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const facebook = seen.find((s) => s.platform === 'FACEBOOK_PAGE');
    const insta = seen.find((s) => s.platform === 'INSTAGRAM_ACCOUNT');
    expect(facebook.caption).toBe('Shared text\n\n#launch #news');
    expect(insta.caption).toBe('Insta text\n\n#launch #news');
    expect(facebook.media).toHaveLength(2);
    expect(facebook.media[0]).toMatchObject({ kind: 'IMAGE', mimeType: 'image/jpeg' });
    // The simulated adapter is never given a token.
    expect(seen.every((s) => s.token === null)).toBe(true);
    const job = (await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob;
    expect(job.destinations[0].warnings).toEqual(['FIRST_COMMENT_NOT_SENT']);
  });

  it('one failing destination does not fail the others: PARTIALLY_PUBLISHED', async () => {
    setSimulatedBehaviourForTests((context) => {
      if (context.account.name === 'Page 1') throw rejected();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect((await queue.deliver()).sort()).toEqual(['failed', 'published']);
    const job = (await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob;
    expect(job.status).toBe('PARTIALLY_PUBLISHED');
    expect(job.counts).toMatchObject({ PUBLISHED: 1, FAILED: 1 });
    const failed = job.destinations.find((d) => d.accountName === 'Page 1');
    expect(failed).toMatchObject({ state: 'FAILED', canRetry: true, canCancel: false });
    expect(failed.error).toMatchObject({
      code: 'PLATFORM_REJECTED',
      message: 'Not accepted.',
      retryable: false,
      uncertain: false,
    });
    expect(job.destinations.find((d) => d.accountName === 'Page 0').state).toBe('PUBLISHED');
    const summary = await get(team.owner.token, '/summary');
    expect(summary.body).toMatchObject({ total: 1, counts: { PARTIALLY_PUBLISHED: 1, FAILED: 0 } });
  });

  it('marks the job FAILED only when every destination failed', async () => {
    setSimulatedBehaviourForTests(() => {
      throw rejected();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    expect((await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob.status).toBe(
      'FAILED',
    );
  });

  it('fails a destination whose account was removed or needs reconnecting, without retrying', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await SocialAccount.deleteOne({ _id: pages[0]._id });
    await SocialAccount.updateOne({ _id: pages[1]._id }, { $set: { connectionStatus: 'EXPIRED' } });
    expect(await queue.deliver()).toEqual(['failed', 'failed']);
    const stored = await PublishDestination.find({ job: res.body.publishJob.id }).sort({
      accountName: 1,
    });
    expect(stored.map((d) => d.error.code)).toEqual(['ACCOUNT_REMOVED', 'ACCOUNT_NEEDS_RECONNECT']);
    expect(queue.pending()).toHaveLength(0);
  });

  it('fails when the login behind the account is no longer active', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await markConnection(connection);
    expect(await queue.deliver()).toEqual(['failed']);
  });

  it('refuses to run a job whose mode is no longer the server mode', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    setPublishingSettingsForTests({ ...SETTINGS, mode: 'DISABLED' });
    expect(await queue.deliver()).toEqual(['failed']);
    const [stored] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(stored.error.code).toBe('LIVE_PUBLISHING_DISABLED');
  });
});

describe('retries and exponential backoff', () => {
  it('retries a temporary failure with growing delays, then publishes', async () => {
    let calls = 0;
    setSimulatedBehaviourForTests(() => {
      calls += 1;
      if (calls < 3) throw transient();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const id = res.body.publishJob.destinations[0].id;
    const t0 = new Date();

    expect(await queue.deliver({ now: t0 })).toEqual(['retry']);
    let stored = await PublishDestination.findById(id);
    expect(stored).toMatchObject({ state: 'RETRY_SCHEDULED', attemptCount: 1 });
    expect(stored.nextAttemptAt.getTime() - stored.error.at.getTime()).toBe(30_000);
    expect(stored.active).toBe(true);
    expect((await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob.status).toBe(
      'PROCESSING',
    );
    expect(queue.pending()[0].delayMs).toBeGreaterThanOrEqual(29_000);

    // Delivered before its time, nothing happens.
    expect(await processDestination(id, { now: new Date(t0.getTime() + 1000) })).toBe('skipped');

    const t1 = stored.nextAttemptAt;
    expect(await queue.deliver({ now: t1 })).toEqual(['retry']);
    stored = await PublishDestination.findById(id);
    expect(stored.attemptCount).toBe(2);
    expect(stored.nextAttemptAt.getTime() - stored.error.at.getTime()).toBe(60_000);

    expect(await queue.deliver({ now: stored.nextAttemptAt })).toEqual(['published']);
    stored = await PublishDestination.findById(id);
    expect(stored).toMatchObject({ state: 'PUBLISHED', attemptCount: 3 });
    expect(stored.attempts.map((a) => a.outcome)).toEqual(['RETRY', 'RETRY', 'PUBLISHED']);
    expect(stored.error).toBeUndefined();
  });

  it('gives up after the allowed number of attempts', async () => {
    setSimulatedBehaviourForTests(() => {
      throw transient();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const id = res.body.publishJob.destinations[0].id;
    const day = (n) => new Date(Date.now() + n * 86_400_000);
    expect(await queue.deliver({ now: day(1) })).toEqual(['retry']);
    expect(await queue.deliver({ now: day(2) })).toEqual(['retry']);
    expect(await queue.deliver({ now: day(3) })).toEqual(['failed']);
    const stored = await PublishDestination.findById(id);
    expect(stored).toMatchObject({ state: 'FAILED', attemptCount: 3 });
    expect(stored.error).toMatchObject({ code: 'PLATFORM_UNAVAILABLE', retryable: true });
    expect(queue.pending()).toHaveLength(0);
  });

  it('never retries a failure that is not temporary', async () => {
    setSimulatedBehaviourForTests(() => {
      throw rejected();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    expect(queue.pending()).toHaveLength(0);
  });

  it('waits at least as long as the platform asks for', async () => {
    setSimulatedBehaviourForTests(() => {
      throw new PublishError('RATE_LIMITED', 'Slow down.', {
        retryable: true,
        retryAfterMs: 600_000,
      });
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const stored = await PublishDestination.findById(res.body.publishJob.destinations[0].id);
    expect(stored.nextAttemptAt.getTime() - stored.error.at.getTime()).toBe(600_000);
  });

  it('treats an unexpected crash in an adapter as a temporary failure with a safe message', async () => {
    setSimulatedBehaviourForTests(() => {
      throw new TypeError('secret internals token=abc');
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['retry']);
    const stored = await PublishDestination.findById(res.body.publishJob.destinations[0].id);
    expect(stored.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong while publishing.',
    });
  });

  it('lets a person retry a failed destination, with a fresh set of attempts', async () => {
    let failing = true;
    setSimulatedBehaviourForTests(() => {
      if (failing) throw rejected();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const jobId = res.body.publishJob.id;
    const target = (await get(team.owner.token, `/${jobId}`)).body.publishJob.destinations[0];
    failing = false;

    const retried = await as(team.owner.token).post(
      publishUrl(ws, `/${jobId}/destinations/${target.id}/retry`),
    );
    expect(retried.status).toBe(200);
    expect(retried.body.publishJob.status).toBe('PROCESSING');
    const waiting = retried.body.publishJob.destinations.find((d) => d.id === target.id);
    expect(waiting).toMatchObject({
      state: 'QUEUED',
      attemptCount: 1,
      maxAttempts: 4,
      canRetry: false,
    });

    // A second click does not queue it twice.
    const again = await as(team.owner.token).post(
      publishUrl(ws, `/${jobId}/destinations/${target.id}/retry`),
    );
    expect(again.status).toBe(409);
    expect(queue.pending()).toHaveLength(1);

    expect(await queue.deliver()).toEqual(['published']);
    const done = (await get(team.owner.token, `/${jobId}`)).body.publishJob;
    expect(done.status).toBe('PARTIALLY_PUBLISHED');
    expect(await ActivityLog.countDocuments({ action: 'publish_destination.retried' })).toBe(1);
    // Finished twice (before and after the retry): logged each time it finished.
    expect(await ActivityLog.countDocuments({ action: 'publish_job.finished' })).toBe(2);
  });

  it('asks for confirmation before retrying when the post may already exist', async () => {
    setSimulatedBehaviourForTests(() => {
      throw new PublishError('OUTCOME_UNKNOWN', 'No answer after sending.');
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['failed']);
    const jobId = res.body.publishJob.id;
    const [target] = (await get(team.owner.token, `/${jobId}`)).body.publishJob.destinations;
    expect(target.error.uncertain).toBe(true);
    const url = publishUrl(ws, `/${jobId}/destinations/${target.id}/retry`);
    const blocked = await as(team.owner.token).post(url).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.reason).toBe('DUPLICATE_RISK');
    const confirmed = await as(team.owner.token).post(url).send({ acknowledgeDuplicateRisk: true });
    expect(confirmed.status).toBe(200);
  });
});

describe('idempotency and duplicate prevention', () => {
  it('returns the same job for the same key, creating nothing new', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const body = { contentPackageId: draft.id, idempotencyKey: newKey() };
    const first = await as(team.owner.token).post(publishUrl(ws)).send(body);
    const second = await as(team.owner.token).post(publishUrl(ws)).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.publishJob.id).toBe(first.body.publishJob.id);
    expect(await PublishJob.countDocuments()).toBe(1);
    expect(await PublishDestination.countDocuments()).toBe(2);
    expect(queue.entries).toHaveLength(2);
  });

  it('creates one job when the same request arrives several times at once', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const body = { contentPackageId: draft.id, idempotencyKey: newKey() };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => as(team.owner.token).post(publishUrl(ws)).send(body)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.publishJob.id)).size).toBe(1);
    expect(await PublishJob.countDocuments()).toBe(1);
    expect(await PublishDestination.countDocuments()).toBe(2);
    expect(queue.entries).toHaveLength(2);
  });

  it('refuses a key that was already used for a different post', async () => {
    const one = await createDraft(team.owner.token, ws, { accounts: pages });
    const two = await createDraft(team.owner.token, ws, { accounts: pages });
    const idempotencyKey = newKey();
    await as(team.owner.token)
      .post(publishUrl(ws))
      .send({ contentPackageId: one.id, idempotencyKey });
    const res = await as(team.owner.token)
      .post(publishUrl(ws))
      .send({ contentPackageId: two.id, idempotencyKey });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('still returns the job for a repeated key while the queue is down', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const body = { contentPackageId: draft.id, idempotencyKey: newKey() };
    await as(team.owner.token).post(publishUrl(ws)).send(body);
    queue.state = QUEUE_STATUS.UNAVAILABLE;
    expect((await as(team.owner.token).post(publishUrl(ws)).send(body)).status).toBe(200);
  });

  it('refuses a second job for a post that is already on its way to the same account', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      socialAccountIds: [String(pages[0]._id)],
      republish: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ reason: 'IN_PROGRESS', accounts: ['Page 0'] });
    expect(await PublishJob.countDocuments()).toBe(1);
  });

  it('the database itself refuses two active destinations for one post and account', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const [existing] = await PublishDestination.find();
    const copy = existing.toObject();
    delete copy._id;
    await expect(PublishDestination.create({ ...copy, job: '5'.repeat(24) })).rejects.toMatchObject(
      { code: 11000 },
    );
  });

  it('refuses to publish again to an account that already got the post, unless asked to', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const again = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('ALREADY_PUBLISHED');
    expect(again.body.error.details.accounts.sort()).toEqual(['Page 0', 'Page 1']);
    const forced = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      republish: true,
    });
    expect(forced.status).toBe(201);
  });

  it('processes a destination once even when its queue entry is delivered many times at once', async () => {
    let calls = 0;
    setSimulatedBehaviourForTests(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const id = res.body.publishJob.destinations[0].id;
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => processDestination(id)));
    expect(outcomes.filter((o) => o === 'published')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'skipped')).toHaveLength(5);
    expect(calls).toBe(1);
    expect(await processDestination(id)).toBe('skipped');
    const stored = await PublishDestination.findById(id);
    expect(stored.attemptCount).toBe(1);
    expect(stored.attempts).toHaveLength(1);
  });

  it('keeps job counts right when many destinations finish at the same moment', async () => {
    const more = await seedSocialAccounts(ws, team.owner.user.id, {
      pages: 8,
      instagram: 0,
      externalUserId: 'fb-user-2',
    });
    const all = [...pages, ...more.accounts];
    setSimulatedBehaviourForTests((context) => {
      if (context.account.name === 'Page 3' && context.account.externalId.startsWith('fb-user-2'))
        throw rejected();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: all });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await Promise.all(queue.pending().map((entry) => processDestination(entry.destinationId)));
    const job = await PublishJob.findById(res.body.publishJob.id);
    expect(job.counts).toMatchObject({ PUBLISHED: 9, FAILED: 1, PROCESSING: 0, QUEUED: 0 });
    expect(job.status).toBe('PARTIALLY_PUBLISHED');
    expect(await ActivityLog.countDocuments({ action: 'publish_job.finished' })).toBe(1);
  });
});

describe('cancellation', () => {
  it('cancels every waiting destination and removes the queue entries', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    expect(res.body.publishJob.canCancel).toBe(true);
    const cancelled = await as(team.owner.token).post(publishUrl(ws, `/${jobId}/cancel`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.publishJob.status).toBe('CANCELLED');
    expect(cancelled.body.publishJob.destinations.every((d) => d.state === 'CANCELLED')).toBe(true);
    expect(queue.removed).toHaveLength(2);
    expect(queue.pending()).toHaveLength(0);
    // Nothing left to cancel.
    expect((await as(team.owner.token).post(publishUrl(ws, `/${jobId}/cancel`))).status).toBe(409);
    expect(await ActivityLog.countDocuments({ action: 'publish_job.cancelled' })).toBe(1);
  });

  it('a cancelled destination is never published, even if its queue entry still arrives', async () => {
    let calls = 0;
    setSimulatedBehaviourForTests(() => {
      calls += 1;
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const [target] = res.body.publishJob.destinations;
    await as(team.owner.token).post(publishUrl(ws, `/${res.body.publishJob.id}/cancel`));
    expect(await processDestination(target.id)).toBe('skipped');
    expect(calls).toBe(0);
    expect((await PublishDestination.findById(target.id)).state).toBe('CANCELLED');
  });

  it('cancels one destination and lets the others go out', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    const [first] = res.body.publishJob.destinations;
    const one = await as(team.owner.token).post(
      publishUrl(ws, `/${jobId}/destinations/${first.id}/cancel`),
    );
    expect(one.status).toBe(200);
    expect(await queue.deliver()).toEqual(['published']);
    const job = (await get(team.owner.token, `/${jobId}`)).body.publishJob;
    expect(job.status).toBe('PARTIALLY_PUBLISHED');
    expect(job.counts).toMatchObject({ CANCELLED: 1, PUBLISHED: 1 });
  });

  it('cannot cancel a destination that is being processed or is finished', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    const [a, b] = res.body.publishJob.destinations;
    await PublishDestination.updateOne(
      { _id: a.id },
      { $set: { state: 'PROCESSING', lockToken: 'x', lockedUntil: new Date(Date.now() + 60_000) } },
    );
    await processDestination(b.id);
    for (const target of [a, b]) {
      const res2 = await as(team.owner.token).post(
        publishUrl(ws, `/${jobId}/destinations/${target.id}/cancel`),
      );
      expect(res2.status).toBe(409);
    }
    expect((await as(team.owner.token).post(publishUrl(ws, `/${jobId}/cancel`))).status).toBe(409);
    expect((await PublishDestination.findById(a.id)).state).toBe('PROCESSING');
  });

  it('can cancel a destination that is waiting for a retry', async () => {
    setSimulatedBehaviourForTests(() => {
      throw transient();
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const cancelled = await as(team.owner.token).post(
      publishUrl(ws, `/${res.body.publishJob.id}/cancel`),
    );
    expect(cancelled.body.publishJob.status).toBe('CANCELLED');
    expect(await queue.deliver({ now: new Date(Date.now() + 86_400_000) })).toEqual([]);
  });
});

describe('interrupted workers', () => {
  it('marks a destination whose worker stopped as interrupted, and never repeats it by itself', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const [a] = res.body.publishJob.destinations;
    const started = new Date();
    await PublishDestination.updateOne(
      { _id: a.id },
      {
        $set: {
          state: 'PROCESSING',
          lockToken: 'dead',
          lockedUntil: new Date(started.getTime() + CLAIM_MS),
          processingAt: started,
          // The worker had already handed the post to the platform.
          sendingAt: started,
        },
        $inc: { attemptCount: 1 },
      },
    );
    await syncJob(res.body.publishJob.id);
    // While the claim is valid nobody else may touch it.
    expect(await processDestination(a.id, { now: new Date(started.getTime() + 1000) })).toBe(
      'skipped',
    );
    expect((await recoverPublishing({ now: new Date(started.getTime() + 1000) })).interrupted).toBe(
      0,
    );

    const later = new Date(started.getTime() + CLAIM_MS + 1000);
    expect((await recoverPublishing({ now: later })).interrupted).toBe(1);
    const stored = await PublishDestination.findById(a.id);
    expect(stored.state).toBe('FAILED');
    expect(stored.error).toMatchObject({ code: 'INTERRUPTED', retryable: false });
    expect(queue.pending().some((e) => e.destinationId === a.id && e.seq > 1)).toBe(false);
    const view = (await get(team.owner.token, `/${res.body.publishJob.id}`)).body.publishJob;
    expect(view.destinations.find((d) => d.id === a.id).error.uncertain).toBe(true);
  });

  /** A destination left PROCESSING by a worker that stopped BEFORE handing it over. */
  async function stoppedBeforeSending({ attempts = 1, max } = {}) {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const [a] = res.body.publishJob.destinations;
    const started = new Date(Date.now() - CLAIM_MS - 60_000);
    await PublishDestination.updateOne(
      { _id: a.id },
      {
        $set: {
          state: 'PROCESSING',
          lockToken: 'dead',
          lockedUntil: new Date(started.getTime() + CLAIM_MS),
          processingAt: started,
          attemptCount: attempts,
          ...(max ? { maxAttempts: max } : {}),
        },
      },
    );
    return { jobId: res.body.publishJob.id, id: a.id };
  }

  it('queues a destination again when its worker stopped before sending anything', async () => {
    const { jobId, id } = await stoppedBeforeSending();
    let sends = 0;
    setSimulatedBehaviourForTests(() => {
      sends += 1;
    });
    expect(await recoverPublishing()).toMatchObject({ restarted: 1, interrupted: 0 });
    const waiting = await PublishDestination.findById(id);
    expect(waiting.state).toBe('RETRY_SCHEDULED');
    expect(waiting.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
    expect(queue.pending().some((e) => e.destinationId === id)).toBe(true);
    expect(await processDestination(id)).toBe('published');
    expect(sends).toBe(1);
    expect((await PublishJob.findById(jobId)).status).toBe('PUBLISHED');
  });

  it('fails plainly (no duplicate warning) once a never-sent destination used its attempts', async () => {
    const { jobId, id } = await stoppedBeforeSending({ attempts: 3, max: 3 });
    expect(await recoverPublishing()).toMatchObject({ restarted: 1 });
    const stored = await PublishDestination.findById(id);
    expect(stored.state).toBe('FAILED');
    expect(stored.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
    const view = (await get(team.owner.token, `/${jobId}`)).body.publishJob;
    expect(view.destinations[0].error.uncertain).toBe(false);
    // A person may retry it without acknowledging a duplicate risk.
    const retry = await as(team.owner.token)
      .post(publishUrl(ws, `/${jobId}/destinations/${id}/retry`))
      .send({});
    expect(retry.status).toBe(200);
  });

  it('marks the send just before handing over, and clears the mark when the attempt ends', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const [a] = res.body.publishJob.destinations;
    let markedDuringSend = null;
    setSimulatedBehaviourForTests(async () => {
      markedDuringSend = (await PublishDestination.findById(a.id).lean()).sendingAt;
    });
    expect(await processDestination(a.id)).toBe('published');
    expect(markedDuringSend).toBeInstanceOf(Date);
    expect((await PublishDestination.findById(a.id).lean()).sendingAt).toBeUndefined();
  });

  it('repairs a job whose status update failed, and leaves correct jobs alone', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    expect(await processDestination(res.body.publishJob.destinations[0].id)).toBe('published');
    // As if the last status update had failed: the job still says PROCESSING.
    const old = new Date(Date.now() - 10 * 60_000);
    await PublishJob.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(jobId) },
      { $set: { status: 'PROCESSING', updatedAt: old } },
    );
    expect((await recoverPublishing()).resynced).toBe(1);
    expect((await PublishJob.findById(jobId)).status).toBe('PUBLISHED');
    expect((await recoverPublishing()).resynced).toBe(0);
  });

  describe('when the post was sent but saving the result fails', () => {
    // Simulates MongoDB failing exactly when the "published" result is written.
    const failSaving = (times) => {
      const original = PublishDestination.findOneAndUpdate.bind(PublishDestination);
      let left = times;
      return vi
        .spyOn(PublishDestination, 'findOneAndUpdate')
        .mockImplementation((filter, update, options) => {
          if (update?.$set?.state === 'PUBLISHED' && left > 0) {
            left -= 1;
            return Promise.reject(new Error('MongoDB is briefly unavailable'));
          }
          return original(filter, update, options);
        });
    };
    afterEach(() => vi.restoreAllMocks());

    it('never sends it again: the destination is left for the sweep to mark interrupted', async () => {
      const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
      const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
      const [a] = res.body.publishJob.destinations;
      let sends = 0;
      setSimulatedBehaviourForTests(() => {
        sends += 1;
      });
      failSaving(Infinity);
      expect(await processDestination(a.id, { saveRetryDelaysMs: [0, 0] })).toBe('interrupted');
      vi.restoreAllMocks();
      expect(sends).toBe(1);
      const stored = await PublishDestination.findById(a.id);
      // Still claimed: no retry was scheduled and no second queue entry exists.
      expect(stored.state).toBe('PROCESSING');
      expect(queue.pending().some((e) => e.destinationId === a.id && e.seq > 1)).toBe(false);
      const later = new Date(Date.now() + CLAIM_MS + 1000);
      expect((await recoverPublishing({ now: later })).interrupted).toBe(1);
      expect((await PublishDestination.findById(a.id)).error).toMatchObject({
        code: 'INTERRUPTED',
      });
      expect(sends).toBe(1);
    });

    it('records the result when saving works on a second try', async () => {
      const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
      const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
      const [a] = res.body.publishJob.destinations;
      failSaving(1);
      expect(await processDestination(a.id, { saveRetryDelaysMs: [0, 0] })).toBe('published');
      expect((await PublishDestination.findById(a.id)).state).toBe('PUBLISHED');
      expect((await PublishJob.findById(res.body.publishJob.id)).status).toBe('PUBLISHED');
    });
  });
});

describe('permissions and isolation', () => {
  it('viewers can read but cannot publish, cancel or retry', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    const [target] = res.body.publishJob.destinations;
    await Membership.updateOne(
      { _id: team.viewer.membershipId },
      { $set: { 'accountAccess.mode': 'ALL' } },
    );

    const denied = await publish(team.viewer.token, ws, { contentPackageId: draft.id });
    expect(denied.status).toBe(403);
    expect((await as(team.viewer.token).post(publishUrl(ws, `/${jobId}/cancel`))).status).toBe(403);
    expect(
      (
        await as(team.viewer.token).post(
          publishUrl(ws, `/${jobId}/destinations/${target.id}/retry`),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await as(team.viewer.token).post(
          publishUrl(ws, `/${jobId}/destinations/${target.id}/cancel`),
        )
      ).status,
    ).toBe(403);

    const list = await get(team.viewer.token);
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ canCancel: false });
    expect(list.body.items[0].destinations.every((d) => !d.canRetry && !d.canCancel)).toBe(true);
    expect(await PublishJob.countDocuments()).toBe(1);
  });

  it('an editor can publish only drafts they may see, and only to accounts assigned to them', async () => {
    // A draft for two pages is invisible to an editor who has one of them (or none).
    const shared = await createDraft(team.owner.token, ws, { accounts: pages });
    const none = await publish(team.editor.token, ws, { contentPackageId: shared.id });
    expect(none.status).toBe(404);
    await grant(team.editor, [pages[0]]);
    const partial = await publish(team.editor.token, ws, {
      contentPackageId: shared.id,
      socialAccountIds: [String(pages[0]._id)],
    });
    expect(partial.status).toBe(404);
    expect(JSON.stringify(partial.body)).not.toContain(String(pages[1]._id));

    // A draft they may see can still only go to their own accounts.
    const own = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const both = await publish(team.editor.token, ws, {
      contentPackageId: own.id,
      socialAccountIds: pages.map((p) => String(p._id)),
    });
    expect(both.status).toBe(422);
    expect(both.body.error.details.fields.socialAccountIds).toMatch(/not available to you/);
    const ok = await publish(team.editor.token, ws, {
      contentPackageId: own.id,
      socialAccountIds: [String(pages[0]._id)],
    });
    expect(ok.status).toBe(201);
    expect(await PublishDestination.countDocuments()).toBe(1);
  });

  it('gives the same answer for unknown, foreign and unassigned account ids', async () => {
    const stranger = await registerUser({ name: 'Stranger' });
    const other = await createWorkspace(stranger.token, { name: 'Other' });
    const foreign = await seedSocialAccounts(other.workspace.id, stranger.user.id, {
      pages: 1,
      instagram: 0,
      externalUserId: 'fb-other',
    });
    await grant(team.editor, [pages[0]]);
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const answers = [];
    for (const id of ['b'.repeat(24), String(foreign.accounts[0]._id), String(pages[1]._id)]) {
      const res = await publish(team.editor.token, ws, {
        contentPackageId: draft.id,
        socialAccountIds: [id],
      });
      answers.push([res.status, res.body.error.details.fields.socialAccountIds]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0][0]).toBe(422);
    expect(await PublishJob.countDocuments()).toBe(0);
  });

  it('hides a job entirely from a reader who cannot use every account it targets', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    const [first, second] = res.body.publishJob.destinations;
    await grant(team.editor, [pages[0]]);

    const view = await get(team.editor.token, `/${jobId}`);
    expect(view.status).toBe(404);
    expect(JSON.stringify(view.body)).not.toContain('Hello from the test');
    expect((await get(team.editor.token)).body.items).toEqual([]);
    expect((await get(team.editor.token, '/summary')).body.total).toBe(0);

    const tries = [
      as(team.editor.token).post(publishUrl(ws, `/${jobId}/cancel`)),
      as(team.editor.token).post(publishUrl(ws, `/${jobId}/destinations/${first.id}/cancel`)),
      as(team.editor.token).post(publishUrl(ws, `/${jobId}/destinations/${second.id}/cancel`)),
      as(team.editor.token).post(publishUrl(ws, `/${jobId}/destinations/${first.id}/retry`)),
    ];
    for (const attempt of await Promise.all(tries)) expect(attempt.status).toBe(404);
    expect((await PublishDestination.find({ job: jobId })).map((d) => d.state)).toEqual([
      'QUEUED',
      'QUEUED',
    ]);

    // A job for their own account they can see and act on.
    const ownDraft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const ownJob = (await publish(team.owner.token, ws, { contentPackageId: ownDraft.id })).body
      .publishJob;
    const listed = (await get(team.editor.token)).body.items;
    expect(listed.map((job) => job.id)).toEqual([ownJob.id]);
    expect(listed[0].hiddenDestinationCount).toBe(0);
    expect((await get(team.editor.token, '/summary')).body.total).toBe(1);
    const cancel = await as(team.editor.token).post(
      publishUrl(ws, `/${ownJob.id}/destinations/${ownJob.destinations[0].id}/cancel`),
    );
    expect(cancel.status).toBe(200);
  });

  it('keeps workspaces apart', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const jobId = res.body.publishJob.id;
    const stranger = await registerUser({ name: 'Stranger' });
    const other = await createWorkspace(stranger.token, { name: 'Other' });
    const otherWs = other.workspace.id;

    expect((await get(stranger.token, `/${jobId}`)).status).toBe(404);
    expect((await get(stranger.token, `/${jobId}`, otherWs)).status).toBe(404);
    expect((await get(stranger.token, '', otherWs)).body.items).toEqual([]);
    expect((await get(stranger.token, '/summary', otherWs)).body.total).toBe(0);
    expect((await as(stranger.token).post(publishUrl(otherWs, `/${jobId}/cancel`))).status).toBe(
      404,
    );
    // Another workspace's draft cannot be published from here.
    const cross = await publish(stranger.token, otherWs, {
      contentPackageId: draft.id,
      socialAccountIds: [String(pages[0]._id)],
    });
    expect(cross.status).toBe(404);
    expect((await as(null).get(publishUrl(ws))).status).toBe(401);
  });

  it('never returns or stores a token anywhere in the publishing data', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    await queue.deliver();
    const bodies = [
      res.body,
      (await get(team.owner.token)).body,
      (await get(team.owner.token, `/${res.body.publishJob.id}`)).body,
    ];
    const stored = [
      await PublishJob.find().lean(),
      await PublishDestination.find().lean(),
      await ActivityLog.find().lean(),
    ];
    for (const value of [...bodies, ...stored, queue.entries]) {
      expect(JSON.stringify(value)).not.toMatch(/page-token-SECRET/);
    }
    // Internal fields never leave the API either.
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toMatch(
        /accessToken|ciphertext|lockToken|requestHash|idempotencyKey|providerState/,
      );
    }
  });
});

describe('listing and history', () => {
  it('lists newest first, filters by status and pages', async () => {
    setSimulatedBehaviourForTests((context) => {
      if (context.caption.startsWith('fail')) throw rejected();
    });
    const ids = [];
    for (const caption of ['ok one', 'fail two', 'ok three']) {
      const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], caption });
      ids.push(
        (await publish(team.owner.token, ws, { contentPackageId: draft.id })).body.publishJob.id,
      );
    }
    await processDestination((await PublishDestination.findOne({ job: ids[0] }))._id);
    await processDestination((await PublishDestination.findOne({ job: ids[1] }))._id);

    const all = await get(team.owner.token, '?limit=2');
    expect(all.body.items.map((j) => j.id)).toEqual([ids[2], ids[1]]);
    const next = await get(team.owner.token, `?limit=2&cursor=${all.body.nextCursor}`);
    expect(next.body.items.map((j) => j.id)).toEqual([ids[0]]);
    expect(next.body.nextCursor).toBeNull();
    expect((await get(team.owner.token, '?status=FAILED')).body.items.map((j) => j.id)).toEqual([
      ids[1],
    ]);
    expect((await get(team.owner.token, '?status=QUEUED')).body.items.map((j) => j.id)).toEqual([
      ids[2],
    ]);
    expect((await get(team.owner.token, '?status=NOPE')).status).toBe(422);
    expect((await get(team.owner.token, '/summary')).body).toMatchObject({
      total: 3,
      counts: { PUBLISHED: 1, FAILED: 1, QUEUED: 1 },
    });
    expect(all.body.items[0].createdBy.name).toBe('Olivia Owner');
  });
});

describe('media of posts that are still being published', () => {
  it('cannot be deleted and survives the clean-up, even after the draft is gone', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]], media: 'image' });
    const mediaId = draft.media[0].mediaId;
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(201);
    await as(team.owner.token).delete(`/api/v1/workspaces/${ws}/content-packages/${draft.id}`);
    const del = await as(team.owner.token).delete(`/api/v1/workspaces/${ws}/media/${mediaId}`);
    expect(del.status).toBe(409);
    const result = await cleanupMedia({ now: new Date(Date.now() + 2 * 86_400_000) });
    expect(result.unreferenced).toBe(0);
    const at = new Date(Date.now() + 3 * 86_400_000);
    expect(await queue.deliver({ now: at })).toEqual(['published']);
  });
});

describe('rehearsing failures with simulated test accounts', () => {
  const rename = (account, externalId) =>
    SocialAccount.updateOne({ _id: account._id }, { $set: { externalId } });

  it('test accounts whose id starts with a sim- prefix behave as named', async () => {
    const more = await seedSocialAccounts(ws, team.owner.user.id, {
      pages: 3,
      instagram: 0,
      externalUserId: 'extra',
    });
    const [refuses, flaky, unknown] = more.accounts;
    await rename(refuses, 'sim-fail-page');
    await rename(flaky, 'sim-flaky-page');
    await rename(unknown, 'sim-unknown-page');
    const draft = await createDraft(team.owner.token, ws, {
      accounts: [pages[0], refuses, flaky, unknown],
    });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const first = await queue.deliver();
    expect([...first].sort()).toEqual(['failed', 'failed', 'published', 'retry']);
    expect(await queue.deliver({ now: new Date(Date.now() + 3_600_000) })).toEqual(['published']);

    const stored = await PublishDestination.find({ job: res.body.publishJob.id });
    const by = (id) => stored.find((d) => String(d.socialAccount) === String(id));
    expect(by(refuses._id).error.code).toBe('PLATFORM_REJECTED');
    expect(by(unknown._id).error).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
    expect(by(flaky._id)).toMatchObject({ state: 'PUBLISHED', attemptCount: 2 });
    // Whatever was rehearsed, nothing gets a post id.
    expect(stored.every((d) => d.externalPostId === undefined && d.simulated)).toBe(true);
  });

  it('a real Meta id (digits only) can never match a rehearsal prefix', async () => {
    await rename(pages[0], '104857600123456');
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(await queue.deliver()).toEqual(['published']);
  });
});
