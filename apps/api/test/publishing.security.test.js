import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityLog,
  Membership,
  PublishDestination,
  PublishJob,
  Workspace,
} from '../src/models/index.js';
import { setHealthDetailsTokenForTests } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { setSimulatedBehaviourForTests } from '../src/modules/publishing/adapters/simulated.js';
import {
  processDestination,
  recoverPublishing,
} from '../src/modules/publishing/publishing.processor.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { api, as, seedSocialAccounts, seedTeam } from './helpers.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish,
  publishUrl,
} from './publishFixtures.js';

/**
 * Security of the publishing engine (stabilization, 2026-11-23). Real API, real processor and
 * an in-memory MongoDB; the simulated adapter stands in for Meta and a test-only queue for
 * Redis. Nothing here contacts Meta or Redis.
 *
 *  1. A post is only sent while the member it relies on may still publish it.
 *  2. A job made from a draft hidden from a member is hidden too (404), whatever it was sent to.
 *  3. Public health shows no internal details; the monitoring details need a token.
 */

let team;
let ws;
let pages;
let queue;
let sends;

const SETTINGS = { mode: 'SIMULATED', maxAttempts: 3, retryBaseMs: 30_000, retryMaxMs: 900_000 };

const grant = (member, accounts) =>
  Membership.updateOne(
    { _id: member.membershipId },
    { $set: { accountAccess: { mode: 'SELECTED', socialAccounts: accounts.map((a) => a._id) } } },
  );

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 0 });
  pages = seeded.accounts;
  await giveTokens(pages);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests(SETTINGS);
  sends = 0;
  setSimulatedBehaviourForTests(() => {
    sends += 1;
  });
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setSimulatedBehaviourForTests(null);
  setHealthDetailsTokenForTests(undefined);
});

/** The editor (with access to the first Page) schedules a post to it. */
async function editorSchedules() {
  await grant(team.editor, [pages[0]]);
  const draft = await createDraft(team.editor.token, ws, { accounts: [pages[0]] });
  const scheduledAt = new Date(Date.now() + 60 * 60_000);
  const res = await publish(team.editor.token, ws, {
    contentPackageId: draft.id,
    scheduledAt: scheduledAt.toISOString(),
  });
  expect(res.status).toBe(201);
  const [destination] = res.body.publishJob.destinations;
  return {
    jobId: res.body.publishJob.id,
    id: destination.id,
    at: new Date(scheduledAt.getTime() + 1000),
  };
}

const blockedEntries = () =>
  ActivityLog.find({ workspace: ws, action: 'publish_destination.blocked' }).lean();

describe('1. authorization is checked again just before sending', () => {
  it('sends while the author may still publish to the account', async () => {
    const { id, at } = await editorSchedules();
    expect(await processDestination(id, { now: at })).toBe('published');
    expect(sends).toBe(1);
  });

  it.each([
    [
      'the author left the workspace',
      () => Membership.deleteOne({ _id: team.editor.membershipId }),
      'NOT_A_MEMBER',
      /no longer a member/,
    ],
    [
      'the author became a viewer',
      () => Membership.updateOne({ _id: team.editor.membershipId }, { $set: { role: 'VIEWER' } }),
      'NO_PUBLISH_PERMISSION',
      /may no longer publish/,
    ],
    [
      'the author lost access to the account',
      () => grant(team.editor, [pages[1]]),
      'NO_ACCOUNT_ACCESS',
      /may no longer use this account/,
    ],
  ])(
    'blocks the send when %s: nothing is sent, nothing is retried, it is logged',
    async (_, revoke, reason, message) => {
      const { jobId, id, at } = await editorSchedules();
      await revoke();
      const entriesBefore = queue.pending().length;
      expect(await processDestination(id, { now: at })).toBe('failed');
      expect(sends).toBe(0);
      const stored = await PublishDestination.findById(id).lean();
      expect(stored.state).toBe('FAILED');
      expect(stored.error).toMatchObject({ code: 'AUTHOR_NOT_AUTHORIZED', retryable: false });
      expect(stored.error.message).toMatch(message);
      expect(stored.sendingAt).toBeUndefined();
      // No automatic retry was queued, and a later sweep leaves it alone.
      expect(queue.pending().length).toBe(entriesBefore);
      expect(await recoverPublishing({ now: new Date(at.getTime() + 60 * 60_000) })).toMatchObject({
        interrupted: 0,
        restarted: 0,
      });
      expect((await PublishJob.findById(jobId)).status).toBe('FAILED');
      const [entry] = await blockedEntries();
      expect(entry).toMatchObject({
        target: { type: 'publish_job', label: pages[0].name },
        metadata: { reason, platform: 'FACEBOOK_PAGE', simulated: true },
      });
      // Not "may have been published": nothing was sent.
      const view = (await as(team.owner.token).get(publishUrl(ws, `/${jobId}`))).body.publishJob;
      expect(view.destinations[0].error.uncertain).toBe(false);
    },
  );

  it('lets an admin take over: a retry relies on the admin, and is sent', async () => {
    const { jobId, id, at } = await editorSchedules();
    await Membership.deleteOne({ _id: team.editor.membershipId });
    expect(await processDestination(id, { now: at })).toBe('failed');
    const retry = await as(team.admin.token)
      .post(publishUrl(ws, `/${jobId}/destinations/${id}/retry`))
      .send({});
    expect(retry.status).toBe(200);
    expect(String((await PublishDestination.findById(id)).authorizedBy)).toBe(team.admin.user.id);
    expect(await processDestination(id)).toBe('published');
    expect(sends).toBe(1);
  });

  it('a new time chosen by another member makes the send rely on that member', async () => {
    const { jobId, id, at } = await editorSchedules();
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    const moved = await as(team.owner.token)
      .patch(publishUrl(ws, `/${jobId}/schedule`))
      .send({ scheduledAt: later.toISOString() });
    expect(moved.status).toBe(200);
    expect(String((await PublishDestination.findById(id)).authorizedBy)).toBe(team.owner.user.id);
    // The editor leaving no longer matters: the owner chose this time.
    await Membership.deleteOne({ _id: team.editor.membershipId });
    expect(await processDestination(id, { now: new Date(later.getTime() + 1000) })).toBe(
      'published',
    );
    expect(at).toBeInstanceOf(Date);
  });

  it('does not send for a workspace that no longer exists, and logs nothing there', async () => {
    const { id, at } = await editorSchedules();
    await Workspace.deleteOne({ _id: ws });
    expect(await processDestination(id, { now: at })).toBe('failed');
    expect(sends).toBe(0);
    expect(await blockedEntries()).toHaveLength(0);
  });
});

describe('2. a job made from a hidden draft is hidden too', () => {
  const SECRET = 'Unannounced: do not leak this caption';

  /** Draft for both Pages, published by the owner to the first Page only. */
  async function jobFromHiddenDraft() {
    const draft = await createDraft(team.owner.token, ws, {
      accounts: pages,
      caption: SECRET,
    });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      socialAccountIds: [String(pages[0]._id)],
    });
    expect(res.status).toBe(201);
    await grant(team.editor, [pages[0]]);
    return { job: res.body.publishJob, draft };
  }

  it('hides it from lists, details and the summary, like an unknown id', async () => {
    const { job } = await jobFromHiddenDraft();
    await processDestination(job.destinations[0].id);
    const editor = as(team.editor.token);
    const list = await editor.get(publishUrl(ws));
    expect(list.body.items).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain(SECRET.slice(0, 20));
    expect((await editor.get(publishUrl(ws, '/summary'))).body.total).toBe(0);
    const detail = await editor.get(publishUrl(ws, `/${job.id}`));
    const unknown = await editor.get(publishUrl(ws, `/${'a'.repeat(24)}`));
    expect(detail.status).toBe(404);
    expect(detail.body.error.message).toBe(unknown.body.error.message);
    // The owner still sees everything.
    expect((await as(team.owner.token).get(publishUrl(ws, `/${job.id}`))).status).toBe(200);
  });

  it('answers 404 to cancel, retry and reschedule as well', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages, caption: SECRET });
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      socialAccountIds: [String(pages[0]._id)],
      scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    const job = res.body.publishJob;
    await grant(team.editor, [pages[0]]);
    const editor = as(team.editor.token);
    const destination = job.destinations[0].id;
    const attempts = [
      editor.post(publishUrl(ws, `/${job.id}/cancel`)).send({}),
      editor.post(publishUrl(ws, `/${job.id}/destinations/${destination}/cancel`)).send({}),
      editor.post(publishUrl(ws, `/${job.id}/destinations/${destination}/retry`)).send({}),
      editor
        .patch(publishUrl(ws, `/${job.id}/schedule`))
        .send({ scheduledAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }),
    ];
    for (const attempt of attempts) {
      const answer = await attempt;
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).not.toContain(SECRET.slice(0, 20));
    }
    expect((await PublishDestination.findById(destination)).state).toBe('SCHEDULED');
  });

  it('records the draft accounts on the job, and uses the draft for older jobs without them', async () => {
    const { job, draft } = await jobFromHiddenDraft();
    const stored = await PublishJob.findById(job.id).lean();
    expect(stored.draftTargetAccounts.map(String).sort()).toEqual(
      pages.map((p) => String(p._id)).sort(),
    );
    // A job made before the field existed: the draft's current accounts decide.
    await PublishJob.updateOne({ _id: job.id }, { $unset: { draftTargetAccounts: 1 } });
    expect((await as(team.editor.token).get(publishUrl(ws, `/${job.id}`))).status).toBe(404);
    expect(draft.id).toBeTruthy();
  });

  it('shows a job whose draft only had accounts the member may use', async () => {
    await grant(team.editor, [pages[0]]);
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    const editor = as(team.editor.token);
    expect((await editor.get(publishUrl(ws, `/${res.body.publishJob.id}`))).status).toBe(200);
    expect((await editor.get(publishUrl(ws))).body.items).toHaveLength(1);
  });
});

describe('3. health: public essentials only, details for monitoring with a token', () => {
  const TOKEN = 'monitoring-token-'.padEnd(48, 'x');

  it('tells the public only whether the API and its database are up', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'connected' });
  });

  it('has no details route unless a token is configured, and refuses wrong tokens like an unknown path', async () => {
    setHealthDetailsTokenForTests(null);
    const off = await api().get('/api/v1/health/details').set('Authorization', `Bearer ${TOKEN}`);
    expect(off.status).toBe(404);
    setHealthDetailsTokenForTests(TOKEN);
    for (const header of [undefined, 'Bearer wrong-token', `Basic ${TOKEN}`, TOKEN]) {
      const req = api().get('/api/v1/health/details');
      const res = header ? await req.set('Authorization', header) : await req;
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/publishing|queue|version/);
    }
    // A member's session is not the monitoring token either.
    const member = await as(team.owner.token).get('/api/v1/health/details');
    expect(member.status).toBe(404);
  });

  it('gives monitoring the server-wide view with the right token', async () => {
    setHealthDetailsTokenForTests(TOKEN);
    const res = await api().get('/api/v1/health/details').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'connected',
      publishing: { mode: 'SIMULATED', queue: 'READY', counts: { waiting: 0 }, workers: 1 },
    });
    expect(res.body.version).toBeTruthy();
  });

  it('refuses a short monitoring token in the configuration', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://127.0.0.1:1/x',
        JWT_ACCESS_SECRET: 'x'.repeat(40),
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
        HEALTH_DETAILS_TOKEN: 'short',
      }),
    ).toThrow(/HEALTH_DETAILS_TOKEN must be at least 32 characters/);
  });
});
