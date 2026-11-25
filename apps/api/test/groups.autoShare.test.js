/**
 * Facebook Group sharing, automatic part: the Facebook Pages that are members of a group, bulk
 * adding groups by link, and "auto share", which turns a real post into sharing tasks for the
 * groups its Pages are members of once each Page's post is live on Facebook.
 *
 * Posting in groups stays manual: Meta removed the Groups API in Graph API v19.0. These tests
 * run the real Facebook adapter against a SIMULATED Meta (a fetch stand-in) and check that no
 * request ever goes to a group.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import {
  ActivityLog,
  FacebookGroup,
  GroupShare,
  PublishDestination,
  SharingTask,
  Workspace,
} from '../src/models/index.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { as, seedSocialAccounts, seedTeam } from './helpers.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish as publishRequest,
} from './publishFixtures.js';

const DAY_MS = 86_400_000;
let team;
let ws;
let queue;
let pages;
let instagram;
let calls;
let failing;

const url = (suffix) => `/api/v1/workspaces/${ws}${suffix}`;
const publish = (body) => publishRequest(team.owner.token, ws, { confirmRealPost: true, ...body });
const autoShare = (token, publishJobId) =>
  as(token).post(url('/group-shares/auto')).send({ publishJobId });
const addGroup = (body, token = team.owner.token) =>
  as(token).post(url('/facebook-groups')).send(body);

/** Simulated Meta: every Page post succeeds (with a permalink) unless its Page is `failing`. */
function fakeMeta(input, init) {
  const target = new URL(input);
  const path = target.pathname.replace(/^\/v\d+\.\d+/, '');
  calls.push({ method: init.method, path });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (init.method === 'POST') {
    const page = path.split('/')[1];
    if (failing.has(page)) return json({ error: { code: 100, message: 'Nope' } }, 400);
    return json({ id: `${page}_post` });
  }
  const postId = path.slice(1);
  return json({ id: postId, permalink_url: `https://www.facebook.com/${postId}` });
}

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  pages = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  instagram = seeded.accounts.filter((a) => a.platform === 'INSTAGRAM_ACCOUNT');
  await giveTokens(seeded.accounts);
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setPublishingSettingsForTests({
    mode: 'LIVE',
    maxAttempts: 1,
    retryBaseMs: 30_000,
    retryMaxMs: 900_000,
  });
  await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
  calls = [];
  failing = new Set();
  setMetaTransportForTests(fakeMeta);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaTransportForTests(undefined);
  // Nothing ever reaches a group: only Page feeds and post read-backs.
  expect(calls.filter((c) => /group/i.test(c.path))).toEqual([]);
});

const pageId = (i) => String(pages[i]._id);

describe('the Pages that are members of a group', () => {
  it('are saved, listed, counted per Page and usable as a filter', async () => {
    const a = await addGroup({
      name: 'Alpha',
      url: 'facebook.com/groups/alpha',
      pageIds: [pageId(0), pageId(1), pageId(0).toUpperCase()],
    });
    expect(a.status).toBe(201);
    expect(a.body.group.pages.map((p) => p.name).sort()).toEqual(['Page 0', 'Page 1']);
    await addGroup({ name: 'Beta', url: 'facebook.com/groups/beta', pageIds: [pageId(1)] });
    await addGroup({ name: 'Gamma', url: 'facebook.com/groups/gamma' });

    const all = await as(team.viewer.token).get(url('/facebook-groups'));
    expect(all.body.facets.pages).toEqual({ [pageId(0)]: 1, [pageId(1)]: 2 });
    const only = await as(team.viewer.token).get(url(`/facebook-groups?pageId=${pageId(1)}`));
    expect(only.body.items.map((g) => g.name)).toEqual(['Alpha', 'Beta']);

    const changed = await as(team.owner.token)
      .patch(url(`/facebook-groups/${a.body.group.id}`))
      .send({ pageIds: [pageId(1)] });
    expect(changed.status).toBe(200);
    expect(changed.body.group.pages).toEqual([{ id: pageId(1), name: 'Page 1' }]);
    const entry = await ActivityLog.findOne({ action: 'facebook_group.updated' });
    expect(entry.metadata.fields).toEqual(['pageIds']);
  });

  it('must be Facebook Pages of this workspace', async () => {
    const instagramAccount = await addGroup({
      name: 'Alpha',
      url: 'facebook.com/groups/alpha',
      pageIds: [String(instagram[0]._id)],
    });
    expect(instagramAccount.status).toBe(422);
    expect(instagramAccount.body.error.details.fields.pageIds).toMatch(/no longer connected/);
    const unknown = await addGroup({
      name: 'Alpha',
      url: 'facebook.com/groups/alpha',
      pageIds: ['6a0000000000000000000000'],
    });
    expect(unknown.status).toBe(422);
    expect(await FacebookGroup.countDocuments()).toBe(0);
  });

  it('only owners and admins change them', async () => {
    const res = await addGroup(
      { name: 'Alpha', url: 'facebook.com/groups/alpha', pageIds: [pageId(0)] },
      team.editor.token,
    );
    expect(res.status).toBe(403);
  });
});

describe('adding groups in bulk', () => {
  it('adds new links, reports listed and invalid ones, and links the Pages to all of them', async () => {
    await addGroup({ name: 'Old friend', url: 'facebook.com/groups/old.friend' });
    const res = await as(team.admin.token)
      .post(url('/facebook-groups/bulk'))
      .send({
        urls: [
          'https://www.facebook.com/groups/london.fashion-lovers/',
          'm.facebook.com/groups/1234567890',
          'https://facebook.com/groups/old.friend/posts/5',
          'https://example.com/groups/nope',
          '   ',
          'facebook.com/groups/LONDON.fashion-lovers',
        ],
        pageIds: [pageId(0)],
      });
    expect(res.status).toBe(200);
    expect(res.body.added.map((g) => g.name)).toEqual([
      'London Fashion Lovers',
      'Facebook group 1234567890',
    ]);
    expect(res.body.existing.map((g) => g.name)).toEqual(['Old friend']);
    expect(res.body.invalid).toEqual(['https://example.com/groups/nope']);
    const groups = await FacebookGroup.find().sort({ name: 1 });
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.pages.map(String).includes(pageId(0)))).toBe(true);
    expect(await ActivityLog.countDocuments({ action: 'facebook_group.added' })).toBe(3);
  });

  it('is refused for editors and for too many links', async () => {
    const editor = await as(team.editor.token)
      .post(url('/facebook-groups/bulk'))
      .send({ urls: ['facebook.com/groups/a'] });
    expect(editor.status).toBe(403);
    const many = await as(team.owner.token)
      .post(url('/facebook-groups/bulk'))
      .send({ urls: Array.from({ length: 101 }, (_, i) => `facebook.com/groups/g${i}`) });
    expect(many.status).toBe(422);
  });
});

describe('auto share', () => {
  /** Alpha: Page 0. Both: Pages 0 and 1. Beta: Page 1. None: no Page. Archived and Cooling. */
  async function directory() {
    const mk = async (name, pageIds, extra = {}) =>
      (
        await addGroup({
          name,
          url: `https://www.facebook.com/groups/${name.toLowerCase()}`,
          pageIds,
          ...extra,
        })
      ).body.group;
    const groups = {
      alpha: await mk('Alpha', [pageId(0)]),
      both: await mk('Both', [pageId(0), pageId(1)]),
      beta: await mk('Beta', [pageId(1)]),
      none: await mk('None', []),
      archived: await mk('Archived', [pageId(0)]),
      cooling: await mk('Cooling', [pageId(0)], { minDaysBetweenShares: 7 }),
    };
    await FacebookGroup.updateOne({ _id: groups.archived.id }, { $set: { status: 'ARCHIVED' } });
    await FacebookGroup.updateOne(
      { _id: groups.cooling.id },
      { $set: { lastSharedAt: new Date(Date.now() - 2 * DAY_MS) } },
    );
    return groups;
  }

  const tasksOf = async (shareId) =>
    (await SharingTask.find({ share: shareId }).populate('group', 'name')).map((t) => ({
      group: t.group.name,
      page: String(t.page),
    }));

  it('creates tasks only once each Page post is live, one per group, as a member Page', async () => {
    await directory();
    const draft = await createDraft(team.owner.token, ws, {
      accounts: pages,
      caption: 'Winter sale starts today\nEverything 20% off',
      hashtags: ['sale'],
    });
    const job = (await publish({ contentPackageId: draft.id })).body.publishJob;

    // Asked for before anything was sent: the share exists, its tasks wait for the posts.
    const early = await autoShare(team.owner.token, job.id);
    expect(early.status).toBe(201);
    expect(early.body).toMatchObject({ created: true, tasksCreated: 0, pagesWaiting: 2 });
    expect(early.body.share).toMatchObject({
      title: 'Winter sale starts today',
      message: 'Winter sale starts today\nEverything 20% off\n\n#sale',
      auto: true,
      publishJobId: job.id,
    });
    expect(await SharingTask.countDocuments()).toBe(0);

    expect(await queue.deliver()).toEqual(['published', 'published']);
    const tasks = await tasksOf(early.body.share.id);
    expect(tasks.map((t) => t.group).sort()).toEqual(['Alpha', 'Beta', 'Both']);
    expect(tasks.find((t) => t.group === 'Alpha').page).toBe(pageId(0));
    expect(tasks.find((t) => t.group === 'Beta').page).toBe(pageId(1));

    const detail = await as(team.viewer.token).get(url(`/group-shares/${early.body.share.id}`));
    expect(detail.body.share.skipped).toEqual([
      expect.objectContaining({ name: 'Cooling', reason: 'TOO_SOON' }),
    ]);

    const list = await as(team.editor.token).get(url('/sharing-tasks?status=OPEN'));
    const alpha = list.body.items.find((t) => t.group.name === 'Alpha');
    expect(alpha.page).toEqual({ id: pageId(0), name: 'Page 0' });
    expect(alpha.pagePost).toEqual({
      state: 'PUBLISHED',
      url: 'https://www.facebook.com/fb-user-1-page-0_post',
    });
    expect(alpha.share).toMatchObject({ auto: true, message: expect.stringContaining('#sale') });
    expect(alpha.dueAt).toBeNull();

    // Asking again changes nothing.
    const again = await autoShare(team.owner.token, job.id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, tasksCreated: 0, pagesWaiting: 0 });
    expect(await SharingTask.countDocuments()).toBe(3);
    expect(await GroupShare.countDocuments()).toBe(1);
    expect(await ActivityLog.countDocuments({ action: 'group_share.created' })).toBe(1);
  });

  it('covers Pages already live when it is asked for after publishing', async () => {
    await directory();
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[1]] });
    const job = (await publish({ contentPackageId: draft.id })).body.publishJob;
    await queue.deliver();
    const res = await autoShare(team.editor.token, job.id);
    // The editor cannot see a post to accounts they have no access to.
    expect(res.status).toBe(404);
    const owner = await autoShare(team.owner.token, job.id);
    expect(owner.body).toMatchObject({ created: true, tasksCreated: 2, pagesWaiting: 0 });
    expect((await tasksOf(owner.body.share.id)).map((t) => t.group).sort()).toEqual([
      'Beta',
      'Both',
    ]);
  });

  it('creates no tasks for a Page whose post failed', async () => {
    await directory();
    failing.add('fb-user-1-page-1');
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const job = (await publish({ contentPackageId: draft.id })).body.publishJob;
    const res = await autoShare(team.owner.token, job.id);
    expect(await queue.deliver()).toEqual(['published', 'failed']);
    expect((await tasksOf(res.body.share.id)).map((t) => t.group).sort()).toEqual([
      'Alpha',
      'Both',
    ]);
    const both = await SharingTask.findOne({ share: res.body.share.id }).populate('group');
    expect(String(both.page)).toBe(pageId(0));
  });

  it('refuses simulated posts and posts without a Facebook Page', async () => {
    await directory();
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'SIMULATED' } });
    setPublishingSettingsForTests({ mode: 'SIMULATED', maxAttempts: 1 });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const simulated = (await publishRequest(team.owner.token, ws, { contentPackageId: draft.id }))
      .body.publishJob;
    await queue.deliver();
    const res = await autoShare(team.owner.token, simulated.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SIMULATED');

    setPublishingSettingsForTests({ mode: 'LIVE', maxAttempts: 1 });
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
    const draft2 = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const live = (await publish({ contentPackageId: draft2.id })).body.publishJob;
    // Test-only: the destination is turned into an Instagram one to model a post without Pages.
    await PublishDestination.updateMany(
      { job: live.id },
      { $set: { platform: 'INSTAGRAM_ACCOUNT' } },
    );
    const noPage = await autoShare(team.owner.token, live.id);
    expect(noPage.status).toBe(409);
    expect(noPage.body.error.details.reason).toBe('NO_FACEBOOK_PAGES');
    expect(await GroupShare.countDocuments()).toBe(0);
  });

  it('needs content:publish and a job of this workspace', async () => {
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const job = (await publish({ contentPackageId: draft.id })).body.publishJob;
    expect((await autoShare(team.viewer.token, job.id)).status).toBe(403);
    expect((await autoShare(team.owner.token, '6a0000000000000000000000')).status).toBe(404);
  });
});
