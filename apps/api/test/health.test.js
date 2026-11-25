import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, redactUrl } from '../src/app.js';
import { api } from './helpers.js';

describe('serving the built web app', () => {
  it('serves pages, assets and client routes, but never source maps', async () => {
    const dist = mkdtempSync(path.join(os.tmpdir(), 'socialhub-dist-'));
    try {
      mkdirSync(path.join(dist, 'assets'));
      writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SocialHub</title>');
      writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
      writeFileSync(path.join(dist, 'assets', 'index-abc.js.map'), '{"sources":["secret.jsx"]}');
      const web = request(createApp({ serveWebDist: dist }));

      expect((await web.get('/assets/index-abc.js')).status).toBe(200);
      const page = await web.get('/w/acme/compose');
      expect(page.status).toBe(200);
      expect(page.text).toContain('<title>SocialHub</title>');
      const map = await web.get('/assets/index-abc.js.map');
      expect(map.status).toBe(404);
      expect(map.text).not.toContain('secret.jsx');
      // API routes still answer as the API, not with the web page.
      expect((await web.get('/api/v1/nope')).status).toBe(404);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('access log redaction', () => {
  it('redacts invitation link tokens but keeps resource ids', () => {
    const token = 'Zk3J9q-vT_2xYb8LmN0pQrStUvWxYz0123456789abc';
    expect(redactUrl(`/api/v1/invitations/${token}`)).toBe('/api/v1/invitations/[redacted]');
    expect(redactUrl(`/api/v1/invitations/${token}/accept`)).toBe(
      '/api/v1/invitations/[redacted]/accept',
    );
    const id = '507f1f77bcf86cd799439011';
    expect(redactUrl(`/api/v1/workspaces/${id}/invitations/${id}/resend`)).toBe(
      `/api/v1/workspaces/${id}/invitations/${id}/resend`,
    );
    expect(redactUrl(`/api/v1/workspaces/${id}/invitations?x=1`)).toBe(
      `/api/v1/workspaces/${id}/invitations?x=1`,
    );
  });

  it('redacts the token in the web invitation link, which this server also serves', () => {
    const token = 'Zk3J9q-vT_2xYb8LmN0pQrStUvWxYz0123456789abc';
    expect(redactUrl(`/invite/${token}`)).toBe('/invite/[redacted]');
    expect(redactUrl(`/invite/${encodeURIComponent(token)}?from=email`)).toBe(
      '/invite/[redacted]?from=email',
    );
    // Other pages are left alone.
    expect(redactUrl('/invitations-help')).toBe('/invitations-help');
    expect(redactUrl('/w/acme/team')).toBe('/w/acme/team');
  });
});

describe('platform', () => {
  it('reports health including database state', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await api().get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
  });

  it('allows only same-origin scripts, and page-created blob: URLs for images and media', async () => {
    const res = await api().get('/api/v1/health');
    const directives = Object.fromEntries(
      res.headers['content-security-policy'].split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values];
      }),
    );
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:', 'https:', 'blob:']);
    expect(directives['media-src']).toEqual(["'self'", 'blob:', 'https:']);
  });

  it('echoes a safe incoming request id and generates one otherwise', async () => {
    const supplied = await api().get('/api/v1/health').set('X-Request-Id', 'trace-abc-12345');
    expect(supplied.headers['x-request-id']).toBe('trace-abc-12345');
    const unsafe = await api().get('/api/v1/health').set('X-Request-Id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('grants CORS with credentials only to configured origins', async () => {
    const allowed = await api()
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await api()
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('authenticates before validating input on protected routes', async () => {
    // Anonymous callers learn nothing about expected parameters.
    const res = await api().get('/api/v1/workspaces?foo=bar');
    expect(res.status).toBe(401);
  });
});
