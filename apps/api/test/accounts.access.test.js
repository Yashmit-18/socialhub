/**
 * API integration tests for team access to social accounts: least-privilege defaults for new
 * members, account grants carried by invitations, per-member changes
 * (PATCH /members/:memberId/account-access), the per-account team panel
 * (GET/PATCH /social-accounts/:accountId/access), optimistic concurrency on those writes and
 * backend enforcement of account access on every account route.
 *
 * Meta is not involved: destinations are fixture documents inserted with seedSocialAccounts().
 * A FakeMeta transport is installed only as a guard (a Graph request would reach the simulator,
 * never the real Meta API) and every test asserts that no request was made to it.
 */
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLog, Invitation, Membership, SocialAccount } from '../src/models/index.js';
import { FakeMeta } from './fakeMeta.js';
import {
  as,
  createWorkspace,
  registerUser,
  seedSocialAccounts,
  seedTeam,
  tokenFromInviteUrl,
  uniqueEmail,
} from './helpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  vi.restoreAllMocks();
  fake.uninstall();
  // Account access is SocialHub data only: nothing in this file may reach Meta.
  expect(fake.calls).toEqual([]);
});

const ACCESS_UPDATED = 'member.account_access_updated';
const NONE = Object.freeze({ mode: 'SELECTED', socialAccountIds: [] });

const wsUrl = (ws) => `/api/v1/workspaces/${ws.id}`;
const accountsUrl = (ws) => `${wsUrl(ws)}/social-accounts`;
const accountUrl = (ws, accountId) => `${accountsUrl(ws)}/${accountId}`;
const teamAccessUrl = (ws, accountId) => `${accountUrl(ws, accountId)}/access`;
const memberUrl = (ws, memberId) => `${wsUrl(ws)}/members/${memberId}`;
const memberAccessUrl = (ws, memberId) => `${memberUrl(ws, memberId)}/account-access`;
const invitesUrl = (ws) => `${wsUrl(ws)}/invitations`;
const acceptUrl = (inviteUrl) =>
  `/api/v1/invitations/${encodeURIComponent(tokenFromInviteUrl(inviteUrl))}/accept`;

const idOf = (doc) => String(doc._id);
const sortIds = (values) => values.map(String).sort();
const missingId = () => String(new mongoose.Types.ObjectId());
const sortedAccess = ({ mode, socialAccountIds }) => ({
  mode,
  socialAccountIds: sortIds(socialAccountIds),
});
/** Status, code and message of a response (the request id always differs). */
const outcome = (res) => ({
  status: res.status,
  code: res.body?.error?.code,
  message: res.body?.error?.message,
});

/** seedTeam() (everyone joined through an invitation without accountAccess) + destinations. */
async function seedWorkspace({ pages = 3, instagram = 1 } = {}) {
  const team = await seedTeam();
  const { connection, accounts } = await seedSocialAccounts(team.workspace.id, team.owner.user.id, {
    pages,
    instagram,
  });
  return { ...team, connection, accounts, accountIds: accounts.map(idOf) };
}

/** A destination (and a member) in a workspace the seeded team does not belong to. */
async function foreignWorkspace() {
  const stranger = await registerUser({ name: 'Sam Stranger' });
  const other = await createWorkspace(stranger.token, { name: 'Elsewhere' });
  const { accounts } = await seedSocialAccounts(other.workspace.id, stranger.user.id, {
    pages: 1,
    instagram: 0,
    externalUserId: 'fb-stranger',
  });
  return {
    workspace: other.workspace,
    membershipId: other.membership.id,
    accountId: idOf(accounts[0]),
  };
}

const invite = (actor, ws, body) => as(actor.token).post(invitesUrl(ws)).send(body);
const patchMember = (actor, ws, memberId, body) =>
  as(actor.token).patch(memberAccessUrl(ws, memberId)).send(body);
const putMember = (actor, ws, memberId, body) =>
  as(actor.token).put(memberAccessUrl(ws, memberId)).send(body);
const patchTeam = (actor, ws, accountId, body) =>
  as(actor.token).patch(teamAccessUrl(ws, accountId)).send(body);

/** Registers a person, invites them (optionally with accountAccess) and accepts. */
async function inviteAndAccept(actor, ws, { role, accountAccess, name = `${role} invitee` }) {
  const person = await registerUser({ name });
  const invited = await invite(actor, ws, {
    email: person.email,
    role,
    ...(accountAccess && { accountAccess }),
  });
  expect(invited.status).toBe(201);
  const accepted = await as(person.token).post(acceptUrl(invited.body.inviteUrl));
  expect(accepted.status).toBe(200);
  return { ...person, membershipId: accepted.body.membership.id, invited, accepted };
}

async function visibleIds(member, ws) {
  const res = await as(member.token).get(accountsUrl(ws));
  expect(res.status).toBe(200);
  return sortIds(res.body.items.map((item) => item.id));
}

async function storedAccess(membershipId) {
  const { accountAccess } = await Membership.findById(membershipId).lean();
  return {
    mode: accountAccess.mode,
    socialAccountIds: sortIds(accountAccess.socialAccounts ?? []),
  };
}

const accessLogs = (ws) =>
  ActivityLog.find({ workspace: ws.id, action: ACCESS_UPDATED }).sort({ _id: 1 }).lean();

describe('least-privilege defaults', () => {
  it('starts members who join without an account grant with SELECTED and no accounts', async () => {
    const { workspace, owner, editor, viewer, accountIds } = await seedWorkspace();

    const newcomer = await inviteAndAccept(owner, workspace, { role: 'EDITOR' });
    expect(newcomer.invited.body.invitation.accountAccess).toBeNull();
    expect(newcomer.accepted.body.membership.accountAccess).toEqual(NONE);

    const members = await as(owner.token).get(`${wsUrl(workspace)}/members`);
    for (const member of [editor, viewer, newcomer]) {
      expect(members.body.items.find((m) => m.id === member.membershipId).accountAccess).toEqual(
        NONE,
      );
      expect(await storedAccess(member.membershipId)).toEqual(NONE);

      const list = await as(member.token).get(accountsUrl(workspace));
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ items: [], total: 0 });
      const summary = await as(member.token).get(`${accountsUrl(workspace)}/summary`);
      expect(summary.body.accounts.total).toBe(0);
      const overview = await as(member.token).get(`${wsUrl(workspace)}/overview`);
      expect(overview.body.stats).toMatchObject({ facebookPages: 0, instagramAccounts: 0 });
      expect((await as(member.token).get(accountUrl(workspace, accountIds[0]))).status).toBe(404);
      expect((await as(member.token).get('/api/v1/social-accounts')).body.total).toBe(0);
    }
  });

  it('always gives owners and admins every account, whatever access list is stored for them', async () => {
    const { workspace, owner, admin, editor, accountIds } = await seedWorkspace();
    // They keep the stored default (SELECTED, none), which never applies to their roles.
    for (const member of [owner, admin]) {
      expect(await storedAccess(member.membershipId)).toEqual(NONE);
      expect(await visibleIds(member, workspace)).toEqual(sortIds(accountIds));
      expect((await as(member.token).get(accountUrl(workspace, accountIds[2]))).status).toBe(200);
      const summary = await as(member.token).get(`${accountsUrl(workspace)}/summary`);
      expect(summary.body.accounts.total).toBe(accountIds.length);
    }

    // An editor limited to one account sees everything as soon as they are promoted to admin.
    await patchMember(owner, workspace, editor.membershipId, { add: [accountIds[0]] });
    expect(await visibleIds(editor, workspace)).toEqual([accountIds[0]]);
    const promoted = await as(owner.token)
      .patch(memberUrl(workspace, editor.membershipId))
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(await visibleIds(editor, workspace)).toEqual(sortIds(accountIds));
    const panel = await as(owner.token).get(teamAccessUrl(workspace, accountIds[1]));
    expect(panel.body.members.find((m) => m.memberId === editor.membershipId)).toMatchObject({
      role: 'ADMIN',
      mode: 'ALL',
      hasAccess: true,
      fullAccess: true,
      manageable: false,
    });
  });
});

describe('invitations that grant account access', () => {
  it('gives an EDITOR exactly the accounts selected in the invitation', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const chosen = [accountIds[0], accountIds[3]];
    const selected = { mode: 'SELECTED', socialAccountIds: sortIds(chosen) };
    const invitee = await registerUser({ name: 'Ivy Invitee' });

    const invited = await invite(owner, workspace, {
      email: invitee.email,
      role: 'EDITOR',
      accountAccess: { mode: 'SELECTED', socialAccountIds: chosen },
    });
    expect(invited.status).toBe(201);
    expect(sortedAccess(invited.body.invitation.accountAccess)).toEqual(selected);
    const pending = await as(owner.token).get(invitesUrl(workspace));
    const listed = pending.body.items.find((i) => i.id === invited.body.invitation.id);
    expect(sortedAccess(listed.accountAccess)).toEqual(selected);
    const created = await ActivityLog.findOne({
      action: 'invitation.created',
      'target.id': invited.body.invitation.id,
    }).lean();
    expect(created.metadata).toEqual({
      role: 'EDITOR',
      accountAccess: 'SELECTED',
      accountCount: 2,
    });

    const accepted = await as(invitee.token).post(acceptUrl(invited.body.inviteUrl));
    expect(accepted.status).toBe(200);
    expect(accepted.body.membership.role).toBe('EDITOR');
    expect(sortedAccess(accepted.body.membership.accountAccess)).toEqual(selected);
    expect(await storedAccess(accepted.body.membership.id)).toEqual(selected);
    expect(await visibleIds(invitee, workspace)).toEqual(sortIds(chosen));
    expect((await as(invitee.token).get(accountUrl(workspace, accountIds[1]))).status).toBe(404);
  });

  it('gives a VIEWER invited with mode ALL every current and future account', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const viewer = await inviteAndAccept(owner, workspace, {
      role: 'VIEWER',
      accountAccess: { mode: 'ALL' },
    });
    expect(viewer.invited.body.invitation.accountAccess).toEqual({
      mode: 'ALL',
      socialAccountIds: [],
    });
    expect(viewer.accepted.body.membership.accountAccess).toEqual({
      mode: 'ALL',
      socialAccountIds: [],
    });
    expect(await visibleIds(viewer, workspace)).toEqual(sortIds(accountIds));

    const { accounts: added } = await seedSocialAccounts(workspace.id, owner.user.id, {
      pages: 1,
      instagram: 0,
      externalUserId: 'fb-user-later',
    });
    expect(await visibleIds(viewer, workspace)).toEqual(sortIds([...accountIds, idOf(added[0])]));
  });

  it('ignores accountAccess on ADMIN invitations: admins always see every account', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const admin = await inviteAndAccept(owner, workspace, {
      role: 'ADMIN',
      accountAccess: { mode: 'SELECTED', socialAccountIds: [accountIds[0]] },
    });
    const invitationId = admin.invited.body.invitation.id;
    expect(admin.invited.body.invitation.accountAccess).toBeNull();
    expect((await Invitation.findById(invitationId).lean()).accountAccess).toBeUndefined();
    const created = await ActivityLog.findOne({
      action: 'invitation.created',
      'target.id': invitationId,
    }).lean();
    expect(created.metadata).toEqual({ role: 'ADMIN' });

    expect(admin.accepted.body.membership.role).toBe('ADMIN');
    expect(await visibleIds(admin, workspace)).toEqual(sortIds(accountIds));
  });

  it('rejects accounts that are not in this workspace (422) and creates no invitation', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const foreign = await foreignWorkspace();
    const email = uniqueEmail('invitee');

    for (const socialAccountIds of [
      [foreign.accountId],
      [accountIds[0], foreign.accountId],
      [missingId()],
    ]) {
      const res = await invite(owner, workspace, {
        email,
        role: 'EDITOR',
        accountAccess: { mode: 'SELECTED', socialAccountIds },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.accountAccess).toMatch(
        /do not belong to this workspace/,
      );
    }

    // Malformed grants are rejected by the request schema.
    const malformed = await invite(owner, workspace, {
      email,
      role: 'VIEWER',
      accountAccess: { mode: 'SELECTED', socialAccountIds: ['not-an-id'] },
    });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.details.fields).toHaveProperty([
      'accountAccess.socialAccountIds.0',
    ]);
    const listWithAll = await invite(owner, workspace, {
      email,
      role: 'VIEWER',
      accountAccess: { mode: 'ALL', socialAccountIds: [accountIds[0]] },
    });
    expect(listWithAll.status).toBe(422);
    expect(listWithAll.body.error.details.fields).toHaveProperty([
      'accountAccess.socialAccountIds',
    ]);

    expect(await Invitation.countDocuments({ email })).toBe(0);
  });

  it('drops accounts that no longer exist when the invitation is accepted', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const [kept, gone] = accountIds;
    const invitee = await registerUser({ name: 'Ivy Invitee' });
    const invited = await invite(owner, workspace, {
      email: invitee.email,
      role: 'EDITOR',
      accountAccess: { mode: 'SELECTED', socialAccountIds: [kept, gone] },
    });
    expect(invited.status).toBe(201);

    // Removed between invite and accept without the usual clean-up of pending invitations.
    await SocialAccount.deleteOne({ _id: gone });
    const stored = await Invitation.findById(invited.body.invitation.id).lean();
    expect(sortIds(stored.accountAccess.socialAccounts)).toEqual(sortIds([kept, gone]));

    const accepted = await as(invitee.token).post(acceptUrl(invited.body.inviteUrl));
    expect(accepted.status).toBe(200);
    const onlyKept = { mode: 'SELECTED', socialAccountIds: [kept] };
    expect(accepted.body.membership.accountAccess).toEqual(onlyKept);
    expect(await storedAccess(accepted.body.membership.id)).toEqual(onlyKept);
  });

  it('pulls a removed account from pending invitations and from members', async () => {
    const { workspace, owner, editor, accountIds } = await seedWorkspace();
    const [kept, removedOne, removedInBulk] = accountIds;
    const all = [kept, removedOne, removedInBulk];
    expect((await patchMember(owner, workspace, editor.membershipId, { add: all })).status).toBe(
      200,
    );
    const invitee = await registerUser({ name: 'Ivy Invitee' });
    const invited = await invite(owner, workspace, {
      email: invitee.email,
      role: 'VIEWER',
      accountAccess: { mode: 'SELECTED', socialAccountIds: all },
    });
    expect(invited.status).toBe(201);

    expect((await as(owner.token).delete(accountUrl(workspace, removedOne))).status).toBe(204);
    const bulk = await as(owner.token)
      .post(`${accountsUrl(workspace)}/remove`)
      .send({ accountIds: [removedInBulk] });
    expect(bulk.body).toEqual({ removed: 1 });

    const onlyKept = { mode: 'SELECTED', socialAccountIds: [kept] };
    const pending = await as(owner.token).get(invitesUrl(workspace));
    const listed = pending.body.items.find((i) => i.id === invited.body.invitation.id);
    expect(listed.accountAccess).toEqual(onlyKept);
    expect(await storedAccess(editor.membershipId)).toEqual(onlyKept);

    const accepted = await as(invitee.token).post(acceptUrl(invited.body.inviteUrl));
    expect(accepted.body.membership.accountAccess).toEqual(onlyKept);
    expect(await visibleIds(invitee, workspace)).toEqual([kept]);
  });
});

describe('PATCH /members/:memberId/account-access', () => {
  it('adds and removes accounts for a SELECTED member and records each change', async () => {
    const { workspace, admin, editor, accountIds } = await seedWorkspace();
    const [a, b, c] = accountIds;

    const added = await patchMember(admin, workspace, editor.membershipId, { add: [a, b] });
    expect(added.status).toBe(200);
    expect(added.body.member).toMatchObject({
      id: editor.membershipId,
      role: 'EDITOR',
      user: { id: editor.user.id, name: 'Eddie Editor', email: editor.email },
    });
    expect(sortedAccess(added.body.member.accountAccess)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: sortIds([a, b]),
    });
    expect(await visibleIds(editor, workspace)).toEqual(sortIds([a, b]));

    const removed = await patchMember(admin, workspace, editor.membershipId, { remove: [a] });
    expect(removed.status).toBe(200);
    expect(removed.body.member.accountAccess).toEqual({ mode: 'SELECTED', socialAccountIds: [b] });
    // Revocation takes effect on the very next request.
    expect(await visibleIds(editor, workspace)).toEqual([b]);
    expect((await as(editor.token).get(accountUrl(workspace, a))).status).toBe(404);

    const swapped = await patchMember(admin, workspace, editor.membershipId, {
      add: [c],
      remove: [b],
    });
    expect(swapped.body.member.accountAccess).toEqual({ mode: 'SELECTED', socialAccountIds: [c] });
    expect(await storedAccess(editor.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [c],
    });

    const logs = await accessLogs(workspace);
    expect(logs).toHaveLength(3);
    for (const log of logs) {
      expect(log).toMatchObject({
        actorName: 'Adam Admin',
        target: { type: 'member', label: 'Eddie Editor' },
      });
      expect(String(log.target.id)).toBe(editor.membershipId);
    }
    expect(logs.map((log) => log.metadata)).toEqual([
      { mode: 'SELECTED', accountCount: 2, added: 2, removed: 0 },
      { mode: 'SELECTED', accountCount: 1, added: 0, removed: 1 },
      { mode: 'SELECTED', accountCount: 1, added: 1, removed: 1 },
    ]);
  });

  it('converts a member with ALL to SELECTED with every other account when one is removed', async () => {
    const { workspace, owner, viewer, accountIds } = await seedWorkspace();
    expect((await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' })).status).toBe(
      200,
    );

    const res = await patchMember(owner, workspace, viewer.membershipId, {
      remove: [accountIds[1]],
    });
    expect(res.status).toBe(200);
    const others = sortIds(accountIds.filter((id) => id !== accountIds[1]));
    expect(sortedAccess(res.body.member.accountAccess)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: others,
    });
    expect(await visibleIds(viewer, workspace)).toEqual(others);
    const [log] = (await accessLogs(workspace)).slice(-1);
    expect(log.metadata).toEqual({
      mode: 'SELECTED',
      accountCount: others.length,
      added: 0,
      removed: 1,
    });
  });

  it('leaves a member with ALL unchanged when accounts are added', async () => {
    const { workspace, owner, viewer, accountIds } = await seedWorkspace();
    await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' });
    const before = await Membership.findById(viewer.membershipId).lean();
    const logsBefore = (await accessLogs(workspace)).length;

    const res = await patchMember(owner, workspace, viewer.membershipId, {
      add: [accountIds[0]],
    });
    expect(res.status).toBe(200);
    expect(res.body.member.accountAccess).toEqual({ mode: 'ALL', socialAccountIds: [] });
    const after = await Membership.findById(viewer.membershipId).lean();
    expect(after.updatedAt).toEqual(before.updatedAt); // nothing written
    expect(await accessLogs(workspace)).toHaveLength(logsBefore);
    expect(await visibleIds(viewer, workspace)).toEqual(sortIds(accountIds));
  });

  it('rejects accounts that are not in this workspace (422)', async () => {
    const { workspace, owner, editor, accountIds } = await seedWorkspace();
    const foreign = await foreignWorkspace();
    for (const body of [
      { add: [foreign.accountId] },
      { remove: [foreign.accountId] },
      { add: [accountIds[0], missingId()] },
    ]) {
      const res = await patchMember(owner, workspace, editor.membershipId, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.accounts).toMatch(/do not belong to this workspace/);
    }
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
  });

  it('rejects empty changes, overlaps and malformed bodies (422)', async () => {
    const { workspace, owner, editor, accountIds } = await seedWorkspace();
    const [a] = accountIds;
    for (const body of [{}, { add: [], remove: [] }, { add: [a], remove: [a] }]) {
      const res = await patchMember(owner, workspace, editor.membershipId, body);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields._root).toMatch(/add or remove/);
    }
    for (const body of [{ add: ['not-an-id'] }, { add: [a], mode: 'ALL' }, { add: a }]) {
      const res = await patchMember(owner, workspace, editor.membershipId, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
    expect(await accessLogs(workspace)).toHaveLength(0);
  });

  it('refuses to restrict owners and admins (400)', async () => {
    const { workspace, owner, admin, accountIds } = await seedWorkspace();
    for (const body of [{ remove: [accountIds[0]] }, { add: [accountIds[0]] }]) {
      const res = await patchMember(owner, workspace, admin.membershipId, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringMatching(/always have access to every account/),
      });
    }
    expect(await storedAccess(admin.membershipId)).toEqual(NONE);
  });

  it('enforces the role hierarchy: an admin cannot change another admin or the owner (403)', async () => {
    const { workspace, owner, admin, accountIds } = await seedWorkspace();
    const otherAdmin = await inviteAndAccept(owner, workspace, {
      role: 'ADMIN',
      name: 'Alex Admin',
    });
    for (const target of [otherAdmin, owner]) {
      const res = await patchMember(admin, workspace, target.membershipId, {
        add: [accountIds[0]],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses changes to your own access (400)', async () => {
    const { workspace, owner, admin, accountIds } = await seedWorkspace();
    for (const actor of [owner, admin]) {
      const res = await patchMember(actor, workspace, actor.membershipId, {
        add: [accountIds[0]],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/your own membership/);
    }
  });

  it('forbids editors and viewers from changing anyone’s access, including their own (403)', async () => {
    const { workspace, editor, viewer, accountIds } = await seedWorkspace();
    for (const [actor, target] of [
      [editor, viewer],
      [viewer, editor],
      [editor, editor],
    ]) {
      const res = await patchMember(actor, workspace, target.membershipId, {
        add: [accountIds[0]],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
    expect(await storedAccess(viewer.membershipId)).toEqual(NONE);
  });

  it('returns 404 for members of another workspace and unknown members', async () => {
    const { workspace, owner, accountIds } = await seedWorkspace();
    const foreign = await foreignWorkspace();
    for (const memberId of [foreign.membershipId, missingId()]) {
      const res = await patchMember(owner, workspace, memberId, { add: [accountIds[0]] });
      expect(outcome(res)).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Member not found' });
    }
    expect(await storedAccess(foreign.membershipId)).toEqual(NONE);
  });
});

describe('GET /social-accounts/:accountId/access', () => {
  const row = (member, role, access) => ({
    memberId: member.membershipId,
    user: { id: member.user.id, name: member.user.name, email: member.email },
    role,
    ...access,
  });

  it('lists every member with their access to the account and whether the actor may change it', async () => {
    const { workspace, owner, admin, editor, viewer, accountIds } = await seedWorkspace();
    const [a, b] = accountIds;
    await patchMember(owner, workspace, editor.membershipId, { add: [a] });
    await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' });

    const res = await as(owner.token).get(teamAccessUrl(workspace, a));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      members: [
        row(owner, 'OWNER', { mode: 'ALL', hasAccess: true, fullAccess: true, manageable: false }),
        row(admin, 'ADMIN', { mode: 'ALL', hasAccess: true, fullAccess: true, manageable: false }),
        row(editor, 'EDITOR', {
          mode: 'SELECTED',
          hasAccess: true,
          fullAccess: false,
          manageable: true,
        }),
        row(viewer, 'VIEWER', {
          mode: 'ALL',
          hasAccess: true,
          fullAccess: false,
          manageable: true,
        }),
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|accessToken/);

    const other = await as(owner.token).get(teamAccessUrl(workspace, b));
    expect(other.body.members.find((m) => m.memberId === editor.membershipId)).toMatchObject({
      mode: 'SELECTED',
      hasAccess: false,
      manageable: true,
    });
    expect(other.body.members.find((m) => m.memberId === viewer.membershipId).hasAccess).toBe(true);
  });

  it('marks the actor, the owner and other admins as not manageable for an admin', async () => {
    const { workspace, owner, admin, editor, viewer, accountIds } = await seedWorkspace();
    const otherAdmin = await inviteAndAccept(owner, workspace, {
      role: 'ADMIN',
      name: 'Alex Admin',
    });
    const res = await as(admin.token).get(teamAccessUrl(workspace, accountIds[0]));
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.body.members.map((m) => [m.memberId, m.manageable]))).toEqual({
      [owner.membershipId]: false,
      [admin.membershipId]: false,
      [otherAdmin.membershipId]: false,
      [editor.membershipId]: true,
      [viewer.membershipId]: true,
    });
  });

  it('is limited to members:manage: editors and viewers get 403, even for their own accounts', async () => {
    const { workspace, owner, editor, viewer, accountIds } = await seedWorkspace();
    await patchMember(owner, workspace, editor.membershipId, { add: [accountIds[0]] });
    await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' });
    for (const member of [editor, viewer]) {
      const res = await as(member.token).get(teamAccessUrl(workspace, accountIds[0]));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('answers the same 404 for an account of another workspace and an unknown id', async () => {
    const { workspace, owner } = await seedWorkspace();
    const foreign = await foreignWorkspace();
    for (const accountId of [foreign.accountId, missingId()]) {
      const res = await as(owner.token).get(teamAccessUrl(workspace, accountId));
      expect(outcome(res)).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Social account not found',
      });
    }
  });
});

describe('PATCH /social-accounts/:accountId/access', () => {
  const hasAccessById = (body) =>
    Object.fromEntries(body.members.map((m) => [m.memberId, m.hasAccess]));

  it('grants and revokes one account for several members and returns the updated list', async () => {
    const { workspace, owner, editor, viewer, accounts, accountIds } = await seedWorkspace();
    const [a, b] = accountIds;

    const granted = await patchTeam(owner, workspace, a, {
      grant: [editor.membershipId, viewer.membershipId],
    });
    expect(granted.status).toBe(200);
    expect(hasAccessById(granted.body)).toMatchObject({
      [editor.membershipId]: true,
      [viewer.membershipId]: true,
    });
    // The response is the panel as it now stands.
    expect(granted.body).toEqual((await as(owner.token).get(teamAccessUrl(workspace, a))).body);
    for (const member of [editor, viewer]) {
      expect(await visibleIds(member, workspace)).toEqual([a]);
      expect((await as(member.token).get(accountUrl(workspace, a))).status).toBe(200);
    }
    // One activity entry per member changed.
    const grants = await accessLogs(workspace);
    expect(sortIds(grants.map((log) => log.target.id))).toEqual(
      sortIds([editor.membershipId, viewer.membershipId]),
    );
    for (const log of grants) {
      expect(log.actorName).toBe('Olivia Owner');
      expect(log.metadata).toEqual({
        mode: 'SELECTED',
        accountCount: 1,
        change: 'grant',
        account: accounts[0].name,
      });
    }

    const revoked = await patchTeam(owner, workspace, a, { revoke: [editor.membershipId] });
    expect(revoked.status).toBe(200);
    expect(hasAccessById(revoked.body)).toMatchObject({
      [editor.membershipId]: false,
      [viewer.membershipId]: true,
    });
    expect(await visibleIds(editor, workspace)).toEqual([]);
    expect((await as(editor.token).get(accountUrl(workspace, a))).status).toBe(404);
    const revokeLog = (await accessLogs(workspace)).at(-1);
    expect(String(revokeLog.target.id)).toBe(editor.membershipId);
    expect(revokeLog.metadata).toEqual({
      mode: 'SELECTED',
      accountCount: 0,
      change: 'revoke',
      account: accounts[0].name,
    });

    // Grants and revocations for different members in one request; revoking an account the
    // member does not have changes (and records) nothing.
    const mixed = await patchTeam(owner, workspace, b, {
      grant: [editor.membershipId],
      revoke: [viewer.membershipId],
    });
    expect(mixed.status).toBe(200);
    expect(await visibleIds(editor, workspace)).toEqual([b]);
    expect(await visibleIds(viewer, workspace)).toEqual([a]);
    expect(await accessLogs(workspace)).toHaveLength(4);
  });

  it('keeps every other account when revoking a member with ALL (converted to SELECTED)', async () => {
    const { workspace, owner, viewer, accountIds } = await seedWorkspace();
    await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' });

    const res = await patchTeam(owner, workspace, accountIds[2], { revoke: [viewer.membershipId] });
    expect(res.status).toBe(200);
    expect(res.body.members.find((m) => m.memberId === viewer.membershipId)).toMatchObject({
      mode: 'SELECTED',
      hasAccess: false,
      manageable: true,
    });
    const others = sortIds(accountIds.filter((id) => id !== accountIds[2]));
    expect(await storedAccess(viewer.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: others,
    });
    expect(await visibleIds(viewer, workspace)).toEqual(others);
    const panel = await as(owner.token).get(teamAccessUrl(workspace, accountIds[0]));
    expect(hasAccessById(panel.body)[viewer.membershipId]).toBe(true);
  });

  it('treats a grant to a member who already has the account as a no-op', async () => {
    const { workspace, owner, editor, viewer, accountIds } = await seedWorkspace();
    await putMember(owner, workspace, viewer.membershipId, { mode: 'ALL' });
    await patchMember(owner, workspace, editor.membershipId, { add: [accountIds[0]] });
    const logsBefore = (await accessLogs(workspace)).length;

    const res = await patchTeam(owner, workspace, accountIds[0], {
      grant: [viewer.membershipId, editor.membershipId],
    });
    expect(res.status).toBe(200);
    expect(await storedAccess(viewer.membershipId)).toEqual({ mode: 'ALL', socialAccountIds: [] });
    expect(await storedAccess(editor.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [accountIds[0]],
    });
    expect(await accessLogs(workspace)).toHaveLength(logsBefore);
  });

  it('refuses yourself and full-access roles (400), and members you do not outrank (403), applying nothing', async () => {
    const { workspace, owner, admin, editor, accountIds } = await seedWorkspace();
    const otherAdmin = await inviteAndAccept(owner, workspace, {
      role: 'ADMIN',
      name: 'Alex Admin',
    });
    const fullAccess = /is an owner or admin and always has access to every account/;
    const self = /your own access/;
    const hierarchy = /lower role than yours/;
    // Same order as PATCH /members/:id/account-access: self, then hierarchy, then full access.
    const cases = [
      [owner, { grant: [admin.membershipId] }, 400, 'BAD_REQUEST', fullAccess],
      [owner, { revoke: [admin.membershipId] }, 400, 'BAD_REQUEST', fullAccess],
      [admin, { revoke: [owner.membershipId] }, 403, 'FORBIDDEN', hierarchy],
      [admin, { revoke: [otherAdmin.membershipId] }, 403, 'FORBIDDEN', hierarchy],
      [owner, { revoke: [owner.membershipId] }, 400, 'BAD_REQUEST', self],
      [admin, { grant: [admin.membershipId] }, 400, 'BAD_REQUEST', self],
      // All or nothing: the valid part of a refused request is not applied either.
      [owner, { grant: [editor.membershipId, admin.membershipId] }, 400, 'BAD_REQUEST', fullAccess],
    ];
    for (const [actor, body, status, code, message] of cases) {
      const res = await patchTeam(actor, workspace, accountIds[0], body);
      expect(res.status).toBe(status);
      expect(res.body.error).toMatchObject({ code, message: expect.stringMatching(message) });
    }
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
    expect(await accessLogs(workspace)).toHaveLength(0);
  });

  it('is limited to members:manage (403) and only accepts members and accounts of this workspace', async () => {
    const { workspace, owner, editor, viewer, accountIds } = await seedWorkspace();
    const foreign = await foreignWorkspace();
    const [a] = accountIds;

    for (const [actor, target] of [
      [editor, viewer],
      [viewer, editor],
    ]) {
      const res = await patchTeam(actor, workspace, a, { grant: [target.membershipId] });
      expect(outcome(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    }
    for (const memberId of [foreign.membershipId, missingId()]) {
      const res = await patchTeam(owner, workspace, a, { grant: [editor.membershipId, memberId] });
      expect(outcome(res)).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Member not found' });
    }
    for (const accountId of [foreign.accountId, missingId()]) {
      const res = await patchTeam(owner, workspace, accountId, { grant: [editor.membershipId] });
      expect(outcome(res)).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Social account not found',
      });
    }
    for (const body of [
      {},
      { grant: [], revoke: [] },
      { grant: [editor.membershipId], revoke: [editor.membershipId] },
    ]) {
      expect((await patchTeam(owner, workspace, a, body)).status).toBe(422);
    }
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
    expect(await storedAccess(viewer.membershipId)).toEqual(NONE);
    expect(await accessLogs(workspace)).toHaveLength(0);
  });
});

describe('optimistic concurrency on account access', () => {
  /**
   * Runs `competingChange` immediately before the first write of a member's accountAccess
   * (optionally only that of `memberId`): after the request under test has read the member and
   * before it writes — the window in which another manager's change can land. Every other
   * Membership.updateOne, including the competing request's own write, runs unchanged.
   */
  function raceBeforeAccessWrite(competingChange, { memberId } = {}) {
    const original = Membership.updateOne;
    let raced = false;
    vi.spyOn(Membership, 'updateOne').mockImplementation((filter, update, ...rest) => {
      const writesAccess = Boolean(update?.accountAccess ?? update?.$set?.accountAccess);
      const isTarget = !memberId || String(filter?._id) === memberId;
      if (raced || !writesAccess || !isTarget) {
        return original.call(Membership, filter, update, ...rest);
      }
      raced = true;
      return (async () => {
        await competingChange();
        return original.call(Membership, filter, update, ...rest);
      })();
    });
  }

  it('rejects a stale member change with 409 CONFLICT and keeps the other manager’s change', async () => {
    const { workspace, owner, admin, editor, accountIds } = await seedWorkspace();
    const [a, b] = accountIds;
    let competing;
    raceBeforeAccessWrite(async () => {
      competing = await patchMember(owner, workspace, editor.membershipId, { add: [b] });
    });

    const stale = await patchMember(admin, workspace, editor.membershipId, { add: [a] });
    expect(competing.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/changed by someone else/),
    });
    expect(await storedAccess(editor.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [b],
    });
    const logs = await accessLogs(workspace);
    expect(logs.map((log) => log.actorName)).toEqual(['Olivia Owner']);

    // Retrying against the fresh state applies the change on top of the other one.
    vi.restoreAllMocks();
    const retried = await patchMember(admin, workspace, editor.membershipId, { add: [a] });
    expect(retried.status).toBe(200);
    expect(await storedAccess(editor.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: sortIds([a, b]),
    });
  });

  it('never loses an update when two managers change the same member at once', async () => {
    const { workspace, owner, admin, editor, accountIds } = await seedWorkspace({
      pages: 6,
      instagram: 0,
    });
    let expected = [];
    for (let round = 0; round < 3; round += 1) {
      const pair = accountIds.slice(round * 2, round * 2 + 2);
      const results = await Promise.all([
        patchMember(admin, workspace, editor.membershipId, { add: [pair[0]] }),
        patchMember(owner, workspace, editor.membershipId, { add: [pair[1]] }),
      ]);
      for (const res of results) {
        expect([200, 409]).toContain(res.status);
        if (res.status === 409) expect(res.body.error.code).toBe('CONFLICT');
      }
      const applied = pair.filter((_, i) => results[i].status === 200);
      expect(applied.length).toBeGreaterThan(0);
      expected = sortIds([...expected, ...applied]);
      // Every acknowledged change is stored; a rejected one is not applied at all.
      expect(await storedAccess(editor.membershipId)).toEqual({
        mode: 'SELECTED',
        socialAccountIds: expected,
      });
    }
    expect(await accessLogs(workspace)).toHaveLength(expected.length);
  });

  it('rolls back a whole per-account change when one of its members changed meanwhile', async () => {
    const { workspace, owner, admin, editor, viewer, accountIds } = await seedWorkspace();
    const [a, b] = accountIds;
    let competing;
    raceBeforeAccessWrite(
      async () => {
        competing = await patchMember(admin, workspace, viewer.membershipId, { add: [b] });
      },
      { memberId: viewer.membershipId },
    );

    const res = await patchTeam(owner, workspace, a, {
      grant: [editor.membershipId, viewer.membershipId],
    });
    expect(competing.status).toBe(200);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // Nothing of the rejected request is applied, not even for the member nobody else touched.
    expect(await storedAccess(editor.membershipId)).toEqual(NONE);
    expect(await storedAccess(viewer.membershipId)).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [b],
    });
    const logs = await accessLogs(workspace);
    expect(logs.map((log) => String(log.target.id))).toEqual([viewer.membershipId]);
  });
});

describe('backend enforcement of account access', () => {
  it('never lets an editor reach an account outside their access, whatever the route', async () => {
    const { workspace, owner, editor, viewer, connection, accounts, accountIds } =
      await seedWorkspace();
    const [mine, hidden] = accountIds;
    const foreign = await foreignWorkspace();
    await patchMember(owner, workspace, editor.membershipId, { add: [mine] });
    const ed = as(editor.token);

    // Reading: an account outside the member's access looks exactly like one that does not exist.
    expect((await ed.get(accountUrl(workspace, mine))).status).toBe(200);
    for (const accountId of [hidden, foreign.accountId, missingId()]) {
      expect(outcome(await ed.get(accountUrl(workspace, accountId)))).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Social account not found',
      });
    }

    // Managing: refused by role before the account is looked up, so the answer is the same for
    // the member's own account, a hidden one and one that does not exist.
    const routes = [
      (id) => ed.post(`${accountUrl(workspace, id)}/refresh`),
      (id) => ed.get(teamAccessUrl(workspace, id)),
      (id) => ed.patch(teamAccessUrl(workspace, id)).send({ grant: [viewer.membershipId] }),
      (id) => ed.delete(accountUrl(workspace, id)),
      (id) => ed.post(`${accountsUrl(workspace)}/refresh`).send({ accountIds: [id] }),
      (id) => ed.post(`${accountsUrl(workspace)}/remove`).send({ accountIds: [id] }),
    ];
    for (const route of routes) {
      const outcomes = [];
      for (const accountId of [mine, hidden, missingId()]) {
        outcomes.push(outcome(await route(accountId)));
      }
      expect(outcomes[0]).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(outcomes[1]).toEqual(outcomes[0]);
      expect(outcomes[2]).toEqual(outcomes[0]);
    }
    expect((await ed.get(`${wsUrl(workspace)}/social-connections/${connection._id}`)).status).toBe(
      403,
    );
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(accountIds.length);
    expect(await storedAccess(viewer.membershipId)).toEqual(NONE);

    // Listing, searching, filtering and counting only ever cover the member's own account.
    expect(await visibleIds(editor, workspace)).toEqual([mine]);
    const searched = await ed.get(accountsUrl(workspace)).query({ q: accounts[1].name });
    expect(searched.body).toMatchObject({ items: [], total: 0 });
    const byLogin = await ed
      .get(accountsUrl(workspace))
      .query({ connectionId: String(connection._id) });
    expect(byLogin.body.items.map((item) => item.id)).toEqual([mine]);
    expect(byLogin.body.facets.platform).toEqual({ FACEBOOK_PAGE: 1 });
    expect((await ed.get(`${accountsUrl(workspace)}/summary`)).body.accounts.total).toBe(1);
    const everywhere = await ed.get('/api/v1/social-accounts');
    expect(everywhere.body.items.map((item) => item.id)).toEqual([mine]);
    expect((await ed.get('/api/v1/social-accounts/summary')).body.accounts.total).toBe(1);
    const otherWorkspace = await ed
      .get('/api/v1/social-accounts')
      .query({ workspaceId: foreign.workspace.id });
    expect(otherWorkspace.status).toBe(404);
  });

  it('does not reveal linked accounts the member cannot open', async () => {
    const { workspace, owner, editor, accounts } = await seedWorkspace();
    const pageDoc = accounts[1];
    const instagramDoc = accounts[3];
    const [pageId, instagramId] = [idOf(pageDoc), idOf(instagramDoc)];
    await SocialAccount.updateOne(
      { _id: instagramDoc._id },
      {
        linkedFacebookPage: pageDoc._id,
        linkedFacebookPageExternalId: pageDoc.externalId,
        linkedFacebookPageName: pageDoc.name,
      },
    );
    await patchMember(owner, workspace, editor.membershipId, { add: [instagramId] });

    // The Page is named (names are not secret) but its id is withheld.
    const hiddenLink = { id: null, externalId: pageDoc.externalId, name: pageDoc.name };
    const list = await as(editor.token).get(accountsUrl(workspace));
    expect(list.body.items.find((item) => item.id === instagramId).linkedPage).toEqual(hiddenLink);
    const detail = await as(editor.token).get(accountUrl(workspace, instagramId));
    expect(detail.body.account.linkedPage).toEqual(hiddenLink);
    expect(detail.body.linkedPage).toBeNull();
    for (const body of [list.body, detail.body]) {
      expect(JSON.stringify(body)).not.toContain(pageId);
    }
    const ownerList = await as(owner.token).get(accountsUrl(workspace));
    expect(ownerList.body.items.find((item) => item.id === instagramId).linkedPage).toEqual({
      ...hiddenLink,
      id: pageId,
    });

    // With the Page but not the Instagram account, the Page detail lists no linked Instagram.
    await patchMember(owner, workspace, editor.membershipId, {
      add: [pageId],
      remove: [instagramId],
    });
    const pageDetail = await as(editor.token).get(accountUrl(workspace, pageId));
    expect(pageDetail.body.linkedInstagram).toEqual([]);
    expect(JSON.stringify(pageDetail.body)).not.toContain(instagramId);
    const ownerPageDetail = await as(owner.token).get(accountUrl(workspace, pageId));
    expect(ownerPageDetail.body.linkedInstagram.map((item) => item.id)).toEqual([instagramId]);
  });

  it('withholds the management sections of an account detail from editors', async () => {
    const { workspace, owner, editor, accountIds } = await seedWorkspace();
    await patchMember(owner, workspace, editor.membershipId, { add: [accountIds[0]] });

    const detail = await as(editor.token).get(accountUrl(workspace, accountIds[0]));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      syncHistory: null,
      activity: null,
      access: null,
      capabilities: { canManageConnections: false, canManageAccess: false, canViewActivity: false },
    });
    expect(Object.keys(detail.body.connection).sort()).toEqual([
      'displayName',
      'id',
      'pictureUrl',
      'provider',
      'status',
    ]);
    expect(detail.body.permissions).not.toHaveProperty('declined');

    const managed = await as(owner.token).get(accountUrl(workspace, accountIds[0]));
    expect(managed.body.access).toEqual(expect.any(Array));
    expect(managed.body.capabilities).toMatchObject({
      canManageConnections: true,
      canManageAccess: true,
      canViewActivity: true,
    });
  });

  it('revokes visibility immediately when the member is removed from the workspace', async () => {
    const { workspace, admin, editor, accountIds } = await seedWorkspace();
    await patchMember(admin, workspace, editor.membershipId, { add: [accountIds[0]] });
    expect(await visibleIds(editor, workspace)).toEqual([accountIds[0]]);

    expect((await as(admin.token).delete(memberUrl(workspace, editor.membershipId))).status).toBe(
      204,
    );
    const ed = as(editor.token);
    expect(outcome(await ed.get(accountsUrl(workspace)))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Workspace not found',
    });
    expect((await ed.get(accountUrl(workspace, accountIds[0]))).status).toBe(404);
    expect((await ed.get('/api/v1/social-accounts')).body).toMatchObject({ items: [], total: 0 });
    expect((await ed.get('/api/v1/social-accounts/summary')).body).toMatchObject({
      accounts: { total: 0 },
      workspaces: 0,
    });
    const scoped = await ed.get('/api/v1/social-accounts').query({ workspaceId: workspace.id });
    expect(scoped.status).toBe(404);
  });
});
