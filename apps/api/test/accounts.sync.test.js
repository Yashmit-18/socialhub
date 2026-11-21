// Simulated Meta integration tests: Meta is replaced by test/fakeMeta.js (no real Meta API calls). Records are controlled test data.
/**
 * Synchronization, status handling and disconnection of social logins, end to end through the
 * HTTP API: manual and bulk sync, sync history, expired / revoked tokens, removed permissions
 * and Page roles, transient Meta failures and rate limits, the per-login sync lock, the
 * "Meta not configured" state, destination refresh, disconnect / removal and the
 * CREATE_CONTENT + publishing-permission eligibility of destinations.
 *
 * Failures FakeMeta does not model are injected in front of it with setMetaTransportForTests;
 * every Meta request still ends at the simulator (or at an injected failure), never at Meta.
 */
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';
import { setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import { ActivityLog, SocialAccount, SocialConnection, SyncRun } from '../src/models/index.js';
import { STATUS_REASONS } from '../src/modules/meta/connectionHealth.js';
import { ALL_FB_SCOPES, FB_APP_SECRET, FULL_PAGE_TASKS, FakeMeta } from './fakeMeta.js';
import { api, as, createWorkspace, registerUser, seedTeam, uniqueEmail } from './helpers.js';
import {
  connectFacebook,
  connectInstagram,
  insta,
  page,
  selectAccounts,
  signedRequest,
} from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  setMetaSettingsForTests(); // back to the configured test Meta apps
  fake.uninstall();
});

/* ----------------------------------------------------------------------- fixtures */

const newId = () => new mongoose.Types.ObjectId().toString();
const keyBy = (items, key) => Object.fromEntries(items.map((item) => [item[key], item]));
const codes = (attention) => attention.map((entry) => entry.code);
const TOKEN_PATTERN = /fb_long_|ig_long_|pagetoken_|ciphertext|accessToken/;

async function ownerWorkspace() {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
  return { owner, workspace };
}

/**
 * Registers a Facebook identity in the simulator, connects it through the real OAuth flow and
 * adds every Page it manages (plus Page-linked Instagram accounts). Returns the connection id.
 */
async function addFacebookLogin(ctx, { pages = [], ...identity }) {
  fake.addFacebookUser({ ...identity, pages });
  const { connectionId } = await connectFacebook(
    fake,
    ctx.owner.token,
    ctx.workspace.id,
    identity.id,
  );
  if (!connectionId) throw new Error(`Connecting Facebook identity ${identity.id} failed`);
  const selection = pages.flatMap((p) =>
    p.instagram ? [page(p.id), insta(p.instagram.id)] : [page(p.id)],
  );
  if (selection.length > 0) {
    const res = await selectAccounts(ctx.owner.token, ctx.workspace.id, connectionId, selection);
    if (res.status !== 200 || res.body.added.length !== selection.length) {
      throw new Error(`Adding accounts failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
  return connectionId;
}

/** The login most tests use: Alice (Facebook user 100) with `pages` (one Page by default). */
const addAlice = (ctx, pages = [{ id: '5001' }]) =>
  addFacebookLogin(ctx, { id: '100', name: 'Alice', pages });

/**
 * Registers an Instagram Login identity in the simulator, connects it and adds its professional
 * account (exactly one per login). Returns the connection id.
 */
async function addInstagramLogin(ctx, identity) {
  fake.addInstagramUser(identity);
  const { connectionId } = await connectInstagram(
    fake,
    ctx.owner.token,
    ctx.workspace.id,
    identity.id,
  );
  if (!connectionId) throw new Error(`Connecting Instagram identity ${identity.id} failed`);
  const res = await selectAccounts(ctx.owner.token, ctx.workspace.id, connectionId, [
    insta(identity.accountId),
  ]);
  if (res.status !== 200 || res.body.added.length !== 1) {
    throw new Error(`Adding the Instagram account failed: ${res.status}`);
  }
  return connectionId;
}

async function accountIdOf(externalId) {
  const account = await SocialAccount.findOne({ externalId }).select('_id');
  return String(account._id);
}

const storedConnection = (connectionId) => SocialConnection.findById(connectionId).lean();
/** Sync history of one login as stored, oldest first. */
const runsOf = (connectionId) => SyncRun.find({ connection: connectionId }).sort({ _id: 1 }).lean();

/** The workspace API as one member uses it. */
function workspaceApi(token, workspaceId) {
  const http = as(token);
  const base = `/api/v1/workspaces/${workspaceId}`;
  const logins = `${base}/social-connections`;
  const destinations = `${base}/social-accounts`;
  return {
    sync: (id) => http.post(`${logins}/${id}/sync`),
    syncAll: (body = {}) => http.post(`${logins}/sync`).send(body),
    syncRuns: (id, query = {}) => http.get(`${logins}/${id}/sync-runs`).query(query),
    connections: () => http.get(logins),
    connection: (id) => http.get(`${logins}/${id}`),
    discovery: (id) => http.get(`${logins}/${id}/discovery`),
    disconnect: (id) => http.post(`${logins}/${id}/disconnect`),
    removeConnection: (id) => http.delete(`${logins}/${id}`),
    accounts: (query = {}) => http.get(destinations).query(query),
    summary: () => http.get(`${destinations}/summary`),
    account: (id) => http.get(`${destinations}/${id}`),
    refresh: (accountIds) => http.post(`${destinations}/refresh`).send({ accountIds }),
    refreshOne: (id) => http.post(`${destinations}/${id}/refresh`),
    remove: (accountIds) => http.post(`${destinations}/remove`).send({ accountIds }),
    removeOne: (id) => http.delete(`${destinations}/${id}`),
    setAccess: (membershipId, socialAccountIds) =>
      http
        .put(`${base}/members/${membershipId}/account-access`)
        .send({ mode: 'SELECTED', socialAccountIds }),
    members: () => http.get(`${base}/members`),
    invite: (body) => http.post(`${base}/invitations`).send(body),
    invitations: () => http.get(`${base}/invitations`),
  };
}

/** Destinations as the API lists them, keyed by their Meta id. */
async function listedByExternalId(ws) {
  const res = await ws.accounts();
  expect(res.status).toBe(200);
  return keyBy(res.body.items, 'externalId');
}

/* ---------------------------------------------------------- injected Meta failures */

const SIMULATED_TRACE = 'SIMULATED_TRACE';

/** A Graph API error response, shaped as Meta sends it. */
const graphErrorResponse = (status, code, message) =>
  new Response(
    JSON.stringify({
      error: { message, type: 'OAuthException', code, fbtrace_id: SIMULATED_TRACE },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
/** HTTP 500 / code 2: a temporary Meta failure (retryable). */
const transientError = () =>
  graphErrorResponse(500, 2, 'An unexpected error has occurred. Please retry your request later.');
const networkError = () => {
  throw new TypeError('fetch failed');
};

/**
 * Puts a failure injector in front of the simulator. `inject(attempt)` may return a Response
 * (or throw, like a network failure) to replace Meta's answer, or nothing to let the simulator
 * answer. Every attempt is recorded, including injected failures the simulator never sees.
 */
function interceptMeta(inject) {
  const attempts = [];
  setMetaTransportForTests(async (url, init = {}) => {
    const target = new URL(url);
    const attempt = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: target.pathname.replace(/^\/v\d+\.\d+/, ''),
      params: target.searchParams,
    };
    attempts.push(attempt);
    return (await inject(attempt)) ?? fake.handle(url, init);
  });
  return attempts;
}

/** Fails the first `times` attempts with `failure`, then lets the simulator answer. */
function failTimes(times, failure) {
  let left = times;
  return () => {
    if (left <= 0) return undefined;
    left -= 1;
    return failure();
  };
}

const attemptLines = (attempts) => attempts.map((a) => `${a.method} ${a.path}`);
const usesToken = (attempt, token) =>
  attempt.params.get('access_token') === token || attempt.params.get('input_token') === token;

/** Holds the first Meta request matching `match` until `release()`; `reached` resolves on arrival. */
function holdMeta(match) {
  let release;
  let arrived;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const reached = new Promise((resolve) => {
    arrived = resolve;
  });
  let held = false;
  setMetaTransportForTests(async (url, init = {}) => {
    if (!held && match(new URL(url))) {
      held = true;
      arrived();
      await gate;
    }
    return fake.handle(url, init);
  });
  return { reached, release };
}

/* --------------------------------------------------------------------- manual sync */

describe('manual sync (simulated Meta)', () => {
  it('records a successful sync: timestamps, a MANUAL history entry and the audit log', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001', name: 'Acme Store' },
      { id: '5002', name: 'Acme Labs' },
    ]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    // Connecting a login and adding its Pages is not a synchronization.
    expect(await SyncRun.countDocuments()).toBe(0);

    fake.pages.get('5001').name = 'Acme Store Online';
    const startedAt = Date.now();
    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'SUCCESS',
      statusChanged: false,
      accounts: { refreshed: 2, lost: 0 },
      connection: {
        id: alice,
        status: 'ACTIVE',
        lastSyncOutcome: 'SUCCESS',
        lastError: null,
        syncInProgress: false,
        attention: [],
      },
    });
    const { lastSyncedAt, lastSyncAttemptAt } = res.body.connection;
    expect(Date.parse(lastSyncedAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(lastSyncAttemptAt)).toBeGreaterThanOrEqual(Date.parse(lastSyncedAt));
    expect(JSON.stringify(res.body)).not.toMatch(TOKEN_PATTERN);

    const stored = await storedConnection(alice);
    expect(stored.lastSyncedAt.toISOString()).toBe(lastSyncedAt);
    expect(stored.lastSyncAttemptAt.toISOString()).toBe(lastSyncAttemptAt);
    expect(stored.lastSyncOutcome).toBe('SUCCESS');
    expect(stored.syncLockedUntil).toBeUndefined();
    expect((await SocialAccount.findOne({ externalId: '5001' })).name).toBe('Acme Store Online');

    const runs = await runsOf(alice);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'MANUAL',
      actorName: 'Olivia Owner',
      outcome: 'SUCCESS',
      statusBefore: 'ACTIVE',
      statusAfter: 'ACTIVE',
      accounts: { refreshed: 2, lost: 0 },
    });
    expect(String(runs[0].actor)).toBe(ctx.owner.user.id);
    expect(String(runs[0].workspace)).toBe(ctx.workspace.id);
    expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(runs[0].durationMs).toBe(runs[0].finishedAt - runs[0].startedAt);
    expect(runs[0].error).toBeUndefined();

    const log = await ActivityLog.findOne({
      workspace: ctx.workspace.id,
      action: 'social_connection.synced',
    }).lean();
    expect(log).toMatchObject({
      actorName: 'Olivia Owner',
      target: { type: 'social_connection', label: 'Alice' },
      metadata: { refreshed: 2, lost: 0, from: 'ACTIVE', to: 'ACTIVE' },
    });
    expect(String(log.target.id)).toBe(alice);

    const [listed] = (await ws.connections()).body.items;
    expect(listed).toMatchObject({
      id: alice,
      lastSyncedAt,
      lastSyncAttemptAt,
      lastSyncOutcome: 'SUCCESS',
      syncInProgress: false,
    });
  });

  it('lists the sync history newest first with cursor pagination', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    for (let i = 0; i < 3; i += 1) expect((await ws.sync(alice)).status).toBe(200);
    const newestFirst = (await runsOf(alice)).map((run) => String(run._id)).reverse();

    const first = await ws.syncRuns(alice, { limit: 1 });
    expect(first.status).toBe(200);
    expect(first.body.items).toEqual([
      expect.objectContaining({
        id: newestFirst[0],
        connection: alice,
        trigger: 'MANUAL',
        actorName: 'Olivia Owner',
        outcome: 'SUCCESS',
        statusBefore: 'ACTIVE',
        statusAfter: 'ACTIVE',
        accounts: { refreshed: 1, lost: 0 },
        durationMs: expect.any(Number),
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
      }),
    ]);
    expect(first.body.nextCursor).toBe(newestFirst[0]);

    const second = await ws.syncRuns(alice, { limit: 1, cursor: first.body.nextCursor });
    expect(second.body.items.map((run) => run.id)).toEqual([newestFirst[1]]);
    expect(second.body.nextCursor).toBe(newestFirst[1]);

    const last = await ws.syncRuns(alice, { limit: 1, cursor: second.body.nextCursor });
    expect(last.body.items.map((run) => run.id)).toEqual([newestFirst[2]]);
    expect(last.body.nextCursor).toBeNull();

    const all = await ws.syncRuns(alice);
    expect(all.body.items.map((run) => run.id)).toEqual(newestFirst);
    expect(all.body.nextCursor).toBeNull();
    expect(JSON.stringify(all.body)).not.toMatch(TOKEN_PATTERN);

    expect((await ws.syncRuns(alice, { cursor: 'not-a-cursor' })).status).toBe(422);
    expect((await ws.syncRuns(alice, { limit: 0 })).status).toBe(422);
    expect((await ws.syncRuns(newId())).status).toBe(404);
  });

  it('is limited to owners and admins', async () => {
    const ctx = await seedTeam();
    const alice = await addAlice(ctx);
    for (const member of [ctx.editor, ctx.viewer]) {
      const ws = workspaceApi(member.token, ctx.workspace.id);
      expect((await ws.sync(alice)).status).toBe(403);
      expect((await ws.syncAll()).status).toBe(403);
      expect((await ws.syncRuns(alice)).status).toBe(403);
    }
    expect(await SyncRun.countDocuments()).toBe(0);

    const admin = workspaceApi(ctx.admin.token, ctx.workspace.id);
    expect((await admin.sync(alice)).body.outcome).toBe('SUCCESS');
    expect((await admin.syncRuns(alice)).body.items.map((run) => run.actorName)).toEqual([
      'Adam Admin',
    ]);
  });
});

/* ------------------------------------------------------------------------ sync all */

describe('sync all logins (simulated Meta)', () => {
  async function twoLogins() {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001', name: 'Alice Page' }]);
    const bob = await addFacebookLogin(ctx, {
      id: '200',
      name: 'Bob',
      pages: [{ id: '5002', name: 'Bob Page' }],
    });
    return { ctx, alice, bob, ws: workspaceApi(ctx.owner.token, ctx.workspace.id) };
  }

  it('reports every login; an expired one does not stop the healthy one', async () => {
    const { alice, bob, ws } = await twoLogins();
    const aliceBefore = await storedConnection(alice);
    fake.setTokenState('100', 'expired');
    fake.pages.get('5002').name = 'Bob Bakery';
    const startedAt = Date.now();

    const res = await ws.syncAll();

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    const results = keyBy(res.body.results, 'connectionId');
    expect(results[alice]).toEqual({
      connectionId: alice,
      displayName: 'Alice',
      provider: 'FACEBOOK_LOGIN',
      outcome: 'TOKEN_EXPIRED',
      status: 'EXPIRED',
      accounts: { refreshed: 0, lost: 0 },
      message: STATUS_REASONS.TOKEN_EXPIRED,
    });
    expect(results[bob]).toEqual({
      connectionId: bob,
      displayName: 'Bob',
      provider: 'FACEBOOK_LOGIN',
      outcome: 'SUCCESS',
      status: 'ACTIVE',
      accounts: { refreshed: 1, lost: 0 },
      message: null,
    });
    expect(res.body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });

    // The healthy login was synchronized...
    const bobAfter = await storedConnection(bob);
    expect(bobAfter.lastSyncOutcome).toBe('SUCCESS');
    expect(bobAfter.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect((await SocialAccount.findOne({ externalId: '5002' })).name).toBe('Bob Bakery');
    // ...and the expired one was marked, keeping its last successful sync time.
    const aliceAfter = await storedConnection(alice);
    expect(aliceAfter).toMatchObject({ status: 'EXPIRED', lastSyncOutcome: 'TOKEN_EXPIRED' });
    expect(aliceAfter.lastSyncedAt).toEqual(aliceBefore.lastSyncedAt);
    // One BULK history entry per login.
    expect((await runsOf(alice)).map((run) => [run.trigger, run.outcome])).toEqual([
      ['BULK', 'TOKEN_EXPIRED'],
    ]);
    expect((await runsOf(bob)).map((run) => [run.trigger, run.outcome])).toEqual([
      ['BULK', 'SUCCESS'],
    ]);
  });

  it('syncs only the requested logins and rejects unknown ones before syncing anything', async () => {
    const { ctx, alice, bob, ws } = await twoLogins();
    const served = fake.calls.length;

    const subset = await ws.syncAll({ connectionIds: [bob] });
    expect(subset.status).toBe(200);
    expect(subset.body.results.map((r) => [r.connectionId, r.outcome])).toEqual([[bob, 'SUCCESS']]);
    expect(subset.body.summary).toEqual({ total: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);
    expect((await storedConnection(alice)).lastSyncAttemptAt).toBeUndefined();
    expect(
      fake.calls.slice(served).filter((call) => call.path.endsWith('/debug_token')),
    ).toHaveLength(1);

    // A login of another workspace is as unknown as a made-up id; the request is all-or-nothing.
    const other = await createWorkspace(ctx.owner.token, { name: 'Brand Two' });
    fake.addFacebookUser({ id: '300', name: 'Carol', pages: [{ id: '7001' }] });
    const { connectionId: elsewhere } = await connectFacebook(
      fake,
      ctx.owner.token,
      other.workspace.id,
      '300',
    );
    const runsBefore = await SyncRun.countDocuments();
    const callsBefore = fake.calls.length;
    for (const unknown of [newId(), elsewhere]) {
      const res = await ws.syncAll({ connectionIds: [bob, unknown] });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(await SyncRun.countDocuments()).toBe(runsBefore);
    expect(fake.calls.length).toBe(callsBefore);

    expect((await ws.syncAll({ connectionIds: [] })).status).toBe(422);
    expect((await ws.syncAll({ connectionIds: ['not-an-id'] })).status).toBe(422);
  });

  it('skips a disconnected login (NEEDS_RECONNECT) without contacting Meta', async () => {
    const { alice, bob, ws } = await twoLogins();
    expect((await ws.disconnect(alice)).status).toBe(200);
    const served = fake.calls.length;

    const only = await ws.syncAll({ connectionIds: [alice] });

    expect(only.status).toBe(200);
    expect(only.body).toEqual({
      results: [
        {
          connectionId: alice,
          displayName: 'Alice',
          provider: 'FACEBOOK_LOGIN',
          skipReason: 'NEEDS_RECONNECT',
          status: 'DISCONNECTED',
          accounts: { refreshed: 0, lost: 0 },
          message: STATUS_REASONS.DISCONNECTED,
        },
      ],
      summary: { total: 1, succeeded: 0, failed: 0, skipped: 1 },
    });
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);

    const all = await ws.syncAll();
    const results = keyBy(all.body.results, 'connectionId');
    expect(results[alice]).toMatchObject({ skipReason: 'NEEDS_RECONNECT' });
    expect(results[alice]).not.toHaveProperty('outcome');
    expect(results[bob]).toMatchObject({ outcome: 'SUCCESS' });
    expect(all.body.summary).toEqual({ total: 2, succeeded: 1, failed: 0, skipped: 1 });
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);
  });

  it('reports a Meta outage on one login and still syncs the others', async () => {
    const { alice, bob, ws } = await twoLogins();
    const aliceToken = (
      await SocialConnection.findById(alice).select('+accessToken')
    ).getAccessToken();
    const attempts = interceptMeta((attempt) =>
      usesToken(attempt, aliceToken) ? transientError() : undefined,
    );

    const res = await ws.syncAll();

    expect(res.status).toBe(200);
    const results = keyBy(res.body.results, 'connectionId');
    expect(results[alice]).toEqual({
      connectionId: alice,
      displayName: 'Alice',
      provider: 'FACEBOOK_LOGIN',
      outcome: 'TRANSIENT_FAILURE',
      status: 'ACTIVE',
      accounts: { refreshed: 0, lost: 0 },
      message: expect.stringMatching(/try again/i),
    });
    expect(results[bob]).toMatchObject({ outcome: 'SUCCESS', status: 'ACTIVE' });
    expect(res.body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });
    // Alice's first request was retried once and then given up.
    expect(attemptLines(attempts.filter((a) => usesToken(a, aliceToken)))).toEqual([
      'GET /debug_token',
      'GET /debug_token',
    ]);
    expect((await runsOf(alice)).map((run) => run.outcome)).toEqual(['TRANSIENT_FAILURE']);
    expect((await storedConnection(alice)).status).toBe('ACTIVE');
  });
});

/* ------------------------------------------------------------------ expired tokens */

describe('expired tokens (simulated Meta)', () => {
  it('marks the login and its destinations expired, records TOKEN_EXPIRED and keeps the last successful sync time', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001', name: 'Acme Store' },
      {
        id: '5002',
        name: 'Acme Careers',
        instagram: { id: '17841400000000010', username: 'acme' },
      },
    ]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const before = await storedConnection(alice);
    const destinationsBefore = await SocialAccount.find({ connection: alice })
      .sort({ _id: 1 })
      .lean();
    fake.setTokenState('100', 'expired');

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'TOKEN_EXPIRED',
      statusChanged: true,
      accounts: { refreshed: 0, lost: 0 },
      connection: {
        status: 'EXPIRED',
        statusReason: STATUS_REASONS.TOKEN_EXPIRED,
        lastSyncOutcome: 'TOKEN_EXPIRED',
        lastError: { code: 'TOKEN_EXPIRED' },
        attention: [{ code: 'CONNECTION_EXPIRED', message: STATUS_REASONS.TOKEN_EXPIRED }],
        needsAttention: true,
      },
    });
    expect(res.body.connection.lastSyncedAt).toBe(before.lastSyncedAt.toISOString());
    expect(Date.parse(res.body.connection.lastSyncAttemptAt)).toBeGreaterThan(
      before.lastSyncedAt.getTime(),
    );

    const { items } = (await ws.accounts()).body;
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.connection.status).toBe('EXPIRED');
      expect(item.health).toMatchObject({
        connectionStatus: 'EXPIRED',
        connectionStatusReason: STATUS_REASONS.TOKEN_EXPIRED,
        readiness: 'UNAVAILABLE',
        readinessReasons: [STATUS_REASONS.TOKEN_EXPIRED],
        attention: [{ code: 'CONNECTION_EXPIRED', message: STATUS_REASONS.TOKEN_EXPIRED }],
        needsAttention: true,
      });
    }
    // The destinations were not refreshed either.
    const destinationsAfter = await SocialAccount.find({ connection: alice })
      .sort({ _id: 1 })
      .lean();
    expect(destinationsAfter.map((a) => a.lastSyncedAt)).toEqual(
      destinationsBefore.map((a) => a.lastSyncedAt),
    );

    expect((await runsOf(alice))[0]).toMatchObject({
      trigger: 'MANUAL',
      outcome: 'TOKEN_EXPIRED',
      statusBefore: 'ACTIVE',
      statusAfter: 'EXPIRED',
      accounts: { refreshed: 0, lost: 0 },
      error: { kind: 'TOKEN_EXPIRED', code: 190, subcode: 463 },
    });
    // Audited as a status change, never as a completed sync.
    expect(
      await ActivityLog.exists({
        action: 'social_connection.status_changed',
        'metadata.from': 'ACTIVE',
        'metadata.to': 'EXPIRED',
      }),
    ).toBeTruthy();
    expect(await ActivityLog.exists({ action: 'social_connection.synced' })).toBeNull();

    const summary = (await ws.summary()).body;
    expect(summary.accounts).toMatchObject({
      total: 3,
      connected: 0,
      ready: 0,
      unavailable: 3,
      needsAttention: 3,
    });
    expect(summary.connections).toMatchObject({
      total: 1,
      active: 0,
      expired: 1,
      needsAttention: 1,
    });
    // Using the login now requires reconnecting.
    expect((await ws.discovery(alice)).body.error.code).toBe('META_RECONNECT_REQUIRED');
  });

  it('treats a token past its expiry date as expired when read, without contacting Meta', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    await SocialConnection.updateOne(
      { _id: alice },
      { tokenExpiresAt: new Date(Date.now() - 60_000) },
    );
    const served = fake.calls.length;

    const listed = (await ws.accounts()).body;
    expect(listed.items).toHaveLength(2);
    for (const item of listed.items) {
      expect(item.health).toMatchObject({
        connectionStatus: 'EXPIRED',
        connectionStatusReason: STATUS_REASONS.TOKEN_EXPIRED,
        readiness: 'UNAVAILABLE',
        attention: [{ code: 'CONNECTION_EXPIRED', message: STATUS_REASONS.TOKEN_EXPIRED }],
      });
    }
    expect(listed.facets).toMatchObject({
      status: { EXPIRED: 2 },
      readiness: { UNAVAILABLE: 2 },
      attention: 2,
    });
    expect((await ws.accounts({ readiness: 'READY' })).body.total).toBe(0);
    expect((await ws.accounts({ status: 'EXPIRED' })).body.total).toBe(2);

    const [login] = (await ws.connections()).body.items;
    expect(login).toMatchObject({
      status: 'EXPIRED',
      statusReason: STATUS_REASONS.TOKEN_EXPIRED,
      attention: [{ code: 'CONNECTION_EXPIRED', message: STATUS_REASONS.TOKEN_EXPIRED }],
      needsAttention: true,
    });
    const detail = (await ws.account(await accountIdOf('5001'))).body;
    expect(detail.connection.status).toBe('EXPIRED');
    expect(detail.account.health.readiness).toBe('UNAVAILABLE');
    expect((await ws.summary()).body.connections).toMatchObject({ active: 0, expired: 1 });

    // Computed from the stored expiry date: nothing was sent to Meta, recorded or rewritten.
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments()).toBe(0);
    expect((await storedConnection(alice)).status).toBe('ACTIVE');
    expect(await SocialAccount.countDocuments({ connectionStatus: { $ne: 'ACTIVE' } })).toBe(0);
  });

  it('reports statusChanged only when the status really changed', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setTokenState('100', 'expired');
    expect((await ws.sync(alice)).body).toMatchObject({
      outcome: 'TOKEN_EXPIRED',
      statusChanged: true,
    });

    const again = await ws.sync(alice);

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      outcome: 'TOKEN_EXPIRED',
      connection: { status: 'EXPIRED' },
    });
    // Only the first sync changed the status (and only that change was audited)...
    expect(await ActivityLog.countDocuments({ action: 'social_connection.status_changed' })).toBe(
      1,
    );
    // ...so the second response must not claim a change.
    expect(again.body.statusChanged).toBe(false);
  });
});

/* ------------------------------------------------------------------ revoked access */

describe('revoked access (simulated Meta)', () => {
  it('marks a Facebook login and its destinations REVOKED when Meta reports the authorization was removed', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const before = await storedConnection(alice);
    fake.setTokenState('100', 'revoked');

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'TOKEN_REVOKED',
      statusChanged: true,
      accounts: { refreshed: 0, lost: 0 },
      connection: {
        status: 'REVOKED',
        statusReason: STATUS_REASONS.REVOKED,
        lastSyncOutcome: 'TOKEN_REVOKED',
        lastError: { code: 'TOKEN_REVOKED' },
        attention: [{ code: 'CONNECTION_REVOKED', message: STATUS_REASONS.REVOKED }],
      },
    });
    expect(res.body.connection.lastSyncedAt).toBe(before.lastSyncedAt.toISOString());
    for (const item of (await ws.accounts()).body.items) {
      expect(item.health).toMatchObject({
        connectionStatus: 'REVOKED',
        readiness: 'UNAVAILABLE',
        attention: [{ code: 'CONNECTION_REVOKED', message: STATUS_REASONS.REVOKED }],
        needsAttention: true,
      });
    }
    const stored = await SocialAccount.find({ connection: alice }).lean();
    expect(stored.map((a) => [a.connectionStatus, a.publishingStatus])).toEqual([
      ['REVOKED', 'UNAVAILABLE'],
      ['REVOKED', 'UNAVAILABLE'],
    ]);
    expect((await runsOf(alice))[0]).toMatchObject({
      outcome: 'TOKEN_REVOKED',
      statusAfter: 'REVOKED',
      error: { kind: 'TOKEN_REVOKED', code: 190, subcode: 458 },
    });
    expect((await ws.summary()).body.connections).toMatchObject({ active: 0, revoked: 1 });
  });

  it('marks an Instagram Login REVOKED as well', async () => {
    const ctx = await ownerWorkspace();
    const studio = await addInstagramLogin(ctx, {
      id: '9001',
      accountId: '17841400000000001',
      username: 'acme.studio',
    });
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setTokenState('9001', 'revoked');

    const res = await ws.sync(studio);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'TOKEN_REVOKED',
      connection: { provider: 'INSTAGRAM_LOGIN', status: 'REVOKED' },
    });
    const [item] = (await ws.accounts()).body.items;
    expect(item.health).toMatchObject({
      connectionStatus: 'REVOKED',
      readiness: 'UNAVAILABLE',
      attention: [{ code: 'CONNECTION_REVOKED', message: STATUS_REASONS.REVOKED }],
    });
    expect((await runsOf(studio))[0]).toMatchObject({
      outcome: 'TOKEN_REVOKED',
      error: { kind: 'TOKEN_REVOKED', code: 190, subcode: 458 },
    });
  });

  it('asks to reconnect a login the person removed at Meta, giving that reason', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const callback = await api()
      .post('/api/v1/meta/facebook/deauthorize')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: '100' }, FB_APP_SECRET) });
    expect(callback.status).toBe(200);
    const [login] = (await ws.connections()).body.items;
    expect(login).toMatchObject({
      status: 'REVOKED',
      statusReason: STATUS_REASONS.REMOVED_BY_PERSON,
    });
    const served = fake.calls.length;

    const bulk = await ws.syncAll();
    const single = await ws.sync(alice);

    // The token was erased when Meta reported the removal: there is nothing to send to Meta.
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments()).toBe(0);
    expect(bulk.body.results).toEqual([
      expect.objectContaining({
        connectionId: alice,
        skipReason: 'NEEDS_RECONNECT',
        status: 'REVOKED',
      }),
    ]);
    expect(single.status).toBe(409);
    expect(single.body.error.code).toBe('META_RECONNECT_REQUIRED');
    // The explanation must match the login's real state, not claim a manager disconnected it.
    expect(bulk.body.results[0].message).toBe(login.statusReason);
    expect(single.body.error.message).toBe(login.statusReason);
  });
});

/* -------------------------------------------------- removed permissions and roles */

describe('removed permissions and Page roles (simulated Meta)', () => {
  it('turns a permission Meta denies during sync into a login ERROR (200, not 502)', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    // The person removed pages_show_list in Facebook: Meta now refuses /me/accounts with (#200).
    fake.setPermissions('100', {
      granted: ALL_FB_SCOPES.filter((scope) => scope !== 'pages_show_list'),
      declined: ['pages_show_list'],
    });

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'PERMISSION_DENIED',
      statusChanged: true,
      accounts: { refreshed: 0, lost: 0 },
      connection: {
        status: 'ERROR',
        statusReason: expect.stringMatching(/required permission was removed/),
        declinedScopes: ['pages_show_list'],
        missingScopes: { required: ['pages_show_list'] },
        lastSyncOutcome: 'PERMISSION_DENIED',
        lastError: { code: 'PERMISSION_DENIED' },
      },
    });
    const reason = res.body.connection.statusReason;
    expect(res.body.connection.attention).toEqual([{ code: 'CONNECTION_ERROR', message: reason }]);

    for (const item of (await ws.accounts()).body.items) {
      expect(item.health).toMatchObject({
        connectionStatus: 'ERROR',
        connectionStatusReason: reason,
        readiness: 'UNAVAILABLE',
        readinessReasons: [reason],
        attention: [{ code: 'CONNECTION_ERROR', message: reason }],
        needsAttention: true,
      });
    }
    const stored = await SocialAccount.find({ connection: alice }).lean();
    expect(stored.map((a) => [a.connectionStatus, a.publishingStatus])).toEqual([
      ['ERROR', 'UNAVAILABLE'],
      ['ERROR', 'UNAVAILABLE'],
    ]);
    expect((await runsOf(alice))[0]).toMatchObject({
      outcome: 'PERMISSION_DENIED',
      statusBefore: 'ACTIVE',
      statusAfter: 'ERROR',
      error: { kind: 'PERMISSION_DENIED', code: 200 },
    });
    expect(
      await ActivityLog.exists({
        action: 'social_connection.status_changed',
        'metadata.to': 'ERROR',
        'metadata.metaError': 'PERMISSION_DENIED',
      }),
    ).toBeTruthy();
    expect((await ws.summary()).body.connections).toMatchObject({
      active: 0,
      error: 1,
      needsAttention: 1,
    });
    // The destinations cannot be used until the person reconnects and grants the permission.
    const discovery = await ws.discovery(alice);
    expect(discovery.status).toBe(409);
    expect(discovery.body.error.code).toBe('META_RECONNECT_REQUIRED');
  });

  it('handles a (#10) permission error from Meta the same way', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    interceptMeta(({ path }) =>
      path === '/me/accounts'
        ? graphErrorResponse(403, 10, '(#10) Application does not have permission for this action')
        : undefined,
    );

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'PERMISSION_DENIED',
      connection: { status: 'ERROR', lastSyncOutcome: 'PERMISSION_DENIED' },
    });
    expect((await runsOf(alice))[0].error).toMatchObject({
      kind: 'PERMISSION_DENIED',
      code: 10,
      fbtraceId: SIMULATED_TRACE,
    });
    expect((await ws.accounts()).body.items[0].health).toMatchObject({
      connectionStatus: 'ERROR',
      readiness: 'UNAVAILABLE',
    });
  });

  it('flags only the Page whose role was removed (ACCESS_LOST); the others stay READY', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.removePageRole('100', '5002');

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'SUCCESS',
      accounts: { refreshed: 1, lost: 1 },
      connection: { status: 'ACTIVE', attention: [] },
    });
    const listed = await listedByExternalId(ws);
    expect(listed['5002'].health).toMatchObject({
      connectionStatus: 'ERROR',
      connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
      readiness: 'UNAVAILABLE',
      readinessReasons: [STATUS_REASONS.ACCOUNT_LOST],
      attention: [{ code: 'ACCESS_LOST', message: STATUS_REASONS.ACCOUNT_LOST }],
      needsAttention: true,
    });
    expect(listed['5001'].health).toMatchObject({
      connectionStatus: 'ACTIVE',
      readiness: 'READY',
      attention: [],
      needsAttention: false,
    });
    expect((await runsOf(alice))[0].accounts).toEqual({ refreshed: 1, lost: 1 });
    // The login itself is healthy; the lost Page counts among its destinations needing attention.
    const [login] = (await ws.connections()).body.items;
    expect(login).toMatchObject({
      status: 'ACTIVE',
      needsAttention: false,
      accountCounts: { facebookPages: 2, instagramAccounts: 0, needsAttention: 1 },
    });

    // Once the role is given back, the next sync makes the Page usable again.
    fake.grantPage('100', { id: '5002' });
    expect((await ws.sync(alice)).body.accounts).toEqual({ refreshed: 2, lost: 0 });
    expect((await listedByExternalId(ws))['5002'].health).toMatchObject({
      connectionStatus: 'ACTIVE',
      readiness: 'READY',
      attention: [],
    });
  });
});

/* ----------------------------------------------------- transient failures, limits */

describe('transient Meta failures and rate limits (simulated Meta)', () => {
  async function oneLogin() {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001', name: 'Acme Store' }]);
    return { ctx, alice, ws: workspaceApi(ctx.owner.token, ctx.workspace.id) };
  }

  it.each([
    ['an HTTP 500 (code 2) answer', transientError],
    ['a network error', networkError],
  ])('retries a GET once after %s and completes the sync', async (_label, failure) => {
    const { alice, ws } = await oneLogin();
    const attempts = interceptMeta(failTimes(1, failure));
    const served = fake.calls.length;

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 'SUCCESS',
      connection: { status: 'ACTIVE', lastError: null },
    });
    expect(attemptLines(attempts)).toEqual([
      'GET /debug_token',
      'GET /debug_token',
      'GET /me/permissions',
      'GET /me/accounts',
      'GET /5001', // the Page's follower count (accounts.followers.test.js)
    ]);
    // The failed attempt never reached Meta's handler; the retry and the other calls did.
    expect(fake.calls.length - served).toBe(4);
    expect((await runsOf(alice)).map((run) => run.outcome)).toEqual(['SUCCESS']);
  });

  it('gives up after one retry: 502 META_UNAVAILABLE, TRANSIENT_FAILURE recorded, login kept ACTIVE with a SYNC_FAILED warning', async () => {
    const { alice, ws } = await oneLogin();
    const before = await storedConnection(alice);
    const attempts = interceptMeta(transientError);

    const res = await ws.sync(alice);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'META_UNAVAILABLE',
      message: expect.stringMatching(/try again/i),
      details: { meta: { kind: 'TRANSIENT', code: 2, fbtraceId: SIMULATED_TRACE } },
    });
    expect(attemptLines(attempts)).toEqual(['GET /debug_token', 'GET /debug_token']);

    const stored = await storedConnection(alice);
    expect(stored).toMatchObject({
      status: 'ACTIVE',
      lastSyncOutcome: 'TRANSIENT_FAILURE',
      lastError: { code: 'TRANSIENT' },
    });
    expect(stored.lastSyncedAt).toEqual(before.lastSyncedAt);
    expect(stored.syncLockedUntil).toBeUndefined();
    expect((await runsOf(alice))[0]).toMatchObject({
      trigger: 'MANUAL',
      outcome: 'TRANSIENT_FAILURE',
      statusBefore: 'ACTIVE',
      statusAfter: 'ACTIVE',
      accounts: { refreshed: 0, lost: 0 },
      error: { kind: 'TRANSIENT', code: 2, fbtraceId: SIMULATED_TRACE },
    });

    const [login] = (await ws.connections()).body.items;
    expect(login).toMatchObject({
      status: 'ACTIVE',
      lastSyncOutcome: 'TRANSIENT_FAILURE',
      attention: [{ code: 'SYNC_FAILED', message: expect.any(String) }],
      needsAttention: true,
      syncInProgress: false,
    });
    expect(login.lastSyncedAt).toBe(before.lastSyncedAt.toISOString());
    // Readiness describes permissions, which did not change; the failed sync is flagged.
    const [item] = (await ws.accounts()).body.items;
    expect(item.health).toMatchObject({
      connectionStatus: 'ACTIVE',
      readiness: 'READY',
      attention: [{ code: 'SYNC_FAILED', message: login.attention[0].message }],
      needsAttention: true,
    });
    expect((await ws.summary()).body.connections).toMatchObject({ active: 1, needsAttention: 1 });

    // The next successful sync clears the warning.
    fake.install();
    const retried = await ws.sync(alice);
    expect(retried.body).toMatchObject({
      outcome: 'SUCCESS',
      connection: { lastSyncOutcome: 'SUCCESS', lastError: null, attention: [] },
    });
    expect((await ws.accounts()).body.items[0].health.attention).toEqual([]);
  });

  it.each([4, 17, 32, 613])(
    'does not retry a rate limit (code %i): 502 META_UNAVAILABLE, RATE_LIMITED recorded, data untouched',
    async (code) => {
      const { alice, ws } = await oneLogin();
      fake.pages.get('5001').name = 'Renamed at Meta';
      const attempts = interceptMeta(({ path }) =>
        path === '/me/accounts'
          ? graphErrorResponse(400, code, `(#${code}) Request limit reached`)
          : undefined,
      );

      const res = await ws.sync(alice);

      expect(res.status).toBe(502);
      expect(res.body.error).toMatchObject({
        code: 'META_UNAVAILABLE',
        details: { meta: { kind: 'RATE_LIMITED', code } },
      });
      expect(attemptLines(attempts)).toEqual([
        'GET /debug_token',
        'GET /me/permissions',
        'GET /me/accounts',
      ]);
      expect(await storedConnection(alice)).toMatchObject({
        status: 'ACTIVE',
        lastSyncOutcome: 'RATE_LIMITED',
        lastError: { code: 'RATE_LIMITED' },
      });
      expect((await runsOf(alice))[0]).toMatchObject({
        outcome: 'RATE_LIMITED',
        error: { kind: 'RATE_LIMITED', code },
      });
      expect((await SocialAccount.findOne({ externalId: '5001' })).name).toBe('Acme Store');
      expect(codes((await ws.connections()).body.items[0].attention)).toEqual(['SYNC_FAILED']);
    },
  );

  it.each([
    ['an HTTP 500 answer', transientError],
    ['a network error', networkError],
  ])(
    'never retries a DELETE: a revocation failing with %s is attempted once and the disconnect completes',
    async (_label, failure) => {
      const { alice, ws } = await oneLogin();
      const attempts = interceptMeta(({ method }) => (method === 'DELETE' ? failure() : undefined));

      const res = await ws.disconnect(alice);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        connection: { status: 'DISCONNECTED' },
        revokedAtMeta: false,
      });
      expect(attemptLines(attempts)).toEqual(['DELETE /me/permissions']);
      expect(fake.revocations()).toHaveLength(0);
      expect((await SocialConnection.findById(alice).select('+accessToken')).hasAccessToken()).toBe(
        false,
      );
    },
  );
});

/* ------------------------------------------------------------------------ sync lock */

describe('sync lock (simulated Meta)', () => {
  async function oneLogin() {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    return { ctx, alice, ws: workspaceApi(ctx.owner.token, ctx.workspace.id) };
  }

  it('refuses to start while another sync holds the lock, without contacting Meta or releasing that lock', async () => {
    const { alice, ws } = await oneLogin();
    const lockedUntil = new Date(Date.now() + 60_000);
    await SocialConnection.updateOne({ _id: alice }, { syncLockedUntil: lockedUntil });
    const served = fake.calls.length;

    const single = await ws.sync(alice);
    expect(single.status).toBe(409);
    expect(single.body.error).toMatchObject({
      code: 'SYNC_IN_PROGRESS',
      message: expect.stringMatching(/already running/),
    });

    const bulk = await ws.syncAll();
    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual({
      results: [
        {
          connectionId: alice,
          displayName: 'Alice',
          provider: 'FACEBOOK_LOGIN',
          skipReason: 'IN_PROGRESS',
          status: 'ACTIVE',
          accounts: { refreshed: 0, lost: 0 },
          message: single.body.error.message,
        },
      ],
      summary: { total: 1, succeeded: 0, failed: 0, skipped: 1 },
    });
    const refresh = await ws.refresh([await accountIdOf('5001')]);
    expect(refresh.body.results).toEqual([
      expect.objectContaining({ connectionId: alice, skipReason: 'IN_PROGRESS' }),
    ]);

    expect((await ws.connections()).body.items[0].syncInProgress).toBe(true);
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments()).toBe(0);
    // The refused attempts must not release the lock held by the running sync.
    expect((await storedConnection(alice)).syncLockedUntil).toEqual(lockedUntil);
  });

  it('ignores a lock left behind past its expiry', async () => {
    const { alice, ws } = await oneLogin();
    await SocialConnection.updateOne(
      { _id: alice },
      { syncLockedUntil: new Date(Date.now() - 1000) },
    );

    const res = await ws.sync(alice);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('SUCCESS');
    expect((await storedConnection(alice)).syncLockedUntil).toBeUndefined();
  });

  it('holds the lock while Meta is answering, so a concurrent sync is refused, and releases it afterwards', async () => {
    const { alice, ws } = await oneLogin();
    const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
    const first = ws.sync(alice).then((res) => res);
    let done;
    try {
      await meta.reached;
      const second = await ws.sync(alice);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SYNC_IN_PROGRESS');
      expect((await ws.syncAll()).body.results[0].skipReason).toBe('IN_PROGRESS');
      expect((await ws.connections()).body.items[0].syncInProgress).toBe(true);
    } finally {
      meta.release();
      done = await first; // never leave a request running into the next test
    }

    expect(done.status).toBe(200);
    expect(done.body.outcome).toBe('SUCCESS');
    expect((await storedConnection(alice)).syncLockedUntil).toBeUndefined();
    expect((await ws.connections()).body.items[0].syncInProgress).toBe(false);
    expect((await runsOf(alice)).map((run) => run.outcome)).toEqual(['SUCCESS']);
  });

  it('releases the lock after every outcome', async () => {
    const { alice, ws } = await oneLogin();
    const lock = async () => (await storedConnection(alice)).syncLockedUntil;

    interceptMeta(transientError);
    expect((await ws.sync(alice)).status).toBe(502);
    expect(await lock()).toBeUndefined();

    fake.install();
    expect((await ws.sync(alice)).body.outcome).toBe('SUCCESS');
    expect(await lock()).toBeUndefined();

    fake.setTokenState('100', 'expired');
    expect((await ws.sync(alice)).body.outcome).toBe('TOKEN_EXPIRED');
    expect(await lock()).toBeUndefined();

    expect((await runsOf(alice)).map((run) => run.outcome)).toEqual([
      'TRANSIENT_FAILURE',
      'SUCCESS',
      'TOKEN_EXPIRED',
    ]);
  });
});

/* ------------------------------------------------------------ Meta not configured */

describe('Meta not configured (simulated Meta)', () => {
  it('never contacts Meta, records nothing and reports setup required when Facebook Login is not configured', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001', name: 'Acme Store' }]);
    const accountId = await accountIdOf('5001');
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    setMetaSettingsForTests({ facebook: null });
    const served = fake.calls.length;
    const connectionBefore = await storedConnection(alice);
    const destinationsBefore = await SocialAccount.find().sort({ _id: 1 }).lean();
    const activityBefore = await ActivityLog.countDocuments();

    const single = await ws.sync(alice);
    expect(single.status).toBe(409);
    expect(single.body.error.code).toBe('META_NOT_CONFIGURED');
    expect(single.body.error.message).toMatch(/Facebook Login is not configured/);
    expect(single.body.error.message).toMatch(/META_SETUP_GUIDE\.md/);
    const setupMessage = single.body.error.message;

    const bulk = await ws.syncAll();
    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual({
      results: [
        {
          connectionId: alice,
          displayName: 'Alice',
          provider: 'FACEBOOK_LOGIN',
          skipReason: 'CONFIG_REQUIRED',
          status: 'ACTIVE',
          accounts: { refreshed: 0, lost: 0 },
          message: setupMessage,
        },
      ],
      summary: { total: 1, succeeded: 0, failed: 0, skipped: 1 },
    });

    const refresh = await ws.refresh([accountId]);
    expect(refresh.status).toBe(200);
    const skipped = {
      accountId,
      name: 'Acme Store',
      connectionId: alice,
      skipReason: 'CONFIG_REQUIRED',
      message: setupMessage,
    };
    expect(refresh.body.results).toEqual([skipped]);
    expect(refresh.body.summary).toEqual({ total: 1, succeeded: 0, failed: 0, skipped: 1 });
    const refreshOne = await ws.refreshOne(accountId);
    expect(refreshOne.status).toBe(200);
    expect(refreshOne.body.result).toEqual(skipped);

    const discovery = await ws.discovery(alice);
    expect(discovery.status).toBe(409);
    expect(discovery.body.error.code).toBe('META_NOT_CONFIGURED');

    // Nothing reached Meta, nothing was recorded, nothing changed.
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments()).toBe(0);
    expect(await ActivityLog.countDocuments()).toBe(activityBefore);
    expect(await storedConnection(alice)).toEqual(connectionBefore);
    expect(await SocialAccount.find().sort({ _id: 1 }).lean()).toEqual(destinationsBefore);

    // The setup-required state is reported wherever the web app looks for it...
    const integration = await as(ctx.owner.token).get('/api/v1/integrations/meta');
    expect(integration.status).toBe(200);
    expect(integration.body.facebook).toMatchObject({ configured: false, ready: false });
    expect(integration.body.instagram).toMatchObject({ configured: true });
    expect((await ws.summary()).body.meta).toEqual({
      facebookConfigured: false,
      instagramConfigured: true,
    });
    expect((await ws.account(accountId)).body.capabilities.providerConfigured).toBe(false);
    const detail = (await ws.connection(alice)).body;
    expect(detail.capabilities.providerConfigured).toBe(false);
    expect(detail.permissions.requested).toBeNull();
    expect(detail.syncHistory).toEqual([]);

    // ...and nothing is reported as synced.
    const [login] = (await ws.connections()).body.items;
    expect(login).toMatchObject({
      status: 'ACTIVE',
      lastSyncAttemptAt: null,
      lastSyncOutcome: null,
      syncInProgress: false,
      attention: [],
    });
    expect(login.lastSyncedAt).toBe(connectionBefore.lastSyncedAt.toISOString());
    expect((await ws.syncRuns(alice)).body).toEqual({ items: [], nextCursor: null });
  });

  it('still disconnects locally (tokens erased) without calling Meta', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    setMetaSettingsForTests({ facebook: null });
    const served = fake.calls.length;

    const res = await ws.disconnect(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connection: { status: 'DISCONNECTED' },
      revokedAtMeta: false,
    });
    expect(fake.calls.length).toBe(served);
    expect((await SocialConnection.findById(alice).select('+accessToken')).hasAccessToken()).toBe(
      false,
    );
    const destinations = await SocialAccount.find({ connection: alice }).select('+accessToken');
    expect(destinations.filter((d) => d.hasAccessToken())).toHaveLength(0);
  });

  it('applies per provider: without Instagram credentials only Instagram logins are blocked', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const studio = await addInstagramLogin(ctx, {
      id: '9001',
      accountId: '17841400000000001',
      username: 'acme.studio',
    });
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    setMetaSettingsForTests({ instagram: null });
    const served = fake.calls.length;

    const single = await ws.sync(studio);
    expect(single.status).toBe(409);
    expect(single.body.error).toMatchObject({
      code: 'META_NOT_CONFIGURED',
      message: expect.stringMatching(/Instagram Login is not configured/),
    });

    const bulk = await ws.syncAll();
    const results = keyBy(bulk.body.results, 'connectionId');
    expect(results[alice]).toMatchObject({ outcome: 'SUCCESS' });
    expect(results[studio]).toMatchObject({ skipReason: 'CONFIG_REQUIRED', status: 'ACTIVE' });
    expect(results[studio]).not.toHaveProperty('outcome');
    expect(bulk.body.summary).toEqual({ total: 2, succeeded: 1, failed: 0, skipped: 1 });
    expect(await SyncRun.countDocuments({ connection: studio })).toBe(0);
    // Only the Facebook Graph API was contacted.
    expect(new Set(fake.calls.slice(served).map((call) => call.host))).toEqual(
      new Set(['graph.facebook.com']),
    );
    expect((await ws.summary()).body.meta).toEqual({
      facebookConfigured: true,
      instagramConfigured: false,
    });
    const igAccount = await accountIdOf('17841400000000001');
    expect((await ws.account(igAccount)).body.capabilities.providerConfigured).toBe(false);
    const fbAccount = await accountIdOf('5001');
    expect((await ws.account(fbAccount)).body.capabilities.providerConfigured).toBe(true);
  });
});

/* -------------------------------------------------------------- refresh endpoints */

describe('refreshing destinations (simulated Meta)', () => {
  async function twoLoginsWithPages() {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001', name: 'Acme Store' },
      { id: '5002', name: 'Acme Labs' },
    ]);
    const bob = await addFacebookLogin(ctx, {
      id: '200',
      name: 'Bob',
      pages: [{ id: '5003', name: 'Bob Bakery' }],
    });
    const ids = {
      store: await accountIdOf('5001'),
      labs: await accountIdOf('5002'),
      bakery: await accountIdOf('5003'),
    };
    return { alice, bob, ids, ws: workspaceApi(ctx.owner.token, ctx.workspace.id) };
  }

  it('refreshes destinations of two logins by syncing each login exactly once', async () => {
    const { alice, bob, ids, ws } = await twoLoginsWithPages();
    const served = fake.calls.length;

    const res = await ws.refresh([ids.store, ids.labs, ids.bakery]);

    expect(res.status).toBe(200);
    expect(keyBy(res.body.results, 'accountId')).toEqual({
      [ids.store]: {
        accountId: ids.store,
        name: 'Acme Store',
        connectionId: alice,
        outcome: 'SUCCESS',
        message: null,
      },
      [ids.labs]: {
        accountId: ids.labs,
        name: 'Acme Labs',
        connectionId: alice,
        outcome: 'SUCCESS',
        message: null,
      },
      [ids.bakery]: {
        accountId: ids.bakery,
        name: 'Bob Bakery',
        connectionId: bob,
        outcome: 'SUCCESS',
        message: null,
      },
    });
    expect(res.body.connections).toHaveLength(2);
    const connections = keyBy(res.body.connections, 'connectionId');
    expect(connections[alice]).toMatchObject({
      displayName: 'Alice',
      outcome: 'SUCCESS',
      status: 'ACTIVE',
      accounts: { refreshed: 2, lost: 0 },
    });
    expect(connections[bob]).toMatchObject({
      displayName: 'Bob',
      outcome: 'SUCCESS',
      accounts: { refreshed: 1, lost: 0 },
    });
    expect(res.body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
    // One synchronization (one token check) per login, not one per destination.
    expect((await runsOf(alice)).map((run) => run.trigger)).toEqual(['BULK']);
    expect((await runsOf(bob)).map((run) => run.trigger)).toEqual(['BULK']);
    expect(
      fake.calls.slice(served).filter((call) => call.path.endsWith('/debug_token')),
    ).toHaveLength(2);
  });

  it('reports each destination with the outcome of its own login', async () => {
    const { alice, bob, ids, ws } = await twoLoginsWithPages();
    fake.setTokenState('100', 'expired');

    const res = await ws.refresh([ids.store, ids.bakery]);

    expect(res.status).toBe(200);
    const results = keyBy(res.body.results, 'accountId');
    expect(results[ids.store]).toEqual({
      accountId: ids.store,
      name: 'Acme Store',
      connectionId: alice,
      outcome: 'TOKEN_EXPIRED',
      message: STATUS_REASONS.TOKEN_EXPIRED,
    });
    expect(results[ids.bakery]).toMatchObject({ connectionId: bob, outcome: 'SUCCESS' });
    expect(res.body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });
  });

  it('refreshes one destination by syncing its login and answers { result, connections }', async () => {
    const { alice, bob, ids, ws } = await twoLoginsWithPages();

    const res = await ws.refreshOne(ids.store);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: {
        accountId: ids.store,
        name: 'Acme Store',
        connectionId: alice,
        outcome: 'SUCCESS',
        message: null,
      },
      connections: [
        {
          connectionId: alice,
          displayName: 'Alice',
          provider: 'FACEBOOK_LOGIN',
          outcome: 'SUCCESS',
          status: 'ACTIVE',
          accounts: { refreshed: 2, lost: 0 },
          message: null,
        },
      ],
    });
    expect((await runsOf(alice)).map((run) => run.trigger)).toEqual(['BULK']);
    expect(await SyncRun.countDocuments({ connection: bob })).toBe(0);
  });

  it('rejects unknown or foreign destinations and invalid payloads without syncing anything', async () => {
    const { ids, ws } = await twoLoginsWithPages();
    const stranger = await registerUser({ name: 'Sam Stranger' });
    const elsewhere = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    await addFacebookLogin(
      { owner: stranger, workspace: elsewhere.workspace },
      { id: '300', name: 'Carol', pages: [{ id: '7001' }] },
    );
    const foreign = await accountIdOf('7001');
    const served = fake.calls.length;

    for (const unknown of [newId(), foreign]) {
      const many = await ws.refresh([ids.store, unknown]);
      expect(many.status).toBe(404);
      expect(many.body.error.code).toBe('NOT_FOUND');
      expect((await ws.refreshOne(unknown)).status).toBe(404);
    }
    expect((await ws.refresh([])).status).toBe(422);
    expect((await ws.refresh(['not-an-id'])).status).toBe(422);
    expect((await ws.refreshOne('not-an-id')).status).toBe(422);
    expect(fake.calls.length).toBe(served);
    expect(await SyncRun.countDocuments()).toBe(0);
  });

  it('is limited to owners and admins: editors and viewers get 403 even for destinations they can see', async () => {
    const ctx = await seedTeam();
    const alice = await addAlice(ctx);
    const accountId = await accountIdOf('5001');
    const owner = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await owner.setAccess(ctx.editor.membershipId, [accountId])).status).toBe(200);
    expect((await owner.setAccess(ctx.viewer.membershipId, [accountId])).status).toBe(200);

    for (const member of [ctx.editor, ctx.viewer]) {
      const ws = workspaceApi(member.token, ctx.workspace.id);
      expect((await ws.account(accountId)).status).toBe(200);
      expect((await ws.refresh([accountId])).status).toBe(403);
      expect((await ws.refreshOne(accountId)).status).toBe(403);
    }
    expect(await SyncRun.countDocuments()).toBe(0);

    const admin = workspaceApi(ctx.admin.token, ctx.workspace.id);
    expect((await admin.refreshOne(accountId)).body.result).toMatchObject({
      connectionId: alice,
      outcome: 'SUCCESS',
    });
  });
});

/* -------------------------------------------------------- disconnecting, removing */

describe('disconnecting and removing (simulated Meta)', () => {
  it('disconnect erases the tokens, keeps the destinations as unavailable and blocks syncing until reconnected', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001' },
      { id: '5002', instagram: { id: '17841400000000010', username: 'acme' } },
    ]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await ws.sync(alice)).status).toBe(200);

    const res = await ws.disconnect(alice);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      revokedAtMeta: true,
      connection: {
        id: alice,
        status: 'DISCONNECTED',
        statusReason: STATUS_REASONS.DISCONNECTED,
        attention: [{ code: 'DISCONNECTED', message: STATUS_REASONS.DISCONNECTED }],
        needsAttention: true,
        disconnectedAt: expect.any(String),
      },
    });
    expect(fake.revocations()).toHaveLength(1);

    // Token material is gone from the stored login and from every destination.
    expect((await SocialConnection.findById(alice).select('+accessToken')).hasAccessToken()).toBe(
      false,
    );
    const destinations = await SocialAccount.find({ connection: alice }).select('+accessToken');
    expect(destinations).toHaveLength(3);
    expect(destinations.filter((d) => d.hasAccessToken())).toHaveLength(0);
    const db = mongoose.connection.db;
    const loginId = new mongoose.Types.ObjectId(alice);
    expect(await db.collection('socialconnections').findOne({ _id: loginId })).not.toHaveProperty(
      'accessToken',
    );
    const rawDestinations = await db
      .collection('socialaccounts')
      .find({ connection: loginId })
      .toArray();
    expect(rawDestinations.filter((doc) => 'accessToken' in doc)).toEqual([]);

    // The destinations stay listed: unavailable and flagged as disconnected.
    const { items } = (await ws.accounts()).body;
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.connection.status).toBe('DISCONNECTED');
      expect(item.health).toMatchObject({
        connectionStatus: 'DISCONNECTED',
        readiness: 'UNAVAILABLE',
        readinessReasons: [STATUS_REASONS.DISCONNECTED],
        attention: [{ code: 'DISCONNECTED', message: STATUS_REASONS.DISCONNECTED }],
        needsAttention: true,
      });
    }
    const summary = (await ws.summary()).body;
    expect(summary.accounts).toMatchObject({ total: 3, connected: 0, unavailable: 3 });
    expect(summary.connections).toMatchObject({ total: 1, active: 0, disconnected: 1 });

    // Syncing (or discovering) requires reconnecting first; Meta is not contacted.
    const served = fake.calls.length;
    const sync = await ws.sync(alice);
    expect(sync.status).toBe(409);
    expect(sync.body.error).toMatchObject({
      code: 'META_RECONNECT_REQUIRED',
      message: STATUS_REASONS.DISCONNECTED,
    });
    expect((await ws.discovery(alice)).body.error.code).toBe('META_RECONNECT_REQUIRED');
    expect(fake.calls.length).toBe(served);
    // Earlier history is kept; the refused attempt is not recorded.
    expect((await ws.syncRuns(alice)).body.items.map((run) => run.outcome)).toEqual(['SUCCESS']);
    expect(
      await ActivityLog.exists({ action: 'social_connection.disconnected', 'target.id': loginId }),
    ).toBeTruthy();

    // Disconnecting again changes nothing.
    const again = await ws.disconnect(alice);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      connection: { status: 'DISCONNECTED' },
      revokedAtMeta: false,
    });
    expect(fake.revocations()).toHaveLength(1);
  });

  it('shows the disconnection on the destination detail as on the login list', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await ws.disconnect(alice)).status).toBe(200);
    const [login] = (await ws.connections()).body.items;
    expect(login.disconnectedAt).toEqual(expect.any(String));

    const detail = (await ws.account(await accountIdOf('5001'))).body;

    expect(detail.account.health).toMatchObject({
      connectionStatus: 'DISCONNECTED',
      readiness: 'UNAVAILABLE',
    });
    expect(detail.connection).toMatchObject({
      id: alice,
      status: 'DISCONNECTED',
      statusReason: STATUS_REASONS.DISCONNECTED,
    });
    expect(detail.connection.disconnectedAt).toBe(login.disconnectedAt);
  });

  it.each([
    ['Meta still accepts the token (the identity is used by another workspace)', true],
    ['the disconnect revoked the token at Meta', false],
  ])(
    'a disconnect made while a sync waits for Meta is not undone by that sync when %s',
    async (_label, sharedIdentity) => {
      const ctx = await ownerWorkspace();
      const alice = await addAlice(ctx);
      if (sharedIdentity) {
        const other = await createWorkspace(ctx.owner.token, { name: 'Brand Two' });
        await connectFacebook(fake, ctx.owner.token, other.workspace.id, '100');
      }
      const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
      const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
      const syncing = ws.sync(alice).then((res) => res);
      let disconnect;
      try {
        await meta.reached;
        disconnect = await ws.disconnect(alice);
      } finally {
        meta.release();
        await syncing; // never leave a request running into the next test
      }

      if (disconnect.status === 409) {
        // Refusing to disconnect while a sync is running would also be consistent.
        expect(disconnect.body.error.code).toBe('SYNC_IN_PROGRESS');
      } else {
        expect(disconnect.status).toBe(200);
        expect(disconnect.body.revokedAtMeta).toBe(!sharedIdentity);
        // The manager was told the login is disconnected: the sync that finished afterwards
        // must not bring back its status or any token.
        const login = await SocialConnection.findById(alice).select('+accessToken');
        const destinations = await SocialAccount.find({ connection: alice }).select('+accessToken');
        expect({
          status: login.status,
          loginToken: login.hasAccessToken(),
          destinations: destinations.map((d) => [d.connectionStatus, d.hasAccessToken()]),
        }).toEqual({
          status: 'DISCONNECTED',
          loginToken: false,
          destinations: [['DISCONNECTED', false]],
        });
      }
    },
  );

  it('a login removed while its sync waits for Meta stays removed; the sync writes nothing and says why', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
    const syncing = ws.sync(alice).then((res) => res);
    let removed;
    try {
      await meta.reached;
      removed = await ws.removeConnection(alice);
    } finally {
      meta.release();
    }
    const sync = await syncing;

    expect(removed.status).toBe(200);
    expect(sync.status).toBe(409);
    expect(sync.body.error).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/removed while it was being synchronized/),
      details: { superseded: 'removed' },
    });
    expect(await SocialConnection.exists({ _id: alice })).toBeNull();
    expect(await SocialAccount.countDocuments({ workspace: ctx.workspace.id })).toBe(0);
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);
  });

  it('a destination removed while its login syncs is not brought back by that sync', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const labs = await accountIdOf('5002');
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
    const syncing = ws.sync(alice).then((res) => res);
    let removed;
    try {
      await meta.reached;
      removed = await ws.removeOne(labs);
    } finally {
      meta.release();
    }
    const sync = await syncing;

    expect(removed.status).toBe(204);
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ outcome: 'SUCCESS', accounts: { refreshed: 1, lost: 0 } });
    expect(await SocialAccount.exists({ _id: labs })).toBeNull();
    expect(await SocialAccount.countDocuments({ connection: alice })).toBe(1);
  });

  it('a reconnect made while a sync waits for Meta wins: the sync keeps the newer token and writes nothing', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const beforeSync = await storedConnection(alice);
    const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
    const syncing = ws.sync(alice).then((res) => res);
    try {
      await meta.reached;
      // Simulates the reauthorization callback storing a fresh user token meanwhile.
      const login = await SocialConnection.findById(alice).select('+accessToken');
      login.setAccessToken('fb_user_token_from_a_newer_authorization');
      await login.save();
    } finally {
      meta.release();
    }
    const sync = await syncing;

    expect(sync.status).toBe(409);
    expect(sync.body.error).toMatchObject({
      code: 'CONFLICT',
      details: { superseded: 'replaced' },
      message: expect.stringMatching(/reconnected while it was being synchronized/),
    });
    const login = await SocialConnection.findById(alice).select('+accessToken');
    expect(login.getAccessToken()).toBe('fb_user_token_from_a_newer_authorization');
    expect(login.lastSyncedAt?.toISOString()).toBe(beforeSync.lastSyncedAt?.toISOString());
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);
    expect(
      await ActivityLog.exists({ workspace: ctx.workspace.id, action: 'social_connection.synced' }),
    ).toBeNull();
  });

  it('reports a bulk sync superseded by a disconnect as SUPERSEDED, with the stored status', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    const meta = holdMeta((url) => url.pathname.endsWith('/debug_token'));
    const syncing = ws.syncAll().then((res) => res);
    try {
      await meta.reached;
      expect((await ws.disconnect(alice)).status).toBe(200);
    } finally {
      meta.release();
    }
    const bulk = await syncing;

    expect(bulk.status).toBe(200);
    expect(bulk.body.summary).toEqual({ total: 1, succeeded: 0, failed: 0, skipped: 1 });
    expect(bulk.body.results[0]).toMatchObject({
      connectionId: alice,
      status: 'DISCONNECTED',
      message: expect.stringMatching(/disconnected while it was being synchronized/),
    });
    expect(bulk.body.results[0].skipReason).toBe('SUPERSEDED');
  });

  it('removing a login deletes its destinations and sync history and cleans member and invitation access', async () => {
    const ctx = await seedTeam();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const bob = await addFacebookLogin(ctx, { id: '200', name: 'Bob', pages: [{ id: '5003' }] });
    const store = await accountIdOf('5001');
    const labs = await accountIdOf('5002');
    const bakery = await accountIdOf('5003');
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await ws.sync(alice)).status).toBe(200);
    expect((await ws.sync(bob)).status).toBe(200);
    expect((await ws.setAccess(ctx.editor.membershipId, [store, bakery])).status).toBe(200);
    expect((await ws.setAccess(ctx.viewer.membershipId, [labs])).status).toBe(200);
    const inviteeEmail = uniqueEmail('invitee');
    const invite = await ws.invite({
      email: inviteeEmail,
      role: 'EDITOR',
      accountAccess: { mode: 'SELECTED', socialAccountIds: [store, labs, bakery] },
    });
    expect(invite.status).toBe(201);

    const res = await ws.removeConnection(alice);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accountsRemoved: 2, revokedAtMeta: true });
    expect(await SocialConnection.exists({ _id: alice })).toBeNull();
    expect(await SocialAccount.countDocuments({ connection: alice })).toBe(0);
    expect(await SyncRun.countDocuments({ connection: alice })).toBe(0);
    expect(await SyncRun.countDocuments({ connection: bob })).toBe(1);
    expect((await ws.connection(alice)).status).toBe(404);
    expect((await ws.syncRuns(alice)).status).toBe(404);

    // Members and pending invitations no longer reference the removed destinations.
    const members = keyBy((await ws.members()).body.items, 'id');
    expect(members[ctx.editor.membershipId].accountAccess).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [bakery],
    });
    expect(members[ctx.viewer.membershipId].accountAccess).toEqual({
      mode: 'SELECTED',
      socialAccountIds: [],
    });
    const invitation = (await ws.invitations()).body.items.find((i) => i.email === inviteeEmail);
    expect(invitation.accountAccess).toEqual({ mode: 'SELECTED', socialAccountIds: [bakery] });

    // The other login and its destination are untouched.
    expect((await storedConnection(bob)).status).toBe('ACTIVE');
    expect((await ws.accounts()).body.items.map((item) => item.externalId)).toEqual(['5003']);
    const log = await ActivityLog.findOne({ action: 'social_connection.removed' }).lean();
    expect(log).toMatchObject({
      actorName: 'Olivia Owner',
      target: { label: 'Alice' },
      metadata: { provider: 'FACEBOOK_LOGIN', accountsRemoved: 2 },
    });
  });

  it('removes several destinations at once and keeps their login', async () => {
    const ctx = await seedTeam();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }, { id: '5003' }]);
    const first = await accountIdOf('5001');
    const second = await accountIdOf('5002');
    const third = await accountIdOf('5003');
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await ws.setAccess(ctx.editor.membershipId, [first, second, third])).status).toBe(200);

    const res = await ws.remove([first, second, first]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 2 });
    expect((await ws.accounts()).body.items.map((item) => item.externalId)).toEqual(['5003']);
    const login = await SocialConnection.findById(alice).select('+accessToken');
    expect(login.status).toBe('ACTIVE');
    expect(login.hasAccessToken()).toBe(true);
    expect(await ActivityLog.countDocuments({ action: 'social_account.removed' })).toBe(2);
    const members = keyBy((await ws.members()).body.items, 'id');
    expect(members[ctx.editor.membershipId].accountAccess.socialAccountIds).toEqual([third]);

    // One unknown id rejects the whole request before anything is removed.
    const rejected = await ws.remove([third, newId()]);
    expect(rejected.status).toBe(404);
    expect(await SocialAccount.exists({ _id: third })).toBeTruthy();
    expect((await ws.remove([])).status).toBe(422);
    // Only managers may remove destinations.
    const editor = workspaceApi(ctx.editor.token, ctx.workspace.id);
    expect((await editor.remove([third])).status).toBe(403);
    expect(await SocialAccount.exists({ _id: third })).toBeTruthy();
  });

  it('DELETE removes one destination (204) and keeps the login working', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [{ id: '5001' }, { id: '5002' }]);
    const removed = await accountIdOf('5002');
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);

    const res = await ws.removeOne(removed);

    expect(res.status).toBe(204);
    expect(await SocialAccount.exists({ _id: removed })).toBeNull();
    const login = await SocialConnection.findById(alice).select('+accessToken');
    expect(login.status).toBe('ACTIVE');
    expect(login.hasAccessToken()).toBe(true);
    expect((await ws.connections()).body.items[0]).toMatchObject({
      id: alice,
      status: 'ACTIVE',
      accountCount: 1,
    });
    // The login keeps syncing, and the removed Page is not added back.
    expect((await ws.sync(alice)).body).toMatchObject({
      outcome: 'SUCCESS',
      accounts: { refreshed: 1, lost: 0 },
    });
    expect((await ws.accounts()).body.items.map((item) => item.externalId)).toEqual(['5001']);
    expect((await ws.removeOne(removed)).status).toBe(404);
  });
});

/* ------------------------------------------------ CREATE_CONTENT and permissions */

describe('CREATE_CONTENT and publishing eligibility (simulated Meta)', () => {
  const NO_CREATE_CONTENT = /no Page role that allows creating content \(CREATE_CONTENT task\)/;

  it('is READY only with the CREATE_CONTENT Page task; other Page roles are RESTRICTED', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001', name: 'Full role' },
      { id: '5002', name: 'Analyst', tasks: ['ANALYZE'] },
      { id: '5003', name: 'Manage only', tasks: ['MANAGE'] },
    ]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);

    const listed = await listedByExternalId(ws);

    expect(listed['5001'].tasks).toEqual(FULL_PAGE_TASKS);
    expect(listed['5001'].health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'READY',
      readinessReasons: [],
      eligibility: { eligible: true, createContent: true, missingPermissions: [] },
      attention: [],
      needsAttention: false,
    });
    for (const externalId of ['5002', '5003']) {
      expect(listed[externalId].health).toEqual({
        connectionStatus: 'ACTIVE',
        connectionStatusReason: null,
        readiness: 'RESTRICTED',
        readinessReasons: [expect.stringMatching(NO_CREATE_CONTENT)],
        eligibility: { eligible: false, createContent: false, missingPermissions: [] },
        attention: [
          { code: 'MISSING_CREATE_CONTENT', message: expect.stringMatching(NO_CREATE_CONTENT) },
        ],
        needsAttention: true,
      });
    }
    const detail = (await ws.account(await accountIdOf('5002'))).body;
    expect(detail.permissions).toMatchObject({
      tasks: ['ANALYZE'],
      createContent: false,
      missing: [],
    });
    const restricted = (await ws.accounts({ readiness: 'RESTRICTED' })).body.items;
    expect(restricted.map((item) => item.externalId).sort()).toEqual(['5002', '5003']);

    // The role is upgraded in Facebook: the next sync records the tasks and the Page is READY.
    fake.grantPage('100', { id: '5002' }, FULL_PAGE_TASKS);
    expect((await ws.sync(alice)).status).toBe(200);
    expect((await listedByExternalId(ws))['5002'].health).toMatchObject({
      readiness: 'READY',
      eligibility: { eligible: true, createContent: true },
      attention: [],
    });
  });

  it('is RESTRICTED with missingPermissions once pages_manage_posts is no longer granted', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx, [
      { id: '5001', instagram: { id: '17841400000000010', username: 'acme' } },
    ]);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await listedByExternalId(ws))['5001'].health.readiness).toBe('READY');
    fake.setPermissions('100', {
      granted: ALL_FB_SCOPES.filter((scope) => scope !== 'pages_manage_posts'),
      declined: ['pages_manage_posts'],
    });

    expect((await ws.sync(alice)).body.outcome).toBe('SUCCESS');

    const listed = await listedByExternalId(ws);
    expect(listed['5001'].health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: [expect.stringMatching(/pages_manage_posts/)],
      eligibility: {
        eligible: false,
        createContent: true,
        missingPermissions: ['pages_manage_posts'],
      },
      attention: [
        { code: 'MISSING_PERMISSIONS', message: expect.stringMatching(/pages_manage_posts/) },
      ],
      needsAttention: true,
    });
    // Publishing to the linked Instagram account does not need pages_manage_posts.
    expect(listed['17841400000000010'].health).toMatchObject({
      readiness: 'READY',
      eligibility: { eligible: true, createContent: true, missingPermissions: [] },
    });
    const detail = (await ws.account(await accountIdOf('5001'))).body;
    expect(detail.permissions).toMatchObject({
      requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
      declined: ['pages_manage_posts'],
      missing: ['pages_manage_posts'],
      createContent: true,
    });
    const [login] = (await ws.connections()).body.items;
    expect(login.missingScopes.publishing).toEqual(['pages_manage_posts']);
  });

  it('never treats unknown Page tasks as READY: createContent stays null until a sync records them', async () => {
    const ctx = await ownerWorkspace();
    const alice = await addAlice(ctx);
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    // A Facebook-Login destination stored without Page tasks (recorded before tasks were kept).
    await SocialAccount.updateOne({ externalId: '5001' }, { $unset: { tasks: 1 } });

    const item = (await listedByExternalId(ws))['5001'];

    expect(item).not.toHaveProperty('tasks');
    expect(item.health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: [expect.stringMatching(/not been confirmed/)],
      eligibility: { eligible: false, createContent: null, missingPermissions: [] },
      attention: [
        { code: 'MISSING_CREATE_CONTENT', message: expect.stringMatching(/not been confirmed/) },
      ],
      needsAttention: true,
    });
    expect((await ws.account(await accountIdOf('5001'))).body.permissions).toMatchObject({
      tasks: null,
      createContent: null,
    });

    expect((await ws.sync(alice)).status).toBe(200);
    expect((await listedByExternalId(ws))['5001'].health).toMatchObject({
      readiness: 'READY',
      eligibility: { eligible: true, createContent: true },
    });
  });

  it('evaluates an Instagram Login account by its publishing permission only (createContent null)', async () => {
    const ctx = await ownerWorkspace();
    await addInstagramLogin(ctx, {
      id: '9001',
      accountId: '17841400000000001',
      username: 'acme.studio',
    });
    await addInstagramLogin(ctx, {
      id: '9002',
      accountId: '17841400000000002',
      username: 'acme.basic',
      granted: ['instagram_business_basic'],
    });
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);

    const listed = await listedByExternalId(ws);

    expect(listed['17841400000000001'].health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'READY',
      readinessReasons: [],
      eligibility: { eligible: true, createContent: null, missingPermissions: [] },
      attention: [],
      needsAttention: false,
    });
    expect(listed['17841400000000002'].health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: [expect.stringMatching(/instagram_business_content_publish/)],
      eligibility: {
        eligible: false,
        createContent: null,
        missingPermissions: ['instagram_business_content_publish'],
      },
      attention: [
        {
          code: 'MISSING_PERMISSIONS',
          message: expect.stringMatching(/instagram_business_content_publish/),
        },
      ],
      needsAttention: true,
    });
    const detail = (await ws.account(await accountIdOf('17841400000000001'))).body;
    expect(detail.permissions).toMatchObject({
      requiredForPublishing: ['instagram_business_content_publish'],
      missing: [],
      tasks: null,
      createContent: null,
    });
  });
});
