import http from 'node:http';
import util from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QUICK_TUNNEL_HOST,
  tunnelConnected,
  updateEnvText,
} from '../../../scripts/socialhub-launcher.js';

/**
 * The Windows launcher (scripts/socialhub-launcher.js) writes the Quick Tunnel URL into
 * apps/api/.env. These tests pin what it may change (three URL lines, nothing else) and when it
 * must refuse to write. Starting real processes is covered by the manual check in the README.
 */
const NEW = 'https://new-two.trycloudflare.com';
const base = [
  '# SocialHub API',
  'MONGODB_URI="mongodb://user:pass@db.example/socialhub"',
  'CLIENT_ORIGIN="https://old-one.trycloudflare.com"',
  '# a comment between',
  'APP_URL="https://old-one.trycloudflare.com"',
  'JWT_ACCESS_SECRET=abc=def==',
  'API_PUBLIC_URL=https://old-one.trycloudflare.com',
  'PUBLISHING_MODE=simulated',
  '',
].join('\n');

describe('launcher: writing the tunnel URL to .env', () => {
  it('changes exactly CLIENT_ORIGIN, APP_URL and API_PUBLIC_URL, keeping their quoting', () => {
    const result = updateEnvText(base, NEW);
    expect(result).toMatchObject({ changed: true, previous: 'https://old-one.trycloudflare.com' });
    const before = util.parseEnv(base);
    const after = util.parseEnv(result.text);
    for (const key of ['CLIENT_ORIGIN', 'APP_URL', 'API_PUBLIC_URL']) expect(after[key]).toBe(NEW);
    for (const key of ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'PUBLISHING_MODE']) {
      expect(after[key]).toBe(before[key]);
    }
    expect(result.text).toContain(`CLIENT_ORIGIN="${NEW}"`);
    expect(result.text).toContain(`API_PUBLIC_URL=${NEW}`);
    const changed = result.text.split('\n').filter((line, i) => line !== base.split('\n')[i]);
    expect(changed).toHaveLength(3);
  });

  it('keeps Windows line endings and does nothing when the URL is already there', () => {
    const crlf = updateEnvText(base.replace(/\n/g, '\r\n'), NEW).text;
    expect(crlf).toContain('\r\n');
    expect(/[^\r]\n/.test(crlf)).toBe(false);
    const again = updateEnvText(updateEnvText(base, NEW).text, NEW);
    expect(again.changed).toBe(false);
  });

  it.each([
    ['http://x.trycloudflare.com', /plain HTTPS origin/],
    ['https://x.trycloudflare.com/api', /plain HTTPS origin/],
    ['https://x.trycloudflare.com?a=1', /plain HTTPS origin/],
  ])('refuses to write %s', (origin, message) => {
    expect(() => updateEnvText(base, origin)).toThrow(message);
  });

  it('refuses to guess when the file is not as expected', () => {
    expect(() =>
      updateEnvText(base.replace('APP_URL="https://old-one', 'APP_URL="https://other'), NEW),
    ).toThrow(/not all the same URL/);
    expect(() => updateEnvText(`${base}APP_URL=x\n`, NEW)).toThrow(/more than once/);
    expect(() => updateEnvText(base.replace(/^API_PUBLIC_URL=.*$/m, ''), NEW)).toThrow(
      /no API_PUBLIC_URL line/,
    );
  });

  it('accepts only real Quick Tunnel hostnames', () => {
    expect(QUICK_TUNNEL_HOST.test('four-random-example-words.trycloudflare.com')).toBe(true);
    for (const host of [
      'example.com',
      'x.trycloudflare.com.evil.example',
      '-a.trycloudflare.com',
      'a..b.trycloudflare.com',
      'UPPER.trycloudflare.com',
    ]) {
      expect(QUICK_TUNNEL_HOST.test(host)).toBe(false);
    }
  });
});

/**
 * A quick tunnel that lost its connection to Cloudflare (for example after the PC slept) still
 * reports its old address, which no longer resolves. The launcher must notice that through
 * cloudflared's GET /ready (200 while connected, 503 otherwise) and replace the tunnel.
 * A local stand-in plays cloudflared's status endpoint.
 */
describe('launcher: is the running tunnel still connected?', () => {
  let server;
  afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())));

  async function statusEndpoint(answers) {
    let call = 0;
    server = http.createServer((req, res) => {
      const status = req.url === '/ready' ? answers[Math.min(call++, answers.length - 1)] : 404;
      res.writeHead(status, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
  }

  it('is connected while /ready answers 200', async () => {
    expect(await tunnelConnected(await statusEndpoint([200]), { waitMs: 0 })).toBe(true);
  });

  it('is not connected while /ready answers 503 (no connection to Cloudflare)', async () => {
    expect(await tunnelConnected(await statusEndpoint([503]), { waitMs: 0 })).toBe(false);
  });

  it('waits for a short reconnect before giving up', async () => {
    expect(await tunnelConnected(await statusEndpoint([503, 503, 200]), { waitMs: 5000 })).toBe(
      true,
    );
  });

  it('is not connected when nothing answers', async () => {
    const port = await statusEndpoint([200]);
    await new Promise((resolve) => server.close(resolve));
    server = null;
    expect(await tunnelConnected(port, { waitMs: 0 })).toBe(false);
  });
});
