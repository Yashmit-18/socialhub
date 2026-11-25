import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const base = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
};

describe('environment configuration', () => {
  it('applies secure production defaults', () => {
    const config = loadConfig(base);
    expect(config.isProduction).toBe(true);
    expect(config.auth.cookie.secure).toBe(true);
    expect(config.mongo.autoIndex).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('requires a strong JWT secret and a 32-byte encryption key', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: undefined })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() =>
      loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('refuses plain HTTP public addresses and insecure cookies in production', () => {
    expect(() => loadConfig({ ...base, CLIENT_ORIGIN: 'http://app.example.com' })).toThrow(
      /CLIENT_ORIGIN must use https:\/\/ in production \(http:\/\/app\.example\.com\)/,
    );
    expect(() =>
      loadConfig({
        ...base,
        CLIENT_ORIGIN: 'https://app.example.com',
        API_PUBLIC_URL: 'http://api.example.com',
      }),
    ).toThrow(/API_PUBLIC_URL must use https:\/\/ in production/);
    expect(() =>
      loadConfig({ ...base, CLIENT_ORIGIN: 'https://app.example.com', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE=false is not allowed in production/);
    // Local addresses (a production build tried out on this machine) are still accepted.
    expect(loadConfig({ ...base, CLIENT_ORIGIN: 'http://localhost:5173' }).appUrl).toBe(
      'http://localhost:5173',
    );
    // Development keeps working on http.
    expect(
      loadConfig({ ...base, NODE_ENV: 'development', CLIENT_ORIGIN: 'http://192.168.1.5:5173' })
        .appUrl,
    ).toBe('http://192.168.1.5:5173');
  });

  it('parses origin lists and derives the app URL', () => {
    const config = loadConfig({
      ...base,
      CLIENT_ORIGIN: 'https://app.example.com/, https://admin.example.com',
    });
    expect(config.clientOrigins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    expect(config.appUrl).toBe('https://app.example.com');
  });

  it('treats blank values as unset', () => {
    const config = loadConfig({ ...base, PORT: '', SMTP_HOST: '' });
    expect(config.port).toBe(4000);
    expect(config.mail.smtp).toBeNull();
  });

  it('refuses SameSite=None cookies without Secure', () => {
    expect(() => loadConfig({ ...base, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SAMESITE/,
    );
  });

  it('leaves the Meta integration disabled unless credentials are provided', () => {
    const config = loadConfig(base);
    expect(config.meta.facebook).toBeNull();
    expect(config.meta.instagram).toBeNull();
    expect(config.meta.graphVersion).toBe('v27.0');
  });

  it('requires Meta app ids and secrets in pairs and derives redirect URIs', () => {
    expect(() => loadConfig({ ...base, META_APP_ID: '123' })).toThrow(/META_APP_SECRET/);
    expect(() => loadConfig({ ...base, INSTAGRAM_APP_SECRET: 'x'.repeat(20) })).toThrow(
      /INSTAGRAM_APP_ID/,
    );
    const config = loadConfig({
      ...base,
      APP_URL: 'https://app.example.com',
      API_PUBLIC_URL: 'https://api.example.com/',
      META_APP_ID: '123',
      META_APP_SECRET: 's'.repeat(32),
    });
    expect(config.meta.facebook.redirectUri).toBe(
      'https://api.example.com/api/v1/oauth/facebook/callback',
    );
    expect(config.meta.facebook.scopes).toContain('pages_show_list');
  });

  it('validates the Graph API version format', () => {
    expect(() => loadConfig({ ...base, META_GRAPH_API_VERSION: '27' })).toThrow(
      /META_GRAPH_API_VERSION/,
    );
  });

  it('parses TRUST_PROXY hop counts', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig(base).trustProxy).toBe(false);
  });
});
