import { describe, expect, it } from 'vitest';
import { ActivityLog, Membership } from '../src/models/index.js';
import { as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';

const membersUrl = (ws) => `/api/v1/workspaces/${ws.id}/members`;

describe('member listing', () => {
  it('is visible to every role and never exposes secrets', async () => {
    const { workspace, viewer } = await seedTeam();
    const res = await as(viewer.token).get(membersUrl(workspace));
    expect(res.status).toBe(200);
    expect(res.body.items.map((m) => m.role).sort()).toEqual([
      'ADMIN',
      'EDITOR',
      'OWNER',
      'VIEWER',
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash|tokenHash/);
    expect(res.body.items[0].user).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
    });
  });
});

describe('role changes (hierarchy enforcement)', () => {
  it('lets the owner promote an editor to admin and logs the change', async () => {
    const { workspace, owner, editor } = await seedTeam();
    const res = await as(owner.token)
      .patch(`${membersUrl(workspace)}/${editor.membershipId}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('ADMIN');
    const log = await ActivityLog.findOne({
      workspace: workspace.id,
      action: 'member.role_changed',
    });
    expect(log.metadata).toMatchObject({ from: 'EDITOR', to: 'ADMIN' });
  });

  it('lets admins move members between editor and viewer', async () => {
    const { workspace, admin, viewer } = await seedTeam();
    const res = await as(admin.token)
      .patch(`${membersUrl(workspace)}/${viewer.membershipId}`)
      .send({ role: 'EDITOR' });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('EDITOR');
  });

  it('stops admins from promoting anyone to admin', async () => {
    const { workspace, admin, editor } = await seedTeam();
    const res = await as(admin.token)
      .patch(`${membersUrl(workspace)}/${editor.membershipId}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
    expect((await Membership.findById(editor.membershipId)).role).toBe('EDITOR');
  });

  it('stops admins from managing other admins or the owner', async () => {
    const { workspace, owner, admin } = await seedTeam();
    const otherAdmin = await registerUser();
    const invite = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .send({ email: otherAdmin.email, role: 'ADMIN' });
    const token = decodeURIComponent(invite.body.inviteUrl.split('/invite/')[1]);
    const joined = await as(otherAdmin.token).post(
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
    );

    expect(
      (
        await as(admin.token)
          .patch(`${membersUrl(workspace)}/${joined.body.membership.id}`)
          .send({ role: 'VIEWER' })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(admin.token)
          .patch(`${membersUrl(workspace)}/${owner.membershipId}`)
          .send({ role: 'VIEWER' })
      ).status,
    ).toBe(403);
  });

  it('never allows OWNER to be assigned through a role change', async () => {
    const { workspace, owner, admin } = await seedTeam();
    const res = await as(owner.token)
      .patch(`${membersUrl(workspace)}/${admin.membershipId}`)
      .send({ role: 'OWNER' });
    expect(res.status).toBe(422);
  });

  it('forbids changing your own role', async () => {
    const { workspace, owner } = await seedTeam();
    const res = await as(owner.token)
      .patch(`${membersUrl(workspace)}/${owner.membershipId}`)
      .send({ role: 'VIEWER' });
    expect(res.status).toBe(400);
  });

  it('forbids editors and viewers from managing members', async () => {
    const { workspace, editor, viewer } = await seedTeam();
    expect(
      (
        await as(editor.token)
          .patch(`${membersUrl(workspace)}/${viewer.membershipId}`)
          .send({ role: 'EDITOR' })
      ).status,
    ).toBe(403);
    expect(
      (await as(viewer.token).delete(`${membersUrl(workspace)}/${editor.membershipId}`)).status,
    ).toBe(403);
  });

  it('returns 404 for members of a different workspace', async () => {
    const { workspace, owner } = await seedTeam();
    const stranger = await registerUser();
    const other = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    const res = await as(owner.token)
      .patch(`${membersUrl(workspace)}/${other.membership.id}`)
      .send({ role: 'VIEWER' });
    expect(res.status).toBe(404);
  });
});

describe('member removal and leaving', () => {
  it('lets admins remove editors, revoking their access immediately', async () => {
    const { workspace, admin, editor } = await seedTeam();
    expect(
      (await as(admin.token).delete(`${membersUrl(workspace)}/${editor.membershipId}`)).status,
    ).toBe(204);
    expect((await as(editor.token).get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(404);
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'member.removed' }),
    ).toBeTruthy();
  });

  it('prevents removing the owner', async () => {
    const { workspace, owner, admin } = await seedTeam();
    expect(
      (await as(admin.token).delete(`${membersUrl(workspace)}/${owner.membershipId}`)).status,
    ).toBe(403);
  });

  it('lets non-owners leave, but not the owner', async () => {
    const { workspace, owner, viewer } = await seedTeam();
    expect((await as(viewer.token).post(`/api/v1/workspaces/${workspace.id}/leave`)).status).toBe(
      204,
    );
    expect(await Membership.exists({ _id: viewer.membershipId })).toBeNull();

    const ownerLeave = await as(owner.token).post(`/api/v1/workspaces/${workspace.id}/leave`);
    expect(ownerLeave.status).toBe(400);
    expect(ownerLeave.body.error.message).toMatch(/transfer ownership/i);
  });
});

describe('workspace-specific social account access', () => {
  const accessUrl = (ws, memberId) =>
    `/api/v1/workspaces/${ws.id}/members/${memberId}/account-access`;
  const accountsUrl = (ws) => `/api/v1/workspaces/${ws.id}/social-accounts`;

  // Phase 3 (least privilege): editors and viewers see only the accounts assigned to them.
  it('starts new editors and viewers with no account access until accounts are assigned', async () => {
    const { workspace, owner, editor, viewer } = await seedTeam();
    await seedSocialAccounts(workspace.id, owner.user.id, { pages: 2, instagram: 1 });
    for (const member of [editor, viewer]) {
      const res = await as(member.token).get(accountsUrl(workspace));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
    // Owners and admins are unaffected.
    expect((await as(owner.token).get(accountsUrl(workspace))).body.items).toHaveLength(3);
  });

  it('gives a member every account once an admin grants ALL', async () => {
    const { workspace, owner, admin, editor } = await seedTeam();
    await seedSocialAccounts(workspace.id, owner.user.id, { pages: 2, instagram: 1 });
    await as(admin.token)
      .put(accessUrl(workspace, editor.membershipId))
      .send({ mode: 'ALL', socialAccountIds: [] });
    expect((await as(editor.token).get(accountsUrl(workspace))).body.items).toHaveLength(3);
  });

  it('restricts an editor to SELECTED accounts', async () => {
    const { workspace, owner, admin, editor } = await seedTeam();
    const { accounts } = await seedSocialAccounts(workspace.id, owner.user.id, {
      pages: 3,
      instagram: 1,
    });
    const chosen = [String(accounts[0]._id), String(accounts[3]._id)];

    const res = await as(admin.token)
      .put(accessUrl(workspace, editor.membershipId))
      .send({ mode: 'SELECTED', socialAccountIds: chosen });
    expect(res.status).toBe(200);
    expect(res.body.member.accountAccess).toEqual({ mode: 'SELECTED', socialAccountIds: chosen });

    const visible = await as(editor.token).get(accountsUrl(workspace));
    expect(visible.body.items.map((a) => a.id).sort()).toEqual([...chosen].sort());

    const onlyPages = await as(editor.token).get(
      `${accountsUrl(workspace)}?platform=FACEBOOK_PAGE`,
    );
    expect(onlyPages.body.items.map((a) => a.id)).toEqual([chosen[0]]);

    // Owners and admins are never restricted.
    expect((await as(admin.token).get(accountsUrl(workspace))).body.items).toHaveLength(4);
    expect(
      await ActivityLog.exists({
        workspace: workspace.id,
        action: 'member.account_access_updated',
      }),
    ).toBeTruthy();
  });

  it('allows an empty selection (no accounts)', async () => {
    const { workspace, owner, viewer } = await seedTeam();
    await seedSocialAccounts(workspace.id, owner.user.id);
    await as(owner.token)
      .put(accessUrl(workspace, viewer.membershipId))
      .send({ mode: 'SELECTED', socialAccountIds: [] });
    expect((await as(viewer.token).get(accountsUrl(workspace))).body.items).toEqual([]);
  });

  it('rejects accounts that belong to another workspace', async () => {
    const { workspace, owner, editor } = await seedTeam();
    const stranger = await registerUser();
    const other = await createWorkspace(stranger.token, { name: 'Other' });
    const { accounts } = await seedSocialAccounts(other.workspace.id, stranger.user.id);

    const res = await as(owner.token)
      .put(accessUrl(workspace, editor.membershipId))
      .send({ mode: 'SELECTED', socialAccountIds: [String(accounts[0]._id)] });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.socialAccountIds).toBeTruthy();
  });

  it('refuses to scope owners and admins', async () => {
    const { workspace, owner, admin } = await seedTeam();
    const res = await as(owner.token)
      .put(accessUrl(workspace, admin.membershipId))
      .send({ mode: 'SELECTED', socialAccountIds: [] });
    expect(res.status).toBe(400);
  });

  it('never exposes access tokens through the API', async () => {
    const { workspace, owner } = await seedTeam();
    const { accounts, connection } = await seedSocialAccounts(workspace.id, owner.user.id, {
      pages: 1,
      instagram: 0,
    });
    accounts[0].setAccessToken('EAAG-page-token-secret');
    await accounts[0].save();
    connection.setAccessToken('EAAG-user-token-secret');
    await connection.save();

    const list = await as(owner.token).get(accountsUrl(workspace));
    const conns = await as(owner.token).get(
      `/api/v1/workspaces/${workspace.id}/social-connections`,
    );
    for (const res of [list, conns]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/EAAG|ciphertext|accessToken/);
    }
    expect(conns.body.items[0]).toMatchObject({ provider: 'FACEBOOK_LOGIN', accountCount: 1 });
  });

  it('limits the connections list to roles that manage connections', async () => {
    const { workspace, editor } = await seedTeam();
    expect(
      (await as(editor.token).get(`/api/v1/workspaces/${workspace.id}/social-connections`)).status,
    ).toBe(403);
  });
});
