import { describe, expect, it } from 'vitest';
import { outbox } from '../src/lib/mailer.js';
import { ActivityLog, Invitation, Membership } from '../src/models/index.js';
import {
  api,
  as,
  createWorkspace,
  registerUser,
  seedTeam,
  tokenFromInviteUrl,
  uniqueEmail,
} from './helpers.js';

const invitesUrl = (ws) => `/api/v1/workspaces/${ws.id}/invitations`;
const acceptUrl = (token) => `/api/v1/invitations/${encodeURIComponent(token)}/accept`;

async function ownerWithWorkspace() {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
  return { owner, workspace };
}

describe('creating invitations', () => {
  it('creates a pending invitation, returns a one-time link and records activity', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const email = uniqueEmail('invitee');
    const res = await as(owner.token).post(invitesUrl(workspace)).send({ email, role: 'EDITOR' });

    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({
      email,
      role: 'EDITOR',
      status: 'PENDING',
      invitedBy: { name: 'Olivia Owner' },
    });
    expect(res.body.inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/.+/);
    expect(res.body.emailDelivered).toBe(false); // No SMTP in tests: reported honestly.
    expect(res.body.invitation).not.toHaveProperty('tokenHash');

    // Only the digest is stored.
    const stored = await Invitation.findById(res.body.invitation.id).select('+tokenHash');
    expect(stored.tokenHash).not.toBe(tokenFromInviteUrl(res.body.inviteUrl));

    expect(outbox.at(-1)).toMatchObject({ to: email, meta: { kind: 'invitation' } });
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'invitation.created' }),
    ).toBeTruthy();
  });

  it('enforces who may invite which role', async () => {
    const { workspace, admin, editor, viewer } = await seedTeam();
    expect(
      (
        await as(admin.token)
          .post(invitesUrl(workspace))
          .send({ email: uniqueEmail(), role: 'ADMIN' })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(admin.token)
          .post(invitesUrl(workspace))
          .send({ email: uniqueEmail(), role: 'EDITOR' })
      ).status,
    ).toBe(201);
    expect(
      (
        await as(editor.token)
          .post(invitesUrl(workspace))
          .send({ email: uniqueEmail(), role: 'VIEWER' })
      ).status,
    ).toBe(403);
    expect((await as(viewer.token).get(invitesUrl(workspace))).status).toBe(403);
  });

  it('prevents duplicate pending invitations and inviting existing members', async () => {
    const { owner, workspace, editor } = await seedTeam();
    const email = uniqueEmail();
    await as(owner.token).post(invitesUrl(workspace)).send({ email, role: 'VIEWER' });

    const dup = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: email.toUpperCase(), role: 'EDITOR' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.fields.email).toMatch(/pending/i);

    const member = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: editor.email, role: 'VIEWER' });
    expect(member.status).toBe(409);
    expect(member.body.error.details.fields.email).toMatch(/already a member/i);
  });

  it('allows re-inviting once a previous invitation expired', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const email = uniqueEmail();
    const first = await as(owner.token).post(invitesUrl(workspace)).send({ email, role: 'VIEWER' });
    await Invitation.updateOne(
      { _id: first.body.invitation.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const second = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email, role: 'VIEWER' });
    expect(second.status).toBe(201);
    expect((await Invitation.findById(first.body.invitation.id)).status).toBe('EXPIRED');
  });

  it('lists pending invitations for inviters', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: uniqueEmail(), role: 'VIEWER' });
    const res = await as(owner.token).get(invitesUrl(workspace));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('invitation landing page', () => {
  it('shows a public preview for a valid link', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const email = uniqueEmail();
    const invite = await as(owner.token).post(invitesUrl(workspace)).send({ email, role: 'ADMIN' });

    const res = await api().get(
      `/api/v1/invitations/${encodeURIComponent(tokenFromInviteUrl(invite.body.inviteUrl))}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.invitation).toMatchObject({
      email,
      role: 'ADMIN',
      status: 'PENDING',
      workspace: { name: 'Acme Social' },
    });
  });

  it('returns 404 for unknown tokens', async () => {
    const res = await api().get(`/api/v1/invitations/${'x'.repeat(43)}`);
    expect(res.status).toBe(404);
  });
});

describe('accepting invitations', () => {
  it('requires authentication', async () => {
    const res = await api().post(acceptUrl('x'.repeat(43)));
    expect(res.status).toBe(401);
  });

  it('joins the workspace with the invited role, exactly once', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const invitee = await registerUser({ name: 'Ivy Invitee' });
    const invite = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: invitee.email, role: 'EDITOR' });
    const token = tokenFromInviteUrl(invite.body.inviteUrl);

    const res = await as(invitee.token).post(acceptUrl(token));
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(workspace.id);
    expect(res.body.membership.role).toBe('EDITOR');

    const membership = await Membership.findById(res.body.membership.id);
    expect(String(membership.invitedBy)).toBe(owner.user.id);
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'invitation.accepted' }),
    ).toBeTruthy();

    const again = await as(invitee.token).post(acceptUrl(token));
    expect(again.status).toBe(409);
  });

  it('rejects users whose email does not match the invitation', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const invite = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: uniqueEmail(), role: 'VIEWER' });
    const intruder = await registerUser();
    const res = await as(intruder.token).post(acceptUrl(tokenFromInviteUrl(invite.body.inviteUrl)));
    expect(res.status).toBe(403);
    expect(await Membership.countDocuments({ workspace: workspace.id })).toBe(1);
  });

  it('rejects expired and revoked invitations', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const invitee = await registerUser();
    const other = await registerUser();

    const expired = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: invitee.email, role: 'VIEWER' });
    await Invitation.updateOne(
      { _id: expired.body.invitation.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const expiredRes = await as(invitee.token).post(
      acceptUrl(tokenFromInviteUrl(expired.body.inviteUrl)),
    );
    expect(expiredRes.status).toBe(409);
    expect(expiredRes.body.error.message).toMatch(/expired/i);

    const revoked = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: other.email, role: 'VIEWER' });
    expect(
      (await as(owner.token).delete(`${invitesUrl(workspace)}/${revoked.body.invitation.id}`))
        .status,
    ).toBe(204);
    const revokedRes = await as(other.token).post(
      acceptUrl(tokenFromInviteUrl(revoked.body.inviteUrl)),
    );
    expect(revokedRes.status).toBe(409);
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'invitation.revoked' }),
    ).toBeTruthy();
  });

  it('handles concurrent acceptance of the same link safely', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const invitee = await registerUser();
    const invite = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: invitee.email, role: 'VIEWER' });
    const token = tokenFromInviteUrl(invite.body.inviteUrl);

    const results = await Promise.all([
      as(invitee.token).post(acceptUrl(token)),
      as(invitee.token).post(acceptUrl(token)),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await Membership.countDocuments({ workspace: workspace.id, user: invitee.user.id }),
    ).toBe(1);
  });
});

describe('resending invitations', () => {
  it('issues a new link, invalidating the old one', async () => {
    const { owner, workspace } = await ownerWithWorkspace();
    const invitee = await registerUser();
    const invite = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: invitee.email, role: 'VIEWER' });
    const oldToken = tokenFromInviteUrl(invite.body.inviteUrl);

    const resent = await as(owner.token).post(
      `${invitesUrl(workspace)}/${invite.body.invitation.id}/resend`,
    );
    expect(resent.status).toBe(200);
    expect(resent.body.invitation.sendCount).toBe(2);
    const newToken = tokenFromInviteUrl(resent.body.inviteUrl);
    expect(newToken).not.toBe(oldToken);

    expect((await api().get(`/api/v1/invitations/${encodeURIComponent(oldToken)}`)).status).toBe(
      404,
    );
    expect((await as(invitee.token).post(acceptUrl(newToken))).status).toBe(200);
  });

  it('does not let admins resend or revoke admin invitations', async () => {
    const { owner, workspace, admin } = await seedTeam();
    const invite = await as(owner.token)
      .post(invitesUrl(workspace))
      .send({ email: uniqueEmail(), role: 'ADMIN' });
    expect(
      (await as(admin.token).post(`${invitesUrl(workspace)}/${invite.body.invitation.id}/resend`))
        .status,
    ).toBe(403);
    expect(
      (await as(admin.token).delete(`${invitesUrl(workspace)}/${invite.body.invitation.id}`))
        .status,
    ).toBe(403);
  });
});
