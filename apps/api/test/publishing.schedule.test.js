import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUEUE_STATUS } from '@socialhub/shared';
import { ActivityLog, Membership, PublishDestination, PublishJob } from '../src/models/index.js';
import { processDestination } from '../src/modules/publishing/publishing.processor.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { as, seedSocialAccounts, seedTeam } from './helpers.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish,
  publishUrl,
} from './publishFixtures.js';

/**
 * Scheduled posts: changing the time of a scheduled job and listing scheduled jobs soonest
 * first. SIMULATED mode with the test-only queue (publishFixtures.js): the real API, processor
 * and MongoDB; nothing contacts Meta or Redis.
 */

const HOUR = 3_600_000;
let team;
let ws;
let queue;
let pages;

const at = (ms) => new Date(Date.now() + ms);
const reschedule = (token, jobId, scheduledAt) =>
  as(token)
    .patch(publishUrl(ws, `/${jobId}/schedule`))
    .send({ scheduledAt: scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt });

async function scheduled(when, accounts = pages) {
  const draft = await createDraft(team.owner.token, ws, { accounts });
  const res = await publish(team.owner.token, ws, {
    contentPackageId: draft.id,
    scheduledAt: when.toISOString(),
  });
  expect(res.status).toBe(201);
  return res.body.publishJob;
}

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 0 });
  pages = seeded.accounts;
  await giveTokens(pages);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests({ mode: 'SIMULATED', maxAttempts: 3 });
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
});

describe('changing the time of a scheduled post', () => {
  it('moves every waiting account to the new time and replaces their queue entries', async () => {
    const job = await scheduled(at(HOUR));
    expect(job.canReschedule).toBe(true);
    const oldEntries = queue.pending().map((e) => e.id);
    const later = at(2 * HOUR);

    const res = await reschedule(team.owner.token, job.id, later);
    expect(res.status).toBe(200);
    expect(res.body.publishJob.status).toBe('SCHEDULED');
    expect(new Date(res.body.publishJob.scheduledAt).getTime()).toBe(later.getTime());
    for (const destination of res.body.publishJob.destinations) {
      expect(new Date(destination.scheduledAt).getTime()).toBe(later.getTime());
    }

    const stored = await PublishDestination.find({ job: job.id });
    for (const destination of stored) {
      expect(destination.dueAt.getTime()).toBe(later.getTime());
      expect(destination.queueSeq).toBe(2);
    }
    expect(queue.removed.sort()).toEqual(oldEntries.sort());
    const fresh = queue.pending();
    expect(fresh).toHaveLength(2);
    expect(fresh.every((e) => e.seq === 2 && e.delayMs > 1.9 * HOUR)).toBe(true);
    expect((await PublishJob.findById(job.id)).scheduledAt.getTime()).toBe(later.getTime());

    const entry = await ActivityLog.findOne({ action: 'publish_job.rescheduled' });
    expect(entry.metadata).toMatchObject({ accountCount: 2, simulated: true });
  });

  it('never sends at the old time, even if an old queue entry survives', async () => {
    const first = at(HOUR);
    const job = await scheduled(first);
    queue.remove = async () => false; // removal failed: the old entries stay in Redis
    const later = at(3 * HOUR);
    expect((await reschedule(team.owner.token, job.id, later)).status).toBe(200);

    const [destination] = await PublishDestination.find({ job: job.id });
    expect(await processDestination(destination._id, { now: first })).toBe('skipped');
    expect((await PublishDestination.findById(destination._id)).state).toBe('SCHEDULED');
    expect(await processDestination(destination._id, { now: later })).toBe('published');
    // Delivered again (old and new entry both arrive): still published once.
    expect(await processDestination(destination._id, { now: later })).toBe('skipped');
    expect((await PublishDestination.findById(destination._id)).attemptCount).toBe(1);
  });

  it('can move a post earlier', async () => {
    const job = await scheduled(at(5 * HOUR));
    const sooner = at(HOUR);
    expect((await reschedule(team.owner.token, job.id, sooner)).status).toBe(200);
    const [destination] = await PublishDestination.find({ job: job.id });
    expect(await processDestination(destination._id, { now: sooner })).toBe('published');
  });

  it.each([
    ['a past time', () => at(-60_000), /future/],
    ['more than 90 days ahead', () => at(91 * 24 * HOUR), /90 days/],
  ])('refuses %s', async (_label, when, message) => {
    const job = await scheduled(at(HOUR));
    const res = await reschedule(team.owner.token, job.id, when());
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.scheduledAt).toMatch(message);
    const [destination] = await PublishDestination.find({ job: job.id });
    expect(destination.queueSeq).toBe(1);
  });

  it('refuses a time that is not a date', async () => {
    const job = await scheduled(at(HOUR));
    expect((await reschedule(team.owner.token, job.id, 'tomorrow')).status).toBe(422);
    expect((await reschedule(team.owner.token, job.id, '2026-12-01T10:00:00')).status).toBe(422);
  });

  it('refuses posts that are not waiting for a scheduled time', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const now = (await publish(team.owner.token, ws, { contentPackageId: draft.id })).body
      .publishJob;
    expect(now.canReschedule).toBe(false);
    const res = await reschedule(team.owner.token, now.id, at(HOUR));
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('NOT_RESCHEDULABLE');

    const job = await scheduled(at(HOUR));
    await as(team.owner.token).post(publishUrl(ws, `/${job.id}/cancel`));
    const cancelled = await reschedule(team.owner.token, job.id, at(2 * HOUR));
    expect(cancelled.status).toBe(409);
  });

  it('leaves alone an account a worker has just started sending', async () => {
    const job = await scheduled(at(HOUR));
    const [claimed, waiting] = await PublishDestination.find({ job: job.id }).sort({ _id: 1 });
    await PublishDestination.updateOne({ _id: claimed._id }, { $set: { state: 'PROCESSING' } });
    const later = at(2 * HOUR);
    expect((await reschedule(team.owner.token, job.id, later)).status).toBe(200);
    expect((await PublishDestination.findById(claimed._id)).queueSeq).toBe(1);
    expect((await PublishDestination.findById(waiting._id)).dueAt.getTime()).toBe(later.getTime());
  });

  it('keeps a post "scheduled" when one of its accounts is cancelled', async () => {
    const job = await scheduled(at(HOUR));
    const cancel = await as(team.owner.token).post(
      publishUrl(ws, `/${job.id}/destinations/${job.destinations[0].id}/cancel`),
    );
    expect(cancel.body.publishJob.status).toBe('SCHEDULED');
    const res = await reschedule(team.owner.token, job.id, at(2 * HOUR));
    expect(res.status).toBe(200);
    expect(res.body.publishJob.counts).toMatchObject({ SCHEDULED: 1, CANCELLED: 1 });
  });

  it('answers 503 and changes nothing while the queue is unreachable', async () => {
    const job = await scheduled(at(HOUR));
    queue.state = QUEUE_STATUS.UNAVAILABLE;
    const res = await reschedule(team.owner.token, job.id, at(2 * HOUR));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');
    const [destination] = await PublishDestination.find({ job: job.id });
    expect(destination.queueSeq).toBe(1);
  });

  it('is only for members who may publish to every account of the post', async () => {
    const job = await scheduled(at(HOUR));
    const later = at(2 * HOUR);
    expect((await reschedule(team.viewer.token, job.id, later)).status).toBe(403);
    await Membership.updateOne(
      { _id: team.editor.membershipId },
      { $set: { accountAccess: { mode: 'SELECTED', socialAccounts: [pages[0]._id] } } },
    );
    expect((await reschedule(team.editor.token, job.id, later)).status).toBe(404);
    await Membership.updateOne(
      { _id: team.editor.membershipId },
      { $set: { accountAccess: { mode: 'SELECTED', socialAccounts: pages.map((p) => p._id) } } },
    );
    expect((await reschedule(team.editor.token, job.id, later)).status).toBe(200);
  });
});

describe('listing scheduled posts', () => {
  it('lists scheduled posts soonest first, page by page', async () => {
    const third = await scheduled(at(3 * HOUR), [pages[0]]);
    const first = await scheduled(at(HOUR), [pages[1]]);
    const second = await scheduled(at(2 * HOUR), [pages[0]]);
    // Sent at once: no scheduled time, so not in this list.
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[1]] });
    await publish(team.owner.token, ws, { contentPackageId: draft.id });

    const query = '?status=SCHEDULED&order=scheduled&limit=2';
    const page1 = await as(team.owner.token).get(publishUrl(ws, query));
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((j) => j.id)).toEqual([first.id, second.id]);
    const page2 = await as(team.owner.token).get(
      publishUrl(ws, `${query}&cursor=${page1.body.nextCursor}`),
    );
    expect(page2.body.items.map((j) => j.id)).toEqual([third.id]);
    expect(page2.body.nextCursor).toBeNull();

    const newest = await as(team.owner.token).get(publishUrl(ws, '?status=SCHEDULED'));
    expect(newest.body.items.map((j) => j.id)).toEqual([second.id, first.id, third.id]);
  });

  it('refuses a page link that does not belong to the order', async () => {
    const bad = await as(team.owner.token).get(publishUrl(ws, '?order=scheduled&cursor=abc'));
    expect(bad.status).toBe(422);
    const wrong = await as(team.owner.token).get(publishUrl(ws, '?cursor=not-an-id'));
    expect(wrong.status).toBe(422);
  });
});
