import { vi } from 'vitest';

export function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const apiError = (status, code, message = code, details) =>
  jsonResponse(status, { error: { code, message, details } });

/**
 * Installs a fetch mock routed by "METHOD /path" (path relative to /api/v1, without query).
 * Handlers receive `{ url, init, headers }` and return a Response (or a promise of one).
 */
export function mockFetch(routes) {
  const calls = [];
  const fn = vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    calls.push({ key, url, init, headers: init.headers ?? {} });
    const handler = routes[key];
    if (!handler) return apiError(404, 'NOT_FOUND', `No mock for ${key}`);
    return handler({ url, init, headers: init.headers ?? {} });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, count: (key) => calls.filter((c) => c.key === key).length };
}
