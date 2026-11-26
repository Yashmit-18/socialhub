import http from 'node:http';
import util from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QUICK_TUNNEL_HOST,
  acceptableTunnelHost,
  hasNgrokAuthtoken,
  metaDashboardUrls,
  ngrokFailureHint,
  ngrokTunnelHost,
  tunnelConnected,
  tunnelSettings,
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

/**
 * TUNNEL_PROVIDER=ngrok gives SocialHub one permanent address (the ngrok account's domain), so
 * the Meta dashboard is set once. These tests pin how the launcher chooses the tunnel, which
 * addresses it accepts from the ngrok agent, and that it never shows the ngrok authtoken.
 */
describe('launcher: choosing the tunnel', () => {
  it('uses a Quick Tunnel unless apps/api/.env asks for ngrok', () => {
    expect(tunnelSettings({})).toEqual({ provider: 'cloudflare', domain: null });
    expect(
      tunnelSettings({ TUNNEL_PROVIDER: 'cloudflare', NGROK_DOMAIN: 'a.ngrok-free.dev' }),
    ).toEqual({ provider: 'cloudflare', domain: null });
    expect(tunnelSettings({ TUNNEL_PROVIDER: ' NGROK ' })).toEqual({
      provider: 'ngrok',
      domain: null,
    });
  });

  it('takes NGROK_DOMAIN as a plain host name, and NGROK_DOMAIN alone selects ngrok', () => {
    expect(tunnelSettings({ NGROK_DOMAIN: 'Calm-Fox.ngrok-free.dev' })).toEqual({
      provider: 'ngrok',
      domain: 'calm-fox.ngrok-free.dev',
    });
    expect(
      tunnelSettings({
        TUNNEL_PROVIDER: 'ngrok',
        NGROK_DOMAIN: 'https://calm-fox.ngrok-free.dev/',
      }),
    ).toEqual({ provider: 'ngrok', domain: 'calm-fox.ngrok-free.dev' });
  });

  it.each([
    [{ TUNNEL_PROVIDER: 'ngrock' }, /must be "ngrok" or "cloudflare"/],
    [{ TUNNEL_PROVIDER: 'ngrok', NGROK_DOMAIN: 'calm fox.ngrok-free.dev' }, /NGROK_DOMAIN/],
    [{ TUNNEL_PROVIDER: 'ngrok', NGROK_DOMAIN: 'https://x.ngrok-free.dev/path' }, /NGROK_DOMAIN/],
    [{ TUNNEL_PROVIDER: 'ngrok', NGROK_DOMAIN: 'localhost' }, /NGROK_DOMAIN/],
  ])('refuses %o', (values, message) => {
    expect(() => tunnelSettings(values)).toThrow(message);
  });

  it('accepts only addresses that fit the chosen tunnel', () => {
    const quick = { provider: 'cloudflare', domain: null };
    const anyNgrok = { provider: 'ngrok', domain: null };
    const pinned = { provider: 'ngrok', domain: 'calm-fox.ngrok-free.dev' };
    expect(acceptableTunnelHost('four-random-words.trycloudflare.com', quick)).toBe(true);
    expect(acceptableTunnelHost('calm-fox.ngrok-free.dev', quick)).toBe(false);
    expect(acceptableTunnelHost('calm-fox.ngrok-free.dev', anyNgrok)).toBe(true);
    expect(acceptableTunnelHost('calm-fox.ngrok-free.dev', pinned)).toBe(true);
    expect(acceptableTunnelHost('other-name.ngrok-free.dev', pinned)).toBe(false);
    for (const bad of ['', 'x', 'a..b.dev', 'evil.dev/path', 'UPPER.ngrok-free.dev', null]) {
      expect(acceptableTunnelHost(bad, anyNgrok)).toBe(false);
    }
  });

  it('writes an ngrok address to .env like any other (three URL lines only)', () => {
    const result = updateEnvText(base, 'https://calm-fox.ngrok-free.dev');
    const after = util.parseEnv(result.text);
    for (const key of ['CLIENT_ORIGIN', 'APP_URL', 'API_PUBLIC_URL']) {
      expect(after[key]).toBe('https://calm-fox.ngrok-free.dev');
    }
    expect(after.JWT_ACCESS_SECRET).toBe(util.parseEnv(base).JWT_ACCESS_SECRET);
  });
});

describe('launcher: reading the ngrok agent', () => {
  const answer = (tunnels) => ({ tunnels, uri: '/api/tunnels' });
  const fox = 'https://calm-fox.ngrok-free.dev';

  it('finds the HTTPS tunnel that forwards to this API', () => {
    const tunnels = answer([
      { public_url: 'https://other.ngrok-free.dev', config: { addr: 'http://localhost:3000' } },
      { public_url: fox, config: { addr: 'http://localhost:4000' } },
    ]);
    expect(ngrokTunnelHost(tunnels, 4000)).toBe('calm-fox.ngrok-free.dev');
    expect(ngrokTunnelHost(tunnels, 3000)).toBe('other.ngrok-free.dev');
    expect(ngrokTunnelHost(tunnels, 5000)).toBeNull();
  });

  it('reads the current endpoints answer (GET /api/endpoints) too', () => {
    const endpoints = {
      endpoints: [
        {
          name: 'command_line',
          uri: '/api/endpoints/command_line',
          url: fox,
          upstream: { url: 'http://localhost:4000', protocol: 'http' },
          inspect: false,
        },
      ],
    };
    expect(ngrokTunnelHost(endpoints, 4000)).toBe('calm-fox.ngrok-free.dev');
    expect(ngrokTunnelHost(endpoints, 4001)).toBeNull();
    expect(
      ngrokTunnelHost(
        { endpoints: [{ url: fox, upstream: { url: 'http://10.0.0.5:4000' } }] },
        4000,
      ),
    ).toBeNull();
  });

  it.each(['localhost:4000', '4000', 'http://127.0.0.1:4000', 'http://[::1]:4000'])(
    'understands the upstream address %s',
    (addr) => {
      expect(ngrokTunnelHost(answer([{ public_url: fox, config: { addr } }]), 4000)).toBe(
        'calm-fox.ngrok-free.dev',
      );
    },
  );

  it('ignores tunnels that are not plain HTTPS origins or not on this computer', () => {
    for (const tunnel of [
      { public_url: 'http://calm-fox.ngrok-free.dev', config: { addr: 'http://localhost:4000' } },
      { public_url: 'tcp://0.tcp.ngrok.io:12345', config: { addr: 'localhost:4000' } },
      { public_url: `${fox}:8443`, config: { addr: 'localhost:4000' } },
      { public_url: `${fox}/x`, config: { addr: 'localhost:4000' } },
      { public_url: fox, config: { addr: 'http://10.0.0.5:4000' } },
      { public_url: 'not a url', config: { addr: 'localhost:4000' } },
      { public_url: fox },
    ]) {
      expect(ngrokTunnelHost(answer([tunnel]), 4000)).toBeNull();
    }
    expect(ngrokTunnelHost(null, 4000)).toBeNull();
    expect(ngrokTunnelHost({ tunnels: 'x' }, 4000)).toBeNull();
  });

  it('detects an authtoken in the config file without needing its value', () => {
    const token = '2abcDEFghiJKLmnoPQRstu_vwxYZ123';
    expect(hasNgrokAuthtoken(`version: "3"\nagent:\n    authtoken: ${token}\n`)).toBe(true);
    expect(hasNgrokAuthtoken(`version: "2"\nauthtoken: ${token}\n`)).toBe(true);
    expect(hasNgrokAuthtoken(`version: "3"\nagent:\n    # authtoken: ${token}\n`)).toBe(false);
    expect(hasNgrokAuthtoken('version: "3"\nagent:\n    authtoken: ""\n')).toBe(false);
    expect(hasNgrokAuthtoken('')).toBe(false);
    expect(hasNgrokAuthtoken(undefined)).toBe(false);
  });

  it('explains ngrok errors from codes only, never by echoing the log', () => {
    const log = [
      't=1 lvl=crit msg="command failed" err="authentication failed: secret-looking 2abcDEF_xyz',
      'ERR_NGROK_4018',
    ].join('\n');
    const hint = ngrokFailureHint(log);
    expect(hint).toMatch(/ngrok config add-authtoken/);
    expect(hint).not.toMatch(/2abcDEF_xyz|secret-looking/);
    expect(ngrokFailureHint('ERR_NGROK_108')).toMatch(/one at a time/);
    expect(ngrokFailureHint('ERR_NGROK_334')).toMatch(/already online/);
    expect(ngrokFailureHint('nothing useful')).toBe('');
  });

  it('points at NGROK_DOMAIN when an unknown ngrok error may come from it', () => {
    const hint = ngrokFailureHint('ERR_NGROK_15013', { domain: 'calm-fox.ngrok-free.dev' });
    expect(hint).toMatch(/err_ngrok_15013/);
    expect(hint).toMatch(/NGROK_DOMAIN in apps\/api\/.env is calm-fox.ngrok-free.dev/);
    expect(ngrokFailureHint('ERR_NGROK_15013')).not.toMatch(/NGROK_DOMAIN/);
  });
});

describe('launcher: Meta dashboard values for a new public URL', () => {
  const origin = 'https://calm-fox.ngrok-free.dev';

  it('lists the Facebook values and the legal pages', () => {
    const rows = Object.fromEntries(metaDashboardUrls(origin, {}));
    expect(rows['App Domains']).toBe('calm-fox.ngrok-free.dev');
    expect(rows['Facebook Login: Valid OAuth Redirect URI']).toBe(
      `${origin}/api/v1/oauth/facebook/callback`,
    );
    expect(rows['User data deletion callback']).toBe(
      `${origin}/api/v1/meta/facebook/data-deletion`,
    );
    expect(rows['Privacy Policy URL']).toBe(`${origin}/privacy.html`);
    expect(Object.keys(rows).some((label) => /Instagram/.test(label))).toBe(false);
  });

  it('adds the Instagram values only for the Instagram logins that .env configures', () => {
    const unified = Object.fromEntries(
      metaDashboardUrls(origin, { META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID: '123' }),
    );
    expect(unified['Instagram Unified Login configuration: Redirect URL']).toBe(
      `${origin}/api/v1/oauth/instagram-unified/callback`,
    );
    expect(unified['Instagram business login: OAuth redirect URI']).toBeUndefined();
    const instagram = Object.fromEntries(metaDashboardUrls(origin, { INSTAGRAM_APP_ID: '9' }));
    expect(instagram['Instagram business login: OAuth redirect URI']).toBe(
      `${origin}/api/v1/oauth/instagram/callback`,
    );
    expect(instagram['Instagram deauthorize callback']).toBe(
      `${origin}/api/v1/meta/instagram/deauthorize`,
    );
  });
});
