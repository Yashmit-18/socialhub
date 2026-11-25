import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { facebookAuthorizationUrl } from '../src/integrations/meta/facebook.js';
import {
  META_ERROR_KINDS,
  MetaApiError,
  appSecretProof,
  classifyMetaError,
  metaRequest,
  parseMetaError,
  scopesFrom,
  setMetaTransportForTests,
  unwrapSingle,
} from '../src/integrations/meta/http.js';
import { normalizeInstagramCode } from '../src/integrations/meta/instagram.js';
import { SignedRequestError, parseSignedRequest } from '../src/integrations/meta/signedRequest.js';
import { redactUrl } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { metaConfigChecks, metaIntegrationStatus } from '../src/modules/meta/metaOAuth.service.js';
import {
  assessPublishing,
  effectiveStatus,
  scopeReport,
} from '../src/modules/meta/connectionHealth.js';
import { signedRequest } from './metaHelpers.js';

afterEach(() => setMetaTransportForTests(null));

describe('Meta error classification', () => {
  it.each([
    [{ code: 190, subcode: 463 }, META_ERROR_KINDS.TOKEN_EXPIRED],
    [{ code: 190, subcode: 467 }, META_ERROR_KINDS.TOKEN_REVOKED],
    [{ code: 190, subcode: 458 }, META_ERROR_KINDS.TOKEN_REVOKED],
    [{ code: 190, subcode: 460 }, META_ERROR_KINDS.TOKEN_REVOKED],
    [{ code: 190 }, META_ERROR_KINDS.TOKEN_EXPIRED],
    [{ code: 102 }, META_ERROR_KINDS.TOKEN_EXPIRED],
    [{ code: 10 }, META_ERROR_KINDS.PERMISSION_DENIED],
    [{ code: 200 }, META_ERROR_KINDS.PERMISSION_DENIED],
    [{ code: 4 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 32 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 80001 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 80014 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 368 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 341 }, META_ERROR_KINDS.RATE_LIMITED],
    [{ code: 80007, httpStatus: 400 }, META_ERROR_KINDS.INVALID_REQUEST],
    [{ code: 2 }, META_ERROR_KINDS.TRANSIENT],
    [{ httpStatus: 503 }, META_ERROR_KINDS.TRANSIENT],
    [{ code: 100, httpStatus: 400 }, META_ERROR_KINDS.INVALID_REQUEST],
  ])('%j -> %s', (input, kind) => {
    expect(classifyMetaError(input)).toBe(kind);
  });

  it('parses Graph and Instagram token-endpoint error shapes', () => {
    const graph = parseMetaError(400, {
      error: {
        message: 'Session expired',
        type: 'OAuthException',
        code: 190,
        error_subcode: 463,
        fbtrace_id: 'T1',
      },
    });
    expect(graph).toMatchObject({
      kind: 'TOKEN_EXPIRED',
      code: 190,
      subcode: 463,
      fbtraceId: 'T1',
    });
    expect(graph.isTokenError).toBe(true);
    const ig = parseMetaError(400, {
      error_type: 'OAuthException',
      code: 400,
      error_message: 'Invalid authorization code',
    });
    expect(ig).toMatchObject({ kind: 'INVALID_REQUEST', message: 'Invalid authorization code' });
  });
});

describe('metaRequest', () => {
  it('adds access_token and a correct appsecret_proof', async () => {
    let seen;
    setMetaTransportForTests(async (url) => {
      seen = new URL(url);
      return new Response('{"ok":true}', { status: 200 });
    });
    await metaRequest('https://graph.facebook.com/v27.0/me', {
      accessToken: 'tok',
      appSecret: 'sec',
    });
    expect(seen.searchParams.get('access_token')).toBe('tok');
    expect(seen.searchParams.get('appsecret_proof')).toBe(
      createHmac('sha256', 'sec').update('tok').digest('hex'),
    );
    expect(appSecretProof('tok', 'sec')).toBe(seen.searchParams.get('appsecret_proof'));
  });

  it('turns network failures into transient errors', async () => {
    setMetaTransportForTests(async () => {
      throw new TypeError('fetch failed');
    });
    const err = await metaRequest('https://graph.facebook.com/v27.0/me').catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.kind).toBe('TRANSIENT');
  });

  it('treats HTML/garbage 5xx responses as transient', async () => {
    setMetaTransportForTests(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await metaRequest('https://graph.facebook.com/v27.0/me').catch((e) => e);
    expect(err.kind).toBe('TRANSIENT');
  });

  it('never logs token material in error diagnostics', () => {
    const err = parseMetaError(400, { error: { message: 'Bad', code: 190 } });
    expect(JSON.stringify(err.toLog())).not.toMatch(/access_token/);
  });
});

describe('response helpers', () => {
  it('unwraps data-wrapped and flat bodies', () => {
    expect(unwrapSingle({ data: [{ a: 1 }] })).toEqual({ a: 1 });
    expect(unwrapSingle({ a: 1 })).toEqual({ a: 1 });
  });

  it('parses permission lists given as strings or arrays', () => {
    expect(scopesFrom('a,b c')).toEqual(['a', 'b', 'c']);
    expect(scopesFrom(['a'])).toEqual(['a']);
    expect(scopesFrom(undefined)).toEqual([]);
  });

  it('strips the "#_" Instagram appends to codes', () => {
    expect(normalizeInstagramCode('AQBx123#_')).toBe('AQBx123');
    expect(normalizeInstagramCode('AQBx123')).toBe('AQBx123');
  });

  it('builds the Facebook dialog URL with scopes and optional rerequest', () => {
    const url = new URL(facebookAuthorizationUrl({ state: 's'.repeat(43), rerequest: true }));
    expect(url.searchParams.get('auth_type')).toBe('rerequest');
    expect(url.searchParams.get('config_id')).toBeNull();
    expect(url.searchParams.get('scope')).toContain('pages_show_list');
  });
});

describe('signed_request verification', () => {
  const secret = 'app-secret-for-signing-0123456789';

  it('accepts a correctly signed payload', () => {
    expect(parseSignedRequest(signedRequest({ user_id: '42' }, secret), secret)).toMatchObject({
      user_id: '42',
    });
  });

  it('rejects tampering, wrong secrets and malformed input', () => {
    const valid = signedRequest({ user_id: '42' }, secret);
    const [sig] = valid.split('.');
    const tampered = `${sig}.${Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '43' })).toString('base64url')}`;
    expect(() => parseSignedRequest(tampered, secret)).toThrow(SignedRequestError);
    expect(() => parseSignedRequest(valid, 'another-secret-another-secret-00')).toThrow(
      SignedRequestError,
    );
    expect(() => parseSignedRequest('garbage', secret)).toThrow(SignedRequestError);
    expect(() =>
      parseSignedRequest(signedRequest({ user_id: '42', algorithm: 'NONE' }, secret), secret),
    ).toThrow(SignedRequestError);
  });
});

describe('health rules', () => {
  const base = { status: 'ACTIVE', provider: 'FACEBOOK_LOGIN', grantedScopes: ['pages_show_list'] };

  it('derives the effective status from stored state and expiry dates', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(effectiveStatus({ ...base }, now).status).toBe('ACTIVE');
    expect(effectiveStatus({ ...base, tokenExpiresAt: new Date('2026-05-01') }, now).status).toBe(
      'EXPIRED',
    );
    expect(effectiveStatus({ ...base, status: 'REVOKED', statusReason: 'x' }, now)).toEqual({
      status: 'REVOKED',
      reason: 'x',
    });
  });

  it('reports missing permissions by purpose', () => {
    expect(scopeReport(base)).toMatchObject({ required: [], recommended: [] });
    expect(scopeReport({ ...base, grantedScopes: [] }).required).toEqual(['pages_show_list']);
    expect(
      scopeReport({ provider: 'INSTAGRAM_LOGIN', grantedScopes: ['instagram_business_basic'] })
        .publishing,
    ).toEqual(['instagram_business_content_publish']);
  });

  it('requires both permissions and a content-creating Page role for publishing readiness', () => {
    const scopes = ['pages_manage_posts', 'pages_read_engagement'];
    expect(
      assessPublishing({
        provider: 'FACEBOOK_LOGIN',
        platform: 'FACEBOOK_PAGE',
        tasks: ['CREATE_CONTENT'],
        grantedScopes: scopes,
      }).status,
    ).toBe('READY');
    expect(
      assessPublishing({
        provider: 'FACEBOOK_LOGIN',
        platform: 'FACEBOOK_PAGE',
        tasks: ['ANALYZE'],
        grantedScopes: scopes,
      }).status,
    ).toBe('RESTRICTED');
    expect(
      assessPublishing({
        provider: 'FACEBOOK_LOGIN',
        platform: 'INSTAGRAM_ACCOUNT',
        tasks: ['MANAGE'],
        grantedScopes: scopes,
      }).reason,
    ).toMatch(/instagram_content_publish/);
  });

  it('does not treat MANAGE alone as permission to create content', () => {
    const result = assessPublishing({
      provider: 'FACEBOOK_LOGIN',
      platform: 'FACEBOOK_PAGE',
      tasks: ['MANAGE', 'MODERATE'],
      grantedScopes: ['pages_manage_posts', 'pages_read_engagement'],
    });
    expect(result.status).toBe('RESTRICTED');
    expect(result.reason).toMatch(/CREATE_CONTENT/);
  });
});

describe('Meta configuration checks', () => {
  const env = {
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    META_APP_ID: '123',
    META_APP_SECRET: 's'.repeat(32),
  };
  const ids = (cfg) => metaConfigChecks(cfg).map((c) => `${c.level}:${c.id}`);

  it('reports nothing to fix for a same-host HTTPS setup using Facebook Login for Business', () => {
    const cfg = loadConfig({
      ...env,
      APP_URL: 'https://app.example.com',
      CLIENT_ORIGIN: 'https://app.example.com',
      META_FACEBOOK_LOGIN_CONFIG_ID: '999',
    });
    expect(ids(cfg)).toEqual(['info:INSTAGRAM_NOT_CONFIGURED']);
    expect(metaIntegrationStatus(cfg).facebook).toMatchObject({
      configured: true,
      ready: true,
      usesLoginConfiguration: true,
      scopes: null,
    });
  });

  it('flags a callback host the binding cookie cannot reach as a blocking error', () => {
    const cfg = loadConfig({
      ...env,
      APP_URL: 'http://localhost:5173',
      API_PUBLIC_URL: 'https://abc.trycloudflare.com',
    });
    expect(ids(cfg)).toContain('error:CALLBACK_HOST_MISMATCH');
    expect(metaIntegrationStatus(cfg).facebook.ready).toBe(false);

    const split = loadConfig({
      ...env,
      APP_URL: 'https://app.example.com',
      API_PUBLIC_URL: 'https://api.example.com',
      COOKIE_SAMESITE: 'none',
      COOKIE_SECURE: 'true',
    });
    expect(ids(split)).toContain('warning:CALLBACK_HOST_SPLIT');
    expect(metaIntegrationStatus(split).facebook.ready).toBe(true);
  });

  it('requires HTTPS in production and the required scopes', () => {
    const production = {
      ...env,
      NODE_ENV: 'production',
      META_FACEBOOK_SCOPES: 'pages_manage_posts',
      INSTAGRAM_APP_ID: '456',
      INSTAGRAM_APP_SECRET: 'i'.repeat(32),
      INSTAGRAM_SCOPES: 'instagram_business_content_publish',
    };
    // A public http:// address is refused outright in production (config/env.js).
    expect(() =>
      loadConfig({
        ...production,
        APP_URL: 'http://app.example.com',
        CLIENT_ORIGIN: 'http://app.example.com',
      }),
    ).toThrow(/must use https:\/\/ in production/);

    const cfg = loadConfig({
      ...production,
      APP_URL: 'https://app.example.com',
      CLIENT_ORIGIN: 'https://app.example.com',
    });
    expect(ids(cfg)).toEqual(
      expect.arrayContaining([
        'error:FACEBOOK_REQUIRED_SCOPE_MISSING',
        'error:INSTAGRAM_REQUIRED_SCOPE_MISSING',
        'info:LOGIN_CONFIG_RECOMMENDED',
      ]),
    );
    expect(ids(cfg)).not.toContain('error:PUBLIC_URL_NOT_HTTPS');
    const status = metaIntegrationStatus(cfg);
    expect(status.facebook.ready).toBe(false);
    expect(status.instagram.ready).toBe(false);
  });

  it('only notes disabled logins when nothing is configured', () => {
    const cfg = loadConfig({ ...env, META_APP_ID: undefined, META_APP_SECRET: undefined });
    expect(ids(cfg)).toEqual(['info:FACEBOOK_NOT_CONFIGURED', 'info:INSTAGRAM_NOT_CONFIGURED']);
  });
});

describe('log redaction', () => {
  it('redacts OAuth codes and states from callback URLs', () => {
    expect(redactUrl('/api/v1/oauth/facebook/callback?code=SECRETCODE&state=SECRETSTATE')).toBe(
      '/api/v1/oauth/facebook/callback?code=[redacted]&state=[redacted]',
    );
    expect(redactUrl('/api/v1/workspaces?limit=5')).toBe('/api/v1/workspaces?limit=5');
  });
});

describe('Meta usage headers', () => {
  it('reads how long Meta asks callers to wait, and keeps errors without a hint as they were', async () => {
    const { parseMetaError, retryAfterFromUsageHeaders } =
      await import('../src/integrations/meta/http.js');
    const headers = (entries) => new Headers(entries);
    expect(
      retryAfterFromUsageHeaders(
        headers({
          'x-business-use-case-usage': JSON.stringify({
            123: [{ type: 'pages', call_count: 98, estimated_time_to_regain_access: 12 }],
            456: [{ type: 'pages', estimated_time_to_regain_access: 3 }],
          }),
        }),
      ),
    ).toBe(12 * 60_000);
    expect(retryAfterFromUsageHeaders(headers({ 'x-app-usage': '{"call_count":100}' }))).toBe(
      undefined,
    );
    expect(retryAfterFromUsageHeaders(headers({ 'x-business-use-case-usage': 'not json' }))).toBe(
      undefined,
    );
    expect(retryAfterFromUsageHeaders(undefined)).toBe(undefined);
    // Capped at a day.
    expect(
      retryAfterFromUsageHeaders(
        headers({
          'x-business-use-case-usage': '{"1":[{"estimated_time_to_regain_access":99999}]}',
        }),
      ),
    ).toBe(24 * 60 * 60_000);

    const err = parseMetaError(
      400,
      { error: { code: 80001, message: 'Too many calls', is_transient: false } },
      headers({ 'x-business-use-case-usage': '{"1":[{"estimated_time_to_regain_access":7}]}' }),
    );
    expect(err).toMatchObject({
      kind: 'RATE_LIMITED',
      retryAfterMs: 7 * 60_000,
      isTransient: false,
    });
    expect(parseMetaError(500, { error: { code: 1, is_transient: true } }).isTransient).toBe(true);
  });
});
