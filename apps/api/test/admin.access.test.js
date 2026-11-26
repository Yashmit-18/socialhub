import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setHealthDetailsTokenForTests, redactUrl } from '../src/app.js';
import { config } from '../src/config/env.js';
import { Session, User } from '../src/models/index.js';
import { setAnalyticsQueueForTests } from '../src/queue/analyticsQueue.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { adminUrl, client, platformAdmin, signUp } from './adminFixtures.js';
import { api, seedTeam } from './helpers.js';
import { createTestQueue } from './publishFixtures.js';

/**
 * Who can reach the operator console (/api/v1/admin). Anonymous callers get 401 as on every
 * protected router (the web client needs it to refresh); everyone signed in who is not a
 * platform admin gets exactly the answer of an unknown route, whatever they send.
 */

const ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  // Never a real Redis: the queues are test stand-ins, or absent.
  setPublishQueueForTests(createTestQueue());
  setAnalyticsQueueForTests(null);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setAnalyticsQueueForTests(undefined);
  setHealthDetailsTokenForTests(undefined);
});

/** Every route of the console, a made-up one, and calls with bad input or the wrong method. */
const PROBES = [
  ['get', '/overview'],
  ['get', '/users'],
  ['get', '/users?status=DISABLED&q=someone%40example.com'],
  ['get', '/users?foo=bar'],
  ['get', `/users/${ID}`],
  ['get', '/users/not-an-id'],
  ['post', `/users/${ID}/suspend`, { reason: 'A reason that is long enough', password: 'x' }],
  ['post', `/users/${ID}/suspend`, { nonsense: true }],
  ['post', `/users/${ID}/reactivate`, { password: 'x' }],
  ['get', '/workspaces'],
  ['get', `/workspaces/${ID}`],
  ['get', '/system'],
  ['get', '/audit-log'],
  ['get', '/audit-log?action=nope'],
  ['get', '/does-not-exist'],
  ['delete', `/users/${ID}`],
  ['patch', '/users', { platformRole: 'PLATFORM_ADMIN' }],
  ['put', `/users/${ID}/platform-role`, { platformRole: 'PLATFORM_ADMIN' }],
];

async function call(token, [method, path, body]) {
  const req = client(token)[method](adminUrl(path));
  return body ? req.send(body) : req;
}

function expectUnknownRoute(res, method, path) {
  expect(res.status).toBe(404);
  expect(Object.keys(res.body)).toEqual(['error']);
  expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message', 'requestId']);
  expect(res.body.error.code).toBe('NOT_FOUND');
  expect(res.body.error.message).toBe(
    `Route not found: ${method.toUpperCase()} /v1/admin${path.split('?')[0]}`,
  );
  expect(res.headers['cache-control']).toBeUndefined();
}

describe('who can reach the operator console', () => {
  it('answers 401 to anonymous callers and bad tokens, before looking at the input', async () => {
    for (const probe of PROBES) {
      const res = await call(null, probe);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    const bad = await client('not-a-token').get(adminUrl('/overview'));
    expect(bad.status).toBe(401);
  });

  it('keeps TOKEN_EXPIRED and SESSION_REVOKED, which the web client needs to refresh', async () => {
    const admin = await platformAdmin();
    const session = await Session.findOne({ user: admin.user.id });
    const expired = jwt.sign(
      { sid: String(session._id), exp: Math.floor(Date.now() / 1000) - 60 },
      config.auth.accessSecret,
      { subject: admin.user.id, issuer: 'socialhub-api', audience: 'socialhub-web' },
    );
    const res = await client(expired).get(adminUrl('/overview'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');

    await client(admin.token).post('/api/v1/auth/logout-all');
    const ended = await client(admin.token).get(adminUrl('/overview'));
    expect(ended.status).toBe(401);
    expect(ended.body.error.code).toBe('SESSION_REVOKED');
  });

  it('looks exactly like an unknown route to a workspace owner and to anyone else signed in', async () => {
    const { owner, admin } = await seedTeam();
    const stranger = await signUp({ name: 'No Workspace' });
    for (const person of [owner, admin, stranger]) {
      for (const probe of PROBES) {
        expectUnknownRoute(await call(person.token, probe), probe[0], probe[1]);
      }
    }
    // The same shape as a route that really does not exist.
    const unknown = await client(owner.token).get('/api/v1/no-such-route');
    expect(unknown.status).toBe(404);
    expect(Object.keys(unknown.body.error).sort()).toEqual(['code', 'message', 'requestId']);
    expect(unknown.headers['cache-control']).toBeUndefined();
  });

  it('serves a platform admin, never cached; an unknown path still falls through to 404', async () => {
    const admin = await platformAdmin();
    const res = await client(admin.token).get(adminUrl('/overview'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    for (const [method, path] of [
      ['get', '/does-not-exist'],
      ['delete', `/users/${ID}`],
    ]) {
      const missing = await client(admin.token)[method](adminUrl(path));
      expect(missing.status).toBe(404);
      expect(missing.body.error.message).toBe(
        `Route not found: ${method.toUpperCase()} /v1/admin${path}`,
      );
      expect(missing.headers['cache-control']).toBe('no-store');
    }
    // Errors a platform admin receives are not cached either.
    const invalid = await client(admin.token).get(adminUrl('/users?foo=bar'));
    expect(invalid.status).toBe(422);
    expect(invalid.headers['cache-control']).toBe('no-store');
  });

  it('applies a grant or a revoke on the very next request (no role in the token)', async () => {
    const person = await signUp();
    expect((await client(person.token).get(adminUrl('/overview'))).status).toBe(404);
    await User.updateOne({ _id: person.user.id }, { $set: { platformRole: 'PLATFORM_ADMIN' } });
    expect((await client(person.token).get(adminUrl('/overview'))).status).toBe(200);
    await User.updateOne({ _id: person.user.id }, { $unset: { platformRole: 1 } });
    expect((await client(person.token).get(adminUrl('/overview'))).status).toBe(404);
  });

  it("shows platformRole in the person's own user JSON, also after a profile save", async () => {
    const admin = await platformAdmin();
    const me = await client(admin.token).get('/api/v1/auth/me');
    expect(me.body.user.platformRole).toBe('PLATFORM_ADMIN');
    const saved = await client(admin.token).patch('/api/v1/users/me').send({ name: 'Petra P.' });
    expect(saved.body.user.platformRole).toBe('PLATFORM_ADMIN');
    for (const body of [me.body, saved.body]) {
      expect(body.user).not.toHaveProperty('status');
      expect(body.user).not.toHaveProperty('suspension');
      expect(body.user).not.toHaveProperty('passwordHash');
    }
    const normal = await signUp();
    expect(normal.user).not.toHaveProperty('platformRole');
  });

  it('lets no request set platformRole', async () => {
    const register = await api().post('/api/v1/auth/register').send({
      name: 'Sneaky',
      email: 'sneaky@example.com',
      password: 'Sup3rSecret!',
      platformRole: 'PLATFORM_ADMIN',
    });
    expect(register.status).toBe(422);
    const person = await signUp();
    const patch = await client(person.token)
      .patch('/api/v1/users/me')
      .send({ name: 'Sneaky', platformRole: 'PLATFORM_ADMIN' });
    expect(patch.status).toBe(422);
    expect((await User.findById(person.user.id)).platformRole).toBeUndefined();
  });
});

describe('health endpoints keep their behaviour', () => {
  const TOKEN = 'monitoring-token-'.padEnd(48, 'x');

  it('answers /health/details with the same keys in the same order', async () => {
    setHealthDetailsTokenForTests(TOKEN);
    const res = await api().get('/api/v1/health/details').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body)).toEqual([
      'status',
      'version',
      'uptimeSeconds',
      'database',
      'publishing',
      'analytics',
      'storage',
    ]);
    expect(Object.keys(res.body.publishing)).toEqual(['mode', 'queue', 'counts', 'workers']);
    expect(Object.keys(res.body.analytics)).toEqual(['mode', 'queue']);
    expect(Object.keys(res.body.storage)).toEqual(['driver', 'publicUrls']);
    expect(res.body).toMatchObject({ status: 'ok', version: '0.1.0', database: 'connected' });
  });

  it("is not unlocked by a platform admin's session", async () => {
    setHealthDetailsTokenForTests(TOKEN);
    const admin = await platformAdmin();
    expect((await client(admin.token).get('/api/v1/health/details')).status).toBe(404);
    expect((await api().get('/api/v1/health')).body).toEqual({
      status: 'ok',
      database: 'connected',
    });
  });
});

describe('access log redaction of admin searches', () => {
  it('removes every search term of the console and leaves other parameters alone', () => {
    expect(redactUrl('/api/v1/admin/users?status=DISABLED&q=mallory%40example.com&page=2')).toBe(
      '/api/v1/admin/users?status=DISABLED&q=[redacted]&page=2',
    );
    expect(redactUrl('/api/v1/admin/workspaces?q=acme')).toBe(
      '/api/v1/admin/workspaces?q=[redacted]',
    );
    expect(redactUrl('/api/v1/admin/users?q=a%40b.co&q=c%40d.co')).toBe(
      '/api/v1/admin/users?q=[redacted]&q=[redacted]',
    );
    expect(redactUrl('/api/v1/admin/users?sq=1&qq=2')).toBe('/api/v1/admin/users?sq=1&qq=2');
    // The console's own pages keep the search in their address; when this server also serves
    // the website, a reload of /admin/users?q=... is logged too.
    expect(redactUrl('/admin/users?q=alice%40example.com&page=2')).toBe(
      '/admin/users?q=[redacted]&page=2',
    );
    expect(redactUrl('/admin?q=x')).toBe('/admin?q=[redacted]');
    expect(redactUrl('/administration?q=x')).toBe('/administration?q=x');
    expect(redactUrl(`/api/v1/admin/users/${ID}`)).toBe(`/api/v1/admin/users/${ID}`);
    // Other routes keep their search terms.
    expect(redactUrl(`/api/v1/workspaces/${ID}/groups?q=acme`)).toBe(
      `/api/v1/workspaces/${ID}/groups?q=acme`,
    );
  });
});
