import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, Membership, OAuthState, SocialConnection } from '../src/models/index.js';
import { FB_APP_ID, FB_REDIRECT_URI, FakeMeta, IG_APP_ID, IG_REDIRECT_URI } from './fakeMeta.js';
import { api, as, createWorkspace, registerUser, seedTeam } from './helpers.js';
import { callback, connectFacebook, connectInstagram, startAuth } from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => fake.uninstall());

async function ownerSetup() {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
  return { owner, workspace };
}

describe('integration status', () => {
  it('reports configured logins, versions and the URLs to register in the Meta dashboard', async () => {
    const { owner } = await ownerSetup();
    const res = await as(owner.token).get('/api/v1/integrations/meta');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      graphApiVersion: 'v27.0',
      facebook: { configured: true, ready: true, redirectUri: FB_REDIRECT_URI },
      instagram: { configured: true, ready: true, redirectUri: IG_REDIRECT_URI },
    });
    // The test server runs on plain http and without a Login for Business configuration.
    expect(res.body.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['PUBLIC_URL_NOT_HTTPS', 'LOGIN_CONFIG_RECOMMENDED']),
    );
    expect(res.body.checks.every((c) => ['error', 'warning', 'info'].includes(c.level))).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/test-meta-app-secret|test-instagram-app-secret/);
  });

  it('requires authentication', async () => {
    expect((await api().get('/api/v1/integrations/meta')).status).toBe(401);
  });
});

describe('starting an authorization', () => {
  it('returns an official Facebook dialog URL with a random state and sets a browser-binding cookie', async () => {
    const { owner, workspace } = await ownerSetup();
    const { res, url, state, setCookie } = await startAuth(owner.token, workspace.id);

    expect(res.status).toBe(201);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe(FB_APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(FB_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope').split(',')).toEqual(
      expect.arrayContaining([
        'pages_show_list',
        'pages_manage_posts',
        'instagram_content_publish',
      ]),
    );
    expect(state.length).toBeGreaterThanOrEqual(40);

    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/oauth/);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    // Only a digest of the state is stored.
    const stored = await OAuthState.findOne({ workspace: workspace.id });
    expect(stored.stateHash).not.toBe(state);
    expect(stored.purpose).toBe('CONNECT');
  });

  it('builds the Instagram Business Login URL with the Instagram app id', async () => {
    const { owner, workspace } = await ownerSetup();
    const { url } = await startAuth(owner.token, workspace.id, { provider: 'INSTAGRAM_LOGIN' });
    expect(`${url.origin}${url.pathname}`).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(IG_APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(IG_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish',
    );
  });

  it('is limited to owners and admins', async () => {
    const { workspace, admin, editor, viewer } = await seedTeam();
    expect((await startAuth(admin.token, workspace.id)).res.status).toBe(201);
    expect((await startAuth(editor.token, workspace.id)).res.status).toBe(403);
    expect((await startAuth(viewer.token, workspace.id)).res.status).toBe(403);
  });

  it('rejects unknown providers and reconnecting a connection from another workspace', async () => {
    const { owner, workspace } = await ownerSetup();
    expect((await startAuth(owner.token, workspace.id, { provider: 'TIKTOK' })).res.status).toBe(
      422,
    );

    const stranger = await registerUser();
    const other = await createWorkspace(stranger.token, { name: 'Elsewhere' });
    fake.addFacebookUser({ id: '700', pages: [] });
    const { connectionId } = await connectFacebook(fake, stranger.token, other.workspace.id, '700');

    const res = await startAuth(owner.token, workspace.id, {
      provider: 'FACEBOOK_LOGIN',
      connectionId,
    });
    expect(res.res.status).toBe(404);
  });
});

describe('OAuth callback validation', () => {
  it('connects the identity on a valid callback and clears the binding cookie', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100', name: 'Ada Facebook', pages: [{ id: '5001' }] });
    const started = await startAuth(owner.token, workspace.id);
    const { res, location, result } = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });

    expect(res.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(
      'http://localhost:5173/oauth/meta/result',
    );
    expect(result).toMatchObject({
      status: 'success',
      reason: 'CONNECTED',
      provider: 'facebook',
      workspace: 'acme-social',
    });
    expect(
      res.headers['set-cookie'].some((c) => c.startsWith(`${started.cookie.split('=')[0]}=;`)),
    ).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');

    const connection = await SocialConnection.findById(result.connection);
    expect(connection).toMatchObject({
      provider: 'FACEBOOK_LOGIN',
      externalUserId: '100',
      displayName: 'Ada Facebook',
      status: 'ACTIVE',
    });
    expect(connection.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);
    expect(connection.dataAccessExpiresAt).toBeInstanceOf(Date);
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'social_connection.connected' }),
    ).toBeTruthy();
    // The callback redirect never carries tokens.
    expect(res.headers.location).not.toMatch(/token/i);
  });

  it('rejects a missing or unknown state without contacting Meta', async () => {
    const missing = await callback('facebook', { code: 'abc' });
    expect(missing.result).toMatchObject({ status: 'error', reason: 'STATE_MISSING' });
    const unknown = await callback('facebook', { state: 'x'.repeat(43), code: 'abc' });
    expect(unknown.result).toMatchObject({ status: 'error', reason: 'STATE_INVALID' });
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects an expired state', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    const started = await startAuth(owner.token, workspace.id);
    await OAuthState.updateOne(
      { workspace: workspace.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const { result } = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });
    expect(result).toMatchObject({
      status: 'error',
      reason: 'STATE_EXPIRED',
      workspace: 'acme-social',
    });
    expect(await SocialConnection.countDocuments()).toBe(0);
  });

  it('rejects a replayed state (single use)', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    const started = await startAuth(owner.token, workspace.id);
    const first = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });
    expect(first.result.status).toBe('success');
    const replay = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });
    expect(replay.result).toMatchObject({ status: 'error', reason: 'STATE_ALREADY_USED' });
  });

  it('rejects a callback completed in a different browser (CSRF / account injection)', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '666', name: 'Attacker' });
    const started = await startAuth(owner.token, workspace.id);

    const noCookie = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('666'),
    });
    expect(noCookie.result).toMatchObject({ status: 'error', reason: 'BROWSER_MISMATCH' });

    const wrongCookie = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('666'),
      cookie: `${started.cookie.split('=')[0]}=forged-value-forged-value`,
    });
    expect(wrongCookie.result).toMatchObject({ status: 'error', reason: 'BROWSER_MISMATCH' });
    expect(await SocialConnection.countDocuments()).toBe(0);
    // The legitimate flow is still usable after the failed attempts.
    const legit = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('666'),
      cookie: started.cookie,
    });
    expect(legit.result.status).toBe('success');
  });

  it('rejects a Facebook state presented to the Instagram callback', async () => {
    const { owner, workspace } = await ownerSetup();
    const started = await startAuth(owner.token, workspace.id);
    const { result } = await callback('instagram', {
      state: started.state,
      code: 'whatever',
      cookie: started.cookie,
    });
    expect(result).toMatchObject({ status: 'error', reason: 'STATE_INVALID' });
  });

  it('reports a cancelled consent dialog', async () => {
    const { owner, workspace } = await ownerSetup();
    const started = await startAuth(owner.token, workspace.id);
    const { result } = await callback('facebook', {
      state: started.state,
      cookie: started.cookie,
      extra: {
        error: 'access_denied',
        error_reason: 'user_denied',
        error_description: 'Permissions error',
      },
    });
    expect(result).toMatchObject({
      status: 'error',
      reason: 'USER_CANCELLED',
      workspace: 'acme-social',
    });
  });

  it('reports invalid or reused authorization codes as a failed token exchange', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    const started = await startAuth(owner.token, workspace.id);
    const { result } = await callback('facebook', {
      state: started.state,
      code: 'not-a-real-code',
      cookie: started.cookie,
    });
    expect(result).toMatchObject({ status: 'error', reason: 'TOKEN_EXCHANGE_FAILED' });
    expect(await SocialConnection.countDocuments()).toBe(0);
  });

  it('requires a code', async () => {
    const { owner, workspace } = await ownerSetup();
    const started = await startAuth(owner.token, workspace.id);
    const { result } = await callback('facebook', { state: started.state, cookie: started.cookie });
    expect(result).toMatchObject({ status: 'error', reason: 'CODE_MISSING' });
  });

  it('re-checks workspace permission at callback time', async () => {
    const { workspace, owner, admin } = await seedTeam();
    fake.addFacebookUser({ id: '100' });
    const started = await startAuth(admin.token, workspace.id);
    // Demoted while away at Meta.
    await as(owner.token)
      .patch(`/api/v1/workspaces/${workspace.id}/members/${admin.membershipId}`)
      .send({ role: 'EDITOR' });
    const { result } = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });
    expect(result).toMatchObject({ status: 'error', reason: 'FORBIDDEN' });
    expect(await SocialConnection.countDocuments()).toBe(0);
    expect(await Membership.countDocuments({ workspace: workspace.id })).toBe(4);
  });
});

describe('reauthorization', () => {
  it('re-prompts declined permissions and updates the same connection', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      granted: ['pages_show_list'],
      declined: ['pages_manage_posts'],
    });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');

    const started = await startAuth(owner.token, workspace.id, {
      provider: 'FACEBOOK_LOGIN',
      connectionId,
    });
    expect(started.url.searchParams.get('auth_type')).toBe('rerequest');

    fake.setPermissions('100', {
      granted: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
    });
    const { result } = await callback('facebook', {
      state: started.state,
      code: fake.authorizeFacebook('100'),
      cookie: started.cookie,
    });
    expect(result).toMatchObject({
      status: 'success',
      reason: 'RECONNECTED',
      connection: connectionId,
    });

    const connections = await SocialConnection.find({ workspace: workspace.id });
    expect(connections).toHaveLength(1);
    expect(connections[0].grantedScopes).toContain('pages_manage_posts');
    expect(connections[0].declinedScopes).toEqual([]);
    expect(
      await ActivityLog.exists({
        workspace: workspace.id,
        action: 'social_connection.reconnected',
      }),
    ).toBeTruthy();
  });

  it('refuses to reconnect a connection as a different Facebook identity', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({ id: '100' });
    fake.addFacebookUser({ id: '200' });
    const { connectionId } = await connectFacebook(fake, owner.token, workspace.id, '100');
    const before = await SocialConnection.findById(connectionId).select('+accessToken');

    const { result } = await connectFacebook(fake, owner.token, workspace.id, '200', {
      connectionId,
    });
    expect(result).toMatchObject({ status: 'error', reason: 'IDENTITY_MISMATCH' });

    const after = await SocialConnection.findById(connectionId).select('+accessToken');
    expect(after.externalUserId).toBe('100');
    expect(after.getAccessToken()).toBe(before.getAccessToken());
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(1);
  });
});

describe('Instagram Login', () => {
  it('connects a professional account, stripping the "#_" suffix from the code', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addInstagramUser({
      id: '9001',
      accountId: '17841400000000001',
      username: 'acme.studio',
      accountType: 'Media_Creator',
    });
    const { result } = await connectInstagram(fake, owner.token, workspace.id, '9001');
    expect(result).toMatchObject({ status: 'success', reason: 'CONNECTED', provider: 'instagram' });

    const connection = await SocialConnection.findById(result.connection);
    expect(connection).toMatchObject({
      provider: 'INSTAGRAM_LOGIN',
      externalUserId: '9001',
      displayName: '@acme.studio',
    });
    expect(connection.grantedScopes).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ]);
  });

  it('refuses accounts that are not Business or Creator accounts', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addInstagramUser({
      id: '9002',
      accountId: '17841400000000002',
      username: 'personal',
      accountType: 'PERSONAL',
    });
    const { result } = await connectInstagram(fake, owner.token, workspace.id, '9002');
    expect(result).toMatchObject({ status: 'error', reason: 'NOT_ELIGIBLE' });
    expect(await SocialConnection.countDocuments()).toBe(0);
  });
});
