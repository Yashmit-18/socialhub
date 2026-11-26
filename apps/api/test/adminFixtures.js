import { expect } from 'vitest';
import request from 'supertest';
import { User } from '../src/models/index.js';
import { DEFAULT_PASSWORD, app, refreshCookie, uniqueEmail } from './helpers.js';

/**
 * Operator console test fixtures. Every request carries a recognisable browser string, so a
 * test can prove that no IP address or browser recorded with a session or an audit entry ever
 * comes back in an admin answer.
 */

export const AGENT = 'AdminPrivacyProbe/1.0 (test)';
export const adminUrl = (suffix = '') => `/api/v1/admin${suffix}`;

/** Requests as `token` (or anonymously) with the probe's browser string. */
export function client(token, target = app) {
  const bind = (method) => (url) => {
    const req = request(target)[method](url).set('User-Agent', AGENT);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  return {
    get: bind('get'),
    post: bind('post'),
    patch: bind('patch'),
    put: bind('put'),
    delete: bind('delete'),
  };
}

/** Registers through the real API, so the session records this browser string and an IP. */
export async function signUp({
  name = 'Test User',
  email = uniqueEmail(),
  password = DEFAULT_PASSWORD,
} = {}) {
  const res = await client().post('/api/v1/auth/register').send({ name, email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return { user: res.body.user, token: res.body.accessToken, cookie: refreshCookie(res), email };
}

/** A person with platform admin access, set the way the command line sets it. */
export async function platformAdmin({ name = 'Petra Platform', email } = {}) {
  const admin = await signUp({ name, email });
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'PLATFORM_ADMIN' } });
  return admin;
}

export const suspend = (adminToken, userId, body, target) =>
  client(adminToken, target)
    .post(adminUrl(`/users/${userId}/suspend`))
    .send({
      reason: 'Posted the same link to 40 Pages within one hour.',
      password: DEFAULT_PASSWORD,
      ...body,
    });

export const reactivate = (adminToken, userId, body, target) =>
  client(adminToken, target)
    .post(adminUrl(`/users/${userId}/reactivate`))
    .send({ password: DEFAULT_PASSWORD, ...body });

/** What must never appear in an operator answer, whatever the endpoint. */
const FORBIDDEN = [
  /passwordHash/i,
  /passwordReset"/,
  /tokenHash/i,
  /refreshToken/i,
  /accessToken/i,
  /ciphertext/i,
  /lockToken/,
  /providerState/,
  /"ip"/,
  /userAgent/i,
  /127\.0\.0\.1/,
  /::1\b/,
  /AdminPrivacyProbe/,
  /\$2[aby]\$/,
  new RegExp(DEFAULT_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  /page-token-SECRET/,
];

/** Fails when the JSON of `body` contains secret material, an IP, a browser or `extra`. */
export function expectNoSecrets(body, extra = []) {
  const text = JSON.stringify(body);
  for (const pattern of [...FORBIDDEN, ...extra]) expect(text).not.toMatch(pattern);
}
