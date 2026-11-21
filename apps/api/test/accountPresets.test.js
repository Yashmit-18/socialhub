import { beforeEach, describe, expect, it } from 'vitest';
import { AccountPreset, ActivityLog } from '../src/models/index.js';
import { as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';

const url = (workspaceId, suffix = '') =>
  `/api/v1/workspaces/${workspaceId}/account-presets${suffix}`;

let team;
let ws;
let ids;

const create = (token, body) => as(token).post(url(ws)).send(body);

async function grant(member, accountIds) {
  const res = await as(team.owner.token)
    .put(`/api/v1/workspaces/${ws}/members/${member.membershipId}/account-access`)
    .send({ mode: 'SELECTED', socialAccountIds: accountIds });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const { accounts } = await seedSocialAccounts(ws, team.owner.user.id);
  ids = accounts.map((a) => String(a._id));
});

describe('account presets', () => {
  it('creates a preset in MongoDB and lists it for the workspace', async () => {
    const res = await create(team.owner.token, {
      name: '  All   Pages ',
      socialAccountIds: [ids[0], ids[1]],
    });
    expect(res.status).toBe(201);
    expect(res.body.preset).toMatchObject({
      id: expect.any(String),
      name: 'All Pages',
      socialAccountIds: [ids[0], ids[1]],
      createdBy: { id: team.owner.user.id, name: 'Olivia Owner' },
    });
    expect(await AccountPreset.countDocuments({ workspace: ws })).toBe(1);

    const list = await as(team.admin.token).get(url(ws));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([res.body.preset]);
  });

  it.each([
    [{ name: '', socialAccountIds: ['a'.repeat(24)] }, 'name'],
    [{ name: 'x'.repeat(41), socialAccountIds: ['a'.repeat(24)] }, 'name'],
    [{ name: 'Empty', socialAccountIds: [] }, 'socialAccountIds'],
    [{ name: 'Bad id', socialAccountIds: ['nope'] }, 'socialAccountIds.0'],
    [{ name: 'Extra', socialAccountIds: ['a'.repeat(24)], workspace: 'x' }, '_root'],
  ])('rejects %o', async (body, field) => {
    const res = await create(team.owner.token, body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toHaveProperty(field);
  });

  it('rejects the same account listed twice', async () => {
    const res = await create(team.owner.token, {
      name: 'Twice',
      socialAccountIds: [ids[0], ids[0]],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.socialAccountIds).toMatch(/only be listed once/);
  });

  it('keeps names unique in a workspace, whatever the case', async () => {
    expect(
      (await create(team.owner.token, { name: 'Retail', socialAccountIds: [ids[0]] })).status,
    ).toBe(201);
    const again = await create(team.admin.token, { name: 'RETAIL', socialAccountIds: [ids[1]] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'CONFLICT',
      details: { fields: { name: 'A preset with this name already exists' } },
    });
    expect(await AccountPreset.countDocuments()).toBe(1);
  });

  it('allows only one of two simultaneous presets with the same name', async () => {
    const results = await Promise.all(
      [0, 1, 2].map(() => create(team.owner.token, { name: 'Race', socialAccountIds: [ids[0]] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await AccountPreset.countDocuments()).toBe(1);
  });

  it('rejects accounts that are unknown or belong to another workspace', async () => {
    const outsider = await registerUser();
    const { workspace: otherWs } = await createWorkspace(outsider.token, { name: 'Other' });
    const foreign = await seedSocialAccounts(otherWs.id, outsider.user.id, {
      externalUserId: 'fb-user-2',
    });
    for (const id of [String(foreign.accounts[0]._id), 'f'.repeat(24)]) {
      const res = await create(team.owner.token, { name: 'Bad', socialAccountIds: [ids[0], id] });
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields.socialAccountIds).toMatch(/not available to you/);
    }
    expect(await AccountPreset.countDocuments()).toBe(0);
  });

  it('enforces each member’s account restrictions', async () => {
    // An editor with no accounts cannot build a preset from accounts they cannot use.
    expect(
      (await create(team.editor.token, { name: 'Mine', socialAccountIds: [ids[0]] })).status,
    ).toBe(422);
    await grant(team.editor, [ids[0]]);
    expect(
      (await create(team.editor.token, { name: 'Mine', socialAccountIds: [ids[0]] })).status,
    ).toBe(201);
    expect(
      (await create(team.editor.token, { name: 'More', socialAccountIds: [ids[0], ids[1]] }))
        .status,
    ).toBe(422);

    // Readers only see the accounts they can use themselves.
    await create(team.owner.token, { name: 'Everything', socialAccountIds: ids });
    const forEditor = (await as(team.editor.token).get(url(ws))).body.items;
    expect(forEditor.find((p) => p.name === 'Everything').socialAccountIds).toEqual([ids[0]]);
    const forViewer = (await as(team.viewer.token).get(url(ws))).body.items;
    expect(forViewer.find((p) => p.name === 'Everything').socialAccountIds).toEqual([]);
    const forOwner = (await as(team.owner.token).get(url(ws))).body.items;
    expect(forOwner.find((p) => p.name === 'Everything').socialAccountIds).toEqual(ids);
  });

  it('lets viewers list presets but not create or delete them', async () => {
    const { body } = await create(team.owner.token, { name: 'Retail', socialAccountIds: [ids[0]] });
    expect((await as(team.viewer.token).get(url(ws))).status).toBe(200);
    expect(
      (await create(team.viewer.token, { name: 'V', socialAccountIds: [ids[0]] })).status,
    ).toBe(403);
    expect((await as(team.viewer.token).delete(url(ws, `/${body.preset.id}`))).status).toBe(403);
  });

  it('lets the creator or an admin delete a preset', async () => {
    await grant(team.editor, [ids[0]]);
    const byOwner = (
      await create(team.owner.token, { name: 'Owner set', socialAccountIds: [ids[0]] })
    ).body.preset;
    const byEditor = (
      await create(team.editor.token, { name: 'Editor set', socialAccountIds: [ids[0]] })
    ).body.preset;

    expect((await as(team.editor.token).delete(url(ws, `/${byOwner.id}`))).status).toBe(403);
    expect((await as(team.editor.token).delete(url(ws, `/${byEditor.id}`))).status).toBe(204);
    expect((await as(team.admin.token).delete(url(ws, `/${byOwner.id}`))).status).toBe(204);
    expect((await as(team.admin.token).delete(url(ws, `/${byOwner.id}`))).status).toBe(404);
    expect(await AccountPreset.countDocuments()).toBe(0);
  });

  it('keeps presets inside their workspace', async () => {
    const { body } = await create(team.owner.token, { name: 'Retail', socialAccountIds: [ids[0]] });
    const outsider = await registerUser();
    const { workspace: otherWs } = await createWorkspace(outsider.token, { name: 'Other' });
    expect((await as(outsider.token).get(url(ws))).status).toBe(404);
    expect((await as(outsider.token).get(url(otherWs.id))).body.items).toEqual([]);
    expect((await as(outsider.token).delete(url(otherWs.id, `/${body.preset.id}`))).status).toBe(
      404,
    );
    // The same name is free in another workspace.
    const foreign = await seedSocialAccounts(otherWs.id, outsider.user.id, {
      externalUserId: 'fb-2',
    });
    const res = await as(outsider.token)
      .post(url(otherWs.id))
      .send({ name: 'Retail', socialAccountIds: [String(foreign.accounts[0]._id)] });
    expect(res.status).toBe(201);
  });

  it('records creation and deletion in the activity log', async () => {
    const { body } = await create(team.owner.token, {
      name: 'Retail',
      socialAccountIds: [ids[0], ids[1]],
    });
    await as(team.owner.token).delete(url(ws, `/${body.preset.id}`));
    const logs = await ActivityLog.find({ 'target.type': 'account_preset' }).sort({ _id: 1 });
    expect(logs.map((l) => l.action)).toEqual(['account_preset.created', 'account_preset.deleted']);
    expect(logs[0]).toMatchObject({ actorName: 'Olivia Owner', metadata: { accountCount: 2 } });
    expect(logs[0].target.label).toBe('Retail');
  });

  it('is removed with its workspace', async () => {
    await create(team.owner.token, { name: 'Retail', socialAccountIds: [ids[0]] });
    await as(team.owner.token)
      .delete(`/api/v1/workspaces/${ws}`)
      .send({ confirmation: team.workspace.name, password: team.owner.password });
    expect(await AccountPreset.countDocuments()).toBe(0);
  });
});
