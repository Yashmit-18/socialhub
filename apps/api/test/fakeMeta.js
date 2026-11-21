/**
 * TEST-ONLY simulation of Meta's official OAuth + Graph endpoints, installed through
 * setMetaTransportForTests (refused outside NODE_ENV=test). It enforces the same contracts
 * the real APIs do — client credentials, exact redirect_uri, single-use codes,
 * appsecret_proof, token validity — so the integration code is exercised end to end.
 * It is not a substitute for testing against a real Meta Developer App.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { setMetaTransportForTests } from '../src/integrations/meta/http.js';

export const FB_APP_ID = process.env.META_APP_ID;
export const FB_APP_SECRET = process.env.META_APP_SECRET;
export const IG_APP_ID = process.env.INSTAGRAM_APP_ID;
export const IG_APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
export const FB_REDIRECT_URI = `${process.env.API_PUBLIC_URL}/api/v1/oauth/facebook/callback`;
export const IG_REDIRECT_URI = `${process.env.API_PUBLIC_URL}/api/v1/oauth/instagram/callback`;

export const ALL_FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];
export const ALL_IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
export const FULL_PAGE_TASKS = ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'];

const DAY = 86_400_000;
const rand = () => randomBytes(9).toString('base64url');

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const graphError = (status, code, message, subcode) =>
  json(status, {
    error: {
      message,
      type: 'OAuthException',
      code,
      error_subcode: subcode,
      fbtrace_id: 'FAKE_TRACE',
    },
  });

export class FakeMeta {
  constructor({ pageSize = 100 } = {}) {
    this.pageSize = pageSize;
    this.fbUsers = new Map();
    this.pages = new Map();
    this.igUsers = new Map();
    this.codes = new Map();
    this.tokens = new Map();
    this.calls = [];
  }

  install() {
    setMetaTransportForTests((url, init) => this.handle(url, init));
    return this;
  }

  uninstall() {
    setMetaTransportForTests(null);
  }

  /* ------------------------------------------------------------- scenario setup */

  addFacebookUser({
    id,
    name = `FB User ${id}`,
    granted = ALL_FB_SCOPES,
    declined = [],
    pages = [],
  }) {
    const user = {
      id,
      name,
      granted: [...granted],
      declined: [...declined],
      roles: new Map(),
      state: 'valid',
    };
    this.fbUsers.set(id, user);
    for (const page of pages) this.grantPage(id, page, page.tasks ?? FULL_PAGE_TASKS);
    return user;
  }

  /** Gives a Facebook user a role on a Page (Pages are shared objects across users). */
  grantPage(
    userId,
    { id, name = `Page ${id}`, category = 'Brand', instagram = null },
    tasks = FULL_PAGE_TASKS,
  ) {
    if (!this.pages.has(id)) this.pages.set(id, { id, name, category, instagram });
    this.fbUsers.get(userId).roles.set(id, [...tasks]);
  }

  /**
   * Sets followers_count for a Page, a Page-linked Instagram account or an Instagram Login
   * account (by its professional account id). `undefined` makes Meta omit the field;
   * { error: 'rate_limited' | 'permission' | 'transient' } makes the read fail.
   */
  setFollowers(id, value) {
    this.followers ??= new Map();
    this.followers.set(String(id), value);
  }

  followersResponse(id) {
    const value = this.followers?.get(String(id));
    if (value?.error === 'rate_limited') return graphError(400, 32, 'Page request limit reached');
    if (value?.error === 'permission')
      return graphError(
        403,
        10,
        '(#10) This endpoint requires the pages_read_engagement permission',
      );
    if (value?.error === 'transient')
      return json(500, {
        error: { message: 'Service temporarily unavailable', code: 2, is_transient: true },
      });
    return json(200, value === undefined ? { id } : { id, followers_count: value });
  }

  removePageRole(userId, pageId) {
    this.fbUsers.get(userId).roles.delete(pageId);
  }

  setPermissions(userId, { granted, declined = [] }) {
    const user = this.fbUsers.get(userId);
    user.granted = [...granted];
    user.declined = [...declined];
  }

  addInstagramUser({
    id,
    accountId,
    username,
    name = username,
    accountType = 'Business',
    granted = ALL_IG_SCOPES,
  }) {
    const user = {
      id,
      accountId,
      username,
      name,
      accountType,
      granted: [...granted],
      state: 'valid',
    };
    this.igUsers.set(id, user);
    return user;
  }

  /** Simulates the person completing the consent dialog: returns the code Meta would send. */
  authorizeFacebook(userId) {
    const code = `fbcode_${rand()}`;
    this.codes.set(code, { provider: 'facebook', userId });
    return code;
  }

  authorizeInstagram(userId) {
    const code = `igcode_${rand()}`;
    this.codes.set(code, { provider: 'instagram', userId });
    return code;
  }

  /** 'expired' -> OAuth error 190/463, 'revoked' -> 190/458 (app removed / grant revoked). */
  setTokenState(userId, state) {
    const user = this.fbUsers.get(userId) ?? this.igUsers.get(userId);
    user.state = state;
  }

  pageToken(userId, pageId) {
    return `pagetoken_${pageId}_${userId}`;
  }

  revocations() {
    return this.calls.filter((c) => c.method === 'DELETE' && c.path.endsWith('/me/permissions'));
  }

  /* ------------------------------------------------------------------- handlers */

  issue(type, userId, ttlMs) {
    const token = `${type}_${userId}_${rand()}`;
    this.tokens.set(token, { type, userId, expiresAt: ttlMs ? Date.now() + ttlMs : null });
    return token;
  }

  async handle(rawUrl, init = {}) {
    const url = new URL(rawUrl);
    const method = (init.method ?? 'GET').toUpperCase();
    const params = Object.fromEntries(url.searchParams);
    if (init.body) Object.assign(params, Object.fromEntries(new URLSearchParams(init.body)));
    this.calls.push({ method, host: url.host, path: url.pathname, params });

    if (url.host === 'graph.facebook.com') return this.facebookGraph(method, url.pathname, params);
    if (url.host === 'api.instagram.com' && url.pathname === '/oauth/access_token') {
      return this.instagramCodeExchange(method, params);
    }
    if (url.host === 'graph.instagram.com')
      return this.instagramGraph(method, url.pathname, params);
    return graphError(404, 803, `Fake Meta: unknown endpoint ${url.host}${url.pathname}`);
  }

  /** Validates a Facebook user token + appsecret_proof, returning [user] or [null, errorResponse]. */
  fbUserFromToken(params) {
    const record = this.tokens.get(params.access_token);
    if (!record || !['fb_long', 'fb_short'].includes(record.type)) {
      return [null, graphError(400, 190, 'Invalid OAuth access token - Cannot parse access token')];
    }
    const proof = createHmac('sha256', FB_APP_SECRET).update(params.access_token).digest('hex');
    if (params.appsecret_proof !== proof) {
      return [null, graphError(400, 100, 'Invalid appsecret_proof provided in the API argument')];
    }
    const user = this.fbUsers.get(record.userId);
    if (user.state === 'expired')
      return [
        null,
        graphError(400, 190, 'Error validating access token: Session has expired', 463),
      ];
    if (user.state === 'revoked')
      return [
        null,
        graphError(
          400,
          190,
          'Error validating access token: The user has not authorized application',
          458,
        ),
      ];
    return [user, null];
  }

  facebookGraph(method, path, params) {
    const route = path.replace(/^\/v\d+\.\d+/, '');

    if (route === '/oauth/access_token' && method === 'GET') {
      if (params.client_id !== FB_APP_ID || params.client_secret !== FB_APP_SECRET) {
        return graphError(
          400,
          101,
          'Error validating application. Invalid application ID or secret.',
        );
      }
      if (params.grant_type === 'fb_exchange_token') {
        const record = this.tokens.get(params.fb_exchange_token);
        if (!record || record.type !== 'fb_short')
          return graphError(400, 190, 'Invalid OAuth access token');
        return json(200, {
          access_token: this.issue('fb_long', record.userId, 60 * DAY),
          token_type: 'bearer',
          expires_in: 5_184_000,
        });
      }
      if (params.redirect_uri !== FB_REDIRECT_URI) {
        return graphError(
          400,
          100,
          'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request',
        );
      }
      const grant = this.codes.get(params.code);
      if (!grant || grant.provider !== 'facebook')
        return graphError(400, 100, 'Invalid verification code format.');
      this.codes.delete(params.code); // single use
      return json(200, {
        access_token: this.issue('fb_short', grant.userId, 2 * 3_600_000),
        token_type: 'bearer',
        expires_in: 7200,
      });
    }

    if (route === '/debug_token') {
      if (params.access_token !== `${FB_APP_ID}|${FB_APP_SECRET}`)
        return graphError(400, 190, 'Invalid app access token');
      const record = this.tokens.get(params.input_token);
      const user = record && this.fbUsers.get(record.userId);
      if (!user)
        return json(200, {
          data: { is_valid: false, error: { code: 190, message: 'Invalid token' } },
        });
      const base = {
        app_id: FB_APP_ID,
        type: 'USER',
        user_id: user.id,
        scopes: user.granted,
        expires_at: record.expiresAt ? Math.floor(record.expiresAt / 1000) : 0,
        data_access_expires_at: Math.floor((Date.now() + 90 * DAY) / 1000),
      };
      if (user.state === 'expired') {
        return json(200, {
          data: {
            ...base,
            is_valid: false,
            expires_at: Math.floor((Date.now() - DAY) / 1000),
            error: { code: 190, subcode: 463, message: 'Session has expired' },
          },
        });
      }
      if (user.state === 'revoked') {
        return json(200, {
          data: {
            ...base,
            is_valid: false,
            error: { code: 190, subcode: 458, message: 'The user has not authorized application' },
          },
        });
      }
      return json(200, { data: { ...base, is_valid: true } });
    }

    if (String(params.access_token ?? '').startsWith('pagetoken_') && method === 'GET') {
      return this.pageTokenGraph(route, params);
    }

    const [user, error] = this.fbUserFromToken(params);
    if (error) return error;

    if (route === '/me' && method === 'GET') {
      return json(200, {
        id: user.id,
        name: user.name,
        picture: { data: { url: `https://example.fbcdn.net/${user.id}.jpg` } },
      });
    }

    if (route === '/me/permissions' && method === 'GET') {
      return json(200, {
        data: [
          ...user.granted.map((permission) => ({ permission, status: 'granted' })),
          ...user.declined.map((permission) => ({ permission, status: 'declined' })),
        ],
      });
    }

    if (route === '/me/permissions' && method === 'DELETE') {
      user.state = 'revoked';
      return json(200, { success: true });
    }

    if (route === '/me/accounts' && method === 'GET') {
      if (!user.granted.includes('pages_show_list')) {
        return graphError(403, 200, '(#200) Requires pages_show_list permission');
      }
      const all = [...user.roles.entries()].map(([pageId, tasks]) => {
        const page = this.pages.get(pageId);
        const row = {
          id: page.id,
          name: page.name,
          category: page.category,
          tasks,
          access_token: this.pageToken(user.id, page.id),
          picture: { data: { url: `https://example.fbcdn.net/page-${page.id}.jpg` } },
        };
        if (page.instagram && user.granted.includes('instagram_basic')) {
          row.instagram_business_account = {
            id: page.instagram.id,
            username: page.instagram.username,
            name: page.instagram.name,
            profile_picture_url: `https://example.cdninstagram.com/${page.instagram.id}.jpg`,
          };
        }
        return row;
      });
      const limit = Math.min(Number(params.limit ?? 25), this.pageSize);
      const start = params.after ? Number(Buffer.from(params.after, 'base64url').toString()) : 0;
      const slice = all.slice(start, start + limit);
      const nextIndex = start + slice.length;
      const paging = {
        cursors: { before: 'b', after: Buffer.from(String(nextIndex)).toString('base64url') },
      };
      if (nextIndex < all.length)
        paging.next = 'https://graph.facebook.com/v27.0/me/accounts?after=...';
      return json(200, { data: slice, paging });
    }

    return graphError(404, 803, `Fake Meta: unknown Facebook route ${method} ${route}`);
  }

  /**
   * GET /{page-id or ig-user-id}?fields=followers_count with a Page token. The token is only
   * valid while its user is valid and still has a role on the Page; the Page field needs
   * pages_read_engagement, the IG User field instagram_basic + pages_read_engagement.
   */
  pageTokenGraph(route, params) {
    const [, pageId, userId] = /^pagetoken_(.+)_([^_]+)$/.exec(params.access_token) ?? [];
    const user = this.fbUsers.get(userId);
    const proof = createHmac('sha256', FB_APP_SECRET).update(params.access_token).digest('hex');
    if (!user || !user.roles.has(pageId) || user.state !== 'valid') {
      return graphError(400, 190, 'Error validating access token', 460);
    }
    if (params.appsecret_proof !== proof) {
      return graphError(400, 100, 'Invalid appsecret_proof provided in the API argument');
    }
    const page = this.pages.get(pageId);
    const nodeId = route.slice(1);
    const isPage = nodeId === pageId;
    const isLinkedInstagram = page.instagram?.id === nodeId;
    if (!isPage && !isLinkedInstagram) {
      return graphError(
        400,
        100,
        `Unsupported get request. Object with ID '${nodeId}' does not exist`,
      );
    }
    if (params.fields !== 'followers_count') {
      return graphError(400, 100, `Fake Meta: unsupported fields ${params.fields}`);
    }
    const needed = isPage
      ? ['pages_read_engagement']
      : ['instagram_basic', 'pages_read_engagement'];
    if (!needed.every((p) => user.granted.includes(p))) {
      return graphError(
        403,
        10,
        `(#10) This endpoint requires the ${needed.join(', ')} permission`,
      );
    }
    return this.followersResponse(nodeId);
  }

  instagramCodeExchange(method, params) {
    if (method !== 'POST')
      return json(405, { error_type: 'OAuthException', code: 405, error_message: 'POST required' });
    if (params.client_id !== IG_APP_ID || params.client_secret !== IG_APP_SECRET) {
      return json(400, {
        error_type: 'OAuthException',
        code: 400,
        error_message: 'Invalid platform app',
      });
    }
    if (params.redirect_uri !== IG_REDIRECT_URI || params.grant_type !== 'authorization_code') {
      return json(400, {
        error_type: 'OAuthException',
        code: 400,
        error_message: 'Error validating verification code',
      });
    }
    const grant = this.codes.get(params.code);
    if (!grant || grant.provider !== 'instagram') {
      return json(400, {
        error_type: 'OAuthException',
        code: 400,
        error_message: 'Invalid authorization code',
      });
    }
    this.codes.delete(params.code);
    const user = this.igUsers.get(grant.userId);
    // Documented shape: wrapped in `data`, permissions as a comma-separated string.
    return json(200, {
      data: [
        {
          access_token: this.issue('ig_short', user.id, 3_600_000),
          user_id: user.id,
          permissions: user.granted.join(','),
        },
      ],
    });
  }

  igUserFromToken(token, types) {
    const record = this.tokens.get(token);
    if (!record || !types.includes(record.type))
      return [null, graphError(400, 190, 'Invalid OAuth access token')];
    const user = this.igUsers.get(record.userId);
    if (user.state === 'expired')
      return [
        null,
        graphError(400, 190, 'Error validating access token: Session has expired', 463),
      ];
    if (user.state === 'revoked')
      return [null, graphError(400, 190, 'The user has not authorized application', 458)];
    return [user, null, record];
  }

  async instagramGraph(method, path, params) {
    if (path === '/access_token') {
      if (params.client_secret !== IG_APP_SECRET || params.grant_type !== 'ig_exchange_token') {
        return graphError(400, 101, 'Invalid client secret');
      }
      const [user, error] = this.igUserFromToken(params.access_token, ['ig_short']);
      if (error) return error;
      return json(200, {
        access_token: this.issue('ig_long', user.id, 60 * DAY),
        token_type: 'bearer',
        expires_in: 5_183_944,
      });
    }
    if (path === '/refresh_access_token') {
      const [user, error] = this.igUserFromToken(params.access_token, ['ig_long']);
      if (error) return error;
      return json(200, {
        access_token: this.issue('ig_long', user.id, 60 * DAY),
        token_type: 'bearer',
        expires_in: 5_183_944,
      });
    }
    if (/^\/v\d+\.\d+\/me$/.test(path)) {
      const [user, error] = this.igUserFromToken(params.access_token, ['ig_long', 'ig_short']);
      if (error) return error;
      if (params.fields === 'followers_count') {
        // Same { data: [...] } wrapping as the profile read.
        const response = this.followersResponse(user.accountId);
        if (!response.ok) return response;
        const body = await response.json();
        return json(200, { data: [{ ...body, id: user.id }] });
      }
      return json(200, {
        data: [
          {
            id: user.id,
            user_id: user.accountId,
            username: user.username,
            name: user.name,
            account_type: user.accountType,
            profile_picture_url: `https://example.cdninstagram.com/${user.accountId}.jpg`,
          },
        ],
      });
    }
    return graphError(404, 803, `Fake Meta: unknown Instagram route ${method} ${path}`);
  }
}
