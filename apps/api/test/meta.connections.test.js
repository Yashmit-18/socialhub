import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, Membership, SocialAccount, SocialConnection } from '../src/models/index.js';
import { FakeMeta } from './fakeMeta.js';
import { as, createWorkspace, registerUser, seedTeam } from './helpers.js';
import { connectFacebook, connectInstagram, insta, page, selectAccounts } from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => fake.uninstall());

const discovery = (token, wsId, connId) =>
  as(token).get(`/api/v1/workspaces/${wsId}/social-connections/${connId}/discovery`);

async function ownerSetup(name = 'Acme Social') {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name });
  return { owner, workspace };
}

/** Collects every string value in a JSON body so tests can assert no secret leaks anywhere. */
const bodyText = (res) => JSON.stringify(res.body);

describe('multiple Facebook connections per workspace', () => {
  it('keeps each identity as an independent connection; adding one never overwrites another', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100', name: 'Alice', pages: [{ id: '5001' }] });
    fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '5002' }] });

    const a = await connectFacebook(fake, owner.token, workspace.id, '100');
    const aBefore = await SocialConnection.findById(a.connectionId).select('+accessToken');
    const b = await connectFacebook(fake, owner.token, workspace.id, '200');

    expect(a.connectionId).not.toBe(b.connectionId);
    const all = await SocialConnection.find({ workspace: workspace.id }).select('+accessToken');
    expect(all.map((c) => c.externalUserId).sort()).toEqual(['100', '200']);
    const aAfter = all.find((c) => c.externalUserId === '100');
    expect(aAfter.getAccessToken()).toBe(aBefore.getAccessToken());
    expect(aAfter.displayName).toBe('Alice');

    const list = await as(owner.token).get(`/api/v1/workspaces/${workspace.id}/social-connections`);
    expect(list.body.items.map((c) => c.displayName).sort()).toEqual(['Alice', 'Bob']);
  });

  it('updates the existing connection when the same identity authorizes again', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    const first = await connectFacebook(fake, owner.token, workspace.id, '100');
    const second = await connectFacebook(fake, owner.token, workspace.id, '100');
    expect(second.result.reason).toBe('RECONNECTED');
    expect(second.connectionId).toBe(first.connectionId);
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(1);
  });

  it('supports Facebook and Instagram logins side by side', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    fake.addInstagramUser({ id: '9001', accountId: '17841400000000001', username: 'acme' });
    await connectFacebook(fake, owner.token, workspace.id, '100');
    await connectInstagram(fake, owner.token, workspace.id, '9001');
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(2);
  });
});

describe('Page discovery and selection', () => {
  it('discovers every Page an identity manages, across paginated responses, plus linked Instagram accounts', async () => {
    fake = new FakeMeta({ pageSize: 2 }).install();
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [
        { id: '5001', name: 'Acme Store' },
        {
          id: '5002',
          name: 'Acme Careers',
          instagram: { id: '17841400000000010', username: 'acme', name: 'Acme' },
        },
        { id: '5003', name: 'Acme Labs' },
        { id: '5004', name: 'Acme Events' },
        { id: '5005', name: 'Acme Outlet' },
      ],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');

    const res = await discovery(owner.token, workspace.id, connectionId);
    expect(res.status).toBe(200);
    const pages = res.body.candidates.filter((c) => c.platform === 'FACEBOOK_PAGE');
    const igs = res.body.candidates.filter((c) => c.platform === 'INSTAGRAM_ACCOUNT');
    expect(pages.map((p) => p.name)).toEqual([
      'Acme Store',
      'Acme Careers',
      'Acme Labs',
      'Acme Events',
      'Acme Outlet',
    ]);
    expect(igs).toEqual([
      expect.objectContaining({
        externalId: '17841400000000010',
        username: 'acme',
        linkedPage: { externalId: '5002', name: 'Acme Careers' },
      }),
    ]);
    expect(res.body.candidates.every((c) => c.state === 'NEW')).toBe(true);
    expect(fake.calls.filter((c) => c.path.endsWith('/me/accounts')).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(bodyText(res)).not.toMatch(/pagetoken_|fb_long_|access_token/);
  });

  it('explains which Pages Meta reports without a linked Instagram professional account', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [
        { id: '5001', name: 'Yashmit talks ' },
        {
          id: '5002',
          name: 'Acme Careers',
          instagram: { id: '17841400000000010', username: 'acme', name: 'Acme' },
        },
      ],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const res = await discovery(owner.token, workspace.id, connectionId);
    const instagram = res.body.warnings.filter((w) => /Instagram professional account/.test(w));
    expect(instagram).toHaveLength(1);
    expect(instagram[0]).toMatch(/no Instagram professional account linked to "Yashmit talks"\./);
    expect(instagram[0]).not.toMatch(/Acme Careers/);
    expect(instagram[0]).toMatch(/Business or Creator/);
    expect(instagram[0]).toMatch(/Personal Instagram accounts cannot be connected/);
    // Only the linked account is offered; nothing is invented for the other Page.
    expect(
      res.body.candidates.filter((c) => c.platform === 'INSTAGRAM_ACCOUNT').map((c) => c.username),
    ).toEqual(['acme']);
  });

  it('adds no Instagram warning when every Page has its Instagram account', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [{ id: '5002', name: 'Acme', instagram: { id: '17841400000000010', username: 'a' } }],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const res = await discovery(owner.token, workspace.id, connectionId);
    expect(res.body.warnings.some((w) => /Instagram professional account/.test(w))).toBe(false);
  });

  it('adds only the selected destinations, each with its own encrypted Page token', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [
        { id: '5001', name: 'Acme Store' },
        {
          id: '5002',
          name: 'Acme Careers',
          instagram: { id: '17841400000000010', username: 'acme' },
        },
        { id: '5003', name: 'Not selected' },
      ],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');

    const res = await selectAccounts(owner.token, workspace.id, connectionId, [
      page('5001'),
      page('5002'),
      insta('17841400000000010'),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.added).toHaveLength(3);
    expect(bodyText(res)).not.toMatch(/pagetoken_|ciphertext|accessToken/);

    const stored = await SocialAccount.find({ workspace: workspace.id })
      .select('+accessToken')
      .sort({ externalId: 1 });
    expect(stored.map((a) => a.externalId)).toEqual(['17841400000000010', '5001', '5002']);
    expect(stored.find((a) => a.externalId === '5001').getAccessToken()).toBe(
      fake.pageToken('100', '5001'),
    );
    // Page-linked Instagram accounts use the linked Page's token and are linked to that Page.
    const ig = stored.find((a) => a.platform === 'INSTAGRAM_ACCOUNT');
    const careers = stored.find((a) => a.externalId === '5002');
    expect(ig.getAccessToken()).toBe(fake.pageToken('100', '5002'));
    expect(String(ig.linkedFacebookPage)).toBe(String(careers._id));
    expect(stored.every((a) => String(a.connection) === connectionId)).toBe(true);

    const raw = await mongoose.connection.db.collection('socialaccounts').find().toArray();
    expect(JSON.stringify(raw)).not.toContain('pagetoken_');
    expect(
      await ActivityLog.countDocuments({ workspace: workspace.id, action: 'social_account.added' }),
    ).toBe(3);
  });

  it('marks publishing readiness from permissions and Page roles', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [{ id: '5001', tasks: ['ANALYZE'] }, { id: '5002' }],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const res = await discovery(owner.token, workspace.id, connectionId);
    const byId = Object.fromEntries(res.body.candidates.map((c) => [c.externalId, c]));
    expect(byId['5002'].publishing).toEqual({ status: 'READY', reason: null });
    expect(byId['5001'].publishing.status).toBe('RESTRICTED');
    expect(byId['5001'].publishing.reason).toMatch(/Page role/);
  });

  it('only accepts accounts the identity actually manages', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const res = await selectAccounts(owner.token, workspace.id, connectionId, [
      page('5001'),
      page('9999'),
    ]);
    expect(res.body.added).toHaveLength(1);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ externalId: '9999', reason: 'NOT_AVAILABLE' }),
    ]);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(1);
  });

  it('validates the selection payload', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    expect((await selectAccounts(owner.token, workspace.id, connectionId, [])).status).toBe(422);
    expect(
      (
        await selectAccounts(owner.token, workspace.id, connectionId, [
          { platform: 'FACEBOOK_PAGE', externalId: '{$ne:1}' },
        ])
      ).status,
    ).toBe(422);
  });

  it('connects the single account from an Instagram Login with its account type', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addInstagramUser({
      id: '9001',
      accountId: '17841400000000001',
      username: 'acme.studio',
      accountType: 'Media_Creator',
    });
    const { connectionId } = await connectInstagram(fake, owner.token, workspace.id, '9001');
    const found = await discovery(owner.token, workspace.id, connectionId);
    expect(found.body.candidates).toEqual([
      expect.objectContaining({
        platform: 'INSTAGRAM_ACCOUNT',
        externalId: '17841400000000001',
        instagramAccountType: 'CREATOR',
        publishing: { status: 'READY', reason: null },
      }),
    ]);
    const res = await selectAccounts(owner.token, workspace.id, connectionId, [
      insta('17841400000000001'),
    ]);
    expect(res.body.added[0]).toMatchObject({
      username: 'acme.studio',
      instagramAccountType: 'CREATOR',
    });
  });
});

describe('duplicate account discovery', () => {
  async function twoIdentitiesSharingAPage() {
    const { owner, workspace } = await ownerSetup();
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
    const a = await connectFacebook(fake, owner.token, workspace.id, '100');
    const b = await connectFacebook(fake, owner.token, workspace.id, '200');
    await selectAccounts(owner.token, workspace.id, a.connectionId, [page('5001')]);
    return { owner, workspace, a: a.connectionId, b: b.connectionId };
  }

  it('shows a Page already connected through another healthy identity and never takes it over', async () => {
    const { owner, workspace, a, b } = await twoIdentitiesSharingAPage();
    const found = await discovery(owner.token, workspace.id, b);
    const shared = found.body.candidates.find((c) => c.externalId === '5001');
    expect(shared).toMatchObject({
      state: 'CONNECTED_VIA_OTHER',
      connectedVia: { id: a, displayName: 'Alice' },
    });

    const res = await selectAccounts(owner.token, workspace.id, b, [page('5001'), page('5002')]);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ externalId: '5001', reason: 'CONNECTED_VIA_OTHER' }),
    ]);
    expect(res.body.added.map((x) => x.externalId)).toEqual(['5002']);

    const sharedAccount = await SocialAccount.findOne({
      workspace: workspace.id,
      externalId: '5001',
    }).select('+accessToken');
    expect(String(sharedAccount.connection)).toBe(a);
    expect(sharedAccount.getAccessToken()).toBe(fake.pageToken('100', '5001'));
    expect(
      await SocialAccount.countDocuments({ workspace: workspace.id, externalId: '5001' }),
    ).toBe(1);
  });

  it('re-links a Page to a working identity when its original connection is no longer usable', async () => {
    const { owner, workspace, a, b } = await twoIdentitiesSharingAPage();
    await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${a}/disconnect`,
    );

    const found = await discovery(owner.token, workspace.id, b);
    expect(found.body.candidates.find((c) => c.externalId === '5001').state).toBe('RECLAIMABLE');

    const res = await selectAccounts(owner.token, workspace.id, b, [page('5001')]);
    expect(res.body.relinked.map((x) => x.externalId)).toEqual(['5001']);
    const account = await SocialAccount.findOne({
      workspace: workspace.id,
      externalId: '5001',
    }).select('+accessToken');
    expect(String(account.connection)).toBe(b);
    expect(account.connectionStatus).toBe('ACTIVE');
    expect(account.getAccessToken()).toBe(fake.pageToken('200', '5001'));
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'social_account.relinked' }),
    ).toBeTruthy();
  });

  it('treats re-selecting an already connected account as a refresh, not a duplicate', async () => {
    const { owner, workspace, a } = await twoIdentitiesSharingAPage();
    const found = await discovery(owner.token, workspace.id, a);
    expect(found.body.candidates[0].state).toBe('CONNECTED_HERE');
    const res = await selectAccounts(owner.token, workspace.id, a, [page('5001'), page('5001')]);
    expect(res.body).toMatchObject({ added: [], relinked: [], skipped: [] });
    expect(res.body.updated).toHaveLength(1);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(1);
  });
});

describe('permissions', () => {
  it('limits every management action to owners and admins', async () => {
    const { workspace, owner, admin, editor, viewer } = await seedTeam();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    await selectAccounts(owner.token, workspace.id, connectionId, [page('5001')]);
    const account = await SocialAccount.findOne({ workspace: workspace.id });
    const base = `/api/v1/workspaces/${workspace.id}`;

    for (const member of [editor, viewer]) {
      const client = as(member.token);
      expect((await client.get(`${base}/social-connections`)).status).toBe(403);
      expect(
        (await client.get(`${base}/social-connections/${connectionId}/discovery`)).status,
      ).toBe(403);
      expect(
        (
          await client
            .post(`${base}/social-connections/${connectionId}/accounts`)
            .send({ accounts: [page('5001')] })
        ).status,
      ).toBe(403);
      expect((await client.post(`${base}/social-connections/${connectionId}/sync`)).status).toBe(
        403,
      );
      expect(
        (await client.post(`${base}/social-connections/${connectionId}/disconnect`)).status,
      ).toBe(403);
      expect((await client.delete(`${base}/social-connections/${connectionId}`)).status).toBe(403);
      expect((await client.delete(`${base}/social-accounts/${account.id}`)).status).toBe(403);
      // Reading destinations is allowed (subject to account access).
      expect((await client.get(`${base}/social-accounts`)).status).toBe(200);
    }
    expect(
      (await as(admin.token).get(`${base}/social-connections/${connectionId}/discovery`)).status,
    ).toBe(200);
  });

  it('respects per-member account access for connected destinations', async () => {
    const { workspace, owner, editor } = await seedTeam();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }, { id: '5002' }] });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const sel = await selectAccounts(owner.token, workspace.id, connectionId, [
      page('5001'),
      page('5002'),
    ]);
    const only = sel.body.added.find((a) => a.externalId === '5002').id;
    await as(owner.token)
      .put(`/api/v1/workspaces/${workspace.id}/members/${editor.membershipId}/account-access`)
      .send({ mode: 'SELECTED', socialAccountIds: [only] });
    const res = await as(editor.token).get(`/api/v1/workspaces/${workspace.id}/social-accounts`);
    expect(res.body.items.map((a) => a.externalId)).toEqual(['5002']);
  });
});

describe('workspace isolation', () => {
  it('keeps the same identity independent in two workspaces', async () => {
    const { owner, workspace } = await ownerSetup('Brand One');
    const other = await createWorkspace(owner.token, { name: 'Brand Two' });
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });

    const one = await connectFacebook(fake, owner.token, workspace.id, '100');
    const two = await connectFacebook(fake, owner.token, other.workspace.id, '100');
    expect(one.connectionId).not.toBe(two.connectionId);

    await selectAccounts(owner.token, workspace.id, one.connectionId, [page('5001')]);
    await selectAccounts(owner.token, other.workspace.id, two.connectionId, [page('5001')]);
    expect(await SocialAccount.countDocuments({ externalId: '5001' })).toBe(2);
  });

  it('never exposes or manages another workspace’s connections', async () => {
    const { owner, workspace } = await ownerSetup();
    const stranger = await registerUser();
    const other = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    fake.addFacebookUser({ id: '300', pages: [{ id: '7001' }] });
    const { connectionId } = await connectFacebook(fake, stranger.token, other.workspace.id, '300');
    const base = `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}`;

    expect((await as(owner.token).get(`${base}/discovery`)).status).toBe(404);
    expect(
      (
        await as(owner.token)
          .post(`${base}/accounts`)
          .send({ accounts: [page('7001')] })
      ).status,
    ).toBe(404);
    expect((await as(owner.token).post(`${base}/sync`)).status).toBe(404);
    expect((await as(owner.token).post(`${base}/disconnect`)).status).toBe(404);
    expect((await as(owner.token).delete(base)).status).toBe(404);
    expect(
      (await as(owner.token).get(`/api/v1/workspaces/${workspace.id}/social-connections`)).body
        .items,
    ).toEqual([]);
    // Non-members cannot reach the other workspace at all.
    expect(
      (await as(owner.token).get(`/api/v1/workspaces/${other.workspace.id}/social-connections`))
        .status,
    ).toBe(404);
  });
});

describe('disconnecting and removing', () => {
  it('disconnects one connection: erases its tokens, marks its destinations, leaves others untouched', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    fake.addFacebookUser({ id: '200', pages: [{ id: '5002' }] });
    const a = await connectFacebook(fake, owner.token, workspace.id, '100');
    const b = await connectFacebook(fake, owner.token, workspace.id, '200');
    await selectAccounts(owner.token, workspace.id, a.connectionId, [page('5001')]);
    await selectAccounts(owner.token, workspace.id, b.connectionId, [page('5002')]);

    const res = await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${a.connectionId}/disconnect`,
    );
    expect(res.status).toBe(200);
    expect(res.body.connection.status).toBe('DISCONNECTED');
    expect(res.body.revokedAtMeta).toBe(true);
    expect(fake.revocations()).toHaveLength(1);

    const aConn = await SocialConnection.findById(a.connectionId).select('+accessToken');
    expect(aConn.hasAccessToken()).toBe(false);
    const aPage = await SocialAccount.findOne({ externalId: '5001' }).select('+accessToken');
    expect(aPage).toMatchObject({
      connectionStatus: 'DISCONNECTED',
      publishingStatus: 'UNAVAILABLE',
    });
    expect(aPage.hasAccessToken()).toBe(false);

    const bConn = await SocialConnection.findById(b.connectionId).select('+accessToken');
    const bPage = await SocialAccount.findOne({ externalId: '5002' }).select('+accessToken');
    expect(bConn.status).toBe('ACTIVE');
    expect(bConn.hasAccessToken()).toBe(true);
    expect(bPage.getAccessToken()).toBe(fake.pageToken('200', '5002'));
    expect(
      await ActivityLog.exists({
        workspace: workspace.id,
        action: 'social_connection.disconnected',
      }),
    ).toBeTruthy();

    // A disconnected connection must be reconnected before use.
    const blocked = await discovery(owner.token, workspace.id, a.connectionId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('META_RECONNECT_REQUIRED');
  });

  it('does not revoke at Meta while another workspace still uses the identity', async () => {
    const { owner, workspace } = await ownerSetup('Brand One');
    const other = await createWorkspace(owner.token, { name: 'Brand Two' });
    fake.addFacebookUser({ id: '100' });
    const one = await connectFacebook(fake, owner.token, workspace.id, '100');
    const two = await connectFacebook(fake, owner.token, other.workspace.id, '100');

    const first = await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${one.connectionId}/disconnect`,
    );
    expect(first.body.revokedAtMeta).toBe(false);
    expect(fake.revocations()).toHaveLength(0);
    expect((await SocialConnection.findById(two.connectionId)).status).toBe('ACTIVE');

    const last = await as(owner.token).post(
      `/api/v1/workspaces/${other.workspace.id}/social-connections/${two.connectionId}/disconnect`,
    );
    expect(last.body.revokedAtMeta).toBe(true);
  });

  it('removes a connection with its destinations and cleans member access lists', async () => {
    const { workspace, owner, editor } = await seedTeam();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    fake.addFacebookUser({ id: '200', pages: [{ id: '5002' }] });
    const a = await connectFacebook(fake, owner.token, workspace.id, '100');
    const b = await connectFacebook(fake, owner.token, workspace.id, '200');
    const selA = await selectAccounts(owner.token, workspace.id, a.connectionId, [page('5001')]);
    const selB = await selectAccounts(owner.token, workspace.id, b.connectionId, [page('5002')]);
    await as(owner.token)
      .put(`/api/v1/workspaces/${workspace.id}/members/${editor.membershipId}/account-access`)
      .send({ mode: 'SELECTED', socialAccountIds: [selA.body.added[0].id, selB.body.added[0].id] });

    const res = await as(owner.token).delete(
      `/api/v1/workspaces/${workspace.id}/social-connections/${a.connectionId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.accountsRemoved).toBe(1);
    expect(await SocialConnection.exists({ _id: a.connectionId })).toBeNull();
    expect(await SocialAccount.exists({ externalId: '5001' })).toBeNull();
    expect(await SocialAccount.exists({ externalId: '5002' })).toBeTruthy();
    const membership = await Membership.findById(editor.membershipId);
    expect(membership.accountAccess.socialAccounts.map(String)).toEqual([selB.body.added[0].id]);
  });

  it('removes a single destination without touching its connection', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [
        { id: '5001' },
        { id: '5002', instagram: { id: '17841400000000010', username: 'acme' } },
      ],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    await selectAccounts(owner.token, workspace.id, connectionId, [
      page('5001'),
      page('5002'),
      insta('17841400000000010'),
    ]);
    const careers = await SocialAccount.findOne({ externalId: '5002' });

    const res = await as(owner.token).delete(
      `/api/v1/workspaces/${workspace.id}/social-accounts/${careers.id}`,
    );
    expect(res.status).toBe(204);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(2);
    expect((await SocialConnection.findById(connectionId)).status).toBe('ACTIVE');
    // The Instagram account that pointed at the removed Page keeps working, unlinked.
    const ig = await SocialAccount.findOne({ externalId: '17841400000000010' });
    expect(ig.linkedFacebookPage).toBeUndefined();
    expect(ig.linkedFacebookPageExternalId).toBe('5002');
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'social_account.removed' }),
    ).toBeTruthy();
  });

  it('deleting a workspace removes its connections and releases unused Meta authorizations', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    await selectAccounts(owner.token, workspace.id, connectionId, [page('5001')]);
    const res = await as(owner.token)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .send({ confirmation: 'Acme Social', password: owner.password });
    expect(res.status).toBe(204);
    expect(await SocialConnection.countDocuments()).toBe(0);
    expect(await SocialAccount.countDocuments()).toBe(0);
    expect(fake.revocations()).toHaveLength(1);
  });
});
