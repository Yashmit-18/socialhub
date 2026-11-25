// Instagram API with Unified Login: configuration, the OAuth round trip, account discovery,
// token expiry/revocation, reconnect, duplicates, workspace isolation, Facebook Login
// regression and publishing in simulation. MOCKED: Meta is the simulated FakeMeta (no request
// can reach the real Meta, see setup.js), the database is a throwaway in-memory one and every
// Meta credential is fake. Nothing here proves that the real Meta accepts these requests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { metaSettings, setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import {
  ActivityLog,
  OAuthState,
  PublishDestination,
  SocialAccount,
  SocialConnection,
} from '../src/models/index.js';
import { scopeReport } from '../src/modules/meta/connectionHealth.js';
import { metaConfigChecks, metaIntegrationStatus } from '../src/modules/meta/metaOAuth.service.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import {
  FB_APP_ID,
  FB_APP_SECRET,
  FB_REDIRECT_URI,
  FakeMeta,
  IG_APP_ID,
  UNIFIED_CONFIG_ID,
  UNIFIED_REDIRECT_URI,
  UNIFIED_SETTINGS,
} from './fakeMeta.js';
import { api, as, createWorkspace, registerUser } from './helpers.js';
import {
  callback,
  connectFacebook,
  connectUnified,
  insta,
  page,
  selectAccounts,
  signedRequest,
  startAuth,
} from './metaHelpers.js';
import { createDraft, createTestQueue, publish } from './publishFixtures.js';

const DAY = 86_400_000;
const FACEBOOK_ONLY_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const BUSINESS = '880000000000001';
const IG_A = '17841400000000101';
const IG_B = '17841400000000102';

let fake;
let logged;
beforeEach(() => {
  fake = new FakeMeta().install();
  setMetaSettingsForTests({ instagramUnified: UNIFIED_SETTINGS });
  logged = [];
  for (const level of ['info', 'warn', 'error']) {
    vi.spyOn(logger, level).mockImplementation((entry, message) => {
      logged.push({ level, entry, message });
    });
  }
});
afterEach(() => {
  fake.uninstall();
  setMetaSettingsForTests(undefined);
  vi.restoreAllMocks();
});

async function ownerSetup(name = 'Acme Social') {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name });
  return { owner, workspace };
}

function addBusiness(overrides = {}) {
  return fake.addBusiness({
    id: BUSINESS,
    instagramAccounts: [
      { id: IG_A, username: 'acme.studio', name: 'Acme Studio' },
      { id: IG_B, username: 'acme.shop', name: 'Acme Shop' },
    ],
    ...overrides,
  });
}

const discovery = (token, wsId, connId) =>
  as(token).get(`/api/v1/workspaces/${wsId}/social-connections/${connId}/discovery`);
const sync = (token, wsId, connId) =>
  as(token).post(`/api/v1/workspaces/${wsId}/social-connections/${connId}/sync`);
const systemTokens = () => [...fake.tokens.entries()].filter(([, r]) => r.type === 'bisu');
/** Everything logged during the test as text (log entries may hold circular request objects). */
function logText() {
  const seen = new WeakSet();
  return JSON.stringify(logged, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
}

/* ------------------------------------------------------------------- configuration */

describe('configuration', () => {
  const env = {
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    APP_URL: 'https://app.example.com',
    CLIENT_ORIGIN: 'https://app.example.com',
    META_APP_ID: '123',
    META_APP_SECRET: 's'.repeat(32),
  };

  it('runs Unified Login under the Meta app id with its own configuration id and callback', () => {
    const cfg = loadConfig({ ...env, META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: '2273594010228203' });
    expect(cfg.meta.instagramUnified).toEqual({
      appId: '123',
      appSecret: 's'.repeat(32),
      configId: '2273594010228203',
      redirectUri: 'https://app.example.com/api/v1/oauth/instagram-unified/callback',
    });
    // Facebook Login is unchanged: no configuration id, scopes, its own callback.
    expect(cfg.meta.facebook).toMatchObject({
      loginConfigId: null,
      redirectUri: 'https://app.example.com/api/v1/oauth/facebook/callback',
    });
    expect(cfg.meta.instagram).toBeNull();
    const status = metaIntegrationStatus(cfg);
    expect(status.instagramUnified).toMatchObject({
      configured: true,
      ready: true,
      missing: [],
      configId: '2273594010228203',
      permissionsFromConfiguration: true,
      usedPermissions: ['instagram_basic', 'instagram_content_publish'],
      redirectUri: 'https://app.example.com/api/v1/oauth/instagram-unified/callback',
    });
    const ids = metaConfigChecks(cfg).map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['INSTAGRAM_UNIFIED_REDIRECT_URL', 'INSTAGRAM_UNIFIED_PERMISSIONS']),
    );
    // The older Instagram Login is optional once Unified Login is configured.
    expect(ids).not.toContain('INSTAGRAM_NOT_CONFIGURED');
    expect(JSON.stringify(status)).not.toContain('s'.repeat(32));
  });

  it('names exactly the missing variables and stays disabled without them', () => {
    const noConfigId = loadConfig(env);
    expect(noConfigId.meta.instagramUnified).toBeNull();
    expect(metaIntegrationStatus(noConfigId).instagramUnified).toMatchObject({
      configured: false,
      ready: false,
      missing: ['META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID'],
      configId: null,
    });

    const noApp = loadConfig({
      ...env,
      META_APP_ID: undefined,
      META_APP_SECRET: undefined,
      META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: '2273594010228203',
    });
    expect(noApp.meta.instagramUnified).toBeNull();
    const status = metaIntegrationStatus(noApp);
    expect(status.instagramUnified).toMatchObject({
      configured: false,
      missing: ['META_APP_ID', 'META_APP_SECRET'],
      configId: '2273594010228203',
    });
    expect(status.facebook.missing).toEqual(['META_APP_ID', 'META_APP_SECRET']);
    expect(
      metaConfigChecks(noApp).find((c) => c.id === 'INSTAGRAM_UNIFIED_NOT_CONFIGURED').message,
    ).toMatch(/META_APP_ID, META_APP_SECRET/);
  });

  it('refuses a configuration id placed in an app id field or in the Facebook Login configuration', () => {
    const id = '2273594010228203';
    expect(() =>
      loadConfig({ ...env, META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: id, META_APP_ID: id }),
    ).toThrow(/META_APP_ID has the same value .*not the Meta App ID/);
    expect(() =>
      loadConfig({
        ...env,
        META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: id,
        INSTAGRAM_APP_ID: id,
        INSTAGRAM_APP_SECRET: 'i'.repeat(32),
      }),
    ).toThrow(/INSTAGRAM_APP_ID has the same value .*not an Instagram App ID/);
    expect(() =>
      loadConfig({
        ...env,
        META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: id,
        META_FACEBOOK_LOGIN_CONFIG_ID: id,
      }),
    ).toThrow(/META_FACEBOOK_LOGIN_CONFIG_ID .*break Facebook Page discovery/);
    expect(() =>
      loadConfig({ ...env, META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: 'config-2273' }),
    ).toThrow(/META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID must be the numeric Configuration ID/);
  });

  it('does not ask a Facebook-only login for Instagram permissions once Instagram has its own login', () => {
    const facebookOnly = { ...env, META_FACEBOOK_SCOPES: FACEBOOK_ONLY_SCOPES.join(',') };
    const publishingWarning = (cfg) =>
      metaConfigChecks(cfg).find((c) => c.id === 'FACEBOOK_PUBLISHING_SCOPES_MISSING');
    // Facebook Login is the only route to Instagram: its Instagram permissions are missing.
    expect(publishingWarning(loadConfig(facebookOnly)).message).toMatch(
      /instagram_basic, instagram_content_publish/,
    );
    // With Unified Login, the Facebook-only login is complete.
    expect(
      publishingWarning(
        loadConfig({ ...facebookOnly, META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: '1590814224104477' }),
      ),
    ).toBeUndefined();
    // A Page permission that is really missing is still reported.
    const noPosts = loadConfig({
      ...env,
      META_FACEBOOK_SCOPES: 'pages_show_list,pages_read_engagement',
      META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: '1590814224104477',
    });
    expect(publishingWarning(noPosts).message).toBe(
      'Not requested (needed for publishing later): pages_manage_posts.',
    );
  });

  it('lists Instagram permissions as missing on a Facebook login only when Facebook Login asks for them', () => {
    const login = { provider: 'FACEBOOK_LOGIN', grantedScopes: FACEBOOK_ONLY_SCOPES };
    // Test default: Facebook Login asks for instagram_basic and instagram_content_publish.
    expect(scopeReport(login).publishing).toEqual(['instagram_basic', 'instagram_content_publish']);
    setMetaSettingsForTests({
      instagramUnified: UNIFIED_SETTINGS,
      facebook: { ...metaSettings().facebook, scopes: FACEBOOK_ONLY_SCOPES },
    });
    expect(scopeReport(login).publishing).toEqual([]);
    expect(scopeReport({ ...login, grantedScopes: ['pages_show_list'] }).publishing).toEqual([
      'pages_manage_posts',
      'pages_read_engagement',
    ]);
  });

  it('reports the Unified Login settings through the API without secrets', async () => {
    const { owner } = await ownerSetup();
    const res = await as(owner.token).get('/api/v1/integrations/meta');
    expect(res.status).toBe(200);
    expect(res.body.instagramUnified).toMatchObject({
      configured: true,
      configId: UNIFIED_CONFIG_ID,
      redirectUri: UNIFIED_REDIRECT_URI,
    });
    expect(res.body.facebook).toMatchObject({ configured: true, redirectUri: FB_REDIRECT_URI });
    expect(JSON.stringify(res.body)).not.toMatch(/test-meta-app-secret|test-instagram-app-secret/);
  });
});

/* ------------------------------------------------------------------ authorization */

describe('starting a Unified Login', () => {
  it('sends the person to the Facebook Login for Business dialog with the configuration id', async () => {
    const { owner, workspace } = await ownerSetup();
    const { res, url, state, setCookie } = await startAuth(owner.token, workspace.id, {
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
    });
    expect(res.status).toBe(201);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: FB_APP_ID,
      config_id: UNIFIED_CONFIG_ID,
      redirect_uri: UNIFIED_REDIRECT_URI,
      response_type: 'code',
      override_default_response_type: 'true',
      prompt: 'login',
      state,
    });
    // config_id replaces scope, and the Instagram app id is never used.
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.toString()).not.toContain(IG_APP_ID);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(await OAuthState.findOne({ workspace: workspace.id })).toMatchObject({
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
      purpose: 'CONNECT',
    });
  });

  it('answers META_NOT_CONFIGURED with the missing variable when the configuration id is absent', async () => {
    setMetaSettingsForTests({ instagramUnified: null, instagramUnifiedConfigId: null });
    const { owner, workspace } = await ownerSetup();
    const { res } = await startAuth(owner.token, workspace.id, {
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'META_NOT_CONFIGURED',
      details: { missing: ['META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID'] },
    });
    expect(res.body.error.message).toMatch(/Instagram \(Unified Login\) is not configured/);
    expect(await OAuthState.countDocuments()).toBe(0);
  });
});

describe('Unified Login callback', () => {
  it('connects the business portfolio and lists its Instagram professional accounts', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { result, res } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    expect(result).toMatchObject({
      status: 'success',
      reason: 'CONNECTED',
      provider: 'instagram-unified',
      workspace: 'acme-social',
    });
    expect(res.headers.location).not.toMatch(/token|bisu/i);

    const connection = await SocialConnection.findById(result.connection).select('+accessToken');
    expect(connection).toMatchObject({
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
      externalUserId: BUSINESS,
      metaSystemUserId: `su_${BUSINESS}`,
      loginConfigId: UNIFIED_CONFIG_ID,
      displayName: '@acme.studio, @acme.shop',
      status: 'ACTIVE',
    });
    expect(connection.grantedScopes).toEqual(['instagram_basic', 'instagram_content_publish']);
    expect(connection.tokenExpiresAt).toBeUndefined(); // the configuration default: never
    // Encrypted at rest: the stored value is not the token itself.
    const [[plainToken]] = systemTokens();
    const raw = await SocialConnection.collection.findOne({ _id: connection._id });
    expect(JSON.stringify(raw)).not.toContain(plainToken);
    expect(connection.getAccessToken()).toBe(plainToken);

    // The exchange used the Meta app credentials and the Unified Login redirect URI.
    const exchange = fake.calls.find((c) => c.path.endsWith('/oauth/access_token'));
    expect(exchange.params).toMatchObject({
      client_id: FB_APP_ID,
      client_secret: FB_APP_SECRET,
      redirect_uri: UNIFIED_REDIRECT_URI,
    });
    // Every Graph call with the token carried appsecret_proof.
    const graphCalls = fake.calls.filter((c) => c.params.access_token === plainToken);
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls.every((c) => c.params.appsecret_proof)).toBe(true);

    const found = await discovery(owner.token, workspace.id, result.connection);
    expect(found.status).toBe(200);
    expect(found.body.candidates.map((c) => [c.externalId, c.username, c.state])).toEqual([
      [IG_A, 'acme.studio', 'NEW'],
      [IG_B, 'acme.shop', 'NEW'],
    ]);
    expect(found.body.candidates[0]).toMatchObject({
      platform: 'INSTAGRAM_ACCOUNT',
      name: 'Acme Studio',
      linkedPage: null,
      publishing: { status: 'READY' },
    });
    expect(JSON.stringify(found.body)).not.toContain(plainToken);
    expect(found.body.warnings).toEqual([]);

    fake.setFollowers(IG_A, 1234);
    const added = await selectAccounts(owner.token, workspace.id, result.connection, [
      insta(IG_A),
      insta(IG_B),
    ]);
    expect(added.status).toBe(200);
    expect(added.body.added).toHaveLength(2);
    const accounts = await SocialAccount.find({ workspace: workspace.id }).sort({ externalId: 1 });
    expect(accounts.map((a) => [a.externalId, a.publishingStatus, a.connectionStatus])).toEqual([
      [IG_A, 'READY', 'ACTIVE'],
      [IG_B, 'READY', 'ACTIVE'],
    ]);
    expect(accounts[0].followersCount).toBe(1234);
    expect(
      await ActivityLog.exists({ workspace: workspace.id, action: 'social_connection.connected' }),
    ).toBeTruthy();
    // No token appears in any log line.
    expect(logText()).not.toContain(plainToken);
    expect(logText()).not.toContain(FB_APP_SECRET);
  });

  it('follows pagination of the assigned accounts and falls back to the documented fields', async () => {
    fake.pageSize = 2;
    const { owner, workspace } = await ownerSetup();
    const business = addBusiness({
      instagramAccounts: ['1', '2', '3'].map((n) => ({
        id: `1784140000000020${n}`,
        username: `brand${n}`,
      })),
    });
    business.rejectsProfileFields = true;
    const { result } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    expect(result.status).toBe('success');
    const found = await discovery(owner.token, workspace.id, result.connection);
    expect(found.body.candidates.map((c) => c.username)).toEqual(['brand1', 'brand2', 'brand3']);
    expect(found.body.candidates[0]).toMatchObject({ name: 'brand1', pictureUrl: null });
  });

  it('validates the state: missing, unknown, other provider, other browser and replays', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const missing = await callback('instagram-unified', { code: fake.authorizeUnified(BUSINESS) });
    expect(missing.result).toMatchObject({ status: 'error', reason: 'STATE_MISSING' });
    const unknown = await callback('instagram-unified', {
      state: 'x'.repeat(43),
      code: fake.authorizeUnified(BUSINESS),
    });
    expect(unknown.result).toMatchObject({ status: 'error', reason: 'STATE_INVALID' });

    // A Facebook Login state can never complete a Unified Login (and vice versa).
    const facebookStarted = await startAuth(owner.token, workspace.id);
    const crossed = await callback('instagram-unified', {
      state: facebookStarted.state,
      code: fake.authorizeUnified(BUSINESS),
      cookie: facebookStarted.cookie,
    });
    expect(crossed.result).toMatchObject({ status: 'error', reason: 'STATE_INVALID' });
    const unifiedStarted = await startAuth(owner.token, workspace.id, {
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
    });
    const crossedBack = await callback('facebook', {
      state: unifiedStarted.state,
      code: 'any',
      cookie: unifiedStarted.cookie,
    });
    expect(crossedBack.result).toMatchObject({ status: 'error', reason: 'STATE_INVALID' });

    const noCookie = await callback('instagram-unified', {
      state: unifiedStarted.state,
      code: fake.authorizeUnified(BUSINESS),
    });
    expect(noCookie.result).toMatchObject({ status: 'error', reason: 'BROWSER_MISMATCH' });
    // No code was exchanged so far.
    expect(fake.calls.filter((c) => c.path.endsWith('/oauth/access_token'))).toHaveLength(0);

    const ok = await callback('instagram-unified', {
      state: unifiedStarted.state,
      code: fake.authorizeUnified(BUSINESS),
      cookie: unifiedStarted.cookie,
    });
    expect(ok.result.status).toBe('success');
    const replay = await callback('instagram-unified', {
      state: unifiedStarted.state,
      code: fake.authorizeUnified(BUSINESS),
      cookie: unifiedStarted.cookie,
    });
    expect(replay.result).toMatchObject({ status: 'error', reason: 'STATE_ALREADY_USED' });
    expect(await SocialConnection.countDocuments()).toBe(1);
  });

  it('reports a cancelled dialog and connects nothing', async () => {
    const { owner, workspace } = await ownerSetup();
    const started = await startAuth(owner.token, workspace.id, {
      provider: 'INSTAGRAM_UNIFIED_LOGIN',
    });
    const { result } = await callback('instagram-unified', {
      state: started.state,
      cookie: started.cookie,
      extra: { error: 'access_denied', error_reason: 'user_denied' },
    });
    expect(result).toMatchObject({ status: 'error', reason: 'USER_CANCELLED' });
    expect(await SocialConnection.countDocuments()).toBe(0);
    expect(await OAuthState.findOne({ workspace: workspace.id })).toMatchObject({
      callbackResult: 'USER_CANCELLED',
      metaError: 'access_denied/user_denied',
    });
  });

  it('never marks anything connected when the exchange, the token or the discovery fails', async () => {
    const { owner, workspace } = await ownerSetup();
    const business = addBusiness();
    const attempt = async (code) => {
      const started = await startAuth(owner.token, workspace.id, {
        provider: 'INSTAGRAM_UNIFIED_LOGIN',
      });
      return (
        await callback('instagram-unified', { state: started.state, code, cookie: started.cookie })
      ).result;
    };

    // Invalid code: Meta refuses the exchange.
    expect(await attempt('not-a-real-code')).toMatchObject({
      status: 'error',
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
    // A Facebook Login code cannot be exchanged with the Unified Login redirect URI.
    fake.addFacebookUser({ id: '100' });
    expect(await attempt(fake.authorizeFacebook('100'))).toMatchObject({
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
    // The token Meta issued is reported invalid by debug_token.
    business.state = 'revoked';
    expect(await attempt(fake.authorizeUnified(BUSINESS))).toMatchObject({
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
    business.state = 'valid';
    // Meta refuses to list the accounts.
    fake.failures.set('GET /me/assigned_instagram_accounts', () =>
      Response.json({ error: { code: 100, message: 'Unsupported get request' } }, { status: 400 }),
    );
    expect(await attempt(fake.authorizeUnified(BUSINESS))).toMatchObject({
      reason: 'ACCOUNT_DISCOVERY_FAILED',
    });
    fake.failures.clear();
    // No Instagram account was shared in the dialog.
    business.instagramAccounts = [];
    expect(await attempt(fake.authorizeUnified(BUSINESS))).toMatchObject({
      reason: 'NO_INSTAGRAM_ACCOUNTS',
    });

    expect(await SocialConnection.countDocuments()).toBe(0);
    expect(await SocialAccount.countDocuments()).toBe(0);
    const failure = logged.find((l) => l.message === 'Meta token exchange failed');
    expect(failure.entry.oauth.stage).toBe('code_exchange');
    expect(logged.some((l) => l.entry?.oauth?.stage === 'accounts')).toBe(true);
    for (const [token] of systemTokens()) expect(logText()).not.toContain(token);
  });

  it('refuses tokens Meta reports for another app', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const original = fake.debugSystemUserToken.bind(fake);
    fake.debugSystemUserToken = async (record) => {
      const body = await (await original(record)).json();
      return Response.json({ data: { ...body.data, app_id: '999999' } });
    };
    const { result } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    expect(result).toMatchObject({ status: 'error', reason: 'TOKEN_EXCHANGE_FAILED' });
    expect(await SocialConnection.countDocuments()).toBe(0);
  });
});

/* ------------------------------------------------------- reconnect and duplicates */

describe('reconnect and duplicate connections', () => {
  it('reconnecting the same business updates the one connection and its accounts', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const first = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    await selectAccounts(owner.token, workspace.id, first.connectionId, [insta(IG_A)]);
    const before = await SocialConnection.findById(first.connectionId).select('+accessToken');

    const again = await connectUnified(fake, owner.token, workspace.id, BUSINESS, {
      connectionId: first.connectionId,
    });
    expect(again.started.url.searchParams.get('config_id')).toBe(UNIFIED_CONFIG_ID);
    expect(again.result).toMatchObject({
      status: 'success',
      reason: 'RECONNECTED',
      connection: first.connectionId,
    });
    const connections = await SocialConnection.find({ workspace: workspace.id }).select(
      '+accessToken',
    );
    expect(connections).toHaveLength(1);
    const after = connections[0].getAccessToken();
    expect(after).not.toBe(before.getAccessToken());
    const [account] = await SocialAccount.find({ workspace: workspace.id }).select('+accessToken');
    expect(account.getAccessToken()).toBe(after);

    // A plain "Connect" for the same business also reuses the connection (no duplicate).
    const third = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    expect(third.result).toMatchObject({ reason: 'RECONNECTED', connection: first.connectionId });
    expect(await SocialConnection.countDocuments({ workspace: workspace.id })).toBe(1);
  });

  it('refuses to reconnect with a different business portfolio and keeps the valid token', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    fake.addBusiness({ id: '880000000000002', instagramAccounts: [{ id: '178', username: 'x' }] });
    const first = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    const before = await SocialConnection.findById(first.connectionId).select('+accessToken');
    const wrong = await connectUnified(fake, owner.token, workspace.id, '880000000000002', {
      connectionId: first.connectionId,
    });
    expect(wrong.result).toMatchObject({ status: 'error', reason: 'IDENTITY_MISMATCH' });
    const after = await SocialConnection.findById(first.connectionId).select('+accessToken');
    expect(after.getAccessToken()).toBe(before.getAccessToken());
    expect(after.externalUserId).toBe(BUSINESS);
    expect(await SocialConnection.countDocuments()).toBe(1);
  });

  it('does not take over an Instagram account already connected through a healthy Facebook login', async () => {
    const { owner, workspace } = await ownerSetup();
    fake.addFacebookUser({
      id: '100',
      pages: [{ id: '5001', instagram: { id: IG_A, username: 'acme.studio' } }],
    });
    const fb = await connectFacebook(fake, owner.token, workspace.id, '100');
    await selectAccounts(owner.token, workspace.id, fb.connectionId, [page('5001'), insta(IG_A)]);

    addBusiness();
    const unified = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    const found = await discovery(owner.token, workspace.id, unified.connectionId);
    expect(found.body.candidates.find((c) => c.externalId === IG_A)).toMatchObject({
      state: 'CONNECTED_VIA_OTHER',
    });
    const res = await selectAccounts(owner.token, workspace.id, unified.connectionId, [
      insta(IG_A),
      insta(IG_B),
    ]);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ externalId: IG_A, reason: 'CONNECTED_VIA_OTHER' }),
    ]);
    expect(res.body.added.map((a) => a.externalId)).toEqual([IG_B]);
    expect(await SocialAccount.countDocuments({ workspace: workspace.id, externalId: IG_A })).toBe(
      1,
    );
  });
});

/* ------------------------------------------------- token health, sync and revocation */

describe('token expiry, revocation and synchronization', () => {
  it('shows an expiring token, marks it expired, and a reconnect restores it', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness({ tokenTtlMs: 3 * DAY });
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    await selectAccounts(owner.token, workspace.id, connectionId, [insta(IG_A)]);
    const stored = await SocialConnection.findById(connectionId);
    expect(stored.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 2 * DAY);
    const detail = await as(owner.token).get(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}`,
    );
    expect(detail.body.connection.attention.map((a) => a.code)).toContain('EXPIRING_SOON');

    // The token runs out at Meta.
    for (const [, record] of systemTokens()) record.expiresAt = Date.now() - 1000;
    const res = await sync(owner.token, workspace.id, connectionId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'TOKEN_EXPIRED' });
    expect(res.body.connection.status).toBe('EXPIRED');
    const [account] = await SocialAccount.find({ workspace: workspace.id });
    expect(account).toMatchObject({ connectionStatus: 'EXPIRED', publishingStatus: 'UNAVAILABLE' });

    const again = await connectUnified(fake, owner.token, workspace.id, BUSINESS, {
      connectionId,
    });
    expect(again.result.reason).toBe('RECONNECTED');
    expect((await SocialConnection.findById(connectionId)).status).toBe('ACTIVE');
    const [restored] = await SocialAccount.find({ workspace: workspace.id });
    expect(restored).toMatchObject({ connectionStatus: 'ACTIVE', publishingStatus: 'READY' });
  });

  it('marks the connection revoked when the client removes the app from its business portfolio', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    await selectAccounts(owner.token, workspace.id, connectionId, [insta(IG_A)]);
    fake.setTokenState(BUSINESS, 'revoked');
    const res = await sync(owner.token, workspace.id, connectionId);
    expect(res.body).toMatchObject({ outcome: 'TOKEN_REVOKED' });
    expect(res.body.connection.status).toBe('REVOKED');
    expect((await SocialAccount.findOne({ externalId: IG_A })).publishingStatus).toBe(
      'UNAVAILABLE',
    );
  });

  it('a sync takes over permissions from Meta and flags accounts that are no longer shared', async () => {
    const { owner, workspace } = await ownerSetup();
    const business = addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    await selectAccounts(owner.token, workspace.id, connectionId, [insta(IG_A), insta(IG_B)]);

    business.instagramAccounts = business.instagramAccounts.filter((a) => a.id === IG_A);
    business.granted = ['instagram_basic'];
    const res = await sync(owner.token, workspace.id, connectionId);
    expect(res.body).toMatchObject({ outcome: 'SUCCESS', accounts: { refreshed: 1, lost: 1 } });
    const connection = await SocialConnection.findById(connectionId);
    expect(connection.grantedScopes).toEqual(['instagram_basic']);
    const a = await SocialAccount.findOne({ externalId: IG_A });
    const b = await SocialAccount.findOne({ externalId: IG_B });
    expect(a).toMatchObject({ connectionStatus: 'ACTIVE', publishingStatus: 'RESTRICTED' });
    expect(a.publishingStatusReason).toMatch(/instagram_content_publish/);
    expect(b).toMatchObject({ connectionStatus: 'ERROR', publishingStatus: 'UNAVAILABLE' });
  });

  it('stops contacting Meta when the configuration is removed, without touching the connection', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    const before = await SocialConnection.findById(connectionId).select('+accessToken');
    setMetaSettingsForTests({ instagramUnified: null });
    const calls = fake.calls.length;
    const res = await sync(owner.token, workspace.id, connectionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('META_NOT_CONFIGURED');
    expect(res.body.error.message).toMatch(/Instagram \(Unified Login\) is not configured/);
    expect(fake.calls.length).toBe(calls);
    const after = await SocialConnection.findById(connectionId).select('+accessToken');
    expect(after.status).toBe('ACTIVE');
    expect(after.getAccessToken()).toBe(before.getAccessToken());
  });

  it('a Facebook deauthorize callback for the system user revokes the Unified Login connection', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    const res = await api()
      .post('/api/v1/meta/facebook/deauthorize')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: `su_${BUSINESS}` }, FB_APP_SECRET) });
    expect(res.status).toBe(200);
    const connection = await SocialConnection.findById(connectionId).select('+accessToken');
    expect(connection.status).toBe('REVOKED');
    expect(connection.hasAccessToken()).toBe(false);
  });

  it('disconnecting erases the token locally and never calls the user-token revoke endpoint', async () => {
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    const res = await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${connectionId}/disconnect`,
    );
    expect(res.status).toBe(200);
    expect(res.body.revokedAtMeta).toBe(false);
    expect(fake.revocations()).toHaveLength(0);
    const connection = await SocialConnection.findById(connectionId).select('+accessToken');
    expect(connection).toMatchObject({ status: 'DISCONNECTED' });
    expect(connection.hasAccessToken()).toBe(false);
  });
});

/* ------------------------------------------------------------- workspace isolation */

describe('workspace isolation', () => {
  it('the same business in two workspaces gives two independent connections', async () => {
    const a = await ownerSetup('Agency A');
    const b = await ownerSetup('Agency B');
    addBusiness();
    const inA = await connectUnified(fake, a.owner.token, a.workspace.id, BUSINESS);
    const inB = await connectUnified(fake, b.owner.token, b.workspace.id, BUSINESS);
    expect(inA.result.reason).toBe('CONNECTED');
    expect(inB.result.reason).toBe('CONNECTED');
    expect(inA.connectionId).not.toBe(inB.connectionId);

    // Workspace B can neither see nor use workspace A's connection.
    expect((await discovery(b.owner.token, b.workspace.id, inA.connectionId)).status).toBe(404);
    // A non-member is not even told that the workspace exists.
    expect((await discovery(a.owner.token, b.workspace.id, inA.connectionId)).status).toBe(404);

    await as(a.owner.token).post(
      `/api/v1/workspaces/${a.workspace.id}/social-connections/${inA.connectionId}/disconnect`,
    );
    const other = await SocialConnection.findById(inB.connectionId).select('+accessToken');
    expect(other.status).toBe('ACTIVE');
    expect(other.hasAccessToken()).toBe(true);
  });
});

/* ------------------------------------------------------- Facebook Login regression */

describe('Facebook Login is unaffected', () => {
  it('still uses its scopes, callback and user-token Page discovery while Unified Login is on', async () => {
    const { owner, workspace } = await ownerSetup();
    const { url } = await startAuth(owner.token, workspace.id);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(url.searchParams.get('redirect_uri')).toBe(FB_REDIRECT_URI);
    expect(url.searchParams.has('config_id')).toBe(false);
    expect(url.searchParams.get('scope')).toContain('pages_show_list');

    fake.addFacebookUser({ id: '100', name: 'Ada', pages: [{ id: '5001' }] });
    addBusiness();
    const fb = await connectFacebook(fake, owner.token, workspace.id, '100');
    const unified = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    expect(fb.result.reason).toBe('CONNECTED');
    expect(unified.result.reason).toBe('CONNECTED');
    const pages = await discovery(owner.token, workspace.id, fb.connectionId);
    expect(pages.body.candidates.map((c) => c.externalId)).toEqual(['5001']);
    expect(await SocialConnection.find({ workspace: workspace.id }).distinct('provider')).toEqual(
      expect.arrayContaining(['FACEBOOK_LOGIN', 'INSTAGRAM_UNIFIED_LOGIN']),
    );
    // The Facebook exchange used the long-lived user-token path; Unified Login did not.
    expect(fake.calls.filter((c) => c.params.grant_type === 'fb_exchange_token')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ publishing (simulated) */

describe('publishing to a Unified Login account in simulation', () => {
  afterEach(() => {
    setPublishQueueForTests(undefined);
    setPublishingSettingsForTests(undefined);
  });

  it('publishes through the simulated adapter and never calls Meta', async () => {
    const queue = createTestQueue();
    setPublishQueueForTests(queue);
    setPublishingSettingsForTests({
      mode: 'SIMULATED',
      maxAttempts: 3,
      retryBaseMs: 30_000,
      retryMaxMs: 900_000,
    });
    const { owner, workspace } = await ownerSetup();
    addBusiness();
    const { connectionId } = await connectUnified(fake, owner.token, workspace.id, BUSINESS);
    await selectAccounts(owner.token, workspace.id, connectionId, [insta(IG_A)]);
    const account = await SocialAccount.findOne({ externalId: IG_A });

    const callsBefore = fake.calls.length;
    const draft = await createDraft(owner.token, workspace.id, {
      accounts: [account],
      media: 'image',
    });
    const res = await publish(owner.token, workspace.id, { contentPackageId: draft.id });
    expect(res.status).toBe(201);
    expect(res.body.publishJob).toMatchObject({ mode: 'SIMULATED', simulated: true });
    expect(await queue.deliver()).toEqual(['published']);
    const [destination] = await PublishDestination.find({ job: res.body.publishJob.id });
    expect(destination).toMatchObject({ state: 'PUBLISHED', platform: 'INSTAGRAM_ACCOUNT' });
    // Nothing reached Meta: no container, no media_publish, no other call.
    expect(fake.calls.length).toBe(callsBefore);
  });
});
