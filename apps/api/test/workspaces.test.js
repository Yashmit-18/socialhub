import { describe, expect, it } from 'vitest';
import { setTransactionSupportForTests } from '../src/db/mongoose.js';
import {
  ActivityLog,
  Invitation,
  Membership,
  SocialAccount,
  SocialConnection,
  Workspace,
} from '../src/models/index.js';
import {
  DEFAULT_PASSWORD,
  as,
  createWorkspace,
  registerUser,
  seedSocialAccounts,
  seedTeam,
} from './helpers.js';

describe('workspace creation', () => {
  it('creates a workspace with the creator as sole OWNER and logs it', async () => {
    const { token, user } = await registerUser();
    const res = await as(token)
      .post('/api/v1/workspaces')
      .send({ name: 'Acme Social', timezone: 'Asia/Kolkata' });

    expect(res.status).toBe(201);
    expect(res.body.workspace).toMatchObject({
      name: 'Acme Social',
      slug: 'acme-social',
      timezone: 'Asia/Kolkata',
    });
    expect(res.body.membership.role).toBe('OWNER');
    expect(res.body.membership.permissions).toContain('workspace:delete');

    const memberships = await Membership.find({ workspace: res.body.workspace.id });
    expect(memberships).toHaveLength(1);
    expect(String(memberships[0].user)).toBe(user.id);

    const log = await ActivityLog.findOne({ workspace: res.body.workspace.id });
    expect(log.action).toBe('workspace.created');
  });

  it('generates a unique slug when the natural one is taken', async () => {
    const { token } = await registerUser();
    const a = await createWorkspace(token, { name: 'Acme Social' });
    const b = await createWorkspace(token, { name: 'Acme Social' });
    expect(a.workspace.slug).toBe('acme-social');
    expect(b.workspace.slug).toMatch(/^acme-social-[a-z0-9]{4}$/);
  });

  it('rejects an explicit slug that is taken, reserved or malformed', async () => {
    const { token } = await registerUser();
    await createWorkspace(token, { name: 'One', slug: 'taken-slug' });
    const taken = await as(token)
      .post('/api/v1/workspaces')
      .send({ name: 'Two', slug: 'taken-slug' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.details.fields.slug).toBeTruthy();

    expect(
      (await as(token).post('/api/v1/workspaces').send({ name: 'Two', slug: 'admin' })).status,
    ).toBe(422);
    expect(
      (await as(token).post('/api/v1/workspaces').send({ name: 'Two', slug: '-bad-' })).status,
    ).toBe(422);
  });

  it('handles names that do not produce a usable slug', async () => {
    const { token } = await registerUser();
    const { workspace } = await createWorkspace(token, { name: '日本' });
    expect(workspace.slug).toMatch(/^workspace-[a-z0-9]{4}$/);
  });

  it('rejects invalid time zones', async () => {
    const { token } = await registerUser();
    const res = await as(token)
      .post('/api/v1/workspaces')
      .send({ name: 'Acme', timezone: 'Nowhere/City' });
    expect(res.status).toBe(422);
  });

  it('works on MongoDB deployments without transaction support', async () => {
    setTransactionSupportForTests(false);
    const { token } = await registerUser();
    const { workspace, membership } = await createWorkspace(token, { name: 'Standalone' });
    expect(membership.role).toBe('OWNER');
    expect(await Membership.countDocuments({ workspace: workspace.id })).toBe(1);
  });
});

describe('workspace access', () => {
  it('lists only the workspaces the user belongs to, with their role', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await createWorkspace(alice.token, { name: 'Alice Co' });
    await createWorkspace(bob.token, { name: 'Bob Co' });

    const res = await as(alice.token).get('/api/v1/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.items.map((w) => w.name)).toEqual(['Alice Co']);
    expect(res.body.items[0].membership.role).toBe('OWNER');
  });

  it('returns 404 (not 403) to non-members so workspace ids cannot be probed', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const { workspace } = await createWorkspace(alice.token);
    expect((await as(bob.token).get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(404);
    expect((await as(bob.token).get(`/api/v1/workspaces/${workspace.id}/members`)).status).toBe(
      404,
    );
    expect((await as(bob.token).get('/api/v1/workspaces/not-an-id')).status).toBe(404);
  });

  it('requires authentication for every workspace route', async () => {
    const { token } = await registerUser();
    const { workspace } = await createWorkspace(token);
    expect((await as('bogus').get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(401);
  });
});

describe('workspace updates', () => {
  it('lets owners and admins update settings, and records what changed', async () => {
    const { workspace, admin } = await seedTeam();
    const res = await as(admin.token)
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Renamed', timezone: 'Europe/London' });
    expect(res.status).toBe(200);
    expect(res.body.workspace).toMatchObject({ name: 'Renamed', timezone: 'Europe/London' });

    const log = await ActivityLog.findOne({ workspace: workspace.id, action: 'workspace.updated' });
    expect(log.metadata.before).toMatchObject({ name: 'Acme Social', timezone: 'UTC' });
    expect(log.metadata.after).toMatchObject({ name: 'Renamed', timezone: 'Europe/London' });
  });

  it('forbids editors and viewers from updating settings', async () => {
    const { workspace, editor, viewer } = await seedTeam();
    for (const member of [editor, viewer]) {
      const res = await as(member.token)
        .patch(`/api/v1/workspaces/${workspace.id}`)
        .send({ name: 'Nope' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('rejects a slug already used by another workspace', async () => {
    const { token } = await registerUser();
    await createWorkspace(token, { name: 'First', slug: 'first-space' });
    const { workspace } = await createWorkspace(token, { name: 'Second' });
    const res = await as(token)
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ slug: 'first-space' });
    expect(res.status).toBe(409);
  });

  it('rejects empty updates', async () => {
    const { token } = await registerUser();
    const { workspace } = await createWorkspace(token);
    expect((await as(token).patch(`/api/v1/workspaces/${workspace.id}`).send({})).status).toBe(422);
  });
});

describe('ownership transfer', () => {
  it('moves OWNER to the target and demotes the previous owner to ADMIN', async () => {
    const { workspace, owner, editor } = await seedTeam();
    const res = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: editor.membershipId, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(204);

    const owners = await Membership.find({ workspace: workspace.id, role: 'OWNER' });
    expect(owners).toHaveLength(1);
    expect(String(owners[0]._id)).toBe(editor.membershipId);
    expect((await Membership.findById(owner.membershipId)).role).toBe('ADMIN');
    expect(
      await ActivityLog.exists({
        workspace: workspace.id,
        action: 'workspace.ownership_transferred',
      }),
    ).toBeTruthy();

    // The new owner now holds owner-only powers; the old owner does not.
    const again = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: editor.membershipId, password: DEFAULT_PASSWORD });
    expect(again.status).toBe(403);
  });

  it('requires the owner to re-enter their password', async () => {
    const { workspace, owner, admin } = await seedTeam();
    const res = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: admin.membershipId, password: 'Wrong-pass1' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.password).toBeTruthy();
    expect((await Membership.findById(owner.membershipId)).role).toBe('OWNER');
  });

  it('is owner-only and validates the target', async () => {
    const { workspace, owner, admin } = await seedTeam();
    const byAdmin = await as(admin.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: admin.membershipId, password: DEFAULT_PASSWORD });
    expect(byAdmin.status).toBe(403);

    const toSelf = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: owner.membershipId, password: DEFAULT_PASSWORD });
    expect(toSelf.status).toBe(400);

    const unknown = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: '507f1f77bcf86cd799439011', password: DEFAULT_PASSWORD });
    expect(unknown.status).toBe(404);
  });

  it('also works without transaction support', async () => {
    const { workspace, owner, admin } = await seedTeam();
    setTransactionSupportForTests(false);
    const res = await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`)
      .send({ memberId: admin.membershipId, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(204);
    expect(await Membership.countDocuments({ workspace: workspace.id, role: 'OWNER' })).toBe(1);
  });

  it('enforces a single OWNER at the database level', async () => {
    const { workspace, admin } = await seedTeam();
    await expect(
      Membership.updateOne({ _id: admin.membershipId }, { role: 'OWNER' }),
    ).rejects.toThrow(/duplicate key/i);
    expect(workspace.id).toBeTruthy();
  });
});

describe('workspace deletion', () => {
  it('requires the exact name and the owner password, then removes all workspace data', async () => {
    const { workspace, owner } = await seedTeam();
    await seedSocialAccounts(workspace.id, owner.user.id);
    await as(owner.token)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .send({ email: 'pending@example.com', role: 'VIEWER' });

    const wrongName = await as(owner.token)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .send({ confirmation: 'acme social', password: DEFAULT_PASSWORD });
    expect(wrongName.status).toBe(422);
    const wrongPassword = await as(owner.token)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .send({ confirmation: 'Acme Social', password: 'Wrong-pass1' });
    expect(wrongPassword.status).toBe(422);
    expect(await Workspace.exists({ _id: workspace.id })).toBeTruthy();

    const res = await as(owner.token)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .send({ confirmation: 'Acme Social', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(204);

    for (const Model of [Membership, Invitation, ActivityLog, SocialAccount, SocialConnection]) {
      expect(await Model.countDocuments({ workspace: workspace.id })).toBe(0);
    }
    expect(await Workspace.exists({ _id: workspace.id })).toBeNull();
    expect((await as(owner.token).get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(404);
  });

  it('is owner-only', async () => {
    const { workspace, admin } = await seedTeam();
    const res = await as(admin.token)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .send({ confirmation: 'Acme Social', password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('workspace overview', () => {
  it('returns stats scoped to what the caller may see', async () => {
    const { workspace, owner, viewer } = await seedTeam();
    await seedSocialAccounts(workspace.id, owner.user.id, { pages: 3, instagram: 2 });

    const asOwner = await as(owner.token).get(`/api/v1/workspaces/${workspace.id}/overview`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.stats).toMatchObject({
      members: 4,
      pendingInvitations: 0,
      socialConnections: 1,
      facebookPages: 3,
      instagramAccounts: 2,
    });
    expect(asOwner.body.recentActivity.length).toBeGreaterThan(0);

    // Viewers start with no assigned accounts (least privilege), so they count none.
    const asViewer = await as(viewer.token).get(`/api/v1/workspaces/${workspace.id}/overview`);
    expect(asViewer.body.stats).toMatchObject({
      members: 4,
      pendingInvitations: null,
      socialConnections: null,
      facebookPages: 0,
      instagramAccounts: 0,
    });
    expect(asViewer.body.recentActivity).toBeNull();
  });
});
