import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEmailDeliveryConfigured } from '../src/lib/mailer.js';
import { grantPlatformAdmin } from '../src/maintenance/platformAdmin.js';
import {
  FacebookGroup,
  Membership,
  MediaAsset,
  PlatformAuditLog,
  PublishDestination,
  PublishJob,
  Session,
  SharingTask,
  SocialAccount,
  SocialConnection,
  User,
  Workspace,
} from '../src/models/index.js';
import { getOverview } from '../src/modules/admin/admin.service.js';
import { attentionItems, systemStatus } from '../src/modules/admin/systemStatus.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setAnalyticsQueueForTests } from '../src/queue/analyticsQueue.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { getStorage } from '../src/storage/index.js';
import {
  adminUrl,
  client,
  expectNoSecrets,
  platformAdmin,
  reactivate,
  signUp,
  suspend,
} from './adminFixtures.js';
import { addMember, as, createWorkspace, seedSocialAccounts, seedTeam } from './helpers.js';
import { createDraft, createTestQueue, giveTokens, publish } from './publishFixtures.js';

/**
 * The read side of the operator console: platform numbers, people, workspaces, system status
 * and the audit log. Counts and states only; nothing of a workspace's content, no names of
 * connected accounts, no secrets, IP addresses or browsers.
 */

const DAY = 86_400_000;
const oid = (date) => mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
// Raw fixture rows carry their own values for the fields of unique indexes.
const unique = () => new mongoose.Types.ObjectId();
const rawJob = (fields) => ({ idempotencyKey: String(unique()), ...fields });

let queue;

beforeEach(() => {
  queue = createTestQueue();
  setPublishQueueForTests(queue);
  setAnalyticsQueueForTests(null);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setAnalyticsQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
});

describe('overview', () => {
  const now = new Date('2026-11-26T12:00:00.000Z');
  const ago = (ms) => new Date(now.getTime() - ms);

  async function seedHistory() {
    const users = [
      { at: ago(30 * 60_000), status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' },
      { at: ago(3 * DAY), status: 'DISABLED' },
      { at: ago(10 * DAY), status: 'ACTIVE' },
      { at: ago(20 * DAY) }, // no stored status: active
      { at: ago(40 * DAY), status: 'ACTIVE' },
    ];
    await User.collection.insertMany(
      users.map((u, i) => ({
        _id: oid(u.at),
        name: `Person ${i}`,
        email: `person${i}@example.com`,
        passwordHash: 'not-a-real-hash',
        ...(u.status ? { status: u.status } : {}),
        ...(u.platformRole ? { platformRole: u.platformRole } : {}),
        createdAt: u.at,
      })),
    );
    const ws = [
      { at: ago(60 * 60_000), publishingMode: 'LIVE' },
      { at: ago(8 * DAY), publishingMode: 'SIMULATED' },
      { at: ago(25 * DAY) },
    ];
    await Workspace.collection.insertMany(
      ws.map((w, i) => ({
        _id: oid(w.at),
        name: `Space ${i}`,
        slug: `space-${i}`,
        ...(w.publishingMode ? { publishingMode: w.publishingMode } : {}),
      })),
    );
    const workspace = oid(ws[0].at);
    await SocialAccount.collection.insertMany([
      { workspace, platform: 'FACEBOOK_PAGE', externalId: 'a' },
      { workspace, platform: 'FACEBOOK_PAGE', externalId: 'b' },
      { workspace, platform: 'INSTAGRAM_ACCOUNT', externalId: 'c' },
    ]);
    const job = (status, mode, completedAt) => ({
      idempotencyKey: String(unique()),
      workspace,
      status,
      mode,
      ...(completedAt ? { completedAt, updatedAt: completedAt } : { updatedAt: now }),
    });
    await PublishJob.collection.insertMany([
      job('PUBLISHED', 'LIVE', ago(60 * 60_000)),
      job('PARTIALLY_PUBLISHED', 'LIVE', new Date('2026-11-24T08:00:00Z')),
      job('PUBLISHED', 'SIMULATED', new Date('2026-11-20T08:00:00Z')),
      job('PUBLISHED', 'SIMULATED', new Date('2026-11-19T08:00:00Z')),
      job('FAILED', 'LIVE', ago(2 * 60 * 60_000)),
      job('FAILED', 'SIMULATED', new Date('2026-11-22T08:00:00Z')),
      job('PUBLISHED', 'LIVE', new Date('2026-11-01T08:00:00Z')),
      job('CANCELLED', 'LIVE', ago(60_000)),
      job('SCHEDULED', 'LIVE'),
      job('QUEUED', 'SIMULATED'),
      job('PROCESSING', 'LIVE'),
    ]);
  }

  it('counts people, workspaces, accounts and posts, and fills 14 UTC days', async () => {
    await seedHistory();
    const overview = await getOverview({ now });
    expect(overview.users).toEqual({
      total: 5,
      active: 4,
      suspended: 1,
      platformAdmins: 1,
      newLast7Days: 2,
      newLast30Days: 4,
    });
    expect(overview.workspaces).toEqual({
      total: 3,
      livePublishing: 1,
      newLast7Days: 1,
      newLast30Days: 3,
    });
    expect(overview.accounts).toEqual({ facebookPages: 2, instagramAccounts: 1 });
    expect(overview.publishing).toEqual({
      postsInProgress: 3,
      last7Days: { realPosts: 2, simulatedPosts: 1, failedPosts: 2 },
    });

    const { days, timezone } = overview.activity;
    expect(timezone).toBe('UTC');
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe('2026-11-13');
    expect(days[13]).toEqual({
      day: '2026-11-26',
      signups: 1,
      workspaces: 1,
      realPosts: 1,
      simulatedPosts: 0,
      failedPosts: 1,
    });
    const day = (key) => days.find((d) => d.day === key);
    expect(day('2026-11-23').signups).toBe(1);
    expect(day('2026-11-16').signups).toBe(1);
    expect(day('2026-11-18').workspaces).toBe(1);
    expect(day('2026-11-24').realPosts).toBe(1);
    expect(day('2026-11-19').simulatedPosts).toBe(1);
    expect(day('2026-11-22').failedPosts).toBe(1);
    // A day on which nothing happened is present with zeros.
    expect(day('2026-11-14')).toEqual({
      day: '2026-11-14',
      signups: 0,
      workspaces: 0,
      realPosts: 0,
      simulatedPosts: 0,
      failedPosts: 0,
    });

    // Publishing is off in this test process: no queue item; the counted ones carry their count.
    const expected = [
      { code: 'POSTS_FAILED_RECENTLY', severity: 'info', count: 1 },
      { code: 'ACCOUNTS_SUSPENDED', severity: 'info', count: 1 },
    ];
    if (!isEmailDeliveryConfigured()) {
      expected.push({ code: 'EMAIL_NOT_CONFIGURED', severity: 'info', count: null });
    }
    expect(overview.attention).toEqual(expected);
  });

  it('answers over HTTP with every number a real count', async () => {
    const admin = await platformAdmin();
    const res = await client(admin.token).get(adminUrl('/overview'));
    expect(res.status).toBe(200);
    expect(res.body.users).toMatchObject({ total: 1, active: 1, suspended: 0, platformAdmins: 1 });
    expect(res.body.activity.days.at(-1).day).toBe(new Date().toISOString().slice(0, 10));
    expect(typeof res.body.generatedAt).toBe('string');
    expect((await client(admin.token).get(adminUrl('/overview?x=1'))).status).toBe(422);
  });
});

describe('users list', () => {
  let admin;

  beforeEach(async () => {
    admin = await platformAdmin({ name: 'Petra Platform', email: 'petra@example.com' });
  });

  const list = (query = '') => client(admin.token).get(adminUrl(`/users${query}`));

  it('searches name and email without case, literally, and by id', async () => {
    const mallory = await signUp({ name: 'Mallory Marsh', email: 'mallory@example.com' });
    await signUp({ name: 'Dot.*Star', email: 'dot@example.com' });
    await signUp({ name: 'Bob Builder', email: 'bob@builders.test' });

    const names = async (q) =>
      (await list(`?q=${encodeURIComponent(q)}`)).body.items.map((u) => u.name);
    expect(await names('marsh')).toEqual(['Mallory Marsh']);
    expect(await names('MALLORY@EX')).toEqual(['Mallory Marsh']);
    expect(await names('builders.test')).toEqual(['Bob Builder']);
    expect(await names('.*')).toEqual(['Dot.*Star']);
    expect(await names('(unclosed')).toEqual([]);
    expect(await names(mallory.user.id)).toEqual(['Mallory Marsh']);
    expect(await names('   ')).toHaveLength(4);

    const long = await list(`?q=${'x'.repeat(101)}`);
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields.q).toBeTruthy();
  });

  it('filters by status (a missing status is active), sorts and pages, with facets of everyone', async () => {
    const people = [];
    for (const name of ['Ann', 'Ben', 'Cat']) people.push(await signUp({ name }));
    await User.updateOne({ _id: people[1].user.id }, { $set: { status: 'DISABLED' } });
    await User.collection.insertOne({
      name: 'Legacy Person',
      email: 'legacy@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    });

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 5, page: 1, limit: 25, pages: 1 });
    expect(all.body.items.map((u) => u.name)).toEqual([
      'Legacy Person',
      'Cat',
      'Ben',
      'Ann',
      'Petra Platform',
    ]);
    expect(all.body.facets).toEqual({ status: { ACTIVE: 4, DISABLED: 1 } });

    const active = await list('?status=ACTIVE');
    expect(active.body.items.map((u) => u.name)).toEqual([
      'Legacy Person',
      'Cat',
      'Ann',
      'Petra Platform',
    ]);
    expect(active.body.items[0].status).toBe('ACTIVE');
    const disabled = await list('?status=DISABLED&q=zzz');
    expect(disabled.body).toMatchObject({ items: [], total: 0, pages: 1 });
    // Facets ignore the search and the filter.
    expect(disabled.body.facets).toEqual({ status: { ACTIVE: 4, DISABLED: 1 } });

    const oldest = await list('?sort=createdAt&limit=2');
    expect(oldest.body.items.map((u) => u.name)).toEqual(['Petra Platform', 'Ann']);
    expect(oldest.body).toMatchObject({ total: 5, limit: 2, pages: 3 });
    const third = await list('?sort=createdAt&limit=2&page=3');
    expect(third.body.items.map((u) => u.name)).toEqual(['Legacy Person']);
    const past = await list('?limit=2&page=9');
    expect(past.body).toMatchObject({ items: [], total: 5, page: 9, pages: 3 });

    for (const bad of [
      '?limit=101',
      '?limit=0',
      '?page=0',
      '?status=BANNED',
      '?sort=name',
      '?foo=1',
    ]) {
      expect((await list(bad)).status).toBe(422);
    }
    expect((await list('?limit=100')).status).toBe(200);
  });

  it('shows each person with exactly the documented fields', async () => {
    const { owner, workspace } = await seedTeam();
    await createWorkspace(owner.token, { name: 'Second Space' });
    const before = await list(`?q=${owner.user.id}`);
    const [item] = before.body.items;
    expect(Object.keys(item)).toEqual([
      'id',
      'name',
      'email',
      'status',
      'platformRole',
      'createdAt',
      'lastLoginAt',
      'suspendedAt',
      'workspaceCount',
    ]);
    expect(item).toMatchObject({
      id: owner.user.id,
      name: 'Olivia Owner',
      status: 'ACTIVE',
      platformRole: null,
      suspendedAt: null,
      workspaceCount: 2,
    });
    expect(typeof item.lastLoginAt).toBe('string');
    expect(workspace.id).toBeTruthy();

    await suspend(admin.token, owner.user.id);
    const after = (await list(`?q=${owner.user.id}`)).body.items[0];
    expect(after.status).toBe('DISABLED');
    expect(typeof after.suspendedAt).toBe('string');
    const self = (await list('?q=petra')).body.items[0];
    expect(self).toMatchObject({ platformRole: 'PLATFORM_ADMIN', workspaceCount: 0 });
  });
});

describe('user detail and the suspension impact preview', () => {
  let admin;
  let team;
  let pages;

  beforeEach(async () => {
    admin = await platformAdmin();
    team = await seedTeam();
    pages = (await seedSocialAccounts(team.workspace.id, team.owner.user.id, { instagram: 0 }))
      .accounts;
    await giveTokens(pages);
    setPublishingSettingsForTests({ mode: 'SIMULATED', maxAttempts: 3 });
  });

  const detail = (userId, token = admin.token) => client(token).get(adminUrl(`/users/${userId}`));

  it('shows the workspaces, sessions, reset link and waiting posts that suspending would touch', async () => {
    const { editor } = team;
    // Owner of a workspace alone, and of one with an admin.
    const alone = await createWorkspace(editor.token, { name: 'Alone Space' });
    const helped = await createWorkspace(editor.token, { name: 'Helped Space' });
    await addMember(helped.workspace.id, editor.token, 'ADMIN', { name: 'Helper Admin' });
    // A second live session, an expired one and an ended one.
    await client()
      .post('/api/v1/auth/login')
      .send({ email: editor.email, password: editor.password });
    await Session.create({
      user: editor.user.id,
      tokenHash: 'expired-session-digest',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await Session.create({
      user: editor.user.id,
      tokenHash: 'revoked-session-digest',
      expiresAt: new Date(Date.now() + DAY),
      revokedAt: new Date(),
    });
    const newest = new Date(Date.now() + 5 * 60_000);
    await Session.updateOne({ user: editor.user.id, revokedAt: null }, { lastUsedAt: newest });
    await client().post('/api/v1/auth/forgot-password').send({ email: editor.email });

    // Two scheduled posts by the editor: one to both Pages (one of them real), one being sent.
    await Membership.updateOne(
      { _id: editor.membershipId },
      { $set: { accountAccess: { mode: 'ALL', socialAccounts: [] } } },
    );
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    const first = await publish(editor.token, team.workspace.id, {
      contentPackageId: (await createDraft(editor.token, team.workspace.id, { accounts: pages }))
        .id,
      scheduledAt: later,
    });
    const second = await publish(editor.token, team.workspace.id, {
      contentPackageId: (
        await createDraft(editor.token, team.workspace.id, { accounts: [pages[0]] })
      ).id,
      scheduledAt: later,
    });
    expect([first.status, second.status]).toEqual([201, 201]);
    await PublishDestination.updateOne(
      { job: first.body.publishJob.id, socialAccount: pages[0]._id },
      { $set: { simulated: false } },
    );
    await PublishDestination.updateOne(
      { job: second.body.publishJob.id },
      { $set: { state: 'PROCESSING', lockedUntil: new Date(Date.now() + 60_000) } },
    );

    const res = await detail(editor.user.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.impact).toEqual({
      liveSessions: 2,
      passwordResetPending: true,
      workspaces: { total: 3, owned: 2, ownedWithoutOtherAdmin: 1 },
      waitingPosts: { posts: 1, deliveries: 2, realDeliveries: 1, sendingNow: 1 },
    });
    expect(res.body.user).toMatchObject({
      id: editor.user.id,
      name: 'Eddie Editor',
      status: 'ACTIVE',
      platformRole: null,
      passwordChangedAt: null,
      suspension: null,
      lastActiveAt: newest.toISOString(),
    });
    expect(Object.keys(res.body.user)).toEqual([
      'id',
      'name',
      'email',
      'status',
      'platformRole',
      'createdAt',
      'lastLoginAt',
      'lastActiveAt',
      'passwordChangedAt',
      'suspension',
    ]);
    // Owned first (newest first), then the rest.
    expect(res.body.memberships.map((m) => [m.workspace.name, m.role, m.onlyOwner])).toEqual([
      ['Helped Space', 'OWNER', true],
      ['Alone Space', 'OWNER', true],
      ['Acme Social', 'EDITOR', false],
    ]);
    const counts = res.body.memberships.map((m) => [m.memberCount, m.adminCount]);
    expect(counts).toEqual([
      [2, 1],
      [1, 0],
      [4, 1],
    ]);
    expect(Object.keys(res.body.memberships[0])).toEqual([
      'id',
      'workspace',
      'role',
      'joinedAt',
      'memberCount',
      'adminCount',
      'onlyOwner',
    ]);
    expect(res.body.membershipsTruncated).toBe(false);
    expect(res.body.actions).toEqual({ canSuspend: true, canReactivate: false, blockedBy: null });
    expect(alone.workspace.id).toBeTruthy();
    expectNoSecrets(res.body, [/Hello from the test/, /Page 0/, /Fixture Identity/]);
  });

  it('says why suspending is not offered: your own account, or another platform admin', async () => {
    const self = await detail(admin.user.id);
    expect(self.body.actions).toEqual({
      canSuspend: false,
      canReactivate: false,
      blockedBy: 'SELF',
    });
    const other = await platformAdmin({ name: 'Otto Operator' });
    const peer = await detail(other.user.id);
    expect(peer.body.user.platformRole).toBe('PLATFORM_ADMIN');
    expect(peer.body.actions).toEqual({
      canSuspend: false,
      canReactivate: false,
      blockedBy: 'TARGET_IS_PLATFORM_ADMIN',
    });
  });

  it('shows a suspension with when, by whom and why, and offers reactivation', async () => {
    await suspend(admin.token, team.viewer.user.id, { reason: 'Spam in every Page, twice a day.' });
    const res = await detail(team.viewer.user.id);
    expect(res.body.user.status).toBe('DISABLED');
    expect(res.body.user.suspension).toEqual({
      at: expect.any(String),
      by: { id: admin.user.id, name: 'Petra Platform' },
      reason: 'Spam in every Page, twice a day.',
    });
    expect(res.body.impact.liveSessions).toBe(0);
    expect(res.body.actions).toEqual({ canSuspend: false, canReactivate: true, blockedBy: null });
    // Suspended outside the panel: suspended, without a recorded suspension.
    await User.updateOne({ _id: team.editor.user.id }, { $set: { status: 'DISABLED' } });
    const manual = await detail(team.editor.user.id);
    expect(manual.body.user).toMatchObject({ status: 'DISABLED', suspension: null });
    expect(manual.body.actions.canReactivate).toBe(true);
  });

  it('answers 404 for nobody and 422 for a malformed id', async () => {
    const missing = await detail(new mongoose.Types.ObjectId().toString());
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('User not found');
    const malformed = await detail('not-an-id');
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.details.fields.userId).toBe('Invalid identifier');
    expect((await client(admin.token).get(adminUrl(`/users/${admin.user.id}?x=1`))).status).toBe(
      422,
    );
  });
});

describe('workspaces', () => {
  let admin;
  let team;

  beforeEach(async () => {
    admin = await platformAdmin();
    team = await seedTeam();
  });

  const list = (query = '') => client(admin.token).get(adminUrl(`/workspaces${query}`));

  it('lists with owner, members and account counts; searches, filters, sorts and pages', async () => {
    await seedSocialAccounts(team.workspace.id, team.owner.user.id);
    const beta = await signUp({ name: 'Bea Beta', email: 'bea@example.com' });
    const betaWs = (await createWorkspace(beta.token, { name: 'Beta Brand' })).workspace;
    await Workspace.updateOne({ _id: betaWs.id }, { $set: { publishingMode: 'LIVE' } });
    const orphanId = new mongoose.Types.ObjectId();
    await Workspace.collection.insertOne({
      _id: orphanId,
      name: 'Orphan Space',
      slug: 'orphan-space',
      createdAt: new Date(),
    });

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 25, pages: 1 });
    expect(all.body.facets).toEqual({ publishingMode: { SIMULATED: 2, LIVE: 1 } });
    expect(all.body.items.map((w) => w.name)).toEqual([
      'Orphan Space',
      'Beta Brand',
      'Acme Social',
    ]);
    const [orphan, betaItem, acme] = all.body.items;
    expect(Object.keys(acme)).toEqual([
      'id',
      'name',
      'slug',
      'createdAt',
      'publishingMode',
      'owner',
      'memberCount',
      'accounts',
    ]);
    expect(acme).toMatchObject({
      id: team.workspace.id,
      publishingMode: 'SIMULATED',
      owner: {
        id: team.owner.user.id,
        name: 'Olivia Owner',
        email: team.owner.email,
        status: 'ACTIVE',
      },
      memberCount: 4,
      accounts: { facebookPages: 2, instagramAccounts: 1 },
    });
    expect(Object.keys(acme.owner)).toEqual(['id', 'name', 'email', 'status']);
    expect(betaItem).toMatchObject({ publishingMode: 'LIVE', memberCount: 1 });
    expect(orphan).toMatchObject({
      publishingMode: 'SIMULATED',
      owner: null,
      memberCount: 0,
      accounts: { facebookPages: 0, instagramAccounts: 0 },
    });

    const names = async (query) => (await list(query)).body.items.map((w) => w.name);
    expect(await names('?q=ACME')).toEqual(['Acme Social']);
    expect(await names('?q=orphan-sp')).toEqual(['Orphan Space']);
    expect(await names(`?q=${betaWs.id}`)).toEqual(['Beta Brand']);
    expect(await names('?publishingMode=LIVE')).toEqual(['Beta Brand']);
    expect(await names('?publishingMode=SIMULATED')).toEqual(['Orphan Space', 'Acme Social']);
    expect(await names('?sort=createdAt&limit=1&page=2')).toEqual(['Beta Brand']);
    const filtered = await list('?publishingMode=LIVE&q=nothing');
    expect(filtered.body).toMatchObject({ items: [], total: 0, pages: 1 });
    expect(filtered.body.facets).toEqual({ publishingMode: { SIMULATED: 2, LIVE: 1 } });
    for (const bad of ['?publishingMode=DISABLED', '?limit=101', '?status=ACTIVE']) {
      expect((await list(bad)).status).toBe(422);
    }
    expectNoSecrets(all.body, [/Page 0/, /Instagram 0/, /Fixture Identity/]);

    // A workspace whose owner is suspended shows it.
    await suspend(admin.token, beta.user.id);
    expect((await list('?publishingMode=LIVE')).body.items[0].owner.status).toBe('DISABLED');
  });

  it('shows one workspace by names, people and counts, never its content', async () => {
    const ws = team.workspace.id;
    const { connection } = await seedSocialAccounts(ws, team.owner.user.id);
    await SocialConnection.create({
      workspace: ws,
      provider: 'FACEBOOK_LOGIN',
      externalUserId: 'fb-user-2',
      displayName: 'Second Fixture Identity',
      status: 'EXPIRED',
      connectedBy: team.owner.user.id,
    });
    const secondEditor = await addMember(ws, team.owner.token, 'EDITOR', { name: 'Second Editor' });
    await as(team.owner.token)
      .post(`/api/v1/workspaces/${ws}/invitations`)
      .send({ email: 'invitee.secret@example.com', role: 'VIEWER' });
    const expiredInvite = await as(team.owner.token)
      .post(`/api/v1/workspaces/${ws}/invitations`)
      .send({ email: 'expired.secret@example.com', role: 'VIEWER' });
    expect(expiredInvite.status).toBe(201);
    await mongoose.connection
      .collection('invitations')
      .updateOne(
        { email: 'expired.secret@example.com' },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      );
    await createDraft(team.owner.token, ws, { caption: 'TOP SECRET CAPTION' });
    const workspace = new mongoose.Types.ObjectId(ws);
    await MediaAsset.collection.insertMany(
      [
        { workspace, status: 'READY', sizeBytes: 1000, fileName: 'secret-file.jpg' },
        { workspace, status: 'READY', sizeBytes: 2500, fileName: 'secret-two.jpg' },
        { workspace, status: 'PENDING_UPLOAD', sizeBytes: 9999, fileName: 'secret-three.jpg' },
      ].map((row) => ({ ...row, storageKey: String(unique()) })),
    );
    await PublishJob.collection.insertMany(
      ['SCHEDULED', 'PUBLISHED', 'PUBLISHED', 'FAILED'].map((status) =>
        rawJob({ workspace, status }),
      ),
    );
    await FacebookGroup.collection.insertOne({ workspace, name: 'Secret Group Name' });
    await SharingTask.collection.insertMany(
      [
        { workspace, status: 'OPEN', note: 'secret note' },
        { workspace, status: 'OPEN' },
        { workspace, status: 'DONE' },
      ].map((row) => ({ ...row, share: unique(), group: unique() })),
    );

    const res = await client(admin.token).get(adminUrl(`/workspaces/${ws}`));
    expect(res.status).toBe(200);
    expect(res.body.workspace).toMatchObject({
      id: ws,
      name: 'Acme Social',
      slug: team.workspace.slug,
      timezone: 'UTC',
      publishingMode: 'SIMULATED',
      publishingModeChangedAt: null,
    });
    expect(Object.keys(res.body.workspace)).toEqual([
      'id',
      'name',
      'slug',
      'timezone',
      'createdAt',
      'publishingMode',
      'publishingModeChangedAt',
      'lastActivityAt',
    ]);
    expect(typeof res.body.workspace.lastActivityAt).toBe('string');
    // The owner first, then by role, then the oldest membership first.
    expect(res.body.members.map((m) => [m.user.name, m.role])).toEqual([
      ['Olivia Owner', 'OWNER'],
      ['Adam Admin', 'ADMIN'],
      ['Eddie Editor', 'EDITOR'],
      ['Second Editor', 'EDITOR'],
      ['Vera Viewer', 'VIEWER'],
    ]);
    expect(res.body.members[3].id).toBe(secondEditor.membershipId);
    expect(Object.keys(res.body.members[0])).toEqual(['id', 'user', 'role', 'joinedAt']);
    expect(Object.keys(res.body.members[0].user)).toEqual(['id', 'name', 'email', 'status']);
    expect(res.body.membersTruncated).toBe(false);
    expect(res.body.counts).toEqual({
      members: 5,
      pendingInvitations: 1,
      connections: { ACTIVE: 1, EXPIRED: 1, REVOKED: 0, ERROR: 0, DISCONNECTED: 0 },
      accounts: { facebookPages: 2, instagramAccounts: 1 },
      drafts: 1,
      mediaFiles: 2,
      mediaBytes: 3500,
      posts: {
        SCHEDULED: 1,
        QUEUED: 0,
        PROCESSING: 0,
        PUBLISHED: 2,
        PARTIALLY_PUBLISHED: 0,
        FAILED: 1,
        CANCELLED: 0,
      },
      facebookGroups: 1,
      openSharingTasks: 2,
    });
    expect(connection).toBeTruthy();
    expectNoSecrets(res.body, [
      /TOP SECRET CAPTION/,
      /Page 0/,
      /Instagram 0/,
      /Fixture Identity/,
      /invitee\.secret/,
      /expired\.secret/,
      /Secret Group Name/,
      /secret-file/,
      /secret note/,
    ]);
  });

  it('answers 404 for no such workspace and 422 for a malformed id', async () => {
    const missing = await client(admin.token).get(
      adminUrl(`/workspaces/${new mongoose.Types.ObjectId()}`),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('Workspace not found');
    const malformed = await client(admin.token).get(adminUrl('/workspaces/acme'));
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.details.fields.workspaceId).toBe('Invalid identifier');
  });
});

describe('system status', () => {
  const now = new Date();

  it('reports what cannot be read as null or UNKNOWN, never as 0', async () => {
    setPublishQueueForTests(null);
    let system = await systemStatus({ now });
    expect(system.publishing.queue).toEqual({ status: 'NOT_CONFIGURED', counts: null });
    expect(system.publishing.worker).toEqual({ status: 'UNKNOWN', count: null });
    expect(system.analytics.queue).toEqual({ status: 'NOT_CONFIGURED', counts: null });
    expect(system.analytics.worker).toEqual({ status: 'UNKNOWN', count: null });
    expect(system.publishing.deliveries).toEqual({
      waiting: 0,
      sending: 0,
      late: 0,
      latePosts: 0,
      interrupted: 0,
      nextDueAt: null,
      lastFinishedAt: null,
    });

    setPublishQueueForTests(createTestQueue({ status: 'UNAVAILABLE' }));
    system = await systemStatus({ now });
    expect(system.publishing.queue).toEqual({ status: 'UNAVAILABLE', counts: null });
    expect(system.publishing.worker).toEqual({ status: 'UNKNOWN', count: null });

    // Redis answers the worker list but not the counts, then the reverse.
    const flaky = createTestQueue();
    flaky.counts = async () => {
      throw new Error('timeout');
    };
    setPublishQueueForTests(flaky);
    system = await systemStatus({ now });
    expect(system.publishing.queue).toEqual({ status: 'READY', counts: null });
    expect(system.publishing.worker).toEqual({ status: 'RUNNING', count: 1 });
    const noWorkers = createTestQueue();
    noWorkers.workerCount = async () => {
      throw new Error('CLIENT LIST not allowed');
    };
    setPublishQueueForTests(noWorkers);
    system = await systemStatus({ now });
    expect(system.publishing.queue.counts).toEqual({ waiting: 0, active: 0, delayed: 0 });
    expect(system.publishing.worker).toEqual({ status: 'UNKNOWN', count: null });
  });

  it('reads workers from the queue and delivery facts from MongoDB', async () => {
    queue.workers = 0;
    const analytics = createTestQueue();
    analytics.workers = 2;
    setAnalyticsQueueForTests(analytics);
    const job = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const at = (minutes) => new Date(now.getTime() + minutes * 60_000);
    const destination = (state, fields) => ({
      state,
      job,
      workspace: job,
      socialAccount: unique(),
      ...fields,
    });
    await PublishDestination.collection.insertMany([
      destination('SCHEDULED', { dueAt: at(60), job: other }),
      destination('QUEUED', { dueAt: at(-30) }),
      destination('RETRY_SCHEDULED', { dueAt: at(-20) }),
      destination('QUEUED', { dueAt: at(-5), job: other }),
      destination('PROCESSING', { lockedUntil: at(-1) }),
      destination('PROCESSING', { lockedUntil: at(5) }),
      destination('PUBLISHED', { dueAt: at(-90) }),
    ]);
    const finished = new Date(now.getTime() - 3_600_000);
    await PublishJob.collection.insertMany([
      rawJob({ status: 'FAILED', completedAt: finished, updatedAt: finished }),
      rawJob({ status: 'PUBLISHED', completedAt: at(-120), updatedAt: at(-120) }),
      rawJob({ status: 'SCHEDULED', updatedAt: now }),
    ]);

    const system = await systemStatus({ now });
    expect(Object.keys(system)).toEqual([
      'generatedAt',
      'api',
      'database',
      'publishing',
      'analytics',
      'storage',
      'email',
    ]);
    expect(system.api).toEqual({
      version: '0.1.0',
      uptimeSeconds: expect.any(Number),
      environment: 'test',
    });
    expect(system.database).toEqual({ state: 'connected', transactions: true });
    expect(system.publishing.worker).toEqual({ status: 'NOT_RUNNING', count: 0 });
    expect(system.analytics).toEqual({
      mode: expect.any(String),
      queue: { status: 'READY', counts: { waiting: 0, active: 0, delayed: 0 } },
      worker: { status: 'RUNNING', count: 2 },
    });
    expect(system.publishing.deliveries).toEqual({
      waiting: 4,
      sending: 2,
      late: 2,
      latePosts: 1,
      interrupted: 1,
      nextDueAt: at(-30),
      lastFinishedAt: finished,
    });
    expect(system.storage).toEqual({
      driver: getStorage()?.name ?? null,
      publicUrls: Boolean(getStorage()?.publicUrls),
    });
    expect(system.email).toEqual({ configured: isEmailDeliveryConfigured() });

    setPublishingSettingsForTests({ mode: 'SIMULATED' });
    const overview = await getOverview({ now });
    expect(overview.attention.slice(0, 3)).toEqual([
      { code: 'WORKER_NOT_RUNNING', severity: 'danger', count: null },
      { code: 'POSTS_LATE', severity: 'danger', count: 1 },
      { code: 'DELIVERIES_INTERRUPTED', severity: 'warning', count: 1 },
    ]);
  });

  it('answers over HTTP to a platform admin', async () => {
    const admin = await platformAdmin();
    const res = await client(admin.token).get(adminUrl('/system'));
    expect(res.status).toBe(200);
    expect(res.body.publishing.queue.status).toBe('READY');
    expect(res.body.publishing.worker).toEqual({ status: 'RUNNING', count: 1 });
    expect((await client(admin.token).get(adminUrl('/system?x=1'))).status).toBe(422);
  });
});

describe('attention items', () => {
  const system = (publishing = {}, rest = {}) => ({
    publishing: {
      mode: 'LIVE',
      queue: { status: 'READY', counts: null },
      worker: { status: 'RUNNING', count: 1 },
      deliveries: { latePosts: 0, interrupted: 0 },
      ...publishing,
    },
    storage: { driver: 's3', publicUrls: true },
    email: { configured: true },
    ...rest,
  });
  const codes = (s, counts = { suspended: 0, failedLast24h: 0 }) =>
    attentionItems(s, counts).map((item) => item.code);

  it('lists only what is known to need attention, in a fixed order', () => {
    expect(codes(system())).toEqual([]);
    expect(codes(system({ queue: { status: 'UNAVAILABLE', counts: null } }))).toEqual([
      'QUEUE_UNAVAILABLE',
    ]);
    expect(codes(system({ queue: { status: 'NOT_CONFIGURED', counts: null } }))).toEqual([
      'QUEUE_NOT_CONFIGURED',
    ]);
    // A cold queue is normal; an unknown worker count says nothing.
    expect(codes(system({ queue: { status: 'CONNECTING', counts: null } }))).toEqual([]);
    expect(codes(system({ worker: { status: 'UNKNOWN', count: null } }))).toEqual([]);
    expect(
      codes(
        system({
          mode: 'DISABLED',
          queue: { status: 'NOT_CONFIGURED' },
          worker: { status: 'NOT_RUNNING' },
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        system({}, { storage: { driver: null, publicUrls: false }, email: { configured: false } }),
        {
          suspended: 2,
          failedLast24h: 3,
        },
      ),
    ).toEqual([
      'POSTS_FAILED_RECENTLY',
      'ACCOUNTS_SUSPENDED',
      'STORAGE_NOT_PUBLIC',
      'EMAIL_NOT_CONFIGURED',
    ]);
    expect(
      codes(
        system(
          { mode: 'SIMULATED', deliveries: { latePosts: 1, interrupted: 2 } },
          {
            storage: { driver: 'local', publicUrls: false },
          },
        ),
      ),
    ).toEqual(['POSTS_LATE', 'DELIVERIES_INTERRUPTED']);
  });
});

describe('audit log', () => {
  let admin;

  beforeEach(async () => {
    admin = await platformAdmin();
  });

  const list = (query = '') => client(admin.token).get(adminUrl(`/audit-log${query}`));

  it('pages newest first with a cursor and filters by action and person', async () => {
    const target = await signUp({ name: 'Tara Target', email: 'tara@example.com' });
    const other = await signUp({ name: 'Omar Other', email: 'omar@example.com' });
    await grantPlatformAdmin('omar@example.com');
    expect((await suspend(admin.token, target.user.id)).status).toBe(200);
    expect(
      (await reactivate(admin.token, target.user.id, { note: 'Talked to them.' })).status,
    ).toBe(200);

    const first = await list('?limit=2');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.items.map((e) => e.action)).toEqual([
      'platform.user_reactivated',
      'platform.user_suspended',
    ]);
    expect(first.body.nextCursor).toBe(first.body.items[1].id);
    const second = await list(`?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((e) => e.action)).toEqual(['platform.admin_granted']);
    expect(second.body.nextCursor).toBeNull();

    const [reactivated, suspended] = first.body.items;
    expect(Object.keys(suspended)).toEqual([
      'id',
      'action',
      'actor',
      'target',
      'metadata',
      'createdAt',
    ]);
    expect(suspended).toMatchObject({
      actor: { id: admin.user.id, name: 'Petra Platform' },
      target: { type: 'user', id: target.user.id, label: 'Tara Target' },
      metadata: {
        email: 'tara@example.com',
        reason: 'Posted the same link to 40 Pages within one hour.',
        sessionsEnded: 1,
        resetLinkCleared: false,
      },
    });
    expect(reactivated.metadata).toEqual({
      email: 'tara@example.com',
      note: 'Talked to them.',
      suspendedAt: expect.any(String),
      suspendedReason: 'Posted the same link to 40 Pages within one hour.',
    });
    expect(second.body.items[0]).toMatchObject({
      actor: { id: null, name: 'Command line' },
      target: { type: 'user', id: other.user.id, label: 'Omar Other' },
      metadata: { email: 'omar@example.com', via: 'CLI' },
    });

    const byAction = await list('?action=platform.user_suspended');
    expect(byAction.body.items).toHaveLength(1);
    const byPerson = await list(`?targetId=${target.user.id}`);
    expect(byPerson.body.items.map((e) => e.action)).toEqual([
      'platform.user_reactivated',
      'platform.user_suspended',
    ]);
    for (const bad of ['?action=platform.user_deleted', '?cursor=nope', '?limit=101', '?q=x']) {
      expect((await list(bad)).status).toBe(422);
    }

    // IP and browser are stored for investigations, and never returned.
    const stored = await PlatformAuditLog.findById(suspended.id).select('+ip +userAgent').lean();
    expect(stored.userAgent).toBe('AdminPrivacyProbe/1.0 (test)');
    expect(stored.ip).toBeTruthy();
    expectNoSecrets(first.body);
    expectNoSecrets(second.body);
  });

  it('returns only the documented metadata keys of each action', async () => {
    await PlatformAuditLog.create({
      actorName: 'Command line',
      action: 'platform.admin_granted',
      target: { type: 'user', id: admin.user.id, label: 'Petra Platform' },
      metadata: { email: 'petra@example.com', via: 'CLI', leaked: 'must-not-appear' },
      ip: '203.0.113.9',
      userAgent: 'Other Browser',
    });
    const res = await list();
    expect(res.body.items[0].metadata).toEqual({ email: 'petra@example.com', via: 'CLI' });
    expectNoSecrets(res.body, [/must-not-appear/, /203\.0\.113\.9/, /Other Browser/]);
  });
});

describe('privacy of every answer', () => {
  it('never returns a secret, an IP address or a browser from any endpoint', async () => {
    const admin = await platformAdmin();
    const team = await seedTeam();
    const { accounts } = await seedSocialAccounts(team.workspace.id, team.owner.user.id);
    await giveTokens(accounts);
    const target = await signUp({ name: 'Scan Target' });
    await client().post('/api/v1/auth/forgot-password').send({ email: target.email });

    const answers = [];
    const get = async (path) => {
      const res = await client(admin.token).get(adminUrl(path));
      expect(res.status).toBe(200);
      answers.push(res.body);
    };
    await get('/overview');
    await get('/users');
    await get(`/users/${target.user.id}`);
    await get(`/users/${team.owner.user.id}`);
    await get('/workspaces');
    await get(`/workspaces/${team.workspace.id}`);
    await get('/system');
    const suspended = await suspend(admin.token, target.user.id);
    expect(suspended.body.result).toEqual({ sessionsEnded: 1, resetLinkCleared: true });
    answers.push(suspended.body);
    answers.push((await reactivate(admin.token, target.user.id)).body);
    await get('/audit-log');
    await get(`/users/${target.user.id}`);
    for (const body of answers) {
      expectNoSecrets(body, [/Page 0/, /Instagram 0/, /Fixture Identity/, /Hello from the test/]);
    }
  });
});
