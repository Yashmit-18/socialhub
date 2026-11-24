import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, jsonResponse, mockFetch } from '../test/fetchMock.js';
import {
  ApiError,
  api,
  login,
  onSessionExpired,
  refreshSession,
  resolveApiLink,
  setAccessToken,
} from './api.js';

const session = (token = 'access-2') =>
  jsonResponse(200, { user: { id: 'u1', name: 'Ada' }, accessToken: token });

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the access token as a bearer header, with credentials and the client header', async () => {
    const mock = mockFetch({ 'GET /workspaces': () => jsonResponse(200, { items: [] }) });
    setAccessToken('access-1');
    await api.get('/workspaces');
    const { init, headers } = mock.calls[0];
    expect(headers.Authorization).toBe('Bearer access-1');
    expect(headers['X-SocialHub-Client']).toBe('web');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once and retries when the access token has expired', async () => {
    let first = true;
    const mock = mockFetch({
      'POST /auth/refresh': () => session('access-2'),
      'GET /workspaces': ({ headers }) => {
        if (first) {
          first = false;
          return apiError(401, 'TOKEN_EXPIRED');
        }
        expect(headers.Authorization).toBe('Bearer access-2');
        return jsonResponse(200, { items: [1] });
      },
    });
    setAccessToken('access-1');
    await expect(api.get('/workspaces')).resolves.toEqual({ items: [1] });
    expect(mock.count('POST /auth/refresh')).toBe(1);
  });

  it('shares a single refresh across concurrent requests', async () => {
    const mock = mockFetch({
      'POST /auth/refresh': () => new Promise((r) => setTimeout(() => r(session()), 20)),
      'GET /a': () => jsonResponse(200, { ok: 'a' }),
      'GET /b': () => jsonResponse(200, { ok: 'b' }),
      'GET /c': () => jsonResponse(200, { ok: 'c' }),
    });
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results.map((r) => r.ok)).toEqual(['a', 'b', 'c']);
    expect(mock.count('POST /auth/refresh')).toBe(1);
  });

  it('retries a refresh that lost a multi-tab race', async () => {
    let attempts = 0;
    mockFetch({
      'POST /auth/refresh': () =>
        ++attempts === 1 ? apiError(401, 'REFRESH_RACE') : session('after-race'),
    });
    const data = await refreshSession();
    expect(data.accessToken).toBe('after-race');
    expect(attempts).toBe(2);
  });

  it('signals session expiry when the refresh cookie is no longer valid', async () => {
    mockFetch({ 'POST /auth/refresh': () => apiError(401, 'SESSION_REVOKED') });
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    await expect(api.get('/workspaces')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('does not attempt a refresh for wrong-password and permission errors', async () => {
    const mock = mockFetch({
      'POST /auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
      'GET /secret': () => apiError(403, 'FORBIDDEN'),
    });
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    setAccessToken('t');
    await expect(api.get('/secret')).rejects.toMatchObject({ status: 403 });
    expect(mock.count('POST /auth/refresh')).toBe(0);
  });

  it('never stores tokens in web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    mockFetch({
      'POST /auth/login': () => session('secret-access-token'),
      'GET /me': () => jsonResponse(200, {}),
    });
    await login({ email: 'a@b.co', password: 'pw' });
    await api.get('/me');
    const written = setItem.mock.calls.map((c) => c.join('=')).join('\n');
    expect(written).not.toContain('secret-access-token');
    expect(document.cookie).not.toContain('secret-access-token');
  });

  it('exposes server field errors on ApiError', async () => {
    mockFetch({
      'POST /workspaces': () =>
        apiError(409, 'CONFLICT', 'Taken', { fields: { slug: 'This URL is already taken' } }),
    });
    setAccessToken('t');
    const err = await api.post('/workspaces', { name: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fields).toEqual({ slug: 'This URL is already taken' });
  });

  it('maps network failures to a friendly error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    setAccessToken('t');
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});

describe('resolveApiLink (storage links sent as paths)', () => {
  const PATH = '/api/v1/storage/objects/w1/a.jpg?expires=1&signature=s';

  it('leaves a path alone when the app talks to its own origin', () => {
    expect(resolveApiLink(PATH, '/api/v1')).toBe(PATH);
  });

  it('resolves a path against the API origin when the API is elsewhere', () => {
    expect(resolveApiLink(PATH, 'https://api.example.com/api/v1')).toBe(
      `https://api.example.com${PATH}`,
    );
  });

  it('leaves absolute links, protocol-relative links and non-strings unchanged', () => {
    const s3 = 'https://cdn.example.com/w1/a.jpg';
    expect(resolveApiLink(s3, 'https://api.example.com/api/v1')).toBe(s3);
    expect(resolveApiLink('//evil.example/x', 'https://api.example.com/api/v1')).toBe(
      '//evil.example/x',
    );
    expect(resolveApiLink(null, 'https://api.example.com/api/v1')).toBeNull();
    expect(resolveApiLink(undefined)).toBeUndefined();
  });
});
