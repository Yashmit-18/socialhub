// Simulated Meta integration tests: Meta is replaced by test/fakeMeta.js (no real Meta API calls). Records are controlled test data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import { Membership, SocialAccount, SocialConnection, SyncRun } from '../src/models/index.js';
import { ALL_FB_SCOPES, ALL_IG_SCOPES, FULL_PAGE_TASKS, FakeMeta } from './fakeMeta.js';
import {
  addMember,
  as,
  createWorkspace,
  registerUser,
  seedTeam,
  tokenFromInviteUrl,
} from './helpers.js';
import { connectFacebook, connectInstagram, insta, page, selectAccounts } from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  fake.uninstall();
  setMetaSettingsForTests();
});

/* ------------------------------------------------------------------ fixtures */

const DAY_MS = 86_400_000;
/** A well-formed id that matches no record. */
const MISSING_ID = '0123456789abcdef01234567';
const ACME_IG = '17841400000000010';
const SOLO_IG = '17841400000000099';
const ALICE_PICTURE = 'https://example.fbcdn.net/100.jpg';

/** Every destination of the portfolio below, in the default (name) order. */
const ALL_NAMES = [
  'Acme Labs',
  'Acme Photos',
  'Acme Store',
  'Beta Bakery',
  'Solo Creator',
  'Zeta Garage',
];
const NO_ACCOUNTS = {
  total: 0,
  facebookPages: 0,
  instagramAccounts: 0,
  connected: 0,
  needsAttention: 0,
  ready: 0,
  restricted: 0,
  unavailable: 0,
};
const META_CONFIGURED = { facebookConfigured: true, instagramConfigured: true };
/**
 * Combined followers when Meta returned no count for any destination (the simulator omits
 * followers_count unless a test sets one): unknown, never 0. See accounts.followers.test.js.
 */
const unknownFollowers = (facebookMissing = 0, instagramMissing = 0) => ({
  total: null,
  facebook: null,
  instagram: null,
  counted: 0,
  missing: facebookMissing + instagramMissing,
  facebookMissing,
  instagramMissing,
  asOf: null,
});
/** Token material of any kind: simulated Meta tokens, the encrypted envelope, token fields. */
const TOKEN_MATERIAL =
  /pagetoken_|fb_long_|fb_short_|ig_long_|ig_short_|accessToken|access_token|ciphertext|authTag|keyVersion/;

const wsUrl = (workspaceId) => `/api/v1/workspaces/${workspaceId}`;

function listAccounts(token, workspaceId, params = {}) {
  const query = new URLSearchParams(params).toString();
  return as(token).get(`${wsUrl(workspaceId)}/social-accounts${query ? `?${query}` : ''}`);
}
const accountSummary = (token, workspaceId) =>
  as(token).get(`${wsUrl(workspaceId)}/social-accounts/summary`);
const accountDetail = (token, workspaceId, accountId) =>
  as(token).get(`${wsUrl(workspaceId)}/social-accounts/${accountId}`);
const listLogins = (token, workspaceId) =>
  as(token).get(`${wsUrl(workspaceId)}/social-connections`);
const discover = (token, workspaceId, connectionId) =>
  as(token).get(`${wsUrl(workspaceId)}/social-connections/${connectionId}/discovery`);
const syncLogin = (token, workspaceId, connectionId) =>
  as(token).post(`${wsUrl(workspaceId)}/social-connections/${connectionId}/sync`);
const grantAccount = (token, workspaceId, accountId, memberIds) =>
  as(token)
    .patch(`${wsUrl(workspaceId)}/social-accounts/${accountId}/access`)
    .send({ grant: memberIds });

const names = (res) => res.body.items.map((item) => item.name);
const itemIds = (res) => res.body.items.map((item) => item.id);
const byName = (res) => Object.fromEntries(res.body.items.map((item) => [item.name, item]));
const errorOf = (res) => ({ code: res.body.error?.code, message: res.body.error?.message });

/** The `connection` summary every destination item carries. */
const loginSummary = (
  id,
  displayName,
  pictureUrl,
  provider = 'FACEBOOK_LOGIN',
  status = 'ACTIVE',
) => ({
  id,
  provider,
  displayName,
  pictureUrl,
  status,
});

async function ownerWorkspace(name = 'Acme Social') {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name });
  return { owner, workspace };
}

/** Completes the simulated Facebook Login round trip; returns the connection id. */
async function connectFb(token, workspaceId, fbUserId) {
  const { result, connectionId } = await connectFacebook(fake, token, workspaceId, fbUserId);
  expect(result).toMatchObject({ status: 'success' });
  return connectionId;
}

/** Completes the simulated Instagram Login round trip; returns the connection id. */
async function connectIg(token, workspaceId, igUserId) {
  const { result, connectionId } = await connectInstagram(fake, token, workspaceId, igUserId);
  expect(result).toMatchObject({ status: 'success' });
  return connectionId;
}

async function select(token, workspaceId, connectionId, accounts) {
  const res = await selectAccounts(token, workspaceId, connectionId, accounts);
  expect(res.status).toBe(200);
  return res.body;
}

const ALICE_PAGES = [
  {
    id: '5001',
    name: 'Acme Store',
    instagram: { id: ACME_IG, username: 'acme.gram', name: 'Acme Photos' },
  },
  { id: '5002', name: 'Acme Labs', tasks: ['ANALYZE'] },
  { id: '5003', name: 'Beta Bakery' },
];

/**
 * Six destinations from three logins:
 *  - "Alice" (Facebook Login): Acme Store with its Instagram account Acme Photos (@acme.gram),
 *    Acme Labs (Page role without CREATE_CONTENT) and Beta Bakery.
 *  - "Bob" (Facebook Login): Zeta Garage. Bob's token then expires at Meta; a sync records it.
 *  - "@solo.creator" (Instagram Login, Creator account): Solo Creator.
 */
async function seedPortfolio(token, workspaceId) {
  fake.addFacebookUser({ id: '100', name: 'Alice', pages: ALICE_PAGES });
  fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '6001', name: 'Zeta Garage' }] });
  fake.addInstagramUser({
    id: '9001',
    accountId: SOLO_IG,
    username: 'solo.creator',
    name: 'Solo Creator',
    accountType: 'Media_Creator',
  });

  const alice = await connectFb(token, workspaceId, '100');
  const bob = await connectFb(token, workspaceId, '200');
  const solo = await connectIg(token, workspaceId, '9001');
  await select(token, workspaceId, alice, [
    page('5001'),
    insta(ACME_IG),
    page('5002'),
    page('5003'),
  ]);
  await select(token, workspaceId, bob, [page('6001')]);
  await select(token, workspaceId, solo, [insta(SOLO_IG)]);

  fake.setTokenState('200', 'expired');
  const synced = await syncLogin(token, workspaceId, bob);
  expect(synced.body).toMatchObject({
    outcome: 'TOKEN_EXPIRED',
    connection: { status: 'EXPIRED' },
  });

  const docs = await SocialAccount.find({ workspace: workspaceId });
  expect(docs).toHaveLength(6);
  return {
    connections: { alice, bob, solo },
    ids: Object.fromEntries(docs.map((doc) => [doc.name, String(doc._id)])),
  };
}

/* ------------------------------------------- 1. several logins per workspace */

describe('several Facebook logins in one workspace (simulated Meta)', () => {
  it('keeps each login an independent connection; adding a second never changes the first', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [{ id: '5001', name: 'Alice Page' }] });
    fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '5002', name: 'Bob Page' }] });

    const alice = await connectFacebook(fake, owner.token, workspace.id, '100');
    expect(alice.result).toMatchObject({ status: 'success', reason: 'CONNECTED' });
    await select(owner.token, workspace.id, alice.connectionId, [page('5001')]);

    const storedAlice = async () => {
      const connection = await SocialConnection.findById(alice.connectionId).select('+accessToken');
      const accounts = await SocialAccount.find({ connection: alice.connectionId }).select(
        '+accessToken',
      );
      return {
        token: connection.getAccessToken(),
        status: connection.status,
        grantedScopes: [...connection.grantedScopes],
        updatedAt: connection.updatedAt.toISOString(),
        accounts: accounts.map((a) => ({
          id: String(a._id),
          token: a.getAccessToken(),
          status: a.connectionStatus,
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    };
    const before = await storedAlice();
    expect(before.token).toMatch(/^fb_long_100_/);
    expect(before.accounts).toEqual([
      expect.objectContaining({ token: fake.pageToken('100', '5001'), status: 'ACTIVE' }),
    ]);
    const [aliceLoginBefore] = (await listLogins(owner.token, workspace.id)).body.items;
    const [alicePageBefore] = (await listAccounts(owner.token, workspace.id)).body.items;

    const bob = await connectFacebook(fake, owner.token, workspace.id, '200');
    expect(bob.result).toMatchObject({ status: 'success', reason: 'CONNECTED' });
    expect(bob.connectionId).not.toBe(alice.connectionId);
    await select(owner.token, workspace.id, bob.connectionId, [page('5002')]);

    // Alice's connection and destinations are untouched: same token, status, scopes, records.
    expect(await storedAlice()).toEqual(before);
    const bobLogin = await SocialConnection.findById(bob.connectionId).select('+accessToken');
    expect(bobLogin.getAccessToken()).toMatch(/^fb_long_200_/);

    const logins = (await listLogins(owner.token, workspace.id)).body.items;
    expect(logins).toHaveLength(2);
    expect(logins.find((c) => c.id === alice.connectionId)).toEqual(aliceLoginBefore);
    expect(logins.find((c) => c.id === bob.connectionId)).toMatchObject({
      provider: 'FACEBOOK_LOGIN',
      displayName: 'Bob',
      status: 'ACTIVE',
      accountCount: 1,
      accountCounts: { facebookPages: 1, instagramAccounts: 0, needsAttention: 0 },
    });

    const res = await listAccounts(owner.token, workspace.id);
    expect(names(res)).toEqual(['Alice Page', 'Bob Page']);
    expect(byName(res)['Alice Page']).toEqual(alicePageBefore);
    expect(byName(res)['Bob Page'].connection).toEqual(
      loginSummary(bob.connectionId, 'Bob', 'https://example.fbcdn.net/200.jpg'),
    );
    const aliceOnly = await listAccounts(owner.token, workspace.id, {
      connectionId: alice.connectionId,
    });
    expect(names(aliceOnly)).toEqual(['Alice Page']);
    const bobOnly = await listAccounts(owner.token, workspace.id, {
      connectionId: bob.connectionId,
    });
    expect(names(bobOnly)).toEqual(['Bob Page']);

    // Bob authorizing again updates only Bob's connection.
    const again = await connectFacebook(fake, owner.token, workspace.id, '200');
    expect(again.result.reason).toBe('RECONNECTED');
    expect(again.connectionId).toBe(bob.connectionId);
    expect(await storedAlice()).toEqual(before);
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(2);
  });
});

/* ------------------------------------------------ 2. several Pages per login */

describe('one Facebook login with several Pages (simulated Meta)', () => {
  it('offers every Page and the linked Instagram account, and lists each with its login', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: ALICE_PAGES });
    const alice = await connectFb(owner.token, workspace.id, '100');

    const found = await discover(owner.token, workspace.id, alice);
    expect(found.status).toBe(200);
    expect(found.body.candidates.map((c) => [c.platform, c.externalId, c.state])).toEqual([
      ['FACEBOOK_PAGE', '5001', 'NEW'],
      ['INSTAGRAM_ACCOUNT', ACME_IG, 'NEW'],
      ['FACEBOOK_PAGE', '5002', 'NEW'],
      ['FACEBOOK_PAGE', '5003', 'NEW'],
    ]);
    expect(found.body.candidates.every((c) => c.hasAccessToken)).toBe(true);
    expect(found.body.candidates[1].linkedPage).toEqual({ externalId: '5001', name: 'Acme Store' });

    const selected = await select(
      owner.token,
      workspace.id,
      alice,
      found.body.candidates.map(({ platform, externalId }) => ({ platform, externalId })),
    );
    expect(selected.added).toHaveLength(4);
    expect(selected.skipped).toEqual([]);

    const res = await listAccounts(owner.token, workspace.id);
    expect(res.body.total).toBe(4);
    expect(names(res)).toEqual(['Acme Labs', 'Acme Photos', 'Acme Store', 'Beta Bakery']);
    for (const item of res.body.items) {
      expect(item.connection).toEqual(loginSummary(alice, 'Alice', ALICE_PICTURE));
    }
    const items = byName(res);
    expect(items['Acme Photos']).toMatchObject({
      platform: 'INSTAGRAM_ACCOUNT',
      externalId: ACME_IG,
      username: 'acme.gram',
      tasks: FULL_PAGE_TASKS,
      linkedPage: { id: items['Acme Store'].id, externalId: '5001', name: 'Acme Store' },
      health: { readiness: 'READY', needsAttention: false },
    });
    for (const name of ['Acme Store', 'Acme Labs', 'Beta Bakery']) {
      expect(items[name]).toMatchObject({ platform: 'FACEBOOK_PAGE', linkedPage: null });
    }
    expect(items['Acme Labs'].health).toMatchObject({
      readiness: 'RESTRICTED',
      eligibility: { eligible: false, createContent: false },
      attention: [{ code: 'MISSING_CREATE_CONTENT' }],
      needsAttention: true,
    });

    const logins = await listLogins(owner.token, workspace.id);
    expect(logins.body.items).toEqual([
      expect.objectContaining({
        id: alice,
        displayName: 'Alice',
        accountCount: 4,
        accountCounts: { facebookPages: 3, instagramAccounts: 1, needsAttention: 1 },
      }),
    ]);

    const again = await discover(owner.token, workspace.id, alice);
    expect(again.body.candidates.map((c) => c.state)).toEqual(Array(4).fill('CONNECTED_HERE'));
    expect(again.body.candidates.map((c) => c.existingAccountId).sort()).toEqual(
      itemIds(res).sort(),
    );
  });

  it('adds Pages incrementally: unselected Pages stay available and the counts follow', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: ALICE_PAGES });
    const alice = await connectFb(owner.token, workspace.id, '100');
    await select(owner.token, workspace.id, alice, [page('5001'), page('5003')]);

    const found = await discover(owner.token, workspace.id, alice);
    expect(Object.fromEntries(found.body.candidates.map((c) => [c.externalId, c.state]))).toEqual({
      5001: 'CONNECTED_HERE',
      [ACME_IG]: 'NEW',
      5002: 'NEW',
      5003: 'CONNECTED_HERE',
    });
    expect((await listLogins(owner.token, workspace.id)).body.items[0]).toMatchObject({
      accountCount: 2,
      accountCounts: { facebookPages: 2, instagramAccounts: 0, needsAttention: 0 },
    });

    await select(owner.token, workspace.id, alice, [page('5002'), insta(ACME_IG)]);
    const res = await listAccounts(owner.token, workspace.id);
    expect(names(res)).toEqual(['Acme Labs', 'Acme Photos', 'Acme Store', 'Beta Bakery']);
    // The Instagram account added after its Page is linked to that Page's record.
    expect(byName(res)['Acme Photos'].linkedPage).toEqual({
      id: byName(res)['Acme Store'].id,
      externalId: '5001',
      name: 'Acme Store',
    });
    expect((await listLogins(owner.token, workspace.id)).body.items[0]).toMatchObject({
      accountCount: 4,
      accountCounts: { facebookPages: 3, instagramAccounts: 1, needsAttention: 1 },
    });
  });
});

/* --------------------------------------- 3. one Page in several workspaces */

describe('the same Page in two workspaces (simulated Meta)', () => {
  it('keeps a separate record per workspace; each workspace sees and removes only its own', async () => {
    const { owner, workspace: one } = await ownerWorkspace('Brand One');
    const { workspace: two } = await createWorkspace(owner.token, { name: 'Brand Two' });
    fake.addFacebookUser({
      id: '100',
      name: 'Alice',
      pages: [{ id: '5001', name: 'Shared Page' }],
    });

    const loginOne = await connectFb(owner.token, one.id, '100');
    const loginTwo = await connectFb(owner.token, two.id, '100');
    expect(loginOne).not.toBe(loginTwo);
    const [inOne] = (await select(owner.token, one.id, loginOne, [page('5001')])).added;
    const [inTwo] = (await select(owner.token, two.id, loginTwo, [page('5001')])).added;
    expect(inOne.id).not.toBe(inTwo.id);

    const docs = await SocialAccount.find({ externalId: '5001' }).sort({ _id: 1 });
    expect(docs.map((d) => [String(d._id), String(d.workspace), String(d.connection)])).toEqual([
      [inOne.id, one.id, loginOne],
      [inTwo.id, two.id, loginTwo],
    ]);

    const listOne = await listAccounts(owner.token, one.id);
    const listTwo = await listAccounts(owner.token, two.id);
    expect(itemIds(listOne)).toEqual([inOne.id]);
    expect(itemIds(listTwo)).toEqual([inTwo.id]);
    expect(listOne.body.items[0].connection.id).toBe(loginOne);
    expect(listTwo.body.items[0].connection.id).toBe(loginTwo);
    // A workspace never resolves the other workspace's record, even for the same person.
    expect((await accountDetail(owner.token, one.id, inTwo.id)).status).toBe(404);
    expect((await accountDetail(owner.token, two.id, inOne.id)).status).toBe(404);

    // The cross-workspace view shows two separate entries.
    const cross = await as(owner.token).get('/api/v1/social-accounts');
    expect(cross.body.items.map((a) => [a.id, a.workspace.id]).sort()).toEqual(
      [
        [inOne.id, one.id],
        [inTwo.id, two.id],
      ].sort(),
    );

    // Removing the Page from workspace One leaves workspace Two's record exactly as it was.
    expect(
      (await as(owner.token).delete(`${wsUrl(two.id)}/social-accounts/${inOne.id}`)).status,
    ).toBe(404);
    expect(
      (await as(owner.token).delete(`${wsUrl(one.id)}/social-accounts/${inOne.id}`)).status,
    ).toBe(204);
    expect((await listAccounts(owner.token, one.id)).body).toMatchObject({ items: [], total: 0 });
    expect((await listAccounts(owner.token, two.id)).body.items).toEqual(listTwo.body.items);
    const kept = await SocialAccount.findById(inTwo.id).select('+accessToken');
    expect(kept.getAccessToken()).toBe(fake.pageToken('100', '5001'));
    expect((await SocialConnection.findById(loginOne)).status).toBe('ACTIVE');
    const crossAfter = await as(owner.token).get('/api/v1/social-accounts');
    expect(itemIds(crossAfter)).toEqual([inTwo.id]);
  });

  it('does not treat a Page connected in another workspace as already connected', async () => {
    const { owner, workspace: one } = await ownerWorkspace('Brand One');
    const agency = await registerUser({ name: 'Sam Stranger' });
    const { workspace: two } = await createWorkspace(agency.token, { name: 'Agency Two' });
    fake.addFacebookUser({
      id: '100',
      name: 'Alice',
      pages: [{ id: '5001', name: 'Shared Page' }],
    });
    fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '5001', name: 'Shared Page' }] });

    const alice = await connectFb(owner.token, one.id, '100');
    const [inOne] = (await select(owner.token, one.id, alice, [page('5001')])).added;

    const bob = await connectFb(agency.token, two.id, '200');
    const found = await discover(agency.token, two.id, bob);
    expect(found.body.candidates).toEqual([
      expect.objectContaining({
        externalId: '5001',
        state: 'NEW',
        existingAccountId: null,
        connectedVia: null,
      }),
    ]);
    const [inTwo] = (await select(agency.token, two.id, bob, [page('5001')])).added;

    const stored = await SocialAccount.find({ externalId: '5001' }).select('+accessToken');
    const tokenOf = (id) => stored.find((d) => String(d._id) === id).getAccessToken();
    expect(tokenOf(inOne.id)).toBe(fake.pageToken('100', '5001'));
    expect(tokenOf(inTwo.id)).toBe(fake.pageToken('200', '5001'));
    expect(itemIds(await listAccounts(owner.token, one.id))).toEqual([inOne.id]);
    expect(itemIds(await listAccounts(agency.token, two.id))).toEqual([inTwo.id]);
    expect((await listAccounts(owner.token, two.id)).status).toBe(404);
  });
});

/* -------------------------------------------------- 4. duplicate prevention */

describe('duplicate prevention (simulated Meta)', () => {
  it('updates the existing record when the same login selects a Page again', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [{ id: '5001', name: 'Acme Store' }] });
    const alice = await connectFb(owner.token, workspace.id, '100');
    const [added] = (await select(owner.token, workspace.id, alice, [page('5001')])).added;

    const again = await select(owner.token, workspace.id, alice, [page('5001'), page('5001')]);
    expect(again).toMatchObject({ added: [], relinked: [], skipped: [] });
    expect(again.updated.map((a) => a.id)).toEqual([added.id]);

    fake.pages.get('5001').name = 'Acme Store (renamed)';
    const renamed = await select(owner.token, workspace.id, alice, [page('5001')]);
    expect(renamed.updated).toEqual([
      expect.objectContaining({ id: added.id, name: 'Acme Store (renamed)' }),
    ]);

    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(1);
    const res = await listAccounts(owner.token, workspace.id);
    expect(res.body.items.map((a) => [a.id, a.name])).toEqual([[added.id, 'Acme Store (renamed)']]);
    expect((await listLogins(owner.token, workspace.id)).body.items[0].accountCount).toBe(1);
  });

  it('reports a Page reachable through a second login as CONNECTED_VIA_OTHER and never duplicates it', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({
      id: '100',
      name: 'Alice',
      pages: [{ id: '5001', name: 'Shared Page' }],
    });
    fake.addFacebookUser({
      id: '200',
      name: 'Bob',
      pages: [
        { id: '5001', name: 'Shared Page' },
        { id: '5002', name: 'Bob Page' },
      ],
    });
    const alice = await connectFb(owner.token, workspace.id, '100');
    const bob = await connectFb(owner.token, workspace.id, '200');
    const [shared] = (await select(owner.token, workspace.id, alice, [page('5001')])).added;

    const found = await discover(owner.token, workspace.id, bob);
    expect(found.body.candidates.find((c) => c.externalId === '5001')).toMatchObject({
      state: 'CONNECTED_VIA_OTHER',
      existingAccountId: shared.id,
      connectedVia: { id: alice, displayName: 'Alice' },
    });
    expect(found.body.candidates.find((c) => c.externalId === '5002').state).toBe('NEW');

    const res = await select(owner.token, workspace.id, bob, [page('5001'), page('5002')]);
    expect(res.skipped).toEqual([
      expect.objectContaining({ externalId: '5001', reason: 'CONNECTED_VIA_OTHER' }),
    ]);
    expect(res.added.map((a) => a.externalId)).toEqual(['5002']);
    expect(
      await SocialAccount.countDocuments({ workspace: workspace.id, externalId: '5001' }),
    ).toBe(1);

    const list = await listAccounts(owner.token, workspace.id);
    expect(list.body.items.map((a) => [a.externalId, a.id === shared.id, a.connection.id])).toEqual(
      [
        ['5002', false, bob],
        ['5001', true, alice],
      ],
    );
    const counts = Object.fromEntries(
      (await listLogins(owner.token, workspace.id)).body.items.map((c) => [
        c.displayName,
        c.accountCount,
      ]),
    );
    expect(counts).toEqual({ Alice: 1, Bob: 1 });

    // Once Alice's login can no longer be used, Bob's login takes over the SAME record.
    await as(owner.token).post(`${wsUrl(workspace.id)}/social-connections/${alice}/disconnect`);
    const relinked = await select(owner.token, workspace.id, bob, [page('5001')]);
    expect(relinked.relinked.map((a) => a.id)).toEqual([shared.id]);
    expect(
      await SocialAccount.countDocuments({ workspace: workspace.id, externalId: '5001' }),
    ).toBe(1);
    const after = byName(await listAccounts(owner.token, workspace.id))['Shared Page'];
    expect(after).toMatchObject({ id: shared.id, connection: { id: bob, displayName: 'Bob' } });
  });

  it('registers an Instagram account reachable through Facebook Login and Instagram Login once', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [ALICE_PAGES[0]] });
    fake.addInstagramUser({
      id: '9010',
      accountId: ACME_IG,
      username: 'acme.gram',
      name: 'Acme Photos',
      accountType: 'Business',
    });
    const alice = await connectFb(owner.token, workspace.id, '100');
    await select(owner.token, workspace.id, alice, [page('5001'), insta(ACME_IG)]);

    const igLogin = await connectIg(owner.token, workspace.id, '9010');
    const found = await discover(owner.token, workspace.id, igLogin);
    expect(found.body.candidates).toEqual([
      expect.objectContaining({
        externalId: ACME_IG,
        state: 'CONNECTED_VIA_OTHER',
        connectedVia: { id: alice, displayName: 'Alice' },
      }),
    ]);
    const res = await select(owner.token, workspace.id, igLogin, [insta(ACME_IG)]);
    expect(res).toMatchObject({ added: [], updated: [], relinked: [] });
    expect(res.skipped).toEqual([expect.objectContaining({ reason: 'CONNECTED_VIA_OTHER' })]);

    const instagram = await listAccounts(owner.token, workspace.id, {
      platform: 'INSTAGRAM_ACCOUNT',
    });
    expect(instagram.body.items).toEqual([
      expect.objectContaining({
        externalId: ACME_IG,
        connection: expect.objectContaining({ id: alice }),
      }),
    ]);
    expect(
      (await listLogins(owner.token, workspace.id)).body.items.find((c) => c.id === igLogin),
    ).toMatchObject({
      provider: 'INSTAGRAM_LOGIN',
      accountCount: 0,
      accountCounts: { facebookPages: 0, instagramAccounts: 0, needsAttention: 0 },
    });
  });

  it('enforces one record per Page per workspace in the database', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [{ id: '5001', name: 'Acme Store' }] });
    fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '5001', name: 'Acme Store' }] });
    const alice = await connectFb(owner.token, workspace.id, '100');
    const bob = await connectFb(owner.token, workspace.id, '200');
    await select(owner.token, workspace.id, alice, [page('5001')]);

    const indexes = await SocialAccount.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: 'one_destination_per_workspace',
        unique: true,
        key: { workspace: 1, platform: 1, externalId: 1 },
      }),
    );
    await expect(
      SocialAccount.create({
        workspace: workspace.id,
        connection: bob,
        platform: 'FACEBOOK_PAGE',
        externalId: '5001',
        name: 'Acme Store (duplicate)',
        connectedBy: owner.user.id,
      }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(1);
    expect((await listAccounts(owner.token, workspace.id)).body.total).toBe(1);
  });
});

/* ----------------------------------- 5. listing: search, filters, sort, pages */

describe('workspace account listing (simulated Meta)', () => {
  let owner;
  let workspace;
  let portfolio;
  beforeEach(async () => {
    ({ owner, workspace } = await ownerWorkspace());
    portfolio = await seedPortfolio(owner.token, workspace.id);
  });
  const query = (params) => listAccounts(owner.token, workspace.id, params);

  it('lists every visible destination by name with the documented item shape', async () => {
    const res = await query();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 6, page: 1, limit: 500, pages: 1, truncated: false });
    expect(names(res)).toEqual(ALL_NAMES);

    const items = byName(res);
    expect(items['Acme Store']).toEqual({
      id: portfolio.ids['Acme Store'],
      workspace: workspace.id,
      platform: 'FACEBOOK_PAGE',
      externalId: '5001',
      name: 'Acme Store',
      pictureUrl: 'https://example.fbcdn.net/page-5001.jpg',
      category: 'Brand',
      tasks: FULL_PAGE_TASKS,
      connectionStatus: 'ACTIVE',
      publishingStatus: 'READY',
      connectedBy: owner.user.id,
      lastSyncedAt: expect.any(String),
      followersCount: null,
      followersCountUpdatedAt: null,
      labels: [],
      starred: false,
      hasNotes: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      connection: loginSummary(portfolio.connections.alice, 'Alice', ALICE_PICTURE),
      linkedPage: null,
      health: {
        connectionStatus: 'ACTIVE',
        connectionStatusReason: null,
        readiness: 'READY',
        readinessReasons: [],
        eligibility: { eligible: true, createContent: true, missingPermissions: [] },
        attention: [],
        needsAttention: false,
      },
    });
    expect(items['Acme Photos']).toMatchObject({
      platform: 'INSTAGRAM_ACCOUNT',
      username: 'acme.gram',
      linkedFacebookPageExternalId: '5001',
      linkedFacebookPageName: 'Acme Store',
      linkedPage: { id: portfolio.ids['Acme Store'], externalId: '5001', name: 'Acme Store' },
    });
    expect(items['Zeta Garage'].connection).toEqual(
      loginSummary(
        portfolio.connections.bob,
        'Bob',
        'https://example.fbcdn.net/200.jpg',
        'FACEBOOK_LOGIN',
        'EXPIRED',
      ),
    );
    expect(items['Zeta Garage'].health).toEqual({
      connectionStatus: 'EXPIRED',
      connectionStatusReason: expect.stringMatching(/expired/i),
      readiness: 'UNAVAILABLE',
      readinessReasons: [expect.stringMatching(/expired/i)],
      eligibility: { eligible: true, createContent: true, missingPermissions: [] },
      attention: [{ code: 'CONNECTION_EXPIRED', message: expect.stringMatching(/expired/i) }],
      needsAttention: true,
    });
    expect(items['Solo Creator']).toMatchObject({
      instagramAccountType: 'CREATOR',
      linkedPage: null,
      connection: loginSummary(
        portfolio.connections.solo,
        '@solo.creator',
        `https://example.cdninstagram.com/${SOLO_IG}.jpg`,
        'INSTAGRAM_LOGIN',
      ),
    });
  });

  it('filters by platform, connection status, readiness, attention and login', async () => {
    const { alice, solo } = portfolio.connections;
    const cases = [
      [{ platform: 'FACEBOOK_PAGE' }, ['Acme Labs', 'Acme Store', 'Beta Bakery', 'Zeta Garage']],
      [{ platform: 'INSTAGRAM_ACCOUNT' }, ['Acme Photos', 'Solo Creator']],
      [{ status: 'EXPIRED' }, ['Zeta Garage']],
      [
        { status: 'ACTIVE' },
        ['Acme Labs', 'Acme Photos', 'Acme Store', 'Beta Bakery', 'Solo Creator'],
      ],
      [{ status: 'REVOKED' }, []],
      [{ readiness: 'READY' }, ['Acme Photos', 'Acme Store', 'Beta Bakery', 'Solo Creator']],
      [{ readiness: 'RESTRICTED' }, ['Acme Labs']],
      [{ readiness: 'UNAVAILABLE' }, ['Zeta Garage']],
      [{ attention: 'true' }, ['Acme Labs', 'Zeta Garage']],
      [{ attention: 'false' }, ['Acme Photos', 'Acme Store', 'Beta Bakery', 'Solo Creator']],
      [{ connectionId: alice }, ['Acme Labs', 'Acme Photos', 'Acme Store', 'Beta Bakery']],
      [{ connectionId: solo }, ['Solo Creator']],
      [{ connectionId: MISSING_ID }, []],
      [{ platform: 'FACEBOOK_PAGE', readiness: 'READY' }, ['Acme Store', 'Beta Bakery']],
      [{ connectionId: alice, attention: 'true' }, ['Acme Labs']],
      [{ platform: 'INSTAGRAM_ACCOUNT', connectionId: alice }, ['Acme Photos']],
    ];
    for (const [params, expected] of cases) {
      const res = await query(params);
      const label = JSON.stringify(params);
      expect(res.status, label).toBe(200);
      expect(names(res), label).toEqual(expected);
      expect(res.body.total, label).toBe(expected.length);
    }
  });

  it('searches names, usernames, Meta ids, login names and linked Page names', async () => {
    const cases = [
      ['bakery', ['Beta Bakery']],
      ['BAKERY', ['Beta Bakery']],
      ['  labs  ', ['Acme Labs']],
      ['gram', ['Acme Photos']], // Instagram username @acme.gram
      ['6001', ['Zeta Garage']], // Page id
      [SOLO_IG, ['Solo Creator']], // Instagram account id
      ['bob', ['Zeta Garage']], // login name
      ['alice', ['Acme Labs', 'Acme Photos', 'Acme Store', 'Beta Bakery']],
      ['store', ['Acme Photos', 'Acme Store']], // own name, and the linked Page's name
      ['no such account', []],
      ['', ALL_NAMES],
    ];
    for (const [q, expected] of cases) {
      const res = await query({ q });
      expect(res.status, q).toBe(200);
      expect(names(res), q).toEqual(expected);
    }
    // Search combines with the other filters.
    expect(names(await query({ q: 'acme', platform: 'FACEBOOK_PAGE' }))).toEqual([
      'Acme Labs',
      'Acme Store',
    ]);
  });

  it('sorts by name, attention and last sync, with never-synced accounts last', async () => {
    const lastSynced = {
      'Acme Store': '2026-11-01',
      'Acme Labs': '2026-11-02',
      'Acme Photos': '2026-11-03',
      'Solo Creator': '2026-11-04',
      'Zeta Garage': '2026-11-05',
    };
    for (const [name, day] of Object.entries(lastSynced)) {
      await SocialAccount.updateOne(
        { _id: portfolio.ids[name] },
        { lastSyncedAt: new Date(`${day}T08:00:00.000Z`) },
      );
    }
    await SocialAccount.updateOne(
      { _id: portfolio.ids['Beta Bakery'] },
      { $unset: { lastSyncedAt: 1 } },
    );

    expect(names(await query({ sort: 'name' }))).toEqual(ALL_NAMES);
    expect(names(await query({ sort: '-name' }))).toEqual([...ALL_NAMES].reverse());
    expect(names(await query({ sort: 'attention' }))).toEqual([
      'Zeta Garage', // needs attention, unavailable
      'Acme Labs', // needs attention, restricted
      'Acme Photos',
      'Acme Store',
      'Beta Bakery',
      'Solo Creator',
    ]);
    expect(names(await query({ sort: '-lastSyncedAt' }))).toEqual([
      'Zeta Garage',
      'Solo Creator',
      'Acme Photos',
      'Acme Labs',
      'Acme Store',
      'Beta Bakery',
    ]);
    expect(names(await query({ sort: 'lastSyncedAt' }))).toEqual([
      'Acme Store',
      'Acme Labs',
      'Acme Photos',
      'Solo Creator',
      'Zeta Garage',
      'Beta Bakery',
    ]);
    expect(names(await query({ sort: '-name', platform: 'INSTAGRAM_ACCOUNT' }))).toEqual([
      'Solo Creator',
      'Acme Photos',
    ]);
  });

  it('paginates with page, limit, pages and total, keeping the order stable across pages', async () => {
    const seen = [];
    for (const n of [1, 2, 3]) {
      const res = await query({ limit: 2, page: n });
      expect(res.body).toMatchObject({ total: 6, page: n, limit: 2, pages: 3 });
      expect(res.body.items).toHaveLength(2);
      seen.push(...names(res));
    }
    expect(seen).toEqual(ALL_NAMES);

    const beyond = await query({ limit: 2, page: 4 });
    expect(beyond.body).toMatchObject({ items: [], total: 6, page: 4, limit: 2, pages: 3 });
    const pagesOnly = await query({ platform: 'FACEBOOK_PAGE', limit: 3, page: 2 });
    expect(pagesOnly.body).toMatchObject({ total: 4, page: 2, limit: 3, pages: 2 });
    expect(names(pagesOnly)).toEqual(['Zeta Garage']);
    const sorted = await query({ sort: '-name', limit: 4, page: 2 });
    expect(names(sorted)).toEqual(['Acme Photos', 'Acme Labs']);
    expect((await query({ q: 'no such account' })).body).toMatchObject({
      items: [],
      total: 0,
      pages: 1,
    });
    // Facets describe the whole result, not the current page.
    expect(beyond.body.facets).toEqual((await query()).body.facets);
  });

  it('computes facets: platform over everything visible, the rest over the platform/login scope', async () => {
    const platform = { FACEBOOK_PAGE: 4, INSTAGRAM_ACCOUNT: 2 };
    const all = await query();
    expect(all.body.facets).toEqual({
      platform,
      status: { ACTIVE: 5, EXPIRED: 1 },
      readiness: { READY: 4, RESTRICTED: 1, UNAVAILABLE: 1 },
      attention: 2,
      labels: {},
      starred: 0,
    });
    expect((await query({ platform: 'INSTAGRAM_ACCOUNT' })).body.facets).toEqual({
      platform,
      status: { ACTIVE: 2 },
      readiness: { READY: 2 },
      attention: 0,
      labels: {},
      starred: 0,
    });
    expect((await query({ platform: 'FACEBOOK_PAGE' })).body.facets).toEqual({
      platform,
      status: { ACTIVE: 3, EXPIRED: 1 },
      readiness: { READY: 2, RESTRICTED: 1, UNAVAILABLE: 1 },
      attention: 2,
      labels: {},
      starred: 0,
    });
    expect((await query({ connectionId: portfolio.connections.alice })).body.facets).toEqual({
      platform,
      status: { ACTIVE: 4 },
      readiness: { READY: 3, RESTRICTED: 1 },
      attention: 1,
      labels: {},
      starred: 0,
    });
    // Status, readiness, attention and search narrow the items but never the facets.
    const narrowed = await query({ readiness: 'READY', attention: 'false', q: 'acme' });
    expect(names(narrowed)).toEqual(['Acme Photos', 'Acme Store']);
    expect(narrowed.body.facets).toEqual(all.body.facets);
  });

  it('never returns token material from listing, summary, detail or login endpoints', async () => {
    const docs = [
      ...(await SocialConnection.find({ workspace: workspace.id }).select('+accessToken')),
      ...(await SocialAccount.find({ workspace: workspace.id }).select('+accessToken')),
    ];
    const secrets = docs
      .filter((doc) => doc.hasAccessToken())
      .flatMap((doc) => [doc.getAccessToken(), doc.accessToken.ciphertext]);
    expect(secrets).toHaveLength(18); // 3 logins + 6 destinations: plain token and ciphertext each

    const base = wsUrl(workspace.id);
    const client = as(owner.token);
    const requests = [
      () => client.get(`${base}/social-accounts`),
      () => client.get(`${base}/social-accounts?q=acme&sort=attention&limit=2`),
      () => client.get(`${base}/social-accounts/summary`),
      ...Object.values(portfolio.ids).map(
        (id) => () => client.get(`${base}/social-accounts/${id}`),
      ),
      () => client.get(`${base}/social-accounts/${portfolio.ids['Acme Store']}/access`),
      () => client.get(`${base}/social-connections`),
      ...Object.values(portfolio.connections).flatMap((id) => [
        () => client.get(`${base}/social-connections/${id}`),
        () => client.get(`${base}/social-connections/${id}/sync-runs`),
      ]),
      () => client.get('/api/v1/social-accounts'),
      () => client.get('/api/v1/social-accounts/summary'),
      // Live discovery, re-selection and a sync (these handle tokens server-side).
      () => client.get(`${base}/social-connections/${portfolio.connections.alice}/discovery`),
      () => client.get(`${base}/social-connections/${portfolio.connections.solo}/discovery`),
      () =>
        client
          .post(`${base}/social-connections/${portfolio.connections.alice}/accounts`)
          .send({ accounts: [page('5001'), insta(ACME_IG)] }),
      () => client.post(`${base}/social-connections/${portfolio.connections.alice}/sync`),
    ];
    for (const send of requests) {
      const res = await send();
      const label = res.req.path;
      expect(res.status, label).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text, label).not.toMatch(TOKEN_MATERIAL);
      for (const secret of secrets) expect(text.includes(secret), label).toBe(false);
    }
  });
});

describe('account listing query validation', () => {
  it('rejects invalid or unknown query parameters with 422', async () => {
    const { owner, workspace } = await ownerWorkspace();
    const invalid = [
      'platform=TWITTER',
      'status=BROKEN',
      'readiness=MAYBE',
      'attention=yes',
      'connectionId=not-an-id',
      'sort=popularity',
      'page=0',
      'page=abc',
      'limit=0',
      'limit=501',
      `q=${'x'.repeat(101)}`,
      'unknown=1',
      `workspaceId=${workspace.id}`,
      'platform[$ne]=FACEBOOK_PAGE',
      'platform=FACEBOOK_PAGE&platform=INSTAGRAM_ACCOUNT',
    ];
    for (const qs of invalid) {
      const res = await as(owner.token).get(`${wsUrl(workspace.id)}/social-accounts?${qs}`);
      expect(res.status, qs).toBe(422);
      expect(res.body.error.code, qs).toBe('VALIDATION_ERROR');
    }
    const fields = await as(owner.token).get(
      `${wsUrl(workspace.id)}/social-accounts?platform=TWITTER&sort=popularity`,
    );
    expect(fields.body.error.details.fields).toEqual({
      platform: expect.any(String),
      sort: expect.any(String),
    });
    // The cross-workspace endpoints validate their query strings too.
    for (const path of [
      '/api/v1/social-accounts?workspaceId=nope',
      '/api/v1/social-accounts?readiness=MAYBE',
      '/api/v1/social-accounts/summary?platform=FACEBOOK_PAGE',
    ]) {
      expect((await as(owner.token).get(path)).status, path).toBe(422);
    }
    // A valid query on an empty workspace is an empty page, not an error.
    expect((await listAccounts(owner.token, workspace.id, { attention: 'true' })).body).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 500,
      pages: 1,
      facets: { platform: {}, status: {}, readiness: {}, attention: 0, labels: {}, starred: 0 },
      truncated: false,
    });
  });
});

/* ------------------------------------------------------------- 6. summary */

describe('account summary (simulated Meta)', () => {
  it('counts destinations and logins for managers; editors and viewers get no login figures', async () => {
    const team = await seedTeam();
    await seedPortfolio(team.owner.token, team.workspace.id);
    const accounts = {
      total: 6,
      facebookPages: 4,
      instagramAccounts: 2,
      connected: 5,
      needsAttention: 2,
      ready: 4,
      restricted: 1,
      unavailable: 1,
    };
    const connections = {
      total: 3,
      facebook: 2,
      instagram: 1,
      active: 2,
      expired: 1,
      revoked: 0,
      disconnected: 0,
      error: 0,
      expiringSoon: 0,
      needsAttention: 1,
    };
    for (const member of [team.owner, team.admin]) {
      const res = await accountSummary(member.token, team.workspace.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accounts,
        followers: unknownFollowers(4, 2),
        connections,
        meta: META_CONFIGURED,
        truncated: false,
      });
    }
    // Least privilege: no accounts assigned yet, and never login figures.
    for (const member of [team.editor, team.viewer]) {
      const res = await accountSummary(member.token, team.workspace.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accounts: NO_ACCOUNTS,
        followers: unknownFollowers(),
        connections: null,
        meta: META_CONFIGURED,
        truncated: false,
      });
    }
    const cross = await as(team.owner.token).get('/api/v1/social-accounts/summary');
    expect(cross.body).toEqual({
      accounts,
      followers: unknownFollowers(4, 2),
      connections,
      meta: META_CONFIGURED,
      truncated: false,
      workspaces: 1,
    });
  });

  it('counts logins in every state, including access that expires soon', async () => {
    const { owner, workspace } = await ownerWorkspace();
    const people = [
      ['100', 'Alice', '5001'],
      ['200', 'Bob', '5002'],
      ['300', 'Carol', '5003'],
      ['400', 'Dan', '5004'],
      ['500', 'Erin', '5005'],
      ['600', 'Finn', '5006'],
    ];
    const login = {};
    for (const [id, name, pageId] of people) {
      fake.addFacebookUser({ id, name, pages: [{ id: pageId, name: `${name} Page` }] });
      login[name] = await connectFb(owner.token, workspace.id, id);
      await select(owner.token, workspace.id, login[name], [page(pageId)]);
    }
    fake.addInstagramUser({
      id: '9001',
      accountId: SOLO_IG,
      username: 'solo.creator',
      name: 'Solo Creator',
      accountType: 'Media_Creator',
    });
    const solo = await connectIg(owner.token, workspace.id, '9001');
    await select(owner.token, workspace.id, solo, [insta(SOLO_IG)]);

    fake.setTokenState('200', 'expired');
    expect((await syncLogin(owner.token, workspace.id, login.Bob)).body.outcome).toBe(
      'TOKEN_EXPIRED',
    );
    fake.setTokenState('300', 'revoked');
    expect((await syncLogin(owner.token, workspace.id, login.Carol)).body.outcome).toBe(
      'TOKEN_REVOKED',
    );
    const disconnected = await as(owner.token).post(
      `${wsUrl(workspace.id)}/social-connections/${login.Dan}/disconnect`,
    );
    expect(disconnected.status).toBe(200);
    fake.setPermissions('500', { granted: ALL_FB_SCOPES.filter((s) => s !== 'pages_show_list') });
    expect((await syncLogin(owner.token, workspace.id, login.Erin)).body.outcome).toBe(
      'PERMISSION_DENIED',
    );
    await SocialConnection.updateOne(
      { _id: login.Finn },
      { tokenExpiresAt: new Date(Date.now() + 3 * DAY_MS) },
    );

    const res = await accountSummary(owner.token, workspace.id);
    expect(res.body.connections).toEqual({
      total: 7,
      facebook: 6,
      instagram: 1,
      active: 3,
      expired: 1,
      revoked: 1,
      disconnected: 1,
      error: 1,
      expiringSoon: 1,
      needsAttention: 5,
    });
    expect(res.body.accounts).toEqual({
      total: 7,
      facebookPages: 6,
      instagramAccounts: 1,
      connected: 3,
      needsAttention: 5,
      ready: 3,
      restricted: 0,
      unavailable: 4,
    });

    const flagged = await listAccounts(owner.token, workspace.id, { attention: 'true' });
    expect(
      Object.fromEntries(
        flagged.body.items.map((a) => [a.name, a.health.attention.map((x) => x.code)]),
      ),
    ).toEqual({
      'Bob Page': ['CONNECTION_EXPIRED'],
      'Carol Page': ['CONNECTION_REVOKED'],
      'Dan Page': ['DISCONNECTED'],
      'Erin Page': ['CONNECTION_ERROR'],
      'Finn Page': ['EXPIRING_SOON'],
    });
    expect(byName(flagged)['Finn Page'].health.readiness).toBe('READY');
    expect(flagged.body.facets.status).toEqual({
      ACTIVE: 3,
      EXPIRED: 1,
      REVOKED: 1,
      DISCONNECTED: 1,
      ERROR: 1,
    });
    for (const [status, name] of [
      ['EXPIRED', 'Bob Page'],
      ['REVOKED', 'Carol Page'],
      ['DISCONNECTED', 'Dan Page'],
      ['ERROR', 'Erin Page'],
    ]) {
      expect(names(await listAccounts(owner.token, workspace.id, { status })), status).toEqual([
        name,
      ]);
    }
  });

  it('reports missing Meta app credentials without contacting Meta or inventing results', async () => {
    const { owner, workspace } = await ownerWorkspace();
    const { ids } = await seedPortfolio(owner.token, workspace.id);
    const listed = await listAccounts(owner.token, workspace.id);
    const metaCalls = fake.calls.length;

    setMetaSettingsForTests({ facebook: null });
    expect((await accountSummary(owner.token, workspace.id)).body.meta).toEqual({
      facebookConfigured: false,
      instagramConfigured: true,
    });
    // Stored destinations are still listed exactly as before (nothing removed, nothing invented).
    expect((await listAccounts(owner.token, workspace.id)).body).toEqual(listed.body);
    const fbPage = await accountDetail(owner.token, workspace.id, ids['Acme Store']);
    expect(fbPage.body.capabilities.providerConfigured).toBe(false);
    const igAccount = await accountDetail(owner.token, workspace.id, ids['Solo Creator']);
    expect(igAccount.body.capabilities.providerConfigured).toBe(true);

    setMetaSettingsForTests({ facebook: null, instagram: null });
    const none = await accountSummary(owner.token, workspace.id);
    expect(none.body.meta).toEqual({ facebookConfigured: false, instagramConfigured: false });
    expect(none.body.accounts.total).toBe(6);
    expect(fake.calls).toHaveLength(metaCalls);
  });
});

/* -------------------------------------------------------------- 7. detail */

describe('account detail (simulated Meta)', () => {
  let team;
  let portfolio;
  beforeEach(async () => {
    team = await seedTeam();
    portfolio = await seedPortfolio(team.owner.token, team.workspace.id);
  });
  const show = (member, name) =>
    accountDetail(member.token, team.workspace.id, portfolio.ids[name]);

  it('shows a Page with its login, linked Instagram account, permissions, history, activity and team access', async () => {
    const { ids, connections } = portfolio;
    const synced = await syncLogin(team.owner.token, team.workspace.id, connections.alice);
    expect(synced.body.outcome).toBe('SUCCESS');

    const res = await show(team.owner, 'Acme Store');
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.account).toMatchObject({
      id: ids['Acme Store'],
      platform: 'FACEBOOK_PAGE',
      externalId: '5001',
      name: 'Acme Store',
      linkedPage: null,
      connection: loginSummary(connections.alice, 'Alice', ALICE_PICTURE),
      health: { readiness: 'READY', needsAttention: false },
    });
    expect(body.connection).toMatchObject({
      id: connections.alice,
      provider: 'FACEBOOK_LOGIN',
      displayName: 'Alice',
      status: 'ACTIVE',
      grantedScopes: ALL_FB_SCOPES,
      declinedScopes: [],
      missingScopes: { required: [], recommended: [], publishing: [] },
      lastSyncOutcome: 'SUCCESS',
      connectedBy: { id: team.owner.user.id, name: 'Olivia Owner' },
      attention: [],
      needsAttention: false,
    });
    expect(body.linkedPage).toBeNull();
    expect(body.linkedInstagram).toEqual([
      expect.objectContaining({
        id: ids['Acme Photos'],
        platform: 'INSTAGRAM_ACCOUNT',
        username: 'acme.gram',
        linkedPage: { id: ids['Acme Store'], externalId: '5001', name: 'Acme Store' },
      }),
    ]);
    expect(body.permissions).toEqual({
      granted: ALL_FB_SCOPES,
      declined: [],
      requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
      missing: [],
      tasks: FULL_PAGE_TASKS,
      createContent: true,
    });
    expect(body.syncHistory).toEqual([
      expect.objectContaining({
        connection: connections.alice,
        trigger: 'MANUAL',
        outcome: 'SUCCESS',
        actorName: 'Olivia Owner',
        statusBefore: 'ACTIVE',
        statusAfter: 'ACTIVE',
        accounts: { refreshed: 4, lost: 0 },
      }),
    ]);
    // Activity of this Page and its login only (not of the login's other destinations).
    expect(body.activity.map((entry) => entry.action)).toEqual([
      'social_connection.synced',
      'social_account.added',
      'social_connection.connected',
    ]);
    for (const entry of body.activity) {
      expect([ids['Acme Store'], connections.alice]).toContain(entry.target.id);
      expect(entry).not.toHaveProperty('ip');
      expect(entry).not.toHaveProperty('userAgent');
    }
    expect(
      body.access.map((m) => [m.role, m.mode, m.hasAccess, m.fullAccess, m.manageable]),
    ).toEqual([
      ['OWNER', 'ALL', true, true, false],
      ['ADMIN', 'ALL', true, true, false],
      ['EDITOR', 'SELECTED', false, false, true],
      ['VIEWER', 'SELECTED', false, false, true],
    ]);
    expect(body.capabilities).toEqual({
      canManageConnections: true,
      canManageAccess: true,
      canViewActivity: true,
      providerConfigured: true,
    });
  });

  it('shows an Instagram account linked to a Page with the full view of that Page', async () => {
    const { ids, connections } = portfolio;
    const res = await show(team.owner, 'Acme Photos');
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      id: ids['Acme Photos'],
      platform: 'INSTAGRAM_ACCOUNT',
      username: 'acme.gram',
      linkedPage: { id: ids['Acme Store'], externalId: '5001', name: 'Acme Store' },
    });
    expect(res.body.linkedPage).toMatchObject({
      id: ids['Acme Store'],
      platform: 'FACEBOOK_PAGE',
      externalId: '5001',
      name: 'Acme Store',
      connection: loginSummary(connections.alice, 'Alice', ALICE_PICTURE),
      health: { readiness: 'READY' },
    });
    expect(res.body.linkedInstagram).toEqual([]);
    expect(res.body.permissions).toEqual({
      granted: ALL_FB_SCOPES,
      declined: [],
      requiredForPublishing: [
        'instagram_basic',
        'instagram_content_publish',
        'pages_read_engagement',
      ],
      missing: [],
      tasks: FULL_PAGE_TASKS,
      createContent: true,
    });
  });

  it('shows an Instagram Login account on its own: no Page and no Page role', async () => {
    const res = await show(team.owner, 'Solo Creator');
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      platform: 'INSTAGRAM_ACCOUNT',
      username: 'solo.creator',
      instagramAccountType: 'CREATOR',
      linkedPage: null,
      connection: { id: portfolio.connections.solo, provider: 'INSTAGRAM_LOGIN' },
      health: {
        readiness: 'READY',
        eligibility: { eligible: true, createContent: null, missingPermissions: [] },
      },
    });
    expect(res.body.connection).toMatchObject({
      provider: 'INSTAGRAM_LOGIN',
      displayName: '@solo.creator',
      grantedScopes: ALL_IG_SCOPES,
      dataAccessExpiresAt: null,
    });
    expect(res.body.linkedPage).toBeNull();
    expect(res.body.linkedInstagram).toEqual([]);
    expect(res.body.permissions).toEqual({
      granted: ALL_IG_SCOPES,
      declined: [],
      requiredForPublishing: ['instagram_business_content_publish'],
      missing: [],
      tasks: null,
      createContent: null,
    });
  });

  it('explains why a destination is restricted or unavailable', async () => {
    const labs = await show(team.owner, 'Acme Labs');
    expect(labs.body.permissions).toMatchObject({
      tasks: ['ANALYZE'],
      createContent: false,
      missing: [],
    });
    expect(labs.body.account.health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: [expect.stringMatching(/CREATE_CONTENT/)],
      eligibility: { eligible: false, createContent: false, missingPermissions: [] },
      attention: [
        { code: 'MISSING_CREATE_CONTENT', message: expect.stringMatching(/CREATE_CONTENT/) },
      ],
      needsAttention: true,
    });

    const zeta = await show(team.owner, 'Zeta Garage');
    expect(zeta.body.account.health).toMatchObject({
      connectionStatus: 'EXPIRED',
      readiness: 'UNAVAILABLE',
      attention: [{ code: 'CONNECTION_EXPIRED' }],
      needsAttention: true,
    });
    expect(zeta.body.connection).toMatchObject({
      id: portfolio.connections.bob,
      status: 'EXPIRED',
      statusReason: expect.stringMatching(/expired/i),
      lastSyncOutcome: 'TOKEN_EXPIRED',
      lastError: { code: 'TOKEN_EXPIRED' },
      attention: [{ code: 'CONNECTION_EXPIRED' }],
      needsAttention: true,
    });
    expect(zeta.body.syncHistory).toEqual([
      expect.objectContaining({
        trigger: 'MANUAL',
        outcome: 'TOKEN_EXPIRED',
        statusBefore: 'ACTIVE',
        statusAfter: 'EXPIRED',
        accounts: { refreshed: 0, lost: 0 },
        error: expect.objectContaining({ kind: 'TOKEN_EXPIRED', code: 190 }),
      }),
    ]);
  });

  it('shows missing and declined permissions; such a Page is RESTRICTED, never READY', async () => {
    const granted = ALL_FB_SCOPES.filter((scope) => scope !== 'pages_manage_posts');
    fake.addFacebookUser({
      id: '300',
      name: 'Carol',
      granted,
      declined: ['pages_manage_posts'],
      pages: [{ id: '7001', name: 'Carol Cafe' }],
    });
    const carol = await connectFb(team.owner.token, team.workspace.id, '300');
    const [cafe] = (await select(team.owner.token, team.workspace.id, carol, [page('7001')])).added;
    await grantAccount(team.owner.token, team.workspace.id, cafe.id, [team.editor.membershipId]);

    const res = await accountDetail(team.owner.token, team.workspace.id, cafe.id);
    expect(res.body.permissions).toEqual({
      granted,
      declined: ['pages_manage_posts'],
      requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
      missing: ['pages_manage_posts'],
      tasks: FULL_PAGE_TASKS,
      createContent: true,
    });
    expect(res.body.account.health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: ['Missing permission: pages_manage_posts'],
      eligibility: {
        eligible: false,
        createContent: true,
        missingPermissions: ['pages_manage_posts'],
      },
      attention: [
        { code: 'MISSING_PERMISSIONS', message: 'Missing permission: pages_manage_posts' },
      ],
      needsAttention: true,
    });
    expect(res.body.connection).toMatchObject({
      declinedScopes: ['pages_manage_posts'],
      missingScopes: { required: [], recommended: [], publishing: ['pages_manage_posts'] },
    });
    // Editors see what is missing, but not the login's declined-permission details.
    const editorView = await accountDetail(team.editor.token, team.workspace.id, cafe.id);
    expect(editorView.body.permissions).toEqual({
      granted,
      requiredForPublishing: ['pages_manage_posts', 'pages_read_engagement'],
      missing: ['pages_manage_posts'],
      tasks: FULL_PAGE_TASKS,
      createContent: true,
    });
    expect(
      names(await listAccounts(team.owner.token, team.workspace.id, { readiness: 'RESTRICTED' })),
    ).toEqual(['Acme Labs', 'Carol Cafe']);
  });

  it('reports capabilities per role and keeps history, activity and team access from editors and viewers', async () => {
    const { ids, connections } = portfolio;
    const granted = await grantAccount(team.admin.token, team.workspace.id, ids['Acme Store'], [
      team.editor.membershipId,
      team.viewer.membershipId,
    ]);
    expect(granted.status).toBe(200);

    for (const member of [team.owner, team.admin]) {
      const res = await show(member, 'Acme Store');
      expect(res.status).toBe(200);
      expect(res.body.capabilities).toEqual({
        canManageConnections: true,
        canManageAccess: true,
        canViewActivity: true,
        providerConfigured: true,
      });
      expect(res.body.syncHistory).toEqual([]);
      expect(res.body.activity.length).toBeGreaterThan(0);
      expect(res.body.access).toHaveLength(4);
      expect(res.body.connection).toMatchObject({
        grantedScopes: ALL_FB_SCOPES,
        declinedScopes: [],
      });
      expect(res.body.permissions.declined).toEqual([]);
      expect(res.body.linkedInstagram.map((a) => a.id)).toEqual([ids['Acme Photos']]);
    }
    for (const member of [team.editor, team.viewer]) {
      const res = await show(member, 'Acme Store');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        account: { id: ids['Acme Store'], health: { readiness: 'READY' } },
        syncHistory: null,
        activity: null,
        access: null,
        capabilities: {
          canManageConnections: false,
          canManageAccess: false,
          canViewActivity: false,
          providerConfigured: true,
        },
      });
      // Only the summary of the login: no scopes, errors or who connected it.
      expect(res.body.connection).toEqual(loginSummary(connections.alice, 'Alice', ALICE_PICTURE));
      expect(res.body.permissions).not.toHaveProperty('declined');
      expect(res.body.permissions).toMatchObject({ granted: ALL_FB_SCOPES, createContent: true });
      // The linked Instagram account was not assigned to them.
      expect(res.body.linkedInstagram).toEqual([]);
    }
    expect(await SyncRun.countDocuments({ connection: connections.alice })).toBe(0);
  });
});

/* ------------------------------------------------- 8. workspace isolation */

describe('workspace isolation (simulated Meta)', () => {
  async function twoWorkspaces() {
    const { owner, workspace } = await ownerWorkspace();
    const editor = await addMember(workspace.id, owner.token, 'EDITOR', { name: 'Eddie Editor' });
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [{ id: '5001', name: 'Acme Store' }] });
    const alice = await connectFb(owner.token, workspace.id, '100');
    const [own] = (await select(owner.token, workspace.id, alice, [page('5001')])).added;

    const stranger = await registerUser({ name: 'Sam Stranger' });
    const { workspace: other } = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    fake.addFacebookUser({ id: '300', name: 'Sam', pages: [{ id: '7001', name: 'Foreign Page' }] });
    const sam = await connectFb(stranger.token, other.id, '300');
    const [foreign] = (await select(stranger.token, other.id, sam, [page('7001')])).added;
    return { owner, workspace, editor, own, stranger, other, sam, foreign };
  }

  it("never resolves, lists or changes another workspace's account from this workspace", async () => {
    const { owner, workspace, editor, own, stranger, other, sam, foreign } = await twoWorkspaces();
    const base = wsUrl(workspace.id);
    const client = as(owner.token);
    const metaCalls = fake.calls.length;

    const attempts = [
      ['detail', () => client.get(`${base}/social-accounts/${foreign.id}`)],
      ['refresh', () => client.post(`${base}/social-accounts/${foreign.id}/refresh`)],
      ['access', () => client.get(`${base}/social-accounts/${foreign.id}/access`)],
      [
        'grant',
        () =>
          client
            .patch(`${base}/social-accounts/${foreign.id}/access`)
            .send({ grant: [editor.membershipId] }),
      ],
      ['delete', () => client.delete(`${base}/social-accounts/${foreign.id}`)],
      [
        'bulk refresh',
        () => client.post(`${base}/social-accounts/refresh`).send({ accountIds: [foreign.id] }),
      ],
      [
        'bulk remove',
        () =>
          client.post(`${base}/social-accounts/remove`).send({ accountIds: [own.id, foreign.id] }),
      ],
      ['login detail', () => client.get(`${base}/social-connections/${sam}`)],
      ['login sync history', () => client.get(`${base}/social-connections/${sam}/sync-runs`)],
    ];
    for (const [label, send] of attempts) {
      const res = await send();
      expect(res.status, label).toBe(404);
      expect(res.body.error.code, label).toBe('NOT_FOUND');
    }
    const assign = await client
      .patch(`${base}/members/${editor.membershipId}/account-access`)
      .send({ add: [foreign.id] });
    expect(assign.status).toBe(422);
    expect(assign.body.error.details.fields.accounts).toBeTruthy();

    // Nothing changed anywhere and Meta was never contacted.
    expect(fake.calls).toHaveLength(metaCalls);
    expect(await SyncRun.countDocuments({ connection: sam })).toBe(0);
    const stored = await SocialAccount.findById(foreign.id).select('+accessToken');
    expect(stored.getAccessToken()).toBe(fake.pageToken('300', '7001'));
    expect(await SocialAccount.exists({ _id: own.id })).toBeTruthy();
    expect((await Membership.findById(editor.membershipId)).accountAccess.socialAccounts).toEqual(
      [],
    );
    expect(itemIds(await listAccounts(stranger.token, other.id))).toEqual([foreign.id]);

    // Never listed, whatever the filter.
    expect(itemIds(await listAccounts(owner.token, workspace.id))).toEqual([own.id]);
    for (const params of [{ connectionId: sam }, { q: 'Foreign' }, { q: '7001' }, { q: 'Sam' }]) {
      const res = await listAccounts(owner.token, workspace.id, params);
      expect(res.body, JSON.stringify(params)).toMatchObject({ items: [], total: 0 });
    }
    const summary = await accountSummary(owner.token, workspace.id);
    expect(summary.body.accounts.total).toBe(1);
    expect(summary.body.connections.total).toBe(1);
  });

  it('answers 404 to non-members on every workspace account route', async () => {
    const { owner, other, foreign, sam } = await twoWorkspaces();
    const client = as(owner.token);
    const routes = (workspaceId) => {
      const base = wsUrl(workspaceId);
      return [
        () => client.get(`${base}/social-accounts`),
        () => client.get(`${base}/social-accounts/summary`),
        () => client.get(`${base}/social-accounts/${foreign.id}`),
        () => client.post(`${base}/social-accounts/${foreign.id}/refresh`),
        () => client.get(`${base}/social-accounts/${foreign.id}/access`),
        () => client.delete(`${base}/social-accounts/${foreign.id}`),
        () => client.post(`${base}/social-accounts/refresh`).send({ accountIds: [foreign.id] }),
        () => client.post(`${base}/social-accounts/remove`).send({ accountIds: [foreign.id] }),
        () => client.get(`${base}/social-connections`),
        () => client.get(`${base}/social-connections/${sam}`),
      ];
    };
    // A workspace the user is not a member of answers exactly like one that does not exist.
    for (const workspaceId of [other.id, MISSING_ID]) {
      for (const send of routes(workspaceId)) {
        const res = await send();
        expect(res.status, res.req.path).toBe(404);
        expect(errorOf(res), res.req.path).toEqual({
          code: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }
    }
    expect(await SocialAccount.exists({ _id: foreign.id })).toBeTruthy();
  });

  it('lists across workspaces only the workspaces the user belongs to', async () => {
    const { owner, workspace, own, stranger, other, foreign } = await twoWorkspaces();
    const mine = await as(owner.token).get('/api/v1/social-accounts');
    expect(mine.status).toBe(200);
    expect(itemIds(mine)).toEqual([own.id]);
    expect(mine.body.items[0]).toMatchObject({
      workspace: { id: workspace.id, name: 'Acme Social', slug: workspace.slug },
      canManage: true,
    });
    expect(mine.body.facets.platform).toEqual({ FACEBOOK_PAGE: 1 });
    expect(itemIds(await as(stranger.token).get('/api/v1/social-accounts'))).toEqual([foreign.id]);
    expect(
      itemIds(await as(owner.token).get(`/api/v1/social-accounts?workspaceId=${workspace.id}`)),
    ).toEqual([own.id]);
    expect((await as(owner.token).get('/api/v1/social-accounts?q=Elsewhere')).body.items).toEqual(
      [],
    );

    // Asking for a foreign workspace is the same as asking for one that does not exist.
    for (const path of [
      `/api/v1/social-accounts?workspaceId=${other.id}`,
      `/api/v1/social-accounts/summary?workspaceId=${other.id}`,
      `/api/v1/social-accounts?workspaceId=${MISSING_ID}`,
    ]) {
      const res = await as(owner.token).get(path);
      expect(res.status, path).toBe(404);
      expect(errorOf(res), path).toEqual({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }
    const summary = await as(owner.token).get('/api/v1/social-accounts/summary');
    expect(summary.body).toMatchObject({
      accounts: { total: 1, facebookPages: 1 },
      connections: { total: 1 },
      workspaces: 1,
    });
  });

  it("applies each workspace's role and account access in the cross-workspace view", async () => {
    const { owner, workspace } = await ownerWorkspace('Alpha Brand');
    fake.addFacebookUser({
      id: '100',
      name: 'Alice',
      pages: [
        { id: '5001', name: 'Alpha One' },
        { id: '5002', name: 'Alpha Two' },
      ],
    });
    const alice = await connectFb(owner.token, workspace.id, '100');
    await select(owner.token, workspace.id, alice, [page('5001'), page('5002')]);

    const stranger = await registerUser({ name: 'Sam Stranger' });
    const { workspace: other } = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    fake.addFacebookUser({
      id: '300',
      name: 'Sam',
      pages: [
        { id: '7001', name: 'Bravo One' },
        { id: '7002', name: 'Bravo Two' },
      ],
    });
    const sam = await connectFb(stranger.token, other.id, '300');
    const bravo = (await select(stranger.token, other.id, sam, [page('7001'), page('7002')])).added;
    const bravoOne = bravo.find((a) => a.name === 'Bravo One');
    const bravoTwo = bravo.find((a) => a.name === 'Bravo Two');

    // Sam invites Olivia into "Elsewhere" as an editor; she starts with no accounts there.
    const invite = await as(stranger.token)
      .post(`${wsUrl(other.id)}/invitations`)
      .send({ email: owner.email, role: 'EDITOR' });
    expect(invite.status).toBe(201);
    const accepted = await as(owner.token).post(
      `/api/v1/invitations/${encodeURIComponent(tokenFromInviteUrl(invite.body.inviteUrl))}/accept`,
    );
    expect(accepted.status).toBe(200);
    expect(names(await as(owner.token).get('/api/v1/social-accounts'))).toEqual([
      'Alpha One',
      'Alpha Two',
    ]);

    const assign = await as(stranger.token)
      .patch(`${wsUrl(other.id)}/members/${accepted.body.membership.id}/account-access`)
      .send({ add: [bravoOne.id] });
    expect(assign.status).toBe(200);

    const cross = await as(owner.token).get('/api/v1/social-accounts');
    expect(cross.body.items.map((a) => [a.name, a.workspace.name, a.canManage])).toEqual([
      ['Alpha One', 'Alpha Brand', true],
      ['Alpha Two', 'Alpha Brand', true],
      ['Bravo One', 'Elsewhere', false],
    ]);
    expect(cross.body.facets.platform).toEqual({ FACEBOOK_PAGE: 3 });
    expect(
      names(await as(owner.token).get(`/api/v1/social-accounts?workspaceId=${other.id}`)),
    ).toEqual(['Bravo One']);
    expect(names(await as(owner.token).get('/api/v1/social-accounts?q=elsewhere'))).toEqual([
      'Bravo One',
    ]);
    const summary = await as(owner.token).get('/api/v1/social-accounts/summary');
    // Logins are counted only where she manages them (her own workspace).
    expect(summary.body).toMatchObject({
      accounts: { total: 3, facebookPages: 3 },
      connections: { total: 1, facebook: 1 },
      workspaces: 2,
    });
    expect((await accountDetail(owner.token, other.id, bravoOne.id)).status).toBe(200);
    expect((await accountDetail(owner.token, other.id, bravoTwo.id)).status).toBe(404);
  });
});

/* --------------------------------------------- 9. role-based visibility */

describe('role-based account visibility (simulated Meta)', () => {
  let team;
  let portfolio;
  let wsId;
  beforeEach(async () => {
    team = await seedTeam();
    portfolio = await seedPortfolio(team.owner.token, team.workspace.id);
    wsId = team.workspace.id;
  });

  it('shows owners and admins every account, and editors and viewers none until assigned', async () => {
    for (const member of [team.owner, team.admin]) {
      expect(names(await listAccounts(member.token, wsId))).toEqual(ALL_NAMES);
      expect((await accountSummary(member.token, wsId)).body.accounts.total).toBe(6);
    }
    for (const member of [team.editor, team.viewer]) {
      const res = await listAccounts(member.token, wsId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        items: [],
        total: 0,
        pages: 1,
        facets: { platform: {}, status: {}, readiness: {}, attention: 0, labels: {}, starred: 0 },
      });
      const summary = await accountSummary(member.token, wsId);
      expect(summary.body).toMatchObject({ accounts: NO_ACCOUNTS, connections: null });
      for (const [name, id] of Object.entries(portfolio.ids)) {
        expect((await accountDetail(member.token, wsId, id)).status, name).toBe(404);
      }
      expect((await as(member.token).get('/api/v1/social-accounts')).body.items).toEqual([]);
    }
  });

  it('shows an editor exactly the accounts an admin granted, in list, summary and detail', async () => {
    const { ids, connections } = portfolio;
    // Granted from the account's Team access panel ...
    const grant = await grantAccount(team.admin.token, wsId, ids['Acme Photos'], [
      team.editor.membershipId,
    ]);
    expect(grant.status).toBe(200);
    expect(grant.body.members.find((m) => m.memberId === team.editor.membershipId)).toMatchObject({
      role: 'EDITOR',
      mode: 'SELECTED',
      hasAccess: true,
    });
    // ... and from the member's access settings.
    const patch = await as(team.admin.token)
      .patch(`${wsUrl(wsId)}/members/${team.editor.membershipId}/account-access`)
      .send({ add: [ids['Acme Labs']] });
    expect(patch.status).toBe(200);
    expect(patch.body.member.accountAccess.mode).toBe('SELECTED');
    expect([...patch.body.member.accountAccess.socialAccountIds].sort()).toEqual(
      [ids['Acme Photos'], ids['Acme Labs']].sort(),
    );

    const list = await listAccounts(team.editor.token, wsId);
    expect(names(list)).toEqual(['Acme Labs', 'Acme Photos']);
    expect(list.body.facets).toEqual({
      platform: { FACEBOOK_PAGE: 1, INSTAGRAM_ACCOUNT: 1 },
      status: { ACTIVE: 2 },
      readiness: { READY: 1, RESTRICTED: 1 },
      attention: 1,
      labels: {},
      starred: 0,
    });
    // The Instagram account's Page is named but cannot be opened by this editor.
    expect(byName(list)['Acme Photos'].linkedPage).toEqual({
      id: null,
      externalId: '5001',
      name: 'Acme Store',
    });
    expect(names(await listAccounts(team.editor.token, wsId, { q: 'store' }))).toEqual([
      'Acme Photos',
    ]);
    expect(
      names(await listAccounts(team.editor.token, wsId, { connectionId: connections.alice })),
    ).toEqual(['Acme Labs', 'Acme Photos']);
    expect(
      (await listAccounts(team.editor.token, wsId, { connectionId: connections.bob })).body.total,
    ).toBe(0);

    expect((await accountSummary(team.editor.token, wsId)).body).toEqual({
      accounts: {
        total: 2,
        facebookPages: 1,
        instagramAccounts: 1,
        connected: 2,
        needsAttention: 1,
        ready: 1,
        restricted: 1,
        unavailable: 0,
      },
      followers: unknownFollowers(1, 1),
      connections: null,
      meta: META_CONFIGURED,
      truncated: false,
    });

    const ig = await accountDetail(team.editor.token, wsId, ids['Acme Photos']);
    expect(ig.status).toBe(200);
    expect(ig.body.account.linkedPage).toEqual({
      id: null,
      externalId: '5001',
      name: 'Acme Store',
    });
    expect(ig.body.linkedPage).toBeNull();
    expect((await accountDetail(team.editor.token, wsId, ids['Acme Labs'])).status).toBe(200);
    for (const name of ['Acme Store', 'Beta Bakery', 'Solo Creator', 'Zeta Garage']) {
      const res = await accountDetail(team.editor.token, wsId, ids[name]);
      expect(res.status, name).toBe(404);
      expect(errorOf(res), name).toEqual({
        code: 'NOT_FOUND',
        message: 'Social account not found',
      });
    }
    // Granting the editor does nothing for the viewer.
    expect((await listAccounts(team.viewer.token, wsId)).body.total).toBe(0);

    // Once the Page is granted too, the link resolves.
    await grantAccount(team.admin.token, wsId, ids['Acme Store'], [team.editor.membershipId]);
    const linked = await accountDetail(team.editor.token, wsId, ids['Acme Photos']);
    expect(linked.body.account.linkedPage.id).toBe(ids['Acme Store']);
    expect(linked.body.linkedPage).toMatchObject({ id: ids['Acme Store'], name: 'Acme Store' });
    expect(byName(await listAccounts(team.editor.token, wsId))['Acme Photos'].linkedPage.id).toBe(
      ids['Acme Store'],
    );
  });

  it('answers an unassigned account exactly like a missing one (404, never 403)', async () => {
    const { ids } = portfolio;
    await grantAccount(team.owner.token, wsId, ids['Acme Labs'], [team.editor.membershipId]);
    const unassigned = await accountDetail(team.editor.token, wsId, ids['Acme Store']);
    const missing = await accountDetail(team.editor.token, wsId, MISSING_ID);
    expect(unassigned.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorOf(unassigned)).toEqual(errorOf(missing));
    expect(errorOf(unassigned)).toEqual({ code: 'NOT_FOUND', message: 'Social account not found' });

    // Team access, refresh and removal need management rights: an editor is refused by role
    // before any account lookup, identically for assigned, unassigned and missing accounts.
    for (const id of [ids['Acme Labs'], ids['Acme Store'], MISSING_ID]) {
      const client = as(team.editor.token);
      const base = `${wsUrl(wsId)}/social-accounts/${id}`;
      for (const res of [
        await client.get(`${base}/access`),
        await client.post(`${base}/refresh`),
        await client.delete(base),
      ]) {
        expect(res.status, res.req.path).toBe(403);
        expect(res.body.error.code, res.req.path).toBe('FORBIDDEN');
      }
    }
  });

  it('lists on a Page only the linked Instagram accounts the member may see', async () => {
    const { ids } = portfolio;
    await grantAccount(team.owner.token, wsId, ids['Acme Store'], [team.viewer.membershipId]);
    const viewerView = await accountDetail(team.viewer.token, wsId, ids['Acme Store']);
    expect(viewerView.status).toBe(200);
    expect(viewerView.body.linkedInstagram).toEqual([]);
    const ownerView = await accountDetail(team.owner.token, wsId, ids['Acme Store']);
    expect(ownerView.body.linkedInstagram.map((a) => a.id)).toEqual([ids['Acme Photos']]);
    expect(names(await listAccounts(team.viewer.token, wsId))).toEqual(['Acme Store']);
  });

  it('gives a member with access mode ALL every current and future account', async () => {
    const { ids, connections } = portfolio;
    const put = await as(team.owner.token)
      .put(`${wsUrl(wsId)}/members/${team.viewer.membershipId}/account-access`)
      .send({ mode: 'ALL', socialAccountIds: [] });
    expect(put.status).toBe(200);
    expect(put.body.member.accountAccess).toEqual({ mode: 'ALL', socialAccountIds: [] });

    expect(names(await listAccounts(team.viewer.token, wsId))).toEqual(ALL_NAMES);
    const summary = await accountSummary(team.viewer.token, wsId);
    expect(summary.body.accounts).toMatchObject({
      total: 6,
      facebookPages: 4,
      instagramAccounts: 2,
    });
    expect(summary.body.connections).toBeNull();
    const ig = await accountDetail(team.viewer.token, wsId, ids['Acme Photos']);
    expect(ig.body.account.linkedPage.id).toBe(ids['Acme Store']);
    expect(ig.body.linkedPage).toMatchObject({ id: ids['Acme Store'] });
    expect(ig.body.capabilities).toEqual({
      canManageConnections: false,
      canManageAccess: false,
      canViewActivity: false,
      providerConfigured: true,
    });

    // A Page added later is visible without another grant; the SELECTED editor still sees none.
    fake.grantPage('100', { id: '5004', name: 'Acme Outlet' });
    await select(team.owner.token, wsId, connections.alice, [page('5004')]);
    expect(names(await listAccounts(team.viewer.token, wsId))).toContain('Acme Outlet');
    expect((await listAccounts(team.editor.token, wsId)).body.total).toBe(0);
  });
});

/* ------------------------------------------------ 10. Instagram accounts */

describe('Instagram accounts (simulated Meta)', () => {
  it('lists Instagram accounts from Facebook Login and from Instagram Login side by side', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [ALICE_PAGES[0]] });
    fake.addInstagramUser({
      id: '9001',
      accountId: SOLO_IG,
      username: 'solo.creator',
      name: 'Solo Creator',
      accountType: 'Media_Creator',
    });
    fake.addInstagramUser({
      id: '9002',
      accountId: '17841400000000077',
      username: 'beta.shop',
      name: 'Beta Shop',
      accountType: 'Business',
    });

    const alice = await connectFb(owner.token, workspace.id, '100');
    const [store] = (await select(owner.token, workspace.id, alice, [page('5001'), insta(ACME_IG)]))
      .added;
    const igLogins = {};
    for (const [userId, accountId, type] of [
      ['9001', SOLO_IG, 'CREATOR'],
      ['9002', '17841400000000077', 'BUSINESS'],
    ]) {
      const connectionId = await connectIg(owner.token, workspace.id, userId);
      const found = await discover(owner.token, workspace.id, connectionId);
      expect(found.body.candidates).toEqual([
        expect.objectContaining({
          platform: 'INSTAGRAM_ACCOUNT',
          externalId: accountId,
          instagramAccountType: type,
          linkedPage: null,
          tasks: null,
          state: 'NEW',
          publishing: { status: 'READY', reason: null },
        }),
      ]);
      await select(owner.token, workspace.id, connectionId, [insta(accountId)]);
      igLogins[type] = connectionId;
    }

    const res = await listAccounts(owner.token, workspace.id, { platform: 'INSTAGRAM_ACCOUNT' });
    expect(names(res)).toEqual(['Acme Photos', 'Beta Shop', 'Solo Creator']);
    const items = byName(res);
    expect(items['Acme Photos']).toMatchObject({
      platform: 'INSTAGRAM_ACCOUNT',
      externalId: ACME_IG,
      username: 'acme.gram',
      tasks: FULL_PAGE_TASKS,
      connection: loginSummary(alice, 'Alice', ALICE_PICTURE),
      linkedPage: { id: store.id, externalId: '5001', name: 'Acme Store' },
      health: { readiness: 'READY', eligibility: { eligible: true, createContent: true } },
    });
    // Meta does not report Business vs Creator for Page-linked accounts.
    expect(items['Acme Photos']).not.toHaveProperty('instagramAccountType');
    expect(items['Solo Creator']).toMatchObject({
      externalId: SOLO_IG,
      username: 'solo.creator',
      instagramAccountType: 'CREATOR',
      linkedPage: null,
      connection: loginSummary(
        igLogins.CREATOR,
        '@solo.creator',
        `https://example.cdninstagram.com/${SOLO_IG}.jpg`,
        'INSTAGRAM_LOGIN',
      ),
      health: {
        readiness: 'READY',
        eligibility: { eligible: true, createContent: null, missingPermissions: [] },
        needsAttention: false,
      },
    });
    expect(items['Beta Shop']).toMatchObject({
      username: 'beta.shop',
      instagramAccountType: 'BUSINESS',
      linkedPage: null,
      connection: { id: igLogins.BUSINESS, provider: 'INSTAGRAM_LOGIN', displayName: '@beta.shop' },
    });
    expect(items['Solo Creator']).not.toHaveProperty('tasks');
    expect(names(await listAccounts(owner.token, workspace.id, { q: 'shop' }))).toEqual([
      'Beta Shop',
    ]);

    const summary = await accountSummary(owner.token, workspace.id);
    expect(summary.body.accounts).toMatchObject({
      total: 4,
      facebookPages: 1,
      instagramAccounts: 3,
      ready: 4,
    });
    expect(summary.body.connections).toMatchObject({
      total: 3,
      facebook: 1,
      instagram: 2,
      active: 3,
    });
  });

  it('keeps the linked Page name for an Instagram account added without its Page', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [ALICE_PAGES[0]] });
    const alice = await connectFb(owner.token, workspace.id, '100');
    const [photos] = (await select(owner.token, workspace.id, alice, [insta(ACME_IG)])).added;

    const unlinked = byName(await listAccounts(owner.token, workspace.id))['Acme Photos'];
    expect(unlinked.linkedPage).toEqual({ id: null, externalId: '5001', name: 'Acme Store' });
    expect((await accountDetail(owner.token, workspace.id, photos.id)).body.linkedPage).toBeNull();

    const [store] = (await select(owner.token, workspace.id, alice, [page('5001')])).added;
    const linked = byName(await listAccounts(owner.token, workspace.id))['Acme Photos'];
    expect(linked.linkedPage).toEqual({ id: store.id, externalId: '5001', name: 'Acme Store' });
    expect(
      (await accountDetail(owner.token, workspace.id, photos.id)).body.linkedPage,
    ).toMatchObject({
      id: store.id,
      name: 'Acme Store',
    });
  });

  it('marks an Instagram Login account without the publishing permission RESTRICTED', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addInstagramUser({
      id: '9004',
      accountId: '17841400000000044',
      username: 'read.only',
      name: 'Read Only',
      granted: ['instagram_business_basic'],
    });
    const igLogin = await connectIg(owner.token, workspace.id, '9004');
    const found = await discover(owner.token, workspace.id, igLogin);
    expect(found.body.candidates[0].publishing).toEqual({
      status: 'RESTRICTED',
      reason: 'Missing permission: instagram_business_content_publish',
    });
    const [account] = (
      await select(owner.token, workspace.id, igLogin, [insta('17841400000000044')])
    ).added;

    const [item] = (await listAccounts(owner.token, workspace.id)).body.items;
    expect(item).toMatchObject({ id: account.id, instagramAccountType: 'BUSINESS' });
    expect(item.health).toEqual({
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'RESTRICTED',
      readinessReasons: ['Missing permission: instagram_business_content_publish'],
      eligibility: {
        eligible: false,
        createContent: null,
        missingPermissions: ['instagram_business_content_publish'],
      },
      attention: [
        {
          code: 'MISSING_PERMISSIONS',
          message: 'Missing permission: instagram_business_content_publish',
        },
      ],
      needsAttention: true,
    });
    const detail = await accountDetail(owner.token, workspace.id, account.id);
    expect(detail.body.permissions).toEqual({
      granted: ['instagram_business_basic'],
      declined: ['instagram_business_content_publish'],
      requiredForPublishing: ['instagram_business_content_publish'],
      missing: ['instagram_business_content_publish'],
      tasks: null,
      createContent: null,
    });
    expect((await accountSummary(owner.token, workspace.id)).body.accounts).toMatchObject({
      ready: 0,
      restricted: 1,
    });
  });

  it('accepts only professional Instagram accounts (NOT_ELIGIBLE)', async () => {
    const { owner, workspace } = await ownerWorkspace();
    fake.addInstagramUser({
      id: '9003',
      accountId: '17841400000000003',
      username: 'just.me',
      accountType: 'PERSONAL',
    });
    const attempt = await connectInstagram(fake, owner.token, workspace.id, '9003');
    expect(attempt.result).toMatchObject({
      status: 'error',
      reason: 'NOT_ELIGIBLE',
      provider: 'instagram',
    });
    expect(attempt.connectionId).toBeUndefined();

    expect((await listLogins(owner.token, workspace.id)).body.items).toEqual([]);
    expect(
      (await listAccounts(owner.token, workspace.id, { platform: 'INSTAGRAM_ACCOUNT' })).body.total,
    ).toBe(0);
    const summary = await accountSummary(owner.token, workspace.id);
    expect(summary.body.accounts).toEqual(NO_ACCOUNTS);
    expect(summary.body.connections).toMatchObject({ total: 0, instagram: 0 });
  });
});
