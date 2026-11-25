/**
 * Instagram API with Unified Login. Official endpoints only; every call is server-side.
 *
 * The client signs in with Facebook or Instagram in Meta's dialog, chooses (or creates) the
 * business portfolio that owns their Instagram professional accounts and selects the accounts
 * to share. The login runs under the Meta app id with a configuration (`config_id`, which
 * replaces `scope`; the permissions are chosen in the configuration in the App Dashboard).
 * The code is exchanged with the Meta app secret for a Business Integration System User
 * access token owned by the client's business portfolio. One token covers every Instagram
 * account the client assigned to the app. API host: graph.facebook.com.
 *
 * Meta documentation: developers.facebook.com/documentation/instagram-platform/
 * instagram-api-with-unified-login (get-started, authentication) and
 * documentation/facebook-login/facebook-login-for-business.
 */
import { instagramUnifiedSettings, metaSettings } from './settings.js';
import {
  META_ERROR_KINDS,
  META_HOSTS,
  MetaApiError,
  expiryFromSeconds,
  metaRequest,
} from './http.js';

const MAX_PAGE_REQUESTS = 50;
/** `id,username` is what Meta documents for the edge; the rest are IG User fields. */
const ACCOUNT_FIELDS = 'id,username,name,profile_picture_url';
const DOCUMENTED_ACCOUNT_FIELDS = 'id,username';

function settings() {
  const unified = instagramUnifiedSettings();
  if (!unified) throw new Error('Instagram Unified Login is not configured');
  return unified;
}

const graphUrl = (path) => `${META_HOSTS.facebookGraph}/${metaSettings().graphVersion}${path}`;

export function isInstagramUnifiedConfigured() {
  return Boolean(instagramUnifiedSettings());
}

/**
 * The login dialog URL. Documented parameters: client_id (Meta app id), config_id,
 * redirect_uri (must match the redirect URL saved in the configuration), response_type=code,
 * prompt=login (offers both Facebook and Instagram sign-in). Facebook Login for Business
 * requires override_default_response_type=true for system-user-token configurations, and
 * `state` protects the round trip (verified on the callback before the code is used).
 */
export function instagramUnifiedAuthorizationUrl({ state }) {
  const unified = settings();
  const url = new URL(`${META_HOSTS.facebookDialog}/dialog/oauth`);
  url.searchParams.set('client_id', unified.appId);
  url.searchParams.set('config_id', unified.configId);
  url.searchParams.set('redirect_uri', unified.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('override_default_response_type', 'true');
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Authorization code -> Business Integration System User access token (Meta app secret). */
export async function exchangeInstagramUnifiedCode(code) {
  const unified = settings();
  const body = await metaRequest(graphUrl('/oauth/access_token'), {
    query: {
      client_id: unified.appId,
      client_secret: unified.appSecret,
      redirect_uri: unified.redirectUri,
      code,
    },
  });
  if (typeof body?.access_token !== 'string' || !body.access_token) {
    throw new MetaApiError({
      message: 'Meta answered the code exchange without an access token',
      kind: META_ERROR_KINDS.INVALID_REQUEST,
    });
  }
  return { accessToken: body.access_token, expiresAt: expiryFromSeconds(body.expires_in) };
}

/**
 * With this token `/me` is the business integration system user (not the Instagram account).
 * `client_business_id` is the client's business portfolio that owns the token.
 */
export async function fetchBusinessIntegration(accessToken) {
  const unified = settings();
  const body = await metaRequest(graphUrl('/me'), {
    query: { fields: 'id,name,client_business_id' },
    accessToken,
    appSecret: unified.appSecret,
  });
  return {
    systemUserId: body?.id ? String(body.id) : null,
    name: typeof body?.name === 'string' ? body.name : null,
    clientBusinessId: body?.client_business_id ? String(body.client_business_id) : null,
  };
}

async function accountsPage(accessToken, fields, after) {
  return metaRequest(graphUrl('/me/assigned_instagram_accounts'), {
    query: { fields, limit: 100, after },
    accessToken,
    appSecret: settings().appSecret,
  });
}

/**
 * Every Instagram professional account assigned to the app by the client (needs
 * instagram_basic), following cursor pagination. Personal accounts can never be assigned.
 * If Meta refuses the extra profile fields on this edge, the documented `id,username` is used.
 */
export async function fetchAssignedInstagramAccounts(accessToken) {
  let fields = ACCOUNT_FIELDS;
  const accounts = [];
  const seen = new Set();
  let after;
  for (let i = 0; i < MAX_PAGE_REQUESTS; i += 1) {
    let body;
    try {
      body = await accountsPage(accessToken, fields, after);
    } catch (err) {
      const unsupportedField =
        err instanceof MetaApiError &&
        err.kind === META_ERROR_KINDS.INVALID_REQUEST &&
        err.code === 100 &&
        fields !== DOCUMENTED_ACCOUNT_FIELDS &&
        after === undefined;
      if (!unsupportedField) throw err;
      fields = DOCUMENTED_ACCOUNT_FIELDS;
      body = await accountsPage(accessToken, fields, after);
    }
    for (const row of body?.data ?? []) {
      if (!row?.id || seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      accounts.push({
        id: String(row.id),
        username: typeof row.username === 'string' ? row.username : null,
        name: typeof row.name === 'string' ? row.name : null,
        pictureUrl: typeof row.profile_picture_url === 'string' ? row.profile_picture_url : null,
      });
    }
    after = body?.paging?.next ? body?.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return accounts;
}
