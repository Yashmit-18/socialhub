import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app, { ensureDatabase } from '../index.js';

/**
 * apps/api/index.js is the API's entry point on Vercel (vercel.json, service "api"). Vercel
 * routes every /api/* request to it with the full path, so the API must answer there exactly
 * as `node src/server.js` does, after making sure the database is connected.
 */
describe('Vercel entry point (apps/api/index.js)', () => {
  it('answers API routes under their full /api/v1 path', async () => {
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok', database: 'connected' });

    const missing = await request(app).get('/api/v1/no-such-route');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBeTruthy();
  });

  it('keeps the API security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('reuses the open database connection instead of connecting again', async () => {
    await expect(ensureDatabase()).resolves.toBeUndefined();
    await expect(Promise.all([ensureDatabase(), ensureDatabase()])).resolves.toHaveLength(2);
  });

  it('does not serve the web app (Vercel serves it from the "web" service)', async () => {
    expect((await request(app).get('/')).status).toBe(404);
    expect((await request(app).get('/w/acme/compose')).status).toBe(404);
  });
});
