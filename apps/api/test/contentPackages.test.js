import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, ContentPackage, SocialAccount } from '../src/models/index.js';
import { UPDATE_LOG_INTERVAL_MS } from '../src/modules/contentPackages/contentPackage.service.js';
import { api, as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';
import { requestSlot, uploadMedia } from './mediaFixtures.js';

const url = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/content-packages${suffix}`;

let team;
let ws;
let accounts; // [page0, page1, instagram0]
let ids;

const create = (token, body = {}) => as(token).post(url(ws)).send(body);
const patch = (token, id, body) =>
  as(token)
    .patch(url(ws, `/${id}`))
    .send(body);

/** Limits an editor/viewer to some accounts (they start with none). */
async function grant(member, accountIds) {
  const res = await as(team.owner.token)
    .put(`/api/v1/workspaces/${ws}/members/${member.membershipId}/account-access`)
    .send({ mode: 'SELECTED', socialAccountIds: accountIds });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  ({ accounts } = await seedSocialAccounts(ws, team.owner.user.id));
  ids = accounts.map((a) => String(a._id));
});

describe('creating and reading drafts', () => {
  it('stores a complete draft in MongoDB and returns it', async () => {
    const media = await uploadMedia(team.owner.token, ws);
    const body = {
      caption: 'Summer sale ☀️',
      platformCaptions: { INSTAGRAM_ACCOUNT: 'Link in bio' },
      hashtags: ['summer', 'sale'],
      hashtagPlacement: 'FIRST_COMMENT',
      keywords: ['summer campaign'],
      firstComment: 'Shop now',
      media: [{ mediaId: media.id, altText: 'A beach' }],
      targetAccountIds: [ids[0], ids[2]],
    };
    const res = await create(team.owner.token, body);
    expect(res.status).toBe(201);
    const draft = res.body.contentPackage;
    expect(draft).toMatchObject({
      ...body,
      status: 'DRAFT',
      version: 1,
      media: [{ mediaId: media.id, altText: 'A beach', media: { id: media.id, status: 'READY' } }],
      createdBy: { id: team.owner.user.id, name: 'Olivia Owner' },
      updatedBy: { id: team.owner.user.id, name: 'Olivia Owner' },
    });
    expect(draft.media[0].media.url).toBe(media.url);

    const stored = await ContentPackage.findById(draft.id);
    expect(stored.caption).toBe('Summer sale ☀️');
    expect(String(stored.workspace)).toBe(ws);

    const read = await as(team.owner.token).get(url(ws, `/${draft.id}`));
    expect(read.status).toBe(200);
    expect(read.body.contentPackage).toEqual(draft);
  });

  it('accepts an empty draft: nothing is required to save', async () => {
    const res = await create(team.editor.token, {});
    expect(res.status).toBe(201);
    expect(res.body.contentPackage).toMatchObject({
      caption: '',
      platformCaptions: {},
      hashtags: [],
      hashtagPlacement: 'CAPTION',
      keywords: [],
      firstComment: '',
      media: [],
      targetAccountIds: [],
      version: 1,
    });
  });

  it.each([
    [{ caption: 'x'.repeat(63207) }, 'caption'],
    [{ hashtags: ['#summer'] }, 'hashtags.0'],
    [{ hashtags: ['sale', 'SALE'] }, 'hashtags'],
    [{ hashtags: Array.from({ length: 61 }, (_, i) => `t${i}`) }, 'hashtags'],
    [{ keywords: ['x'.repeat(61)] }, 'keywords.0'],
    [{ hashtagPlacement: 'STORY' }, 'hashtagPlacement'],
    [{ platformCaptions: { TIKTOK: 'x' } }, 'platformCaptions'],
    [{ targetAccountIds: ['not-an-id'] }, 'targetAccountIds.0'],
    [{ media: [{ mediaId: 'a'.repeat(24), altText: 'x'.repeat(1001) }] }, 'media.0.altText'],
    [{ status: 'PUBLISHED' }, '_root'],
  ])('rejects %o', async (body, field) => {
    const res = await create(team.owner.token, body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toHaveProperty(field);
    expect(await ContentPackage.countDocuments()).toBe(0);
  });

  it('counts emoji as one character, like the composer does', async () => {
    const res = await create(team.owner.token, { caption: '😀'.repeat(63206) });
    expect(res.status).toBe(201);
  });

  it('rejects the same account or the same file listed twice', async () => {
    const media = await uploadMedia(team.owner.token, ws);
    const twiceAccounts = await create(team.owner.token, { targetAccountIds: [ids[0], ids[0]] });
    expect(twiceAccounts.status).toBe(422);
    const twiceMedia = await create(team.owner.token, {
      media: [{ mediaId: media.id }, { mediaId: media.id }],
    });
    expect(twiceMedia.status).toBe(422);
  });

  it('only references files that were verified in this workspace', async () => {
    const pending = await requestSlot(team.owner.token, ws, {
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      kind: 'IMAGE',
      sizeBytes: 10,
    });
    const other = await registerUser();
    const { workspace: otherWs } = await createWorkspace(other.token, { name: 'Other' });
    const foreign = await uploadMedia(other.token, otherWs.id);
    for (const mediaId of [pending.body.media.id, foreign.id, 'f'.repeat(24)]) {
      const res = await create(team.owner.token, { media: [{ mediaId }] });
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields.media).toMatch(/missing or were not uploaded/);
    }
  });
});

describe('updating drafts and version conflicts', () => {
  it('replaces every field and increases the version', async () => {
    const { body } = await create(team.owner.token, {
      caption: 'One',
      platformCaptions: { FACEBOOK_PAGE: 'FB', INSTAGRAM_ACCOUNT: 'IG' },
      hashtags: ['a', 'b'],
      targetAccountIds: [ids[0]],
    });
    const id = body.contentPackage.id;
    const res = await patch(team.owner.token, id, {
      caption: 'Two',
      platformCaptions: { FACEBOOK_PAGE: 'FB only' },
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.contentPackage).toMatchObject({
      caption: 'Two',
      // A platform left out goes back to the shared caption: nothing is merged.
      platformCaptions: { FACEBOOK_PAGE: 'FB only' },
      hashtags: [],
      targetAccountIds: [],
      version: 2,
    });
  });

  it('requires the version', async () => {
    const { body } = await create(team.owner.token, { caption: 'One' });
    const res = await patch(team.owner.token, body.contentPackage.id, { caption: 'Two' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toHaveProperty('version');
  });

  it('answers 409 for a stale version and writes nothing', async () => {
    const { body } = await create(team.owner.token, { caption: 'Original' });
    const id = body.contentPackage.id;
    expect((await patch(team.admin.token, id, { caption: 'Admin edit', version: 1 })).status).toBe(
      200,
    );

    const stale = await patch(team.owner.token, id, { caption: 'Owner edit', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Someone else saved this draft. Reload it to see their changes.',
      details: { currentVersion: 2 },
    });
    const stored = await ContentPackage.findById(id);
    expect(stored).toMatchObject({ caption: 'Admin edit', version: 2 });

    // After reloading, the same person can save on top of the current version.
    const retry = await patch(team.owner.token, id, { caption: 'Owner edit', version: 2 });
    expect(retry.body.contentPackage).toMatchObject({ caption: 'Owner edit', version: 3 });
  });

  it('lets exactly one of two simultaneous saves win', async () => {
    const { body } = await create(team.owner.token, { caption: 'Original' });
    const id = body.contentPackage.id;
    const results = await Promise.all(
      ['A', 'B', 'C', 'D'].map((caption) => patch(team.owner.token, id, { caption, version: 1 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    const winner = results.find((r) => r.status === 200).body.contentPackage;
    const stored = await ContentPackage.findById(id);
    expect(stored).toMatchObject({ caption: winner.caption, version: 2 });
  });

  it('supports autosave: a run of saves, each on the version before it', async () => {
    const { body } = await create(team.editor.token, { caption: 'D' });
    let version = body.contentPackage.version;
    for (const caption of ['Dr', 'Dra', 'Draf', 'Draft']) {
      const res = await patch(team.editor.token, body.contentPackage.id, { caption, version });
      expect(res.status).toBe(200);
      version = res.body.contentPackage.version;
    }
    expect(version).toBe(5);
    expect((await ContentPackage.findById(body.contentPackage.id)).caption).toBe('Draft');
  });

  it('answers 404 for a draft that was deleted meanwhile', async () => {
    const { body } = await create(team.owner.token, { caption: 'Gone' });
    const id = body.contentPackage.id;
    expect((await as(team.owner.token).delete(url(ws, `/${id}`))).status).toBe(204);
    expect((await patch(team.owner.token, id, { caption: 'x', version: 1 })).status).toBe(404);
    expect((await as(team.owner.token).get(url(ws, `/${id}`))).status).toBe(404);
    expect((await as(team.owner.token).delete(url(ws, `/${id}`))).status).toBe(404);
  });
});

describe('listing drafts', () => {
  it('lists newest first and pages with a cursor', async () => {
    for (const caption of ['one', 'two', 'three', 'four', 'five']) {
      await create(team.owner.token, { caption });
    }
    const first = await as(team.owner.token).get(url(ws)).query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(first.body.items.map((d) => d.caption)).toEqual(['five', 'four']);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const seen = [...first.body.items];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await as(team.owner.token).get(url(ws)).query({ limit: 2, cursor });
      seen.push(...page.body.items);
      cursor = page.body.nextCursor;
    }
    expect(seen.map((d) => d.caption)).toEqual(['five', 'four', 'three', 'two', 'one']);
  });

  it('moves a draft to the top when it is saved again', async () => {
    const a = await create(team.owner.token, { caption: 'a' });
    await create(team.owner.token, { caption: 'b' });
    await patch(team.owner.token, a.body.contentPackage.id, { caption: 'a2', version: 1 });
    const list = await as(team.owner.token).get(url(ws));
    expect(list.body.items.map((d) => d.caption)).toEqual(['a2', 'b']);
  });

  it('rejects a malformed cursor and unknown query fields', async () => {
    expect((await as(team.owner.token).get(url(ws)).query({ cursor: 'nonsense' })).status).toBe(
      422,
    );
    expect((await as(team.owner.token).get(url(ws)).query({ limit: 500 })).status).toBe(422);
    expect((await as(team.owner.token).get(url(ws)).query({ workspace: 'x' })).status).toBe(422);
  });
});

describe('workspace isolation', () => {
  it('never shows, changes or deletes a draft through another workspace', async () => {
    const { body } = await create(team.owner.token, { caption: 'Private' });
    const id = body.contentPackage.id;
    const outsider = await registerUser();
    const { workspace: otherWs } = await createWorkspace(outsider.token, { name: 'Other' });

    for (const workspaceId of [ws, otherWs.id]) {
      expect((await as(outsider.token).get(url(workspaceId, `/${id}`))).status).toBe(404);
      const edit = await as(outsider.token)
        .patch(url(workspaceId, `/${id}`))
        .send({ caption: 'hacked', version: 1 });
      expect(edit.status).toBe(404);
      expect((await as(outsider.token).delete(url(workspaceId, `/${id}`))).status).toBe(404);
    }
    expect((await as(outsider.token).get(url(otherWs.id))).body.items).toEqual([]);
    expect((await as(outsider.token).get(url(ws))).status).toBe(404);
    expect((await ContentPackage.findById(id)).caption).toBe('Private');
  });

  it('rejects accounts of another workspace', async () => {
    const outsider = await registerUser();
    const { workspace: otherWs } = await createWorkspace(outsider.token, { name: 'Other' });
    const foreign = await seedSocialAccounts(otherWs.id, outsider.user.id, {
      externalUserId: 'fb-user-2',
    });
    const res = await create(team.owner.token, {
      targetAccountIds: [String(foreign.accounts[0]._id)],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.targetAccountIds).toMatch(/not available to you/);
  });

  it('requires a session', async () => {
    expect((await api().get(url(ws))).status).toBe(401);
    expect((await api().post(url(ws)).send({})).status).toBe(401);
  });
});

describe('roles and account access', () => {
  it('lets viewers read drafts but not create, change or delete them', async () => {
    const { body } = await create(team.owner.token, { caption: 'Read me' });
    const id = body.contentPackage.id;
    expect((await as(team.viewer.token).get(url(ws))).body.items).toHaveLength(1);
    expect((await as(team.viewer.token).get(url(ws, `/${id}`))).status).toBe(200);
    expect((await create(team.viewer.token, {})).status).toBe(403);
    expect((await patch(team.viewer.token, id, { caption: 'x', version: 1 })).status).toBe(403);
    expect((await as(team.viewer.token).delete(url(ws, `/${id}`))).status).toBe(403);
  });

  it('only lets an editor target the accounts assigned to them', async () => {
    // Editors start with no accounts at all.
    const none = await create(team.editor.token, { targetAccountIds: [ids[0]] });
    expect(none.status).toBe(422);
    expect(none.body.error.details.fields.targetAccountIds).toMatch(/not available to you/);

    await grant(team.editor, [ids[0]]);
    expect((await create(team.editor.token, { targetAccountIds: [ids[0]] })).status).toBe(201);
    expect((await create(team.editor.token, { targetAccountIds: [ids[0], ids[1]] })).status).toBe(
      422,
    );
  });

  it('hides accounts a reader cannot use, and stops them changing that draft', async () => {
    await grant(team.editor, [ids[0]]);
    const { body } = await create(team.owner.token, {
      caption: 'For two pages',
      targetAccountIds: [ids[0], ids[1]],
    });
    const id = body.contentPackage.id;

    const read = await as(team.editor.token).get(url(ws, `/${id}`));
    expect(read.body.contentPackage.targetAccountIds).toEqual([ids[0]]);
    const listed = await as(team.editor.token).get(url(ws));
    expect(listed.body.items[0].targetAccountIds).toEqual([ids[0]]);

    // Saving would silently drop the page the editor cannot see, so it is refused.
    const edit = await patch(team.editor.token, id, {
      caption: 'Editor version',
      targetAccountIds: [ids[0]],
      version: 1,
    });
    expect(edit.status).toBe(403);
    expect((await as(team.editor.token).delete(url(ws, `/${id}`))).status).toBe(403);
    const stored = await ContentPackage.findById(id);
    expect(stored.targetAccounts.map(String)).toEqual([ids[0], ids[1]]);

    // Once the editor has both accounts, they can work on it.
    await grant(team.editor, [ids[0], ids[1]]);
    const ok = await patch(team.editor.token, id, {
      caption: 'Editor version',
      targetAccountIds: [ids[0], ids[1]],
      version: 1,
    });
    expect(ok.status).toBe(200);
  });

  it('does not let a removed account lock a draft', async () => {
    await grant(team.editor, [ids[0]]);
    const { body } = await create(team.owner.token, { targetAccountIds: [ids[0], ids[1]] });
    await SocialAccount.deleteOne({ _id: ids[1] });
    const res = await patch(team.editor.token, body.contentPackage.id, {
      caption: 'Still editable',
      targetAccountIds: [ids[0]],
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.contentPackage.targetAccountIds).toEqual([ids[0]]);
  });
});

describe('activity log', () => {
  const actions = async () =>
    (await ActivityLog.find({ 'target.type': 'content_package' }).sort({ _id: 1 })).map(
      (l) => l.action,
    );

  it('records creation and deletion without the content', async () => {
    const { body } = await create(team.editor.token, {
      caption: 'Confidential launch text',
      firstComment: 'Secret comment',
      keywords: ['secret keyword'],
    });
    await as(team.editor.token).delete(url(ws, `/${body.contentPackage.id}`));
    const logs = await ActivityLog.find({ 'target.type': 'content_package' }).sort({ _id: 1 });
    expect(logs.map((l) => l.action)).toEqual([
      'content_package.created',
      'content_package.deleted',
    ]);
    expect(logs[0]).toMatchObject({
      actorName: 'Eddie Editor',
      metadata: { mediaCount: 0, accountCount: 0 },
    });
    expect(String(logs[0].target.id)).toBe(body.contentPackage.id);
    const text = JSON.stringify(logs.map((l) => l.toJSON()));
    for (const secret of ['Confidential', 'Secret comment', 'secret keyword']) {
      expect(text).not.toContain(secret);
    }
  });

  it('logs an update once per interval, not once per autosave', async () => {
    const { body } = await create(team.owner.token, { caption: 'v1' });
    const id = body.contentPackage.id;
    for (let version = 1; version <= 4; version += 1) {
      await patch(team.owner.token, id, { caption: `v${version + 1}`, version });
    }
    expect(await actions()).toEqual(['content_package.created', 'content_package.updated']);

    // Later edits are logged again.
    await ContentPackage.updateOne(
      { _id: id },
      { updateLoggedAt: new Date(Date.now() - UPDATE_LOG_INTERVAL_MS - 1000) },
    );
    await patch(team.owner.token, id, { caption: 'later', version: 5 });
    expect(await actions()).toEqual([
      'content_package.created',
      'content_package.updated',
      'content_package.updated',
    ]);
  });

  it('logs nothing for a rejected or conflicting save', async () => {
    const { body } = await create(team.owner.token, { caption: 'v1' });
    await patch(team.owner.token, body.contentPackage.id, { caption: 'x', version: 9 });
    await patch(team.owner.token, body.contentPackage.id, { hashtags: ['#bad'], version: 1 });
    expect(await actions()).toEqual(['content_package.created']);
  });
});
