/**
 * API integration tests for Facebook Group distribution (Phase 6): the group directory and
 * its categories, shares with duplicate prevention and "days between shares" rules, manual
 * sharing tasks with their permission rules, and clean-up when members leave or a workspace
 * is deleted.
 *
 * Facebook is never contacted: a FakeMeta transport is installed only as a guard and every
 * test asserts that no request reached it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityLog,
  FacebookGroup,
  GroupCategory,
  GroupShare,
  SharingTask,
} from '../src/models/index.js';
import { FakeMeta } from './fakeMeta.js';
import { DEFAULT_PASSWORD, as, createWorkspace, registerUser, seedTeam } from './helpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  fake.uninstall();
  expect(fake.calls).toEqual([]);
});

const DAY_MS = 86_400_000;
const ws = (w) => `/api/v1/workspaces/${w.id}`;
const errorOf = (res) => ({ code: res.body.error?.code, message: res.body.error?.message });

const addGroup = (token, w, body) =>
  as(token)
    .post(`${ws(w)}/facebook-groups`)
    .send(body);
const addCategory = (token, w, name) =>
  as(token)
    .post(`${ws(w)}/group-categories`)
    .send({ name });
const createShare = (token, w, body) =>
  as(token)
    .post(`${ws(w)}/group-shares`)
    .send(body);
const listTasks = (token, w, params = {}) =>
  as(token).get(`${ws(w)}/sharing-tasks?${new URLSearchParams(params)}`);
const patchTask = (token, w, taskId, body) =>
  as(token)
    .patch(`${ws(w)}/sharing-tasks/${taskId}`)
    .send(body);

async function directory(team) {
  const w = team.workspace;
  const local = (await addCategory(team.owner.token, w, 'Local')).body.category;
  const food = (await addCategory(team.owner.token, w, 'Food')).body.category;
  const mk = async (name, slug, extra = {}) => {
    const res = await addGroup(team.owner.token, w, {
      name,
      url: `https://www.facebook.com/groups/${slug}`,
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body.group;
  };
  return {
    local,
    food,
    bakers: await mk('London Bakers', 'londonbakers', {
      categoryId: food.id,
      tags: ['Bread', 'london'],
    }),
    vegans: await mk('Vegan Eats', '1234567890', {
      categoryId: food.id,
      tags: ['vegan'],
      minDaysBetweenShares: 7,
    }),
    market: await mk('Camden Market', 'camden.market', { categoryId: local.id, memberCount: 5400 }),
    misc: await mk('Anything Goes', 'anything-goes'),
  };
}

/* ---------------------------------------------------------------- directory */

describe('Facebook Group directory', () => {
  it('adds groups with a canonical link and rejects the same group under another address', async () => {
    const team = await seedTeam();
    const res = await addGroup(team.owner.token, team.workspace, {
      name: '  Acme Fans ',
      url: 'm.facebook.com/groups/Acme.Fans/posts/123?ref=share',
      tags: ['Shoes', 'shoes', ' sale '],
      notes: 'Promotions on Fridays only',
    });
    expect(res.status).toBe(201);
    expect(res.body.group).toMatchObject({
      name: 'Acme Fans',
      url: 'https://www.facebook.com/groups/Acme.Fans/',
      tags: ['shoes', 'sale'],
      notes: 'Promotions on Fridays only',
      status: 'ACTIVE',
      category: null,
      memberCount: null,
      lastSharedAt: null,
      nextShareAllowedAt: null,
    });

    const again = await addGroup(team.admin.token, team.workspace, {
      name: 'Duplicate',
      url: 'https://www.facebook.com/groups/acme.fans/',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('This group is already in the directory as “Acme Fans”.');
    expect(again.body.error.details.groupId).toBe(res.body.group.id);

    for (const url of [
      'https://example.com/groups/x',
      'https://www.facebook.com/acme',
      'not a link',
    ]) {
      const bad = await addGroup(team.owner.token, team.workspace, { name: 'X', url });
      expect(bad.status, url).toBe(422);
      expect(bad.body.error.details.fields.url).toMatch(/Facebook Group link/);
    }
    const log = await ActivityLog.findOne({ action: 'facebook_group.added' });
    expect(log.target.label).toBe('Acme Fans');
  });

  it('filters by status, category, tag and search, sorts, and reports facets', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    await as(team.owner.token)
      .patch(`${ws(w)}/facebook-groups/${d.misc.id}`)
      .send({ status: 'ARCHIVED' });

    const names = async (params = {}) =>
      (
        await as(team.viewer.token).get(`${ws(w)}/facebook-groups?${new URLSearchParams(params)}`)
      ).body.items.map((g) => g.name);

    expect(await names()).toEqual(['Camden Market', 'London Bakers', 'Vegan Eats']);
    expect(await names({ status: 'ARCHIVED' })).toEqual(['Anything Goes']);
    expect(await names({ category: d.food.id })).toEqual(['London Bakers', 'Vegan Eats']);
    expect(await names({ category: 'none', status: 'ALL' })).toEqual(['Anything Goes']);
    expect(await names({ tag: 'BREAD' })).toEqual(['London Bakers']);
    expect(await names({ q: 'camden' })).toEqual(['Camden Market']);
    expect(await names({ q: 'vegan' })).toEqual(['Vegan Eats']);
    expect(await names({ sort: '-memberCount' })).toEqual([
      'Camden Market',
      'London Bakers',
      'Vegan Eats',
    ]);

    const res = await as(team.viewer.token).get(`${ws(w)}/facebook-groups`);
    expect(res.body).toMatchObject({ total: 3, page: 1, pages: 1 });
    expect(res.body.facets.categories).toEqual({ [d.food.id]: 2, [d.local.id]: 1 });
    expect(res.body.facets.status).toEqual({ ACTIVE: 3, ARCHIVED: 1 });
    expect(res.body.facets.tags).toEqual([
      { tag: 'bread', count: 1 },
      { tag: 'london', count: 1 },
      { tag: 'vegan', count: 1 },
    ]);
    expect(res.body.items[0].category).toEqual({ id: d.local.id, name: 'Local' });

    expect((await as(team.owner.token).get(`${ws(w)}/facebook-groups?sort=bogus`)).status).toBe(
      422,
    );
  });

  it('manages categories: counts, unique names, and deletion leaves groups uncategorized', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    const listed = await as(team.editor.token).get(`${ws(w)}/group-categories`);
    expect(listed.body.items).toEqual([
      { id: d.food.id, name: 'Food', groupCount: 2 },
      { id: d.local.id, name: 'Local', groupCount: 1 },
    ]);
    expect((await addCategory(team.owner.token, w, 'FOOD')).status).toBe(409);
    const renamed = await as(team.owner.token)
      .patch(`${ws(w)}/group-categories/${d.food.id}`)
      .send({ name: 'Food & drink' });
    expect(renamed.body.category).toEqual({ id: d.food.id, name: 'Food & drink', groupCount: 2 });

    const removed = await as(team.owner.token).delete(`${ws(w)}/group-categories/${d.food.id}`);
    expect(removed.body).toEqual({ groupsUncategorized: 2 });
    expect(await FacebookGroup.countDocuments({ category: null })).toBe(3);

    const unknown = await addGroup(team.owner.token, w, {
      name: 'X',
      url: 'facebook.com/groups/x',
      categoryId: d.food.id,
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.fields.categoryId).toMatch(/no longer exists/);
  });

  it('lets only owners and admins change the directory; everyone can read it', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    for (const member of [team.editor, team.viewer]) {
      expect(
        (await addGroup(member.token, w, { name: 'X', url: 'facebook.com/groups/x' })).status,
      ).toBe(403);
      expect((await addCategory(member.token, w, 'X')).status).toBe(403);
      expect(
        (
          await as(member.token)
            .patch(`${ws(w)}/facebook-groups/${d.bakers.id}`)
            .send({ name: 'Y' })
        ).status,
      ).toBe(403);
      expect(
        (await as(member.token).delete(`${ws(w)}/facebook-groups/${d.bakers.id}`)).status,
      ).toBe(403);
      const detail = await as(member.token).get(`${ws(w)}/facebook-groups/${d.bakers.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.group.name).toBe('London Bakers');
    }
  });

  it('keeps each workspace’s directory to itself', async () => {
    const team = await seedTeam();
    const d = await directory(team);
    const stranger = await registerUser({ name: 'Stranger' });
    const { workspace: other } = await createWorkspace(stranger.token, { name: 'Other Co' });

    expect((await as(stranger.token).get(`${ws(team.workspace)}/facebook-groups`)).status).toBe(
      404,
    );
    expect(
      (await as(stranger.token).get(`${ws(other)}/facebook-groups/${d.bakers.id}`)).status,
    ).toBe(404);
    // The same Facebook Group may be listed in another workspace.
    expect(
      (
        await addGroup(stranger.token, other, {
          name: 'Bakers',
          url: 'facebook.com/groups/londonbakers',
        })
      ).status,
    ).toBe(201);
    const share = await createShare(stranger.token, other, {
      title: 'T',
      message: 'M',
      groupIds: [d.bakers.id],
    });
    expect(share.status).toBe(422);
  });
});

/* ------------------------------------------------------------------- shares */

describe('group shares', () => {
  it('creates one task per group and explains every group it skipped', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    await as(team.owner.token)
      .patch(`${ws(w)}/facebook-groups/${d.misc.id}`)
      .send({ status: 'ARCHIVED' });
    // Vegan Eats allows one share a week and was shared 2 days ago.
    const sharedAt = new Date(Date.now() - 2 * DAY_MS);
    await FacebookGroup.updateOne({ _id: d.vegans.id }, { lastSharedAt: sharedAt });

    const res = await createShare(team.owner.token, w, {
      title: 'Autumn menu',
      message: 'Our autumn menu is here 🍂',
      link: 'https://acme.example/menu',
      groupIds: [d.bakers.id, d.vegans.id, d.market.id, d.misc.id],
      dueAt: '2026-12-01T09:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.share).toMatchObject({
      title: 'Autumn menu',
      link: 'https://acme.example/menu',
      createdBy: { id: team.owner.user.id, name: 'Olivia Owner' },
      counts: { open: 2, done: 0, skipped: 0, total: 2 },
    });
    const skipped = Object.fromEntries(res.body.skipped.map((s) => [s.name, s]));
    expect(skipped['Anything Goes'].reason).toBe('ARCHIVED');
    expect(skipped['Vegan Eats']).toMatchObject({
      reason: 'TOO_SOON',
      lastSharedAt: sharedAt.toISOString(),
      nextShareAllowedAt: new Date(sharedAt.getTime() + 7 * DAY_MS).toISOString(),
    });

    // Adding the same groups again never duplicates a task.
    const shareId = res.body.share.id;
    const again = await as(team.admin.token)
      .post(`${ws(w)}/group-shares/${shareId}/groups`)
      .send({ groupIds: [d.bakers.id, d.market.id] });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(0);
    expect(again.body.skipped.map((s) => s.reason)).toEqual(['ALREADY_QUEUED', 'ALREADY_QUEUED']);
    expect(await SharingTask.countDocuments({ share: shareId })).toBe(2);

    const detail = await as(team.viewer.token).get(`${ws(w)}/group-shares/${shareId}`);
    expect(detail.body.tasks.map((t) => [t.group.name, t.status, t.dueAt])).toEqual([
      ['Camden Market', 'OPEN', '2026-12-01T09:00:00.000Z'],
      ['London Bakers', 'OPEN', '2026-12-01T09:00:00.000Z'],
    ]);
    expect(await ActivityLog.findOne({ action: 'group_share.created' })).toMatchObject({
      metadata: { groups: 2, skipped: 2 },
    });
  });

  it('refuses a share no selected group can take, and writes nothing', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    await as(team.owner.token)
      .patch(`${ws(w)}/facebook-groups/${d.misc.id}`)
      .send({ status: 'ARCHIVED' });
    const res = await createShare(team.owner.token, w, {
      title: 'T',
      message: 'M',
      groupIds: [d.misc.id],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.skipped).toEqual([
      { groupId: d.misc.id, name: 'Anything Goes', reason: 'ARCHIVED' },
    ]);
    expect(await GroupShare.countDocuments({})).toBe(0);
  });

  it('validates shares: text, https links, groups and assignees', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    const base = { title: 'T', message: 'M', groupIds: [d.bakers.id] };
    expect((await createShare(team.owner.token, w, { ...base, message: '  ' })).status).toBe(422);
    expect(
      (await createShare(team.owner.token, w, { ...base, link: 'http://x.example' })).status,
    ).toBe(422);
    expect((await createShare(team.owner.token, w, { ...base, groupIds: [] })).status).toBe(422);
    const viewerAssignee = await createShare(team.owner.token, w, {
      ...base,
      assigneeId: team.viewer.user.id,
    });
    expect(viewerAssignee.status).toBe(422);
    expect(viewerAssignee.body.error.details.fields.assigneeId).toMatch(
      /can complete sharing tasks/,
    );
    const outsider = await registerUser({ name: 'Outsider' });
    expect(
      (await createShare(team.owner.token, w, { ...base, assigneeId: outsider.user.id })).status,
    ).toBe(422);
    expect((await createShare(team.editor.token, w, base)).status).toBe(403);
    expect(await GroupShare.countDocuments({})).toBe(0);
  });

  it('lists shares with progress, edits them, and deletes only unposted ones', async () => {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    const first = (
      await createShare(team.owner.token, w, {
        title: 'First',
        message: 'A',
        groupIds: [d.bakers.id],
      })
    ).body;
    const second = (
      await createShare(team.owner.token, w, {
        title: 'Second',
        message: 'B',
        groupIds: [d.market.id, d.misc.id],
      })
    ).body;
    const task = (await SharingTask.findOne({ share: first.share.id }))._id;
    await patchTask(team.editor.token, w, String(task), { status: 'DONE' });

    const listed = await as(team.viewer.token).get(`${ws(w)}/group-shares`);
    expect(listed.body.items.map((s) => [s.title, s.counts])).toEqual([
      ['Second', { open: 2, done: 0, skipped: 0, total: 2 }],
      ['First', { open: 0, done: 1, skipped: 0, total: 1 }],
    ]);

    const edited = await as(team.owner.token)
      .patch(`${ws(w)}/group-shares/${second.share.id}`)
      .send({ message: 'B, updated', link: 'https://acme.example' });
    expect(edited.body.share).toMatchObject({
      message: 'B, updated',
      link: 'https://acme.example',
    });

    const blocked = await as(team.owner.token).delete(`${ws(w)}/group-shares/${first.share.id}`);
    expect(blocked.status).toBe(409);
    const removed = await as(team.owner.token).delete(`${ws(w)}/group-shares/${second.share.id}`);
    expect(removed.body).toEqual({ tasksRemoved: 2 });
    expect(await SharingTask.countDocuments({ share: second.share.id })).toBe(0);
  });
});

/* -------------------------------------------------------------------- tasks */

describe('sharing tasks', () => {
  async function setup() {
    const team = await seedTeam();
    const w = team.workspace;
    const d = await directory(team);
    const open = (
      await createShare(team.owner.token, w, {
        title: 'Launch',
        message: 'We launched!',
        link: 'https://acme.example/launch',
        groupIds: [d.bakers.id, d.vegans.id],
      })
    ).body;
    const assigned = (
      await createShare(team.owner.token, w, {
        title: 'Admin only',
        message: 'For Adam',
        groupIds: [d.market.id],
        assigneeId: team.admin.user.id,
      })
    ).body;
    const tasks = await SharingTask.find({}).populate('group', 'name');
    const byGroup = Object.fromEntries(tasks.map((t) => [t.group.name, String(t._id)]));
    return { team, w, d, open, assigned, byGroup };
  }

  it('gives each person their queue with the text, link and group rules to post', async () => {
    const { team, w } = await setup();
    const editorQueue = await listTasks(team.editor.token, w, { assignee: 'available' });
    expect(editorQueue.status).toBe(200);
    expect(editorQueue.body.items.map((t) => t.group.name)).toEqual([
      'London Bakers',
      'Vegan Eats',
    ]);
    expect(editorQueue.body.items[0]).toMatchObject({
      status: 'OPEN',
      share: { title: 'Launch', message: 'We launched!', link: 'https://acme.example/launch' },
      group: { name: 'London Bakers', url: 'https://www.facebook.com/groups/londonbakers/' },
      assignee: null,
    });
    expect(editorQueue.body.counts).toEqual({ open: 2, done: 0, skipped: 0, total: 2 });

    const adminMine = await listTasks(team.admin.token, w, { assignee: 'me' });
    expect(adminMine.body.items.map((t) => t.group.name)).toEqual(['Camden Market']);
    expect((await listTasks(team.viewer.token, w, { assignee: 'any' })).body.total).toBe(3);
  });

  it('marks a task done with the post link, updates the group and reopens it', async () => {
    const { team, w, d, byGroup } = await setup();
    const done = await patchTask(team.editor.token, w, byGroup['Vegan Eats'], {
      status: 'DONE',
      postUrl: 'https://www.facebook.com/groups/1234567890/posts/42',
      note: 'Pinned by the admin',
    });
    expect(done.status).toBe(200);
    expect(done.body.task).toMatchObject({
      status: 'DONE',
      completedBy: { id: team.editor.user.id, name: 'Eddie Editor' },
      postUrl: 'https://www.facebook.com/groups/1234567890/posts/42',
      note: 'Pinned by the admin',
    });
    expect(done.body.task.group.nextShareAllowedAt).not.toBeNull();
    const group = await FacebookGroup.findById(d.vegans.id);
    expect(group.lastSharedAt.toISOString()).toBe(done.body.task.completedAt);
    expect(await ActivityLog.findOne({ action: 'sharing_task.completed' })).toMatchObject({
      metadata: {
        share: 'Launch',
        group: 'Vegan Eats',
        postUrl: 'https://www.facebook.com/groups/1234567890/posts/42',
      },
    });

    // The "days between shares" rule now keeps new shares away from this group.
    const next = await createShare(team.owner.token, w, {
      title: 'Next',
      message: 'M',
      groupIds: [d.vegans.id, d.bakers.id],
    });
    expect(next.body.skipped.map((s) => [s.name, s.reason])).toEqual([['Vegan Eats', 'TOO_SOON']]);

    // Only the person who finished it (or an admin) can reopen it.
    const otherEditor = await patchTask(team.admin.token, w, byGroup['Vegan Eats'], {
      status: 'OPEN',
    });
    expect(otherEditor.status).toBe(200);
    expect(otherEditor.body.task).toMatchObject({
      status: 'OPEN',
      completedBy: null,
      postUrl: null,
    });
    expect((await FacebookGroup.findById(d.vegans.id)).lastSharedAt).toBeNull();
  });

  it('enforces who may work on which task', async () => {
    const { team, w, byGroup } = await setup();
    const adminTask = byGroup['Camden Market'];
    expect((await patchTask(team.editor.token, w, adminTask, { status: 'DONE' })).status).toBe(403);
    expect(
      (await patchTask(team.viewer.token, w, byGroup['London Bakers'], { status: 'DONE' })).status,
    ).toBe(403);
    // Editors may take an unassigned task, but not hand it to someone else.
    const claimed = await patchTask(team.editor.token, w, byGroup['London Bakers'], {
      assigneeId: team.editor.user.id,
    });
    expect(claimed.body.task.assignee).toEqual({ id: team.editor.user.id, name: 'Eddie Editor' });
    expect(
      (
        await patchTask(team.editor.token, w, byGroup['Vegan Eats'], {
          assigneeId: team.admin.user.id,
        })
      ).status,
    ).toBe(403);
    // Admins assign anyone who can complete tasks, never a viewer.
    expect(
      (await patchTask(team.admin.token, w, adminTask, { assigneeId: team.viewer.user.id })).status,
    ).toBe(422);
    const skipped = await patchTask(team.editor.token, w, byGroup['London Bakers'], {
      status: 'SKIPPED',
      note: 'Group paused promotions',
    });
    expect(skipped.body.task).toMatchObject({ status: 'SKIPPED', note: 'Group paused promotions' });
    // An owner or admin can reopen any task.
    expect(
      (await patchTask(team.owner.token, w, byGroup['London Bakers'], { status: 'OPEN' })).status,
    ).toBe(200);
  });

  it('accepts only Facebook links as the post link and refuses double completion', async () => {
    const { team, w, byGroup } = await setup();
    const task = byGroup['London Bakers'];
    expect(
      (
        await patchTask(team.editor.token, w, task, {
          status: 'DONE',
          postUrl: 'https://evil.example/x',
        })
      ).status,
    ).toBe(422);
    const results = await Promise.all([
      patchTask(team.editor.token, w, task, { status: 'DONE' }),
      patchTask(team.admin.token, w, task, { status: 'DONE' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await SharingTask.countDocuments({ _id: task, status: 'DONE' })).toBe(1);

    // One after the other: the second person is told who already shared it.
    const other = byGroup['Vegan Eats'];
    expect((await patchTask(team.editor.token, w, other, { status: 'DONE' })).status).toBe(200);
    const again = await patchTask(team.admin.token, w, other, { status: 'DONE' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe(
      'This task was already marked as shared by Eddie Editor.',
    );
    const task2 = await SharingTask.findById(other).populate('completedBy', 'name');
    expect(task2.completedBy.name).toBe('Eddie Editor');
  });

  it('returns a leaving member’s open tasks to the team and cleans up with the workspace', async () => {
    const { team, w, byGroup } = await setup();
    await patchTask(team.editor.token, w, byGroup['London Bakers'], {
      assigneeId: team.editor.user.id,
    });
    const removed = await as(team.owner.token).delete(
      `${ws(w)}/members/${team.editor.membershipId}`,
    );
    expect(removed.status).toBe(204);
    expect((await SharingTask.findById(byGroup['London Bakers'])).assignee).toBeNull();

    const deleted = await as(team.owner.token)
      .delete(ws(w))
      .send({ confirmation: w.name, password: DEFAULT_PASSWORD });
    expect(deleted.status).toBe(204);
    for (const Model of [FacebookGroup, GroupCategory, GroupShare, SharingTask]) {
      expect(await Model.countDocuments({ workspace: w.id }), Model.modelName).toBe(0);
    }
  });

  it('answers 404 for tasks of other workspaces and validates filters', async () => {
    const { team, w, byGroup } = await setup();
    const stranger = await registerUser({ name: 'Stranger' });
    const { workspace: other } = await createWorkspace(stranger.token, { name: 'Other Co' });
    expect(
      errorOf(await patchTask(stranger.token, other, byGroup['London Bakers'], { status: 'DONE' })),
    ).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listTasks(team.owner.token, w, { status: 'LATE' })).status).toBe(422);
    expect((await listTasks(team.owner.token, w, { status: 'ALL' })).body.total).toBe(3);
  });
});
