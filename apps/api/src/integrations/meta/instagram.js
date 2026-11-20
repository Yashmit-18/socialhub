/**
 * Instagram API with Instagram Login ("Business Login for Instagram"). Yields exactly one
 * professional (Business or Creator) account per authorization. Official endpoints only.
 */
import { INSTAGRAM_ACCOUNT_TYPES } from '@socialhub/shared';
import { instagramSettings, metaSettings } from './settings.js';
import { META_HOSTS, expiryFromSeconds, metaRequest, scopesFrom, unwrapSingle } from './http.js';

function settings() {
  const ig = instagramSettings();
  if (!ig) throw new Error('Instagram Login is not configured');
  return ig;
}

export function isInstagramConfigured() {
  return Boolean(instagramSettings());
}

export function instagramAuthorizationUrl({ state, forceReauth = false }) {
  const ig = settings();
  const url = new URL(`${META_HOSTS.instagramAuthorize}/oauth/authorize`);
  url.searchParams.set('client_id', ig.appId);
  url.searchParams.set('redirect_uri', ig.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ig.scopes.join(','));
  url.searchParams.set('state', state);
  // When reconnecting, make sure the person signs in to the intended account again.
  if (forceReauth) url.searchParams.set('force_reauth', 'true');
  return url.toString();
}

/** Instagram appends "#_" to the code in the redirect; it is not part of the code. */
export function normalizeInstagramCode(code) {
  return String(code ?? '').replace(/#_$/, '');
}

/** Code -> short-lived token + the person's Instagram-scoped user id and granted permissions. */
export async function exchangeInstagramCode(code) {
  const ig = settings();
  const body = unwrapSingle(
    await metaRequest(`${META_HOSTS.instagramApi}/oauth/access_token`, {
      method: 'POST',
      form: {
        client_id: ig.appId,
        client_secret: ig.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: ig.redirectUri,
        code: normalizeInstagramCode(code),
      },
    }),
  );
  return {
    accessToken: body.access_token,
    userId: String(body.user_id),
    permissions: scopesFrom(body.permissions),
  };
}

/** Short-lived -> long-lived (60 day) token. */
export async function exchangeInstagramLongLivedToken(shortLivedToken) {
  const ig = settings();
  const body = await metaRequest(`${META_HOSTS.instagramGraph}/access_token`, {
    query: { grant_type: 'ig_exchange_token', client_secret: ig.appSecret },
    accessToken: shortLivedToken,
  });
  return { accessToken: body.access_token, expiresAt: expiryFromSeconds(body.expires_in) };
}

/** Extends a long-lived token by 60 days. Meta requires it to be >= 24h old and unexpired. */
export async function refreshInstagramToken(longLivedToken) {
  const body = await metaRequest(`${META_HOSTS.instagramGraph}/refresh_access_token`, {
    query: { grant_type: 'ig_refresh_token' },
    accessToken: longLivedToken,
  });
  return { accessToken: body.access_token, expiresAt: expiryFromSeconds(body.expires_in) };
}

const ACCOUNT_TYPES = {
  BUSINESS: INSTAGRAM_ACCOUNT_TYPES.BUSINESS,
  MEDIA_CREATOR: INSTAGRAM_ACCOUNT_TYPES.CREATOR,
  CREATOR: INSTAGRAM_ACCOUNT_TYPES.CREATOR,
};

export async function fetchInstagramProfile(accessToken) {
  const body = unwrapSingle(
    await metaRequest(`${META_HOSTS.instagramGraph}/${metaSettings().graphVersion}/me`, {
      query: { fields: 'id,user_id,username,name,account_type,profile_picture_url' },
      accessToken,
    }),
  );
  const rawType = String(body?.account_type ?? '').toUpperCase();
  return {
    /** App-scoped id of the person (identity). */
    id: body?.id ? String(body.id) : null,
    /** Instagram professional account id (destination). */
    accountId: body?.user_id ? String(body.user_id) : null,
    username: body?.username ?? null,
    name: body?.name ?? null,
    pictureUrl: body?.profile_picture_url ?? null,
    accountType: ACCOUNT_TYPES[rawType] ?? null,
  };
}
