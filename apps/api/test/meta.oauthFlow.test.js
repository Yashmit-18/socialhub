// Facebook Login round trips with several people and several attempts at once, and the safe
// diagnostics that show where an attempt stopped. MOCKED: Meta is the simulated FakeMeta, the
// database is a throwaway in-memory one, and the Meta app credentials are fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactUrl } from '../src/app.js';
import { logger } from '../src/config/logger.js';
import { OAuthState, SocialConnection } from '../src/models/index.js';
import { explainOAuthAttempt, oauthAttemptId } from '../src/modules/meta/metaOAuth.service.js';
import { sha256 } from '../src/lib/crypto.js';
import { FB_APP_ID, FB_REDIRECT_URI, FakeMeta } from './fakeMeta.js';
import { createWorkspace, registerUser } from './helpers.js';
import { callback, startAuth } from './metaHelpers.js';

let fake;
let logged;
beforeEach(() => {
  fake = new FakeMeta().install();
  logged = [];
  for (const level of ['info', 'warn', 'error']) {
    vi.spyOn(logger, level).mockImplementation((entry, message) => {
      logged.push({ level, entry, message });
    });
  }
});
afterEach(() => {
  fake.uninstall();
  vi.restoreAllMocks();
});

async function person(name, workspaceName) {
  const user = await registerUser({ name });
  const { workspace } = await createWorkspace(user.token, { name: workspaceName });
  return { user, workspace };
}

const attemptFor = (state) => OAuthState.findOne({ stateHash: sha256(state) }).lean();
const oauthLogs = () => logged.filter((l) => l.entry?.oauth);

describe('several people and several attempts at once', () => {
  it('two different people connect their own Facebook accounts at the same time', async () => {
    const admin = await person('Ada Admin', 'Ada Pages');
    const second = await person('Bob Second', 'Bob Pages');
    fake.addFacebookUser({ id: '100', name: 'Ada Facebook', pages: [{ id: '5001' }] });
    fake.addFacebookUser({ id: '200', name: 'Bob Facebook', pages: [{ id: '6001' }] });

    // Both start before either comes back from Meta.
    const startedA = await startAuth(admin.user.token, admin.workspace.id);
    const startedB = await startAuth(second.user.token, second.workspace.id);
    expect(startedA.state).not.toBe(startedB.state);
    expect(startedA.cookie.split('=')[0]).not.toBe(startedB.cookie.split('=')[0]);

    // The second person comes back first.
    const doneB = await callback('facebook', {
      state: startedB.state,
      code: fake.authorizeFacebook('200'),
      cookie: startedB.cookie,
    });
    const doneA = await callback('facebook', {
      state: startedA.state,
      code: fake.authorizeFacebook('100'),
      cookie: startedA.cookie,
    });
    expect(doneA.result).toMatchObject({
      status: 'success',
      reason: 'CONNECTED',
      workspace: 'ada-pages',
    });
    expect(doneB.result).toMatchObject({
      status: 'success',
      reason: 'CONNECTED',
      workspace: 'bob-pages',
    });

    const [connA] = await SocialConnection.find({ workspace: admin.workspace.id });
    const [connB] = await SocialConnection.find({ workspace: second.workspace.id });
    expect(connA).toMatchObject({ externalUserId: '100', displayName: 'Ada Facebook' });
    expect(connB).toMatchObject({ externalUserId: '200', displayName: 'Bob Facebook' });
    for (const state of [startedA.state, startedB.state]) {
      expect(await attemptFor(state)).toMatchObject({
        callbackResult: 'CONNECTED',
        callbackCount: 1,
      });
    }
  });

  it('two attempts from the same browser do not overwrite each other', async () => {
    const { user, workspace } = await person('Olivia Owner', 'Acme Social');
    fake.addFacebookUser({ id: '100', name: 'First Facebook' });
    fake.addFacebookUser({ id: '200', name: 'Second Facebook' });
    const first = await startAuth(user.token, workspace.id);
    const second = await startAuth(user.token, workspace.id);
    // The browser now holds both binding cookies.
    const jar = `${first.cookie}; ${second.cookie}`;

    const doneSecond = await callback('facebook', {
      state: second.state,
      code: fake.authorizeFacebook('200'),
      cookie: jar,
    });
    const doneFirst = await callback('facebook', {
      state: first.state,
      code: fake.authorizeFacebook('100'),
      cookie: jar,
    });
    expect(doneSecond.result.status).toBe('success');
    expect(doneFirst.result.status).toBe('success');
    const ids = (await SocialConnection.find({ workspace: workspace.id })).map(
      (c) => c.externalUserId,
    );
    expect(ids.sort()).toEqual(['100', '200']);
  });

  it("refuses a callback that carries another attempt's cookie, records it, and still lets the right browser finish", async () => {
    const { user, workspace } = await person('Olivia Owner', 'Acme Social');
    fake.addFacebookUser({ id: '100' });
    const mine = await startAuth(user.token, workspace.id);
    const other = await startAuth(user.token, workspace.id);

    // Same thing as coming back on another hostname: the host-only binding cookie is not sent.
    const wrong = await callback('facebook', {
      state: mine.state,
      code: fake.authorizeFacebook('100'),
      cookie: other.cookie,
    });
    expect(wrong.result).toMatchObject({ status: 'error', reason: 'BROWSER_MISMATCH' });
    let attempt = await attemptFor(mine.state);
    expect(attempt).toMatchObject({ callbackResult: 'BROWSER_MISMATCH', callbackCount: 1 });
    expect(attempt.consumedAt).toBeUndefined();
    expect(explainOAuthAttempt(attempt)).toBe(
      'came back to SocialHub and was refused: BROWSER_MISMATCH',
    );
    expect(oauthLogs().at(-1).entry.oauth).toMatchObject({
      attempt: oauthAttemptId(sha256(mine.state)),
      failedAt: 'browser_binding',
      browserBinding: 'missing',
      stateKnown: true,
    });

    const right = await callback('facebook', {
      state: mine.state,
      code: fake.authorizeFacebook('100'),
      cookie: mine.cookie,
    });
    expect(right.result.status).toBe('success');
    attempt = await attemptFor(mine.state);
    expect(attempt).toMatchObject({ callbackResult: 'CONNECTED', callbackCount: 2 });
    expect(explainOAuthAttempt(attempt)).toBe('completed: CONNECTED');
  });
});

describe('diagnostics: where an attempt stopped', () => {
  it('an attempt that never comes back from Meta has no callback recorded', async () => {
    const { user, workspace } = await person('Olivia Owner', 'Acme Social');
    const started = await startAuth(user.token, workspace.id);
    const attempt = await attemptFor(started.state);
    expect(attempt.callbackAt).toBeUndefined();
    expect(explainOAuthAttempt(attempt)).toBe('waiting: the person is still at Meta');
    expect(explainOAuthAttempt(attempt, new Date(Date.now() + 3_600_000))).toMatch(
      /^never came back from Meta/,
    );
  });

  it('records expired, cancelled, failed-exchange and replayed callbacks', async () => {
    const { user, workspace } = await person('Olivia Owner', 'Acme Social');
    fake.addFacebookUser({ id: '100' });

    const expired = await startAuth(user.token, workspace.id);
    await OAuthState.updateOne(
      { stateHash: sha256(expired.state) },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await callback('facebook', {
      state: expired.state,
      code: fake.authorizeFacebook('100'),
      cookie: expired.cookie,
    });
    expect(await attemptFor(expired.state)).toMatchObject({ callbackResult: 'STATE_EXPIRED' });

    const cancelled = await startAuth(user.token, workspace.id);
    await callback('facebook', {
      state: cancelled.state,
      cookie: cancelled.cookie,
      extra: { error: 'access_denied', error_reason: 'user_denied', error_code: '200' },
    });
    expect(await attemptFor(cancelled.state)).toMatchObject({
      callbackResult: 'USER_CANCELLED',
      metaError: 'access_denied/user_denied',
    });

    const badCode = await startAuth(user.token, workspace.id);
    await callback('facebook', {
      state: badCode.state,
      code: 'not-a-real-code',
      cookie: badCode.cookie,
    });
    expect(await attemptFor(badCode.state)).toMatchObject({
      callbackResult: 'TOKEN_EXCHANGE_FAILED',
    });

    const replayed = await startAuth(user.token, workspace.id);
    for (let i = 0; i < 2; i += 1) {
      await callback('facebook', {
        state: replayed.state,
        code: fake.authorizeFacebook('100'),
        cookie: replayed.cookie,
      });
    }
    // The replay is counted but does not hide that the attempt itself succeeded.
    expect(await attemptFor(replayed.state)).toMatchObject({
      callbackResult: 'CONNECTED',
      callbackCount: 2,
    });

    const failures = oauthLogs().filter((l) => l.entry.oauth.failedAt);
    expect(failures.map((l) => l.entry.oauth.failedAt)).toEqual([
      'state_expired',
      'meta_authorization',
      'token_exchange',
      'state_replayed',
    ]);
  });

  it('logs a missing or unknown state without storing anything', async () => {
    await callback('facebook', { code: 'abc' });
    await callback('facebook', { state: 'x'.repeat(43), code: 'abc' });
    expect(oauthLogs().map((l) => l.entry.oauth)).toMatchObject([
      { statePresent: false, stateKnown: false, failedAt: 'state', result: 'STATE_MISSING' },
      { statePresent: true, stateKnown: false, failedAt: 'state', result: 'STATE_INVALID' },
    ]);
    expect(await OAuthState.countDocuments()).toBe(0);
  });

  it('logs what was sent to Meta and every outcome, never a state, cookie, code, token or secret', async () => {
    const { user, workspace } = await person('Olivia Owner', 'Acme Social');
    fake.addFacebookUser({ id: '100', pages: [{ id: '5001' }] });
    const started = await startAuth(user.token, workspace.id);
    const code = fake.authorizeFacebook('100');
    await callback('facebook', { state: started.state, code, cookie: started.cookie });

    const [start, done] = oauthLogs().map((l) => l.entry.oauth);
    expect(start).toMatchObject({
      attempt: oauthAttemptId(sha256(started.state)),
      stage: 'started',
      provider: 'FACEBOOK_LOGIN',
      purpose: 'CONNECT',
      workspace: 'acme-social',
      request: {
        dialog: 'https://www.facebook.com/v27.0/dialog/oauth',
        clientId: FB_APP_ID,
        redirectUri: FB_REDIRECT_URI,
        responseType: 'code',
        loginConfiguration: false,
        statePresent: true,
      },
    });
    expect(start.request.scopes).toEqual(
      expect.arrayContaining(['pages_show_list', 'pages_manage_posts']),
    );
    expect(done).toMatchObject({
      attempt: start.attempt,
      stage: 'callback',
      result: 'CONNECTED',
      browserBinding: 'matched',
    });
    expect(done.failedAt).toBeUndefined();

    // The OAuth diagnostics themselves.
    const diagnostics = JSON.stringify(oauthLogs().map((l) => l.entry));
    const binding = started.cookie.split('=')[1];
    for (const secret of [started.state, binding, code, 'test-meta-app-secret']) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(diagnostics).not.toMatch(/fb_short_|fb_long_|pagetoken_/);

    // The access log line for the callback is written through redactUrl (the request
    // serializer): the state and the authorization code never reach it.
    const callbackUrl = `/oauth/facebook/callback?state=${started.state}&code=${code}`;
    expect(redactUrl(callbackUrl)).toBe(
      '/oauth/facebook/callback?state=[redacted]&code=[redacted]',
    );
  });
});
