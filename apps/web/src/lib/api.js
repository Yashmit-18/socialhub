import { CLIENT_HEADER } from '@socialhub/shared';

/**
 * HTTP client for the SocialHub API.
 *
 * Security model: the short-lived access token lives only in this module's memory (never
 * in localStorage/sessionStorage). The long-lived refresh token is an httpOnly cookie the
 * browser attaches to /api/v1/auth/* — JavaScript can never read it. On a 401 the client
 * refreshes once (single-flight across concurrent requests) and retries.
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');
const RETRYABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'SESSION_REVOKED', 'UNAUTHENTICATED']);

let accessToken = null;
let refreshInFlight = null;
const sessionExpiredListeners = new Set();

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** `{ field: message }` map for form display, when the server returned one. */
  get fields() {
    return this.details?.fields ?? {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setAccessToken(token) {
  accessToken = token ?? null;
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

export function onSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function emitSessionExpired() {
  accessToken = null;
  for (const listener of sessionExpiredListeners) listener();
}

/**
 * Makes a link the API sent as a path ("/api/v1/storage/…", from local storage) usable
 * wherever this app runs. In the normal single-origin setup (the API serves the app, or the
 * dev server proxies /api) it is returned unchanged. When the app talks to an API on another
 * origin (VITE_API_URL), it is resolved against that origin, not the page's. Absolute links
 * (S3, https://…) and anything else are returned as they are.
 */
export function resolveApiLink(url, base = BASE_URL) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return url;
  if (!/^https?:\/\//i.test(base)) return url;
  return new URL(url, base).href;
}

function buildUrl(path, query) {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function send(path, { method = 'GET', body, query, token, signal } = {}) {
  const headers = { Accept: 'application/json', [CLIENT_HEADER]: 'web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach SocialHub. Check your connection and try again.',
    );
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error ?? {};
    throw new ApiError(
      res.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? `Request failed (${res.status})`,
      error.details,
      error.requestId,
    );
  }
  return data;
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshInFlight ??= (async () => {
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const data = await send('/auth/refresh', { method: 'POST' });
          accessToken = data.accessToken;
          return data;
        } catch (err) {
          // Another tab rotated the cookie a moment ago; the browser now holds the new one.
          if (err.code === 'REFRESH_RACE' && attempt < 3) {
            await sleep(200 * (attempt + 1));
            continue;
          }
          accessToken = null;
          throw err;
        }
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Authenticated request with transparent token refresh. Use `auth: false` for public endpoints. */
export async function request(path, { auth = true, ...options } = {}) {
  if (!auth) return send(path, options);

  if (!accessToken) {
    try {
      await refreshSession();
    } catch (err) {
      if (err.status === 401) emitSessionExpired();
      throw err;
    }
  }

  try {
    return await send(path, { ...options, token: accessToken });
  } catch (err) {
    if (err.status !== 401 || !RETRYABLE_AUTH_CODES.has(err.code)) throw err;
    try {
      await refreshSession();
    } catch (refreshErr) {
      if (refreshErr.status === 401) emitSessionExpired();
      throw refreshErr;
    }
    return send(path, { ...options, token: accessToken });
  }
}

/** File name from a Content-Disposition header (`attachment; filename="x.csv"`), if any. */
export function fileNameFrom(disposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Authenticated file download (for example the CSV export). Resolves to `{ blob, fileName }`;
 * errors are ApiErrors exactly like JSON requests (the API answers errors as JSON).
 */
async function sendDownload(path, { query, token, signal } = {}) {
  const headers = { Accept: 'text/csv, application/json', [CLIENT_HEADER]: 'web' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(buildUrl(path, query), { headers, credentials: 'include', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach SocialHub. Check your connection and try again.',
    );
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const error = data?.error ?? {};
    throw new ApiError(
      res.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? `Request failed (${res.status})`,
      error.details,
      error.requestId,
    );
  }
  return {
    blob: await res.blob(),
    fileName: fileNameFrom(res.headers.get('Content-Disposition')),
  };
}

/** sendDownload with the same transparent token refresh as request(). */
export async function download(path, options = {}) {
  if (!accessToken) {
    try {
      await refreshSession();
    } catch (err) {
      if (err.status === 401) emitSessionExpired();
      throw err;
    }
  }
  try {
    return await sendDownload(path, { ...options, token: accessToken });
  } catch (err) {
    if (err.status !== 401 || !RETRYABLE_AUTH_CODES.has(err.code)) throw err;
    try {
      await refreshSession();
    } catch (refreshErr) {
      if (refreshErr.status === 401) emitSessionExpired();
      throw refreshErr;
    }
    return sendDownload(path, { ...options, token: accessToken });
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
};

/* ----------------------------------------------------------- auth calls */

export async function login(credentials) {
  const data = await send('/auth/login', { method: 'POST', body: credentials });
  accessToken = data.accessToken;
  return data.user;
}

export async function register(details) {
  const data = await send('/auth/register', { method: 'POST', body: details });
  accessToken = data.accessToken;
  return data.user;
}

export async function logout() {
  try {
    await send('/auth/logout', { method: 'POST' });
  } finally {
    accessToken = null;
  }
}
