// Simulated Meta integration tests: Meta is replaced by test/fakeMeta.js (no real Meta API calls). Records are controlled test data.
/**
 * Follower counts: read from Meta when destinations are added or synced (never during
 * discovery), stored per destination, and combined in the summary. A count Meta did not
 * return is unknown (null) — never 0 — and is left out of the totals. Follower reads are
 * best effort: a refused or failed read never fails adding or syncing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SocialAccount } from '../src/models/index.js';
import { ALL_FB_SCOPES, FakeMeta } from './fakeMeta.js';
import { as, createWorkspace, registerUser, addMember } from './helpers.js';
import { connectFacebook, connectInstagram, insta, page, selectAccounts } from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  fake.uninstall();
});

const TOKEN_PATTERN = /fb_long_|ig_long_|pagetoken_|ciphertext|accessToken/;
const followerReads = () => fake.calls.filter((c) => c.params.fields === 'followers_count');

async function ownerWorkspace(name = 'Acme Social', owner) {
  const user = owner ?? (await registerUser({ name: 'Olivia Owner' }));
  const { workspace } = await createWorkspace(user.token, { name });
  return { owner: user, workspace };
}

function workspaceApi(token, workspaceId) {
  const http = as(token);
  const base = `/api/v1/workspaces/${workspaceId}`;
  return {
    summary: () => http.get(`${base}/social-accounts/summary`),
    accounts: (query = {}) => http.get(`${base}/social-accounts`).query(query),
    sync: (id) => http.post(`${base}/social-connections/${id}/sync`),
    discovery: (id) => http.get(`${base}/social-connections/${id}/discovery`),
    setAccess: (membershipId, socialAccountIds) =>
      http
        .put(`${base}/members/${membershipId}/account-access`)
        .send({ mode: 'SELECTED', socialAccountIds }),
  };
}

/** Connects a Facebook identity and adds every Page (and Page-linked Instagram account). */
async function addFacebookLogin(ctx, { pages, ...identity }) {
  if (!fake.fbUsers.has(identity.id)) fake.addFacebookUser({ ...identity, pages });
  const { connectionId } = await connectFacebook(
    fake,
    ctx.owner.token,
    ctx.workspace.id,
    identity.id,
  );
  const selection = pages.flatMap((p) =>
    p.instagram ? [page(p.id), insta(p.instagram.id)] : [page(p.id)],
  );
  const res = await selectAccounts(ctx.owner.token, ctx.workspace.id, connectionId, selection);
  expect(res.status).toBe(200);
  expect(res.body.added.length + res.body.updated.length).toBe(selection.length);
  return connectionId;
}

async function addInstagramLogin(ctx, identity) {
  fake.addInstagramUser(identity);
  const { connectionId } = await connectInstagram(
    fake,
    ctx.owner.token,
    ctx.workspace.id,
    identity.id,
  );
  const res = await selectAccounts(ctx.owner.token, ctx.workspace.id, connectionId, [
    insta(identity.accountId),
  ]);
  expect(res.status).toBe(200);
  return connectionId;
}

const PAGES = [
  { id: '5001', name: 'Acme Coffee', instagram: { id: '9001', username: 'acme.coffee' } },
  { id: '5002', name: 'Acme Bakery' },
];

async function followersOf() {
  const docs = await SocialAccount.find().select('externalId followersCount').lean();
  return Object.fromEntries(docs.map((d) => [d.externalId, d.followersCount ?? null]));
}

describe('follower counts', () => {
  it('stores counts when accounts are added and combines Pages + Instagram in the summary', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setFollowers('5001', 1200);
    fake.setFollowers('9001', 3400);
    fake.setFollowers('5002', 800);
    fake.setFollowers('7001', 56);

    const fbLogin = await addFacebookLogin(ctx, { id: '100', name: 'Alice', pages: PAGES });
    await addInstagramLogin(ctx, { id: 'ig-1', accountId: '7001', username: 'acme.studio' });

    expect(await followersOf()).toEqual({ 5001: 1200, 5002: 800, 9001: 3400, 7001: 56 });

    const summary = await ws.summary();
    expect(summary.status).toBe(200);
    expect(summary.body.followers).toMatchObject({
      total: 1200 + 800 + 3400 + 56,
      facebook: 1200 + 800,
      instagram: 3400 + 56,
      counted: 4,
      missing: 0,
      facebookMissing: 0,
      instagramMissing: 0,
    });
    expect(Date.parse(summary.body.followers.asOf)).not.toBeNaN();

    const list = await ws.accounts({ limit: 50 });
    const byId = Object.fromEntries(list.body.items.map((a) => [a.externalId, a]));
    expect(byId['9001'].followersCount).toBe(3400);
    expect(byId['9001'].followersCountUpdatedAt).toEqual(expect.any(String));
    expect(JSON.stringify([summary.body, list.body])).not.toMatch(TOKEN_PATTERN);

    // Discovery (the selection screen) does not read follower counts.
    const before = followerReads().length;
    expect((await ws.discovery(fbLogin)).status).toBe(200);
    expect(followerReads()).toHaveLength(before);
  });

  it('reads Page counts with the Page token and appsecret_proof', async () => {
    const ctx = await ownerWorkspace();
    fake.setFollowers('5002', 10);
    await addFacebookLogin(ctx, { id: '100', pages: [PAGES[1]] });
    const [read] = followerReads();
    expect(read).toMatchObject({ host: 'graph.facebook.com', path: '/v27.0/5002' });
    expect(read.params.access_token).toBe(fake.pageToken('100', '5002'));
    expect(read.params.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats a count Meta did not return as unknown, never 0', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setFollowers('5001', 1200); // 9001 and 5002: Meta omits followers_count
    await addFacebookLogin(ctx, { id: '100', pages: PAGES });

    expect(await followersOf()).toEqual({ 5001: 1200, 5002: null, 9001: null });
    const { followers } = (await ws.summary()).body;
    expect(followers).toMatchObject({
      total: 1200,
      facebook: 1200,
      instagram: null,
      counted: 1,
      missing: 2,
      facebookMissing: 1,
      instagramMissing: 1,
    });
    const items = (await ws.accounts()).body.items;
    expect(items.find((a) => a.externalId === '5002').followersCount).toBeNull();
  });

  it('reports no total at all when no destination has a count', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await ws.summary()).body.followers).toEqual({
      total: null,
      facebook: null,
      instagram: null,
      counted: 0,
      missing: 0,
      facebookMissing: 0,
      instagramMissing: 0,
      asOf: null,
    });
    await addFacebookLogin(ctx, { id: '100', pages: [PAGES[1]] });
    expect((await ws.summary()).body.followers).toMatchObject({ total: null, missing: 1 });
  });

  it('refreshes counts on sync, and a later omitted count becomes unknown', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setFollowers('5001', 100);
    fake.setFollowers('9001', 200);
    const login = await addFacebookLogin(ctx, { id: '100', pages: [PAGES[0]] });
    const first = await SocialAccount.findOne({ externalId: '5001' }).lean();

    fake.setFollowers('5001', 150);
    fake.setFollowers('9001', undefined);
    const sync = await ws.sync(login);
    expect(sync.status).toBe(200);
    expect(sync.body.outcome).toBe('SUCCESS');

    const after = await SocialAccount.findOne({ externalId: '5001' }).lean();
    expect(after.followersCount).toBe(150);
    expect(after.followersCountUpdatedAt.getTime()).toBeGreaterThan(
      first.followersCountUpdatedAt.getTime() - 1,
    );
    const ig = await SocialAccount.findOne({ externalId: '9001' }).lean();
    expect(ig.followersCount).toBeUndefined();
    expect(ig.followersCountUpdatedAt).toBeUndefined();
    expect((await ws.summary()).body.followers).toMatchObject({ total: 150, missing: 1 });
  });

  it('keeps the stored count when a follower read fails, without failing the sync', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setFollowers('5001', 100);
    fake.setFollowers('9001', 200);
    const login = await addFacebookLogin(ctx, { id: '100', pages: [PAGES[0]] });
    const before = await SocialAccount.findOne({ externalId: '5001' }).lean();

    fake.setFollowers('5001', { error: 'permission' });
    fake.setFollowers('9001', { error: 'transient' });
    const sync = await ws.sync(login);
    expect(sync.status).toBe(200);
    expect(sync.body.outcome).toBe('SUCCESS');
    expect(sync.body.connection.status).toBe('ACTIVE');

    const after = await SocialAccount.findOne({ externalId: '5001' }).lean();
    expect(after.followersCount).toBe(100);
    expect(after.followersCountUpdatedAt).toEqual(before.followersCountUpdatedAt);
    expect(after.lastSyncedAt.getTime()).toBeGreaterThan(before.lastSyncedAt.getTime() - 1);
    expect(await followersOf()).toEqual({ 5001: 100, 9001: 200 });
  });

  it('does not attempt follower reads the login has no permission for', async () => {
    const ctx = await ownerWorkspace();
    const ws = workspaceApi(ctx.owner.token, ctx.workspace.id);
    fake.setFollowers('5001', 100);
    fake.setFollowers('9001', 200);
    await addFacebookLogin(ctx, {
      id: '100',
      granted: ALL_FB_SCOPES.filter((s) => s !== 'pages_read_engagement'),
      pages: [PAGES[0]],
    });
    expect(followerReads()).toHaveLength(0);
    expect(await followersOf()).toEqual({ 5001: null, 9001: null });
    expect((await ws.summary()).body.followers).toMatchObject({ total: null, missing: 2 });
  });

  it('stops reading follower counts once Meta rate-limits', async () => {
    const ctx = await ownerWorkspace();
    const pages = Array.from({ length: 12 }, (_, i) => ({ id: String(6000 + i) }));
    for (const p of pages) fake.setFollowers(p.id, { error: 'rate_limited' });
    await addFacebookLogin(ctx, { id: '100', pages });
    // At most one read per concurrent worker before they all stop.
    expect(followerReads().length).toBeLessThanOrEqual(4);
    expect(Object.values(await followersOf()).every((v) => v === null)).toBe(true);
  });

  it('only combines the accounts a member is allowed to see', async () => {
    const ctx = await ownerWorkspace();
    fake.setFollowers('5001', 1200);
    fake.setFollowers('9001', 3400);
    fake.setFollowers('5002', 800);
    await addFacebookLogin(ctx, { id: '100', pages: PAGES });
    const editor = await addMember(ctx.workspace.id, ctx.owner.token, 'EDITOR');
    const bakery = await SocialAccount.findOne({ externalId: '5002' }).select('_id').lean();
    const owner = workspaceApi(ctx.owner.token, ctx.workspace.id);
    expect((await owner.setAccess(editor.membershipId, [String(bakery._id)])).status).toBe(200);

    const { followers } = (await workspaceApi(editor.token, ctx.workspace.id).summary()).body;
    expect(followers).toMatchObject({ total: 800, facebook: 800, instagram: null, counted: 1 });
  });

  it('counts a destination present in two workspaces once in the cross-workspace summary', async () => {
    const first = await ownerWorkspace('Acme One');
    const second = await ownerWorkspace('Acme Two', first.owner);
    fake.setFollowers('5002', 800);
    await addFacebookLogin(first, { id: '100', pages: [PAGES[1]] });
    await addFacebookLogin(second, { id: '100', pages: [PAGES[1]] });

    const res = await as(first.owner.token).get('/api/v1/social-accounts/summary');
    expect(res.status).toBe(200);
    expect(res.body.accounts.total).toBe(2);
    expect(res.body.followers).toMatchObject({ total: 800, counted: 1, missing: 0 });
  });
});
