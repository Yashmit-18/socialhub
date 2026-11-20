import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityLog,
  MetaDataDeletionRequest,
  SocialAccount,
  SocialConnection,
} from '../src/models/index.js';
import { FB_APP_SECRET, FakeMeta, IG_APP_SECRET } from './fakeMeta.js';
import { api, as, createWorkspace, registerUser } from './helpers.js';
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
afterEach(() => fake.uninstall());

async function connectedWorkspace({ pages = [{ id: '5001' }, { id: '5002' }], granted } = {}) {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
  fake.addFacebookUser({ id: '100', name: 'Alice', pages, ...(granted && { granted }) });
  const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
  await selectAccounts(
    owner.token,
    workspace.id,
    connectionId,
    pages.map((p) => page(p.id)),
  );
  const sync = () =>
    as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/sync`,
    );
  const list = () => as(owner.token).get(`/api/v1/workspaces/${workspace.id}/social-connections`);
  return { owner, workspace, connectionId, sync, list };
}

describe('sync', () => {
  it('refreshes metadata and tokens for a healthy connection and logs the manual sync', async () => {
    const { workspace, sync } = await connectedWorkspace();
    fake.pages.get('5001').name = 'Renamed Page';
    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.body.connection.status).toBe('ACTIVE');
    expect(res.body.accounts).toEqual({ refreshed: 2, lost: 0 });
    expect((await SocialAccount.findOne({ externalId: '5001' })).name).toBe('Renamed Page');
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'social_connection.synced' }),
    ).toBeTruthy();
  });

  it('flags destinations the identity can no longer reach, keeping the rest active', async () => {
    const { sync } = await connectedWorkspace();
    fake.removePageRole('100', '5002');
    const res = await sync();
    expect(res.body.accounts).toEqual({ refreshed: 1, lost: 1 });
    const lost = await SocialAccount.findOne({ externalId: '5002' });
    expect(lost).toMatchObject({ connectionStatus: 'ERROR', publishingStatus: 'UNAVAILABLE' });
    expect(lost.connectionStatusReason).toMatch(/No longer accessible/);
    expect((await SocialAccount.findOne({ externalId: '5001' })).connectionStatus).toBe('ACTIVE');
  });
});

describe('expired tokens', () => {
  it('marks the connection and its destinations EXPIRED when Meta reports an expired session', async () => {
    const { workspace, sync, list } = await connectedWorkspace();
    fake.setTokenState('100', 'expired');
    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ status: 'EXPIRED' });
    expect(res.body.connection.statusReason).toMatch(/expired/i);

    const accounts = await SocialAccount.find({ workspace: workspace.id });
    expect(
      accounts.every(
        (a) => a.connectionStatus === 'EXPIRED' && a.publishingStatus === 'UNAVAILABLE',
      ),
    ).toBe(true);
    expect((await list()).body.items[0].status).toBe('EXPIRED');
    expect(
      await ActivityLog.exists({
        workspace: workspace.id,
        action: 'social_connection.status_changed',
      }),
    ).toBeTruthy();
  });

  it('treats a token past its expiry date as expired even before the next sync', async () => {
    const { connectionId, list, owner, workspace } = await connectedWorkspace();
    await SocialConnection.updateOne(
      { _id: connectionId },
      { tokenExpiresAt: new Date(Date.now() - 1000) },
    );
    expect((await list()).body.items[0]).toMatchObject({ status: 'EXPIRED' });
    const res = await as(owner.token).get(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/discovery`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('META_RECONNECT_REQUIRED');
  });

  it('treats lapsed Meta data access (90 days) as expired', async () => {
    const { connectionId, list } = await connectedWorkspace();
    await SocialConnection.updateOne(
      { _id: connectionId },
      { dataAccessExpiresAt: new Date(Date.now() - 1000) },
    );
    const [item] = (await list()).body.items;
    expect(item.status).toBe('EXPIRED');
    expect(item.statusReason).toMatch(/data access/i);
  });

  it('warns before expiry', async () => {
    const { connectionId, list } = await connectedWorkspace();
    const soon = new Date(Date.now() + 3 * 86_400_000);
    await SocialConnection.updateOne({ _id: connectionId }, { tokenExpiresAt: soon });
    const [item] = (await list()).body.items;
    expect(item.status).toBe('ACTIVE');
    expect(new Date(item.expiringSoonAt).getTime()).toBe(soon.getTime());
  });

  it('detects expiry during discovery and requires reconnecting', async () => {
    const { owner, workspace, connectionId } = await connectedWorkspace();
    fake.setTokenState('100', 'expired');
    const res = await as(owner.token).get(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/discovery`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('META_RECONNECT_REQUIRED');
    expect((await SocialConnection.findById(connectionId)).status).toBe('EXPIRED');
  });

  it('recovers after reauthorization: fresh tokens for the connection and its destinations', async () => {
    const { owner, workspace, connectionId, sync } = await connectedWorkspace();
    fake.setTokenState('100', 'expired');
    await sync();
    fake.setTokenState('100', 'valid');
    const { result } = await connectFacebook(fake, owner.token, workspace.id, '100', {
      connectionId,
    });
    expect(result.reason).toBe('RECONNECTED');
    const connection = await SocialConnection.findById(connectionId);
    expect(connection.status).toBe('ACTIVE');
    const accounts = await SocialAccount.find({ workspace: workspace.id }).select('+accessToken');
    expect(accounts.every((a) => a.connectionStatus === 'ACTIVE' && a.hasAccessToken())).toBe(true);
  });
});

describe('revoked permissions', () => {
  it('marks the connection REVOKED when the app authorization was removed', async () => {
    const { workspace, sync } = await connectedWorkspace();
    fake.setTokenState('100', 'revoked');
    const res = await sync();
    expect(res.body.connection.status).toBe('REVOKED');
    const accounts = await SocialAccount.find({ workspace: workspace.id });
    expect(accounts.every((a) => a.connectionStatus === 'REVOKED')).toBe(true);
  });

  it('restricts publishing readiness when a publishing permission is removed', async () => {
    const { sync, list } = await connectedWorkspace();
    expect((await SocialAccount.findOne({ externalId: '5001' })).publishingStatus).toBe('READY');
    fake.setPermissions('100', {
      granted: ['pages_show_list', 'pages_read_engagement', 'business_management'],
      declined: ['pages_manage_posts'],
    });
    await sync();
    const account = await SocialAccount.findOne({ externalId: '5001' });
    expect(account).toMatchObject({ connectionStatus: 'ACTIVE', publishingStatus: 'RESTRICTED' });
    expect(account.publishingStatusReason).toMatch(/pages_manage_posts/);
    const [item] = (await list()).body.items;
    expect(item.declinedScopes).toEqual(['pages_manage_posts']);
    expect(item.missingScopes.publishing).toContain('pages_manage_posts');
  });

  it('reports a missing pages_show_list grant during discovery', async () => {
    const owner = await registerUser();
    const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
    fake.addFacebookUser({
      id: '100',
      granted: ['public_profile'],
      declined: ['pages_show_list'],
      pages: [{ id: '5001' }],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const res = await as(owner.token).get(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/discovery`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/permission/i);
    // A permission problem is not a dead token: the connection stays usable once re-granted.
    expect((await SocialConnection.findById(connectionId)).status).toBe('ACTIVE');
  });
});

describe('Instagram token lifecycle', () => {
  it('refreshes a long-lived token once it is at least 24 hours old', async () => {
    const owner = await registerUser();
    const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
    fake.addInstagramUser({ id: '9001', accountId: '17841400000000001', username: 'acme' });
    const { connectionId } = await connectInstagram(fake, owner.token, workspace.id, '9001');
    await selectAccounts(owner.token, workspace.id, connectionId, [insta('17841400000000001')]);
    const syncUrl = `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/sync`;

    // Too new to refresh (Meta requires >= 24h).
    await as(owner.token).post(syncUrl);
    expect(fake.calls.filter((c) => c.path === '/refresh_access_token')).toHaveLength(0);

    const before = await SocialConnection.findById(connectionId).select('+accessToken');
    await SocialConnection.updateOne(
      { _id: connectionId },
      {
        lastRefreshedAt: new Date(Date.now() - 2 * 86_400_000),
        tokenExpiresAt: new Date(Date.now() + 10 * 86_400_000),
      },
    );
    const res = await as(owner.token).post(syncUrl);
    expect(res.body.connection.status).toBe('ACTIVE');
    expect(fake.calls.filter((c) => c.path === '/refresh_access_token')).toHaveLength(1);

    const after = await SocialConnection.findById(connectionId).select('+accessToken');
    expect(after.getAccessToken()).not.toBe(before.getAccessToken());
    expect(after.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);
    const account = await SocialAccount.findOne({ workspace: workspace.id }).select('+accessToken');
    expect(account.getAccessToken()).toBe(after.getAccessToken());
  });

  it('marks an Instagram connection expired when Meta rejects its token', async () => {
    const owner = await registerUser();
    const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
    fake.addInstagramUser({ id: '9001', accountId: '17841400000000001', username: 'acme' });
    const { connectionId } = await connectInstagram(fake, owner.token, workspace.id, '9001');
    fake.setTokenState('9001', 'expired');
    const res = await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/sync`,
    );
    expect(res.body.connection.status).toBe('EXPIRED');
  });
});

describe('Meta deauthorize callback', () => {
  it('revokes every connection of the person across workspaces and erases their tokens', async () => {
    const { workspace } = await connectedWorkspace();
    const res = await api()
      .post('/api/v1/meta/facebook/deauthorize')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: '100' }, FB_APP_SECRET) });
    expect(res.status).toBe(200);

    const connection = await SocialConnection.findOne({ externalUserId: '100' }).select(
      '+accessToken',
    );
    expect(connection.status).toBe('REVOKED');
    expect(connection.hasAccessToken()).toBe(false);
    const accounts = await SocialAccount.find({ workspace: workspace.id }).select('+accessToken');
    expect(accounts.every((a) => a.connectionStatus === 'REVOKED' && !a.hasAccessToken())).toBe(
      true,
    );
    const log = await ActivityLog.findOne({
      workspace: workspace.id,
      action: 'social_connection.revoked',
    });
    expect(log.actorName).toBe('Meta');
  });

  it('rejects requests with an invalid signature', async () => {
    await connectedWorkspace();
    const forged = signedRequest({ user_id: '100' }, 'not-the-app-secret-0000000000');
    const res = await api()
      .post('/api/v1/meta/facebook/deauthorize')
      .type('form')
      .send({ signed_request: forged });
    expect(res.status).toBe(400);
    expect((await SocialConnection.findOne({ externalUserId: '100' })).status).toBe('ACTIVE');
  });

  it('accepts Instagram callbacks signed with either SocialHub app secret, and nothing else', async () => {
    const owner = await registerUser();
    const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
    fake.addInstagramUser({ id: '9001', accountId: '17841400000000001', username: 'acme' });
    await connectInstagram(fake, owner.token, workspace.id, '9001');
    const send = (secret, userId = '9001') =>
      api()
        .post('/api/v1/meta/instagram/deauthorize')
        .type('form')
        .send({ signed_request: signedRequest({ user_id: userId }, secret) });

    expect((await send('unknown-secret-unknown-secret-000')).status).toBe(400);
    expect((await SocialConnection.findOne({ externalUserId: '9001' })).status).toBe('ACTIVE');
    expect((await send(IG_APP_SECRET)).status).toBe(200);
    expect((await SocialConnection.findOne({ externalUserId: '9001' })).status).toBe('REVOKED');
    // Meta does not document which secret signs Instagram callbacks; the Meta app secret is accepted too.
    expect((await send(FB_APP_SECRET)).status).toBe(200);
  });

  it('matches Instagram callbacks by professional account id as well as user id', async () => {
    const owner = await registerUser();
    const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
    fake.addInstagramUser({ id: '9001', accountId: '17841400000000001', username: 'acme' });
    const { connectionId } = await connectInstagram(fake, owner.token, workspace.id, '9001');
    await selectAccounts(owner.token, workspace.id, connectionId, [insta('17841400000000001')]);
    const res = await api()
      .post('/api/v1/meta/instagram/data-deletion')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: '17841400000000001' }, IG_APP_SECRET) });
    expect(res.status).toBe(200);
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(0);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(0);
  });

  it('does not match a Facebook connection from an Instagram callback', async () => {
    const { workspace } = await connectedWorkspace();
    await api()
      .post('/api/v1/meta/instagram/deauthorize')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: '100' }, IG_APP_SECRET) });
    const connection = await SocialConnection.findOne({ workspace: workspace.id });
    expect(connection.status).toBe('ACTIVE');
  });
});

describe('Meta data deletion callback', () => {
  it('deletes the person’s connections and destinations and returns a checkable confirmation', async () => {
    const { workspace } = await connectedWorkspace();
    const res = await api()
      .post('/api/v1/meta/facebook/data-deletion')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: '100' }, FB_APP_SECRET) });
    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toEqual(expect.any(String));
    expect(res.body.url).toBe(
      `http://localhost:4000/api/v1/meta/data-deletion/${res.body.confirmation_code}`,
    );

    expect(await SocialConnection.countDocuments({ externalUserId: '100' })).toBe(0);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id })).toBe(0);
    const record = await MetaDataDeletionRequest.findOne({
      confirmationCode: res.body.confirmation_code,
    });
    expect(record).toMatchObject({ connectionsRemoved: 1, accountsRemoved: 2 });
    expect(JSON.stringify(record)).not.toContain('"100"');

    const status = await api().get(new URL(res.body.url).pathname);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      confirmationCode: res.body.confirmation_code,
      status: 'COMPLETED',
    });
  });

  it('returns 404 for unknown confirmation codes', async () => {
    expect((await api().get('/api/v1/meta/data-deletion/UNKNOWNCODE1')).status).toBe(404);
  });
});
