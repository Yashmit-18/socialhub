import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setTransactionSupportForTests } from '../src/db/mongoose.js';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { sha256 } from '../src/lib/crypto.js';
import { outbox } from '../src/lib/mailer.js';
import {
  ActivityLog,
  Membership,
  PlatformAuditLog,
  PublishDestination,
  PublishJob,
  Session,
  User,
  Workspace,
} from '../src/models/index.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../src/modules/auth/auth.service.js';
import { setSimulatedBehaviourForTests } from '../src/modules/publishing/adapters/simulated.js';
import {
  processDestination,
  recoverPublishing,
} from '../src/modules/publishing/publishing.processor.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setAnalyticsQueueForTests } from '../src/queue/analyticsQueue.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import {
  AGENT,
  adminUrl,
  client,
  expectNoSecrets,
  platformAdmin,
  reactivate,
  signUp,
} from './adminFixtures.js';
import {
  DEFAULT_PASSWORD,
  api,
  as,
  seedSocialAccounts,
  seedTeam,
  withClientHeader,
} from './helpers.js';
import {
  createDraft,
  createTestQueue,
  giveTokens,
  publish,
  publishUrl,
} from './publishFixtures.js';

/**
 * The headline operator action: suspending and reactivating an account, end to end. Sign-in,
 * sessions, reset links and the publish worker all honour it; the simulated adapter and a
 * recording stand-in for Meta prove that nothing is sent for a suspended author.
 */

const REASON = 'Posted the same link to 40 Pages within one hour.';
const USER_KEYS = [
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
];

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
  setSimulatedBehaviourForTests(null);
  setMetaTransportForTests(undefined);
});

const suspendUrl = (userId) => adminUrl(`/users/${userId}/suspend`);
const reactivateUrl = (userId) => adminUrl(`/users/${userId}/reactivate`);
const suspend = (token, userId, body = {}, target) =>
  client(token, target)
    .post(suspendUrl(userId))
    .send({ reason: REASON, password: DEFAULT_PASSWORD, ...body });
const login = (email, password = DEFAULT_PASSWORD) =>
  client().post('/api/v1/auth/login').send({ email, password });
const refresh = (cookie) =>
  withClientHeader(api().post('/api/v1/auth/refresh').set('Cookie', cookie));
const lastResetToken = () => {
  const mail = outbox.findLast((m) => m.meta.kind === 'password_reset');
  return new URL(mail.meta.url).searchParams.get('token');
};
const auditEntries = (action) => PlatformAuditLog.find(action ? { action } : {}).lean();

describe('suspending an account', () => {
  let admin;
  let target;

  beforeEach(async () => {
    admin = await platformAdmin();
    target = await signUp({ name: 'Mallory Marsh', email: 'mallory@example.com' });
  });

  it('needs the platform admin’s own password: a wrong one changes nothing', async () => {
    const res = await suspend(admin.token, target.user.id, { password: 'Wrong-pass1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.password).toBe('Password is incorrect');
    expect((await User.findById(target.user.id)).status).toBe('ACTIVE');
    expect(await Session.countDocuments({ user: target.user.id, revokedAt: null })).toBe(1);
    expect(await auditEntries()).toHaveLength(0);
    // The target's password is not the one that counts.
    const theirs = await suspend(admin.token, target.user.id, { password: 'Another-pass9' });
    expect(theirs.status).toBe(422);
  });

  it('needs a written reason of 10 to 500 characters and nothing else in the body', async () => {
    const cases = [
      [{ reason: undefined }, 'reason', 'Write why you are suspending this account'],
      [{ reason: '   too short   ' }, 'reason', /at least 10 characters/],
      [{ reason: 'x'.repeat(501) }, 'reason', 'Use at most 500 characters'],
      [{ password: undefined }, 'password', 'Password is required'],
      [{ password: '' }, 'password', 'Password is required'],
    ];
    for (const [body, field, message] of cases) {
      const res = await suspend(admin.token, target.user.id, body);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields[field]).toMatch(message);
    }
    const extra = await suspend(admin.token, target.user.id, { notify: true });
    expect(extra.status).toBe(422);
    const malformed = await suspend(admin.token, 'not-an-id');
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.details.fields.userId).toBe('Invalid identifier');
    const missing = await suspend(admin.token, '507f1f77bcf86cd799439011');
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('User not found');
    expect((await User.findById(target.user.id)).status).toBe('ACTIVE');
  });

  it('refuses your own account, another platform admin and an account already suspended', async () => {
    // Checked before the password: no secret is needed to learn these.
    const self = await suspend(admin.token, admin.user.id, { password: 'Wrong-pass1' });
    expect(self.status).toBe(409);
    expect(self.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'You cannot suspend your own account.',
      details: { reason: 'SELF' },
    });
    const other = await platformAdmin({ name: 'Otto Operator' });
    const peer = await suspend(admin.token, other.user.id);
    expect(peer.status).toBe(409);
    expect(peer.body.error.details.reason).toBe('TARGET_IS_PLATFORM_ADMIN');
    expect(peer.body.error.message).toBe(
      'This person is a platform admin. Remove their admin access first, then suspend the account.',
    );
    expect((await suspend(admin.token, target.user.id)).status).toBe(200);
    const again = await suspend(admin.token, target.user.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      message: 'This account is already suspended.',
      details: { reason: 'ALREADY_SUSPENDED' },
    });
    expect(await auditEntries('platform.user_suspended')).toHaveLength(1);
  });

  it('suspends at once: when, by whom and why, every session ended, reset link cleared, audited', async () => {
    const second = await login(target.email);
    expect(second.status).toBe(200);
    await client().post('/api/v1/auth/forgot-password').send({ email: target.email });
    const resetToken = lastResetToken();

    const res = await suspend(admin.token, target.user.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.result).toEqual({ sessionsEnded: 2, resetLinkCleared: true });
    expect(Object.keys(res.body.user)).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({
      id: target.user.id,
      status: 'DISABLED',
      suspension: {
        at: expect.any(String),
        by: { id: admin.user.id, name: 'Petra Platform' },
        reason: REASON,
      },
    });

    const stored = await User.findById(target.user.id).select('+suspension +passwordReset').lean();
    expect(stored.status).toBe('DISABLED');
    expect(stored.suspension).toMatchObject({ byName: 'Petra Platform', reason: REASON });
    expect(String(stored.suspension.by)).toBe(admin.user.id);
    expect(stored.passwordReset).toBeUndefined();
    const sessions = await Session.find({ user: target.user.id }).lean();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.revokedAt && s.revokedReason === 'account_suspended')).toBe(
      true,
    );

    const [entry] = await PlatformAuditLog.find({ action: 'platform.user_suspended' })
      .select('+ip +userAgent')
      .lean();
    expect(entry).toMatchObject({
      actorName: 'Petra Platform',
      target: { type: 'user', label: 'Mallory Marsh' },
      metadata: {
        email: 'mallory@example.com',
        reason: REASON,
        sessionsEnded: 2,
        resetLinkCleared: true,
      },
      userAgent: AGENT,
    });
    expect(String(entry.actor)).toBe(admin.user.id);
    expect(entry.ip).toBeTruthy();
    expectNoSecrets(res.body);

    // The link sent before the suspension no longer works.
    const reset = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'Brand-new-pass1' });
    expect(reset.status).toBe(400);
    expect(reset.body.error.message).toBe('This reset link is invalid or has expired');
  });

  it('lets exactly one of two platform admins win a race', async () => {
    const other = await platformAdmin({ name: 'Otto Operator' });
    const results = await Promise.all([
      suspend(admin.token, target.user.id),
      suspend(other.token, target.user.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.details.reason).toBe(
      'ALREADY_SUSPENDED',
    );
    expect(await auditEntries('platform.user_suspended')).toHaveLength(1);
  });

  it('works the same on a database without transactions', async () => {
    setTransactionSupportForTests(false);
    const res = await suspend(admin.token, target.user.id);
    expect(res.status).toBe(200);
    expect(res.body.result.sessionsEnded).toBe(1);
    expect(await auditEntries('platform.user_suspended')).toHaveLength(1);
  });

  it('limits failed attempts per platform admin, counting failures only', async () => {
    const limited = createApp({ rateLimit: { authMax: 2 } });
    const other = await platformAdmin({ name: 'Otto Operator' });
    const wrong = { password: 'Wrong-pass1' };
    expect((await suspend(admin.token, target.user.id, wrong, limited)).status).toBe(422);
    // Successful actions do not count.
    expect((await suspend(admin.token, target.user.id, {}, limited)).status).toBe(200);
    expect((await reactivate(admin.token, target.user.id, {}, limited)).status).toBe(200);
    expect((await suspend(admin.token, target.user.id, wrong, limited)).status).toBe(422);
    const blocked = await suspend(admin.token, target.user.id, {}, limited);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    });
    expect((await reactivate(admin.token, target.user.id, {}, limited)).status).toBe(429);
    // Counted per person, not per address: another platform admin is not held up.
    expect((await suspend(other.token, target.user.id, {}, limited)).status).toBe(200);
  });

  it('shares the failure count with every other route that checks the password', async () => {
    // A stolen access token must not be able to guess the password on a less guarded route.
    const limited = createApp({ rateLimit: { authMax: 2 } });
    const wrong = { password: 'Wrong-pass1' };
    expect((await suspend(admin.token, target.user.id, wrong, limited)).status).toBe(422);
    expect((await suspend(admin.token, target.user.id, wrong, limited)).status).toBe(422);
    const changePassword = await client(admin.token, limited)
      .post('/api/v1/users/me/password')
      .send({ currentPassword: 'Wrong-pass1', newPassword: 'Another-pass2' });
    expect(changePassword.status).toBe(429);
  });

  it('keeps no suspension without its audit entry on a database without transactions', async () => {
    setTransactionSupportForTests(false);
    const create = PlatformAuditLog.create.bind(PlatformAuditLog);
    PlatformAuditLog.create = () => Promise.reject(new Error('audit write failed'));
    try {
      expect((await suspend(admin.token, target.user.id)).status).toBe(500);
    } finally {
      PlatformAuditLog.create = create;
    }
    const after = await User.findById(target.user.id).select('status +suspension').lean();
    expect(after.status).toBe('ACTIVE');
    expect(after.suspension).toBeUndefined();
    expect(await auditEntries('platform.user_suspended')).toHaveLength(0);
  });
});

describe('signing in while suspended', () => {
  let admin;
  let target;

  beforeEach(async () => {
    admin = await platformAdmin();
    target = await signUp({ name: 'Mallory Marsh', email: 'mallory@example.com' });
  });

  it('ends the open session: the access token and the refresh cookie stop working', async () => {
    expect((await client(target.token).get('/api/v1/auth/me')).status).toBe(200);
    expect((await suspend(admin.token, target.user.id)).status).toBe(200);
    const me = await client(target.token).get('/api/v1/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    const refreshed = await refresh(target.cookie);
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.code).toBe('SESSION_REVOKED');
  });

  it('tells only someone with the right password that the account is suspended', async () => {
    await suspend(admin.token, target.user.id);
    const sessionsBefore = await Session.countDocuments({ user: target.user.id });

    const right = await login(target.email);
    expect(right.status).toBe(401);
    expect(right.body.error).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      message: ACCOUNT_SUSPENDED_MESSAGE,
    });
    expect(right.body.error.message).not.toContain(REASON);
    expect(right.headers['set-cookie']).toBeUndefined();
    expect(await Session.countDocuments({ user: target.user.id })).toBe(sessionsBefore);

    const wrong = await login(target.email, 'Wrong-pass1');
    const unknown = await login('nobody@example.com', 'Wrong-pass1');
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }
  });

  it('sends no reset link to a suspended account and refuses one presented for it', async () => {
    await suspend(admin.token, target.user.id);
    const forgot = await client()
      .post('/api/v1/auth/forgot-password')
      .send({ email: target.email });
    expect(forgot.status).toBe(202);
    expect(outbox).toHaveLength(0);
    // A link stored by hand (outside the product) still cannot be used.
    const token = 'manually-planted-reset-token-0123456789';
    await User.updateOne(
      { _id: target.user.id },
      {
        $set: {
          passwordReset: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) },
        },
      },
    );
    const reset = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Brand-new-pass1' });
    expect(reset.status).toBe(400);
    expect(reset.body.error.message).toBe('This reset link is invalid or has expired');
  });
});

describe('reactivating an account', () => {
  let admin;
  let target;

  beforeEach(async () => {
    admin = await platformAdmin();
    target = await signUp({ name: 'Mallory Marsh', email: 'mallory@example.com' });
  });

  it('refuses an account that is not suspended, before checking the password', async () => {
    const res = await reactivate(admin.token, target.user.id, { password: 'Wrong-pass1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      message: 'This account is not suspended.',
      details: { reason: 'NOT_SUSPENDED' },
    });
  });

  it('needs the password and accepts a short optional note', async () => {
    await suspend(admin.token, target.user.id);
    const wrong = await reactivate(admin.token, target.user.id, { password: 'Wrong-pass1' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.fields.password).toBe('Password is incorrect');
    const long = await reactivate(admin.token, target.user.id, { note: 'x'.repeat(501) });
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields.note).toBe('Use at most 500 characters');
    const extra = await reactivate(admin.token, target.user.id, { restoreSessions: true });
    expect(extra.status).toBe(422);
    expect((await User.findById(target.user.id)).status).toBe('DISABLED');
  });

  it('restores sign-in only: old sessions stay ended, and the audit entry keeps the history', async () => {
    await suspend(admin.token, target.user.id);
    const res = await reactivate(admin.token, target.user.id, {
      note: '  Spoke to them on the phone.  ',
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['user']);
    expect(Object.keys(res.body.user)).toEqual(USER_KEYS);
    expect(res.body.user).toMatchObject({ status: 'ACTIVE', suspension: null });
    expect((await User.findById(target.user.id).select('+suspension')).suspension).toBeUndefined();

    expect((await client(target.token).get('/api/v1/auth/me')).status).toBe(401);
    expect((await refresh(target.cookie)).status).toBe(401);
    expect((await login(target.email)).status).toBe(200);

    const [entry] = await auditEntries('platform.user_reactivated');
    expect(entry.metadata).toEqual({
      email: 'mallory@example.com',
      note: 'Spoke to them on the phone.',
      suspendedAt: expect.any(Date),
      suspendedReason: REASON,
    });
    const detail = await client(admin.token).get(adminUrl(`/users/${target.user.id}`));
    expect(detail.body.actions).toEqual({
      canSuspend: true,
      canReactivate: false,
      blockedBy: null,
    });
  });

  it('reactivates an account suspended outside the panel, with an empty note left out', async () => {
    await User.updateOne({ _id: target.user.id }, { $set: { status: 'DISABLED' } });
    const res = await reactivate(admin.token, target.user.id, { note: '   ' });
    expect(res.status).toBe(200);
    const [entry] = await auditEntries('platform.user_reactivated');
    expect(entry.metadata).toEqual({
      email: 'mallory@example.com',
      suspendedAt: null,
      suspendedReason: null,
    });
    const again = await client(admin.token)
      .post(reactivateUrl(target.user.id))
      .send({ password: DEFAULT_PASSWORD });
    expect(again.status).toBe(409);
  });
});

describe('the publish worker refuses posts of a suspended author', () => {
  let admin;
  let team;
  let ws;
  let pages;
  let sends;

  beforeEach(async () => {
    admin = await platformAdmin();
    team = await seedTeam();
    ws = team.workspace.id;
    pages = (await seedSocialAccounts(ws, team.owner.user.id, { pages: 2, instagram: 0 })).accounts;
    await giveTokens(pages);
    setPublishingSettingsForTests({
      mode: 'SIMULATED',
      maxAttempts: 3,
      retryBaseMs: 30_000,
      retryMaxMs: 900_000,
    });
    sends = 0;
    setSimulatedBehaviourForTests(() => {
      sends += 1;
    });
  });

  /** The editor (with access to the first Page) schedules a post to it, an hour from now. */
  async function editorSchedules() {
    await Membership.updateOne(
      { _id: team.editor.membershipId },
      { $set: { accountAccess: { mode: 'SELECTED', socialAccounts: [pages[0]._id] } } },
    );
    const draft = await createDraft(team.editor.token, ws, { accounts: [pages[0]] });
    const scheduledAt = new Date(Date.now() + 60 * 60_000);
    const res = await publish(team.editor.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(res.status).toBe(201);
    return {
      jobId: res.body.publishJob.id,
      id: res.body.publishJob.destinations[0].id,
      at: new Date(scheduledAt.getTime() + 1000),
    };
  }

  it('fails the delivery when its time comes: nothing sent, nothing retried, logged without the reason', async () => {
    const { jobId, id, at } = await editorSchedules();
    const preview = await client(admin.token).get(adminUrl(`/users/${team.editor.user.id}`));
    expect(preview.body.impact.waitingPosts).toEqual({
      posts: 1,
      deliveries: 1,
      realDeliveries: 0,
      sendingNow: 0,
    });
    expect((await suspend(admin.token, team.editor.user.id)).status).toBe(200);
    const pendingBefore = queue.pending().length;

    expect(await processDestination(id, { now: at })).toBe('failed');
    expect(sends).toBe(0);
    const stored = await PublishDestination.findById(id).lean();
    expect(stored.state).toBe('FAILED');
    expect(stored.error).toMatchObject({ code: 'AUTHOR_NOT_AUTHORIZED', retryable: false });
    expect(stored.error.message).toBe(
      'The account of the person who scheduled this post is suspended, so it was not sent.',
    );
    expect(stored.sendingAt).toBeUndefined();
    expect(queue.pending().length).toBe(pendingBefore);
    expect(await recoverPublishing({ now: new Date(at.getTime() + 60 * 60_000) })).toMatchObject({
      interrupted: 0,
      restarted: 0,
    });
    expect((await PublishJob.findById(jobId)).status).toBe('FAILED');
    const [entry] = await ActivityLog.find({
      workspace: ws,
      action: 'publish_destination.blocked',
    }).lean();
    expect(entry.metadata).toMatchObject({ reason: 'AUTHOR_SUSPENDED', simulated: true });
    // Members never see why or by whom the account was suspended.
    const view = (await as(team.owner.token).get(publishUrl(ws, `/${jobId}`))).body.publishJob;
    expect(view.destinations[0].error.uncertain).toBe(false);
    expect(JSON.stringify([view, entry])).not.toContain(REASON);
    expect(JSON.stringify([view, entry])).not.toContain('Petra Platform');
  });

  it('sends as planned when the account is reactivated before the post’s time', async () => {
    const { id, at } = await editorSchedules();
    await suspend(admin.token, team.editor.user.id);
    await reactivate(admin.token, team.editor.user.id);
    expect(await processDestination(id, { now: at })).toBe('published');
    expect(sends).toBe(1);
  });

  it('a teammate can retry a refused post, which then relies on the teammate', async () => {
    const { jobId, id, at } = await editorSchedules();
    await suspend(admin.token, team.editor.user.id);
    expect(await processDestination(id, { now: at })).toBe('failed');
    const retry = await as(team.admin.token)
      .post(publishUrl(ws, `/${jobId}/destinations/${id}/retry`))
      .send({});
    expect(retry.status).toBe(200);
    expect(String((await PublishDestination.findById(id)).authorizedBy)).toBe(team.admin.user.id);
    expect(await processDestination(id)).toBe('published');
    expect(sends).toBe(1);
  });

  it('a post another member rescheduled relies on that member and still goes out', async () => {
    const { jobId, id } = await editorSchedules();
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    const moved = await as(team.owner.token)
      .patch(publishUrl(ws, `/${jobId}/schedule`))
      .send({ scheduledAt: later.toISOString() });
    expect(moved.status).toBe(200);
    await suspend(admin.token, team.editor.user.id);
    expect(await processDestination(id, { now: new Date(later.getTime() + 1000) })).toBe(
      'published',
    );
    expect(sends).toBe(1);
  });

  it('never calls Meta for a real post whose author was suspended', async () => {
    const calls = [];
    setMetaTransportForTests(async (url, init) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return new Response(JSON.stringify({ id: '101' }), { status: 200 });
    });
    setPublishingSettingsForTests({
      mode: 'LIVE',
      maxAttempts: 3,
      retryBaseMs: 30_000,
      retryMaxMs: 900_000,
    });
    await Workspace.updateOne({ _id: ws }, { $set: { publishingMode: 'LIVE' } });
    const draft = await createDraft(team.owner.token, ws, { accounts: [pages[0]] });
    const scheduledAt = new Date(Date.now() + 60 * 60_000);
    const res = await publish(team.owner.token, ws, {
      contentPackageId: draft.id,
      scheduledAt: scheduledAt.toISOString(),
      confirmRealPost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.publishJob).toMatchObject({ mode: 'LIVE', simulated: false });
    const preview = await client(admin.token).get(adminUrl(`/users/${team.owner.user.id}`));
    expect(preview.body.impact.waitingPosts).toMatchObject({ deliveries: 1, realDeliveries: 1 });

    expect((await suspend(admin.token, team.owner.user.id)).status).toBe(200);
    const [destination] = res.body.publishJob.destinations;
    expect(
      await processDestination(destination.id, { now: new Date(scheduledAt.getTime() + 1000) }),
    ).toBe('failed');
    expect(calls).toHaveLength(0);
    const stored = await PublishDestination.findById(destination.id).lean();
    expect(stored).toMatchObject({ state: 'FAILED', simulated: false });
    expect(stored.error.code).toBe('AUTHOR_NOT_AUTHORIZED');
    expect(stored.externalPostId).toBeUndefined();
  });
});
