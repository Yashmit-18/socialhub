import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentPackage, Membership, PublishJob, SocialAccount } from '../src/models/index.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { api, as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';
import { createTestQueue, giveTokens, publish, publishUrl } from './publishFixtures.js';
import { mediaUrl, uploadMedia } from './mediaFixtures.js';

/**
 * Draft visibility (docs/ARCHITECTURE.md, "Draft visibility"), tested through the real API:
 *
 *   OWNER / ADMIN        every draft of the workspace
 *   EDITOR / VIEWER      only drafts whose every account they may use (plus drafts with none)
 *   VIEWER               never edits, deletes or publishes
 *
 * Each check sends the request directly, as a client that ignores the web app's hidden
 * buttons would, so the server is the only thing being trusted.
 */

const draftsUrl = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/content-packages${suffix}`;

let team;
let ws;
let pageA;
let pageB;
let insta;
let drafts; // { none, onlyA, onlyB, mixed }

const SECRET_CAPTION = 'Unreleased launch: do not leak';

async function grant(member, accounts, mode = 'SELECTED') {
  await Membership.updateOne(
    { _id: member.membershipId },
    {
      $set: {
        accountAccess: { mode, socialAccounts: mode === 'ALL' ? [] : accounts.map((a) => a._id) },
      },
    },
  );
}

async function saveDraft(caption, accounts) {
  const res = await as(team.owner.token)
    .post(draftsUrl(ws))
    .send({ caption, targetAccountIds: accounts.map((a) => String(a._id)) });
  expect(res.status).toBe(201);
  return res.body.contentPackage;
}

const listIds = async (token, query = '') =>
  (await as(token).get(draftsUrl(ws, query))).body.items.map((d) => d.id).sort();

const read = (token, id) => as(token).get(draftsUrl(ws, `/${id}`));
const update = (token, draft, body = {}) =>
  as(token)
    .patch(draftsUrl(ws, `/${draft.id}`))
    .send({ caption: 'changed', targetAccountIds: draft.targetAccountIds, version: 1, ...body });
const remove = (token, id) => as(token).delete(draftsUrl(ws, `/${id}`));

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 1 });
  [pageA, pageB] = seeded.accounts.filter((a) => a.platform === 'FACEBOOK_PAGE');
  [insta] = seeded.accounts.filter((a) => a.platform === 'INSTAGRAM_ACCOUNT');
  await giveTokens(seeded.accounts);
  drafts = {
    none: await saveDraft('No accounts yet', []),
    onlyA: await saveDraft('Only page A', [pageA]),
    onlyB: await saveDraft('Only page B', [pageB]),
    mixed: await saveDraft(SECRET_CAPTION, [pageA, pageB, insta]),
  };
  setPublishQueueForTests(createTestQueue());
  setPublishingSettingsForTests({ mode: 'SIMULATED' });
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
});

const all = () =>
  Object.values(drafts)
    .map((d) => d.id)
    .sort();

describe('owner and admin', () => {
  it.each(['owner', 'admin'])('%s sees, edits and deletes every draft', async (role) => {
    const token = team[role].token;
    expect(await listIds(token)).toEqual(all());
    const mixed = await read(token, drafts.mixed.id);
    expect(mixed.status).toBe(200);
    expect(mixed.body.contentPackage.caption).toBe(SECRET_CAPTION);
    expect(mixed.body.contentPackage.targetAccountIds).toHaveLength(3);
    expect((await update(token, drafts.mixed)).status).toBe(200);
    expect((await remove(token, drafts.onlyB.id)).status).toBe(204);
  });

  it('ignores any account list an owner or admin happens to have stored', async () => {
    await grant(team.admin, [pageA]);
    expect(await listIds(team.admin.token)).toEqual(all());
  });
});

describe.each(['editor', 'viewer'])('%s with access to some accounts', (role) => {
  const member = () => team[role];

  it('with no accounts sees only drafts that have no accounts', async () => {
    expect(await listIds(member().token)).toEqual([drafts.none.id]);
    expect((await read(member().token, drafts.onlyA.id)).status).toBe(404);
  });

  it('sees a draft whose only account is permitted', async () => {
    await grant(member(), [pageA]);
    expect(await listIds(member().token)).toEqual([drafts.none.id, drafts.onlyA.id].sort());
    const res = await read(member().token, drafts.onlyA.id);
    expect(res.status).toBe(200);
    expect(res.body.contentPackage.targetAccountIds).toEqual([String(pageA._id)]);
  });

  it('does not see a draft whose one account is not permitted', async () => {
    await grant(member(), [pageA]);
    const res = await read(member().token, drafts.onlyB.id);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Draft not found');
  });

  it('does not see a mixed draft at all, not even partly', async () => {
    await grant(member(), [pageA, insta]);
    const res = await read(member().token, drafts.mixed.id);
    expect(res.status).toBe(404);
    // Identical to an id that never existed: nothing can be probed.
    const unknown = await read(member().token, 'a'.repeat(24));
    const answer = ({ error }) => ({ code: error.code, message: error.message });
    expect(answer(res.body)).toEqual(answer(unknown.body));
    const list = await as(member().token).get(draftsUrl(ws));
    for (const body of [res.body, list.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(SECRET_CAPTION);
      expect(text).not.toContain(String(pageB._id));
    }
  });

  it('sees the mixed draft once they may use every account on it', async () => {
    await grant(member(), [pageA, pageB, insta]);
    expect(await listIds(member().token)).toEqual(all());
    expect((await read(member().token, drafts.mixed.id)).body.contentPackage.caption).toBe(
      SECRET_CAPTION,
    );
  });

  it('with access to all accounts sees every draft', async () => {
    await grant(member(), [], 'ALL');
    expect(await listIds(member().token)).toEqual(all());
  });

  it('is not restricted by an account that was removed from the workspace', async () => {
    await grant(member(), [pageA, insta]);
    await SocialAccount.deleteOne({ _id: pageB._id });
    const res = await read(member().token, drafts.mixed.id);
    expect(res.status).toBe(200);
    expect(res.body.contentPackage.targetAccountIds.sort()).toEqual(
      [String(pageA._id), String(insta._id)].sort(),
    );
  });

  it('gets full pages: hidden drafts are filtered inside the query', async () => {
    await grant(member(), [pageA]);
    // Newest drafts are hidden ones; a filter applied after paging would return empty pages.
    for (let i = 0; i < 3; i += 1) await saveDraft(`Hidden ${i}`, [pageB]);
    const first = await as(member().token).get(draftsUrl(ws, '?limit=1'));
    expect(first.body.items).toHaveLength(1);
    const second = await as(member().token).get(
      draftsUrl(ws, `?limit=1&cursor=${first.body.nextCursor}`),
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect([first.body.items[0].id, second.body.items[0].id].sort()).toEqual(
      [drafts.none.id, drafts.onlyA.id].sort(),
    );
  });
});

describe('changing drafts', () => {
  it('an editor edits and deletes drafts they may see, and nothing else', async () => {
    await grant(team.editor, [pageA]);
    expect((await update(team.editor.token, drafts.onlyA)).status).toBe(200);
    expect((await update(team.editor.token, drafts.none)).status).toBe(200);

    for (const hidden of [drafts.onlyB, drafts.mixed]) {
      const res = await update(team.editor.token, hidden, { targetAccountIds: [] });
      expect(res.status).toBe(404);
      expect((await remove(team.editor.token, hidden.id)).status).toBe(404);
    }
    const mixed = await ContentPackage.findById(drafts.mixed.id);
    expect(mixed.caption).toBe(SECRET_CAPTION);
    expect(mixed.targetAccounts).toHaveLength(3);
    expect(await ContentPackage.countDocuments()).toBe(4);
  });

  it('an editor cannot move a draft onto an account they may not use', async () => {
    await grant(team.editor, [pageA]);
    const res = await update(team.editor.token, drafts.onlyA, {
      targetAccountIds: [String(pageA._id), String(pageB._id)],
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain(String(pageB._id));
  });

  it('a viewer can never create, edit or delete, even drafts they may see', async () => {
    await grant(team.viewer, [], 'ALL');
    expect((await as(team.viewer.token).post(draftsUrl(ws)).send({})).status).toBe(403);
    expect((await update(team.viewer.token, drafts.onlyA)).status).toBe(403);
    expect((await remove(team.viewer.token, drafts.onlyA.id)).status).toBe(403);
    expect(await ContentPackage.countDocuments()).toBe(4);
  });
});

describe('publishing a draft', () => {
  it('an editor cannot publish a draft they may not see, whichever accounts they name', async () => {
    await grant(team.editor, [pageA]);
    const asked = await publish(team.editor.token, ws, {
      contentPackageId: drafts.mixed.id,
      socialAccountIds: [String(pageA._id)],
    });
    expect(asked.status).toBe(404);
    const saved = await publish(team.editor.token, ws, { contentPackageId: drafts.onlyB.id });
    expect(saved.status).toBe(404);
    expect(await PublishJob.countDocuments()).toBe(0);
  });

  it('an editor publishes a draft whose accounts they may all use', async () => {
    await grant(team.editor, [pageA]);
    const res = await publish(team.editor.token, ws, { contentPackageId: drafts.onlyA.id });
    expect(res.status).toBe(201);
    expect(res.body.publishJob.simulated).toBe(true);
  });

  it('a viewer can never publish, cancel or reschedule', async () => {
    await grant(team.viewer, [], 'ALL');
    const res = await publish(team.viewer.token, ws, { contentPackageId: drafts.onlyA.id });
    expect(res.status).toBe(403);
    const job = (await publish(team.owner.token, ws, { contentPackageId: drafts.onlyA.id })).body
      .publishJob;
    const later = new Date(Date.now() + 3600_000).toISOString();
    const viewer = as(team.viewer.token);
    expect((await viewer.post(publishUrl(ws, `/${job.id}/cancel`))).status).toBe(403);
    expect(
      (await viewer.patch(publishUrl(ws, `/${job.id}/schedule`)).send({ scheduledAt: later }))
        .status,
    ).toBe(403);
    // Reading is allowed, and the answer says the viewer cannot act.
    const view = await viewer.get(publishUrl(ws, `/${job.id}`));
    expect(view.status).toBe(200);
    expect(view.body.publishJob).toMatchObject({ canCancel: false, canReschedule: false });
  });

  it('a viewer sees only the jobs whose every account they may use', async () => {
    // Instagram needs media, so the mixed job here goes to the two Pages.
    const twoPages = await saveDraft(SECRET_CAPTION, [pageA, pageB]);
    const mixedJob = (await publish(team.owner.token, ws, { contentPackageId: twoPages.id })).body
      .publishJob;
    const ownJob = (await publish(team.owner.token, ws, { contentPackageId: drafts.onlyA.id })).body
      .publishJob;
    await grant(team.viewer, [pageA]);
    const viewer = as(team.viewer.token);
    const list = await viewer.get(publishUrl(ws));
    expect(list.body.items.map((j) => j.id)).toEqual([ownJob.id]);
    expect(JSON.stringify(list.body)).not.toContain(SECRET_CAPTION.slice(0, 20));
    expect((await viewer.get(publishUrl(ws, `/${mixedJob.id}`))).status).toBe(404);
    expect((await viewer.get(publishUrl(ws, '/summary'))).body.total).toBe(1);
  });
});

describe('requests from outside', () => {
  it('rejects requests without a session', async () => {
    expect((await api().get(draftsUrl(ws))).status).toBe(401);
    expect((await api().get(draftsUrl(ws, `/${drafts.none.id}`))).status).toBe(401);
    expect((await api().post(publishUrl(ws)).send({})).status).toBe(401);
  });

  it('keeps every workspace apart, even for owners', async () => {
    const stranger = await registerUser({ name: 'Stranger' });
    const other = (await createWorkspace(stranger.token, { name: 'Other' })).workspace.id;
    // Not a member: the workspace itself is not found.
    expect((await read(stranger.token, drafts.none.id)).status).toBe(404);
    // Their own workspace's URL with this workspace's draft id: not found either.
    const cross = await as(stranger.token).get(draftsUrl(other, `/${drafts.none.id}`));
    expect(cross.status).toBe(404);
    expect((await as(stranger.token).get(draftsUrl(other))).body.items).toEqual([]);
    const crossPatch = await as(stranger.token)
      .patch(draftsUrl(other, `/${drafts.none.id}`))
      .send({ caption: 'taken over', targetAccountIds: [], version: 1 });
    expect(crossPatch.status).toBe(404);
    const crossPublish = await publish(stranger.token, other, {
      contentPackageId: drafts.none.id,
    });
    expect(crossPublish.status).toBe(404);
    expect((await ContentPackage.findById(drafts.none.id)).caption).toBe('No accounts yet');
  });
});

describe('files of hidden drafts', () => {
  async function draftWithFile(accounts) {
    const file = await uploadMedia(team.owner.token, ws);
    const res = await as(team.owner.token)
      .post(draftsUrl(ws))
      .send({
        caption: SECRET_CAPTION,
        media: [{ mediaId: file.id }],
        targetAccountIds: accounts.map((a) => String(a._id)),
      });
    expect(res.status).toBe(201);
    return file;
  }

  it('cannot be read by id, or through "complete", by a member who cannot see the draft', async () => {
    const file = await draftWithFile([pageB]);
    await grant(team.editor, [pageA]);
    const read = await as(team.editor.token).get(mediaUrl(ws, `/${file.id}`));
    expect(read.status).toBe(404);
    const unknown = await as(team.editor.token).get(mediaUrl(ws, `/${'a'.repeat(24)}`));
    expect(read.body.error.message).toBe(unknown.body.error.message);
    const complete = await as(team.editor.token).post(mediaUrl(ws, `/${file.id}/complete`));
    expect(complete.status).toBe(404);
    for (const body of [read.body, complete.body]) {
      expect(JSON.stringify(body)).not.toContain(file.url);
    }
  });

  it('can be read by members who can see a draft using it, and by unrestricted members', async () => {
    const file = await draftWithFile([pageB]);
    await grant(team.editor, [pageB]);
    await grant(team.viewer, [], 'ALL');
    for (const member of [team.owner, team.admin, team.editor, team.viewer]) {
      const res = await as(member.token).get(mediaUrl(ws, `/${file.id}`));
      expect(res.status).toBe(200);
      expect(res.body.media.url).toBe(file.url);
    }
  });

  it('a file on no draft is visible to its uploader and to unrestricted members only', async () => {
    await grant(team.editor, [pageA]);
    const own = await uploadMedia(team.editor.token, ws);
    expect((await as(team.editor.token).get(mediaUrl(ws, `/${own.id}`))).status).toBe(200);
    expect((await as(team.owner.token).get(mediaUrl(ws, `/${own.id}`))).status).toBe(200);
    const others = await uploadMedia(team.owner.token, ws);
    expect((await as(team.editor.token).get(mediaUrl(ws, `/${others.id}`))).status).toBe(404);
  });

  it('cannot be reached by attaching its id to a draft of their own', async () => {
    const file = await draftWithFile([pageB]);
    await grant(team.editor, [pageA]);
    const attach = (mediaId) =>
      as(team.editor.token)
        .post(draftsUrl(ws))
        .send({ caption: 'mine', media: [{ mediaId }], targetAccountIds: [String(pageA._id)] });
    const hidden = await attach(file.id);
    const unknown = await attach('a'.repeat(24));
    // Same answer as an id that does not exist, and the file stays hidden afterwards.
    expect(hidden.status).toBe(422);
    expect(hidden.body.error).toEqual({
      ...unknown.body.error,
      requestId: hidden.body.error.requestId,
    });
    expect(JSON.stringify(hidden.body)).not.toContain(file.url);
    expect((await as(team.editor.token).get(mediaUrl(ws, `/${file.id}`))).status).toBe(404);
    // Editing a visible draft is refused the same way.
    await grant(team.editor, [pageA]);
    const edit = await update(team.editor.token, drafts.onlyA, { media: [{ mediaId: file.id }] });
    expect(edit.status).toBe(422);
    // Their own uploads, and files on drafts they can see, still attach.
    const own = await uploadMedia(team.editor.token, ws);
    expect((await attach(own.id)).status).toBe(201);
    await grant(team.editor, [pageA, pageB]);
    expect((await attach(file.id)).status).toBe(201);
  });

  it('cannot be probed by deleting: a hidden file answers like an unknown id', async () => {
    const file = await draftWithFile([pageB]);
    await grant(team.editor, [pageA]);
    const del = await as(team.editor.token).delete(mediaUrl(ws, `/${file.id}`));
    const unknown = await as(team.editor.token).delete(mediaUrl(ws, `/${'a'.repeat(24)}`));
    expect(del.status).toBe(404);
    expect(del.body.error.message).toBe(unknown.body.error.message);
  });
});
