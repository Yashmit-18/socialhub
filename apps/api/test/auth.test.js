import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';
import { Session, User } from '../src/models/index.js';
import {
  DEFAULT_PASSWORD,
  api,
  as,
  refreshCookie,
  registerUser,
  uniqueEmail,
  withClientHeader,
} from './helpers.js';

const refresh = (cookie) =>
  withClientHeader(
    api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie ?? ''),
  );

describe('registration', () => {
  it('creates an account, returns an access token and sets an httpOnly refresh cookie', async () => {
    const email = uniqueEmail();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ada', email });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('refreshToken');

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('sh_rt='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores only a bcrypt hash of the password', async () => {
    const { email } = await registerUser();
    const stored = await User.findOne({ email }).select('+passwordHash').lean();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain(DEFAULT_PASSWORD);
  });

  it('normalises email case and rejects duplicates', async () => {
    const email = uniqueEmail();
    await registerUser({ email });
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Dup', email: email.toUpperCase(), password: DEFAULT_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.details.fields.email).toBeTruthy();
  });

  it('returns field-level validation errors', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });

  it('rejects unknown fields such as attempts to self-assign a status', async () => {
    const res = await api().post('/api/v1/auth/register').send({
      name: 'Mallory',
      email: uniqueEmail(),
      password: DEFAULT_PASSWORD,
      status: 'ACTIVE',
    });
    expect(res.status).toBe(422);
  });
});

describe('login', () => {
  it('signs in with valid credentials', async () => {
    const { email } = await registerUser();
    const res = await api().post('/api/v1/auth/login').send({ email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeTruthy();
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const { email } = await registerUser();
    const wrong = await api().post('/api/v1/auth/login').send({ email, password: 'Wrong-pass1' });
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: 'Wrong-pass1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('blocks disabled accounts', async () => {
    const { email } = await registerUser();
    await User.updateOne({ email }, { status: 'DISABLED' });
    const res = await api().post('/api/v1/auth/login').send({ email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects NoSQL operator payloads', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });

  it('rate-limits repeated attempts', async () => {
    const limited = createApp({ rateLimit: { authMax: 3 } });
    const attempt = () =>
      request(limited)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'nope' });
    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('access tokens', () => {
  it('returns the current user from /me', async () => {
    const { token, email } = await registerUser();
    const res = await as(token).get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await as('garbage').get('/api/v1/auth/me')).status).toBe(401);
    const forged = jwt.sign(
      { sid: '507f1f77bcf86cd799439011' },
      'another-secret-another-secret-123456',
      {
        subject: '507f1f77bcf86cd799439011',
        issuer: 'socialhub-api',
        audience: 'socialhub-web',
      },
    );
    expect((await as(forged).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('reports expired tokens with TOKEN_EXPIRED so the client can refresh', async () => {
    const { user } = await registerUser();
    const session = await Session.findOne({ user: user.id });
    const expired = jwt.sign({ sid: String(session._id) }, process.env.JWT_ACCESS_SECRET, {
      subject: user.id,
      issuer: 'socialhub-api',
      audience: 'socialhub-web',
      expiresIn: -10,
    });
    const res = await as(expired).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects an unexpired access token once its session is revoked', async () => {
    const { token, cookie } = await registerUser();
    await withClientHeader(api().post('/api/v1/auth/logout').set('Cookie', cookie));
    const res = await as(token).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('refresh token rotation', () => {
  it('requires the client header (CSRF guard)', async () => {
    const { cookie } = await registerUser();
    const res = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('rejects a missing cookie', async () => {
    const res = await refresh();
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token and issues a new access token', async () => {
    const { cookie } = await registerUser();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const rotated = refreshCookie(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(cookie);
    expect((await as(res.body.accessToken).get('/api/v1/auth/me')).status).toBe(200);
  });

  it('treats an immediate replay of the previous token as a benign multi-tab race', async () => {
    const { cookie } = await registerUser();
    const first = await refresh(cookie);
    const replay = await refresh(cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_RACE');
    // The session survives: the rotated cookie still works.
    expect((await refresh(refreshCookie(first))).status).toBe(200);
  });

  it('revokes the whole session when a rotated token is reused after the grace window', async () => {
    const { cookie, user } = await registerUser();
    const first = await refresh(cookie);
    const latest = refreshCookie(first);
    await Session.updateOne({ user: user.id }, { rotatedAt: new Date(Date.now() - 60_000) });

    const reuse = await refresh(cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');

    // The legitimate holder is signed out too; the attacker gains nothing.
    expect((await refresh(latest)).status).toBe(401);
    expect((await as(first.body.accessToken).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const { cookie, user } = await registerUser();
    await Session.updateOne({ user: user.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes the current session and clears the cookie', async () => {
    const { cookie } = await registerUser();
    const res = await withClientHeader(api().post('/api/v1/auth/logout').set('Cookie', cookie));
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].some((c) => c.startsWith('sh_rt=;'))).toBe(true);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('logout-all revokes every session for the user', async () => {
    const { email, token } = await registerUser();
    const second = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD });
    expect((await as(token).post('/api/v1/auth/logout-all')).status).toBe(204);
    expect((await as(second.body.accessToken).get('/api/v1/auth/me')).status).toBe(401);
    expect((await refresh(refreshCookie(second))).status).toBe(401);
  });
});

describe('password reset', () => {
  const lastResetToken = () => {
    const mail = outbox.findLast((m) => m.meta.kind === 'password_reset');
    return new URL(mail.meta.url).searchParams.get('token');
  };

  it('responds identically for unknown emails and sends nothing', async () => {
    const res = await api().post('/api/v1/auth/forgot-password').send({ email: uniqueEmail() });
    expect(res.status).toBe(202);
    expect(outbox).toHaveLength(0);
  });

  it('emails a single-use link that resets the password and signs out all sessions', async () => {
    const { email, token } = await registerUser();
    const forgot = await api().post('/api/v1/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(202);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(email);

    const resetToken = lastResetToken();
    const stored = await User.findOne({ email }).select('+passwordReset').lean();
    expect(stored.passwordReset.tokenHash).not.toBe(resetToken);

    const reset = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'Brand-new-pass9' });
    expect(reset.status).toBe(204);

    expect((await as(token).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/login').send({ email, password: DEFAULT_PASSWORD })).status,
    ).toBe(401);
    expect(
      (await api().post('/api/v1/auth/login').send({ email, password: 'Brand-new-pass9' })).status,
    ).toBe(200);

    const again = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'Another-pass9' });
    expect(again.status).toBe(400);
  });

  it('rejects expired reset links', async () => {
    const { email } = await registerUser();
    await api().post('/api/v1/auth/forgot-password').send({ email });
    await User.updateOne({ email }, { 'passwordReset.expiresAt': new Date(Date.now() - 1000) });
    const res = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: lastResetToken(), password: 'Brand-new-pass9' });
    expect(res.status).toBe(400);
  });

  it('applies the password policy to the new password', async () => {
    const { email } = await registerUser();
    await api().post('/api/v1/auth/forgot-password').send({ email });
    const res = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: lastResetToken(), password: 'weak' });
    expect(res.status).toBe(422);
  });
});

describe('profile and password change', () => {
  it('updates the display name', async () => {
    const { token } = await registerUser();
    const res = await as(token).patch('/api/v1/users/me').send({ name: '  Grace Hopper ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Grace Hopper');
  });

  it('requires the correct current password', async () => {
    const { token } = await registerUser();
    const res = await as(token)
      .post('/api/v1/users/me/password')
      .send({ currentPassword: 'Wrong-pass1', newPassword: 'Next-pass-123' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.currentPassword).toBeTruthy();
  });

  it('changes the password and signs out other sessions but keeps the current one', async () => {
    const { email, token } = await registerUser();
    const other = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD });

    const res = await as(token)
      .post('/api/v1/users/me/password')
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'Next-pass-123' });
    expect(res.status).toBe(204);
    expect((await as(token).get('/api/v1/auth/me')).status).toBe(200);
    expect((await as(other.body.accessToken).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/login').send({ email, password: 'Next-pass-123' })).status,
    ).toBe(200);
  });
});
