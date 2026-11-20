/**
 * Facebook Login + Graph API calls used to connect Facebook identities and discover the
 * Pages (and Page-linked Instagram professional accounts) they manage.
 * Official endpoints only; every call is server-side.
 */
import { facebookSettings, metaSettings } from './settings.js';
import { META_HOSTS, dateFromEpoch, expiryFromSeconds, metaRequest, scopesFrom } from './http.js';

const MAX_PAGE_REQUESTS = 50;

function settings() {
  const fb = facebookSettings();
  if (!fb) throw new Error('Facebook Login is not configured');
  return fb;
}

const graphUrl = (path) => `${META_HOSTS.facebookGraph}/${metaSettings().graphVersion}${path}`;

export function isFacebookConfigured() {
  return Boolean(facebookSettings());
}

export function facebookAuthorizationUrl({ state, rerequest = false }) {
  const fb = settings();
  const url = new URL(`${META_HOSTS.facebookDialog}/${metaSettings().graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', fb.appId);
  url.searchParams.set('redirect_uri', fb.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (fb.loginConfigId) {
    // Facebook Login for Business: the configuration defines the permissions.
    url.searchParams.set('config_id', fb.loginConfigId);
  } else {
    url.searchParams.set('scope', fb.scopes.join(','));
  }
  // Re-prompt for permissions the person previously declined.
  if (rerequest) url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
}

/** Authorization code -> short-lived user token. */
export async function exchangeCode(code) {
  const fb = settings();
  const body = await metaRequest(graphUrl('/oauth/access_token'), {
    query: {
      client_id: fb.appId,
      client_secret: fb.appSecret,
      redirect_uri: fb.redirectUri,
      code,
    },
  });
  return { accessToken: body.access_token, expiresAt: expiryFromSeconds(body.expires_in) };
}

/** Short-lived -> long-lived (~60 day) user token. Page tokens derived from it do not expire. */
export async function exchangeForLongLivedToken(shortLivedToken) {
  const fb = settings();
  const body = await metaRequest(graphUrl('/oauth/access_token'), {
    query: {
      grant_type: 'fb_exchange_token',
      client_id: fb.appId,
      client_secret: fb.appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
  return { accessToken: body.access_token, expiresAt: expiryFromSeconds(body.expires_in) };
}

export async function fetchProfile(accessToken) {
  const fb = settings();
  const body = await metaRequest(graphUrl('/me'), {
    query: { fields: 'id,name,picture.width(200).height(200)' },
    accessToken,
    appSecret: fb.appSecret,
  });
  return {
    id: String(body.id),
    name: body.name ?? null,
    pictureUrl: body.picture?.data?.url ?? null,
  };
}

export async function fetchPermissions(accessToken) {
  const fb = settings();
  const body = await metaRequest(graphUrl('/me/permissions'), {
    accessToken,
    appSecret: fb.appSecret,
  });
  const granted = [];
  const declined = [];
  for (const row of body.data ?? []) {
    if (row.status === 'granted') granted.push(row.permission);
    else declined.push(row.permission);
  }
  return { granted, declined };
}

/** Token introspection with the app access token: validity, expiry and data-access expiry. */
export async function debugToken(inputToken) {
  const fb = settings();
  const body = await metaRequest(graphUrl('/debug_token'), {
    query: { input_token: inputToken },
    accessToken: `${fb.appId}|${fb.appSecret}`,
  });
  const data = body.data ?? {};
  return {
    isValid: data.is_valid === true,
    appId: data.app_id ? String(data.app_id) : null,
    userId: data.user_id ? String(data.user_id) : null,
    expiresAt: dateFromEpoch(data.expires_at),
    dataAccessExpiresAt: dateFromEpoch(data.data_access_expires_at),
    scopes: scopesFrom(data.scopes),
    error: data.error
      ? {
          code: Number(data.error.code),
          subcode: Number(data.error.subcode),
          message: data.error.message,
        }
      : null,
  };
}

const PAGE_FIELDS = [
  'id',
  'name',
  'category',
  'tasks',
  'access_token',
  'picture.width(200).height(200)',
  'instagram_business_account{id,username,name,profile_picture_url}',
].join(',');

/**
 * Every Page the identity has a role on, following cursor pagination. One identity commonly
 * manages many Pages — never assume one.
 */
export async function fetchManagedPages(accessToken) {
  const fb = settings();
  const pages = [];
  let after;
  for (let i = 0; i < MAX_PAGE_REQUESTS; i += 1) {
    const body = await metaRequest(graphUrl('/me/accounts'), {
      query: { fields: PAGE_FIELDS, limit: 100, after },
      accessToken,
      appSecret: fb.appSecret,
    });
    for (const page of body.data ?? []) {
      const ig = page.instagram_business_account;
      pages.push({
        id: String(page.id),
        name: page.name,
        category: page.category ?? null,
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        accessToken: page.access_token ?? null,
        pictureUrl: page.picture?.data?.url ?? null,
        instagram: ig?.id
          ? {
              id: String(ig.id),
              username: ig.username ?? null,
              name: ig.name ?? null,
              pictureUrl: ig.profile_picture_url ?? null,
            }
          : null,
      });
    }
    after = body.paging?.next ? body.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return pages;
}

/** Removes this app's authorization for the identity (all workspaces!). Callers must check. */
export async function revokeAppAuthorization(accessToken) {
  const fb = settings();
  await metaRequest(graphUrl('/me/permissions'), {
    method: 'DELETE',
    accessToken,
    appSecret: fb.appSecret,
  });
}
