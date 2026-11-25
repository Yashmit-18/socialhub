import { createHmac } from 'node:crypto';
import { api, as } from './helpers.js';

/** Starts an authorization like the web app does; returns the state Meta would echo and the binding cookie. */
export async function startAuth(token, workspaceId, body = { provider: 'FACEBOOK_LOGIN' }) {
  const res = await as(token)
    .post(`/api/v1/workspaces/${workspaceId}/meta/authorizations`)
    .send(body);
  if (res.status !== 201) return { res };
  const url = new URL(res.body.authorizationUrl);
  const setCookie = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sh_oauth_'));
  return {
    res,
    url,
    state: url.searchParams.get('state'),
    cookie: setCookie.split(';')[0],
    setCookie,
  };
}

/** Simulates Meta redirecting the browser back to the callback. */
export async function callback(provider, { state, code, cookie, extra = {} }) {
  const query = new URLSearchParams({ ...(state && { state }), ...(code && { code }), ...extra });
  const req = api().get(`/api/v1/oauth/${provider}/callback?${query}`);
  if (cookie) req.set('Cookie', cookie);
  const res = await req;
  const location = res.headers.location ? new URL(res.headers.location) : null;
  return { res, location, result: location ? Object.fromEntries(location.searchParams) : null };
}

/** Full Facebook connect flow for an identity already registered in the fake. */
export async function connectFacebook(fake, token, workspaceId, userId, { connectionId } = {}) {
  const started = await startAuth(token, workspaceId, {
    provider: 'FACEBOOK_LOGIN',
    ...(connectionId && { connectionId }),
  });
  if (!started.state)
    throw new Error(`start failed: ${started.res.status} ${JSON.stringify(started.res.body)}`);
  const done = await callback('facebook', {
    state: started.state,
    code: fake.authorizeFacebook(userId),
    cookie: started.cookie,
  });
  return { ...done, connectionId: done.result?.connection };
}

export async function connectInstagram(fake, token, workspaceId, userId, { code } = {}) {
  const started = await startAuth(token, workspaceId, { provider: 'INSTAGRAM_LOGIN' });
  const done = await callback('instagram', {
    state: started.state,
    code: code ?? `${fake.authorizeInstagram(userId)}#_`, // Instagram appends "#_" to the code
    cookie: started.cookie,
  });
  return { ...done, connectionId: done.result?.connection };
}

/** Full Instagram Unified Login flow for a business portfolio registered in the fake. */
export async function connectUnified(fake, token, workspaceId, businessId, { connectionId } = {}) {
  const started = await startAuth(token, workspaceId, {
    provider: 'INSTAGRAM_UNIFIED_LOGIN',
    ...(connectionId && { connectionId }),
  });
  if (!started.state)
    throw new Error(`start failed: ${started.res.status} ${JSON.stringify(started.res.body)}`);
  const done = await callback('instagram-unified', {
    state: started.state,
    code: fake.authorizeUnified(businessId),
    cookie: started.cookie,
  });
  return { ...done, started, connectionId: done.result?.connection };
}

export function selectAccounts(token, workspaceId, connectionId, accounts) {
  return as(token)
    .post(`/api/v1/workspaces/${workspaceId}/social-connections/${connectionId}/accounts`)
    .send({ accounts });
}

export const page = (externalId) => ({ platform: 'FACEBOOK_PAGE', externalId });
export const insta = (externalId) => ({ platform: 'INSTAGRAM_ACCOUNT', externalId });

/** Builds a Meta-style signed_request. */
export function signedRequest(payload, secret) {
  const body = Buffer.from(
    JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: 1, ...payload }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${signature}.${body}`;
}
