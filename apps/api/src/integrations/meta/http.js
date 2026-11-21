import { createHmac } from 'node:crypto';
import { config } from '../../config/env.js';

/** Official Meta endpoints. Only these hosts are ever contacted. */
export const META_HOSTS = Object.freeze({
  facebookDialog: 'https://www.facebook.com',
  facebookGraph: 'https://graph.facebook.com',
  instagramAuthorize: 'https://www.instagram.com',
  instagramApi: 'https://api.instagram.com',
  instagramGraph: 'https://graph.instagram.com',
});

export const META_ERROR_KINDS = Object.freeze({
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  TRANSIENT: 'TRANSIENT',
  INVALID_REQUEST: 'INVALID_REQUEST',
});

// Documented throttling codes: 4 (app), 17 (user), 32 (Pages), 341 (application limit),
// 613 (custom), 368 (temporarily blocked, wait and retry) and the Business Use Case codes.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613]);
const BUSINESS_USE_CASE_CODES = new Set([
  80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014,
]);
// OAuthException 190: without a subcode it means "access token has expired"; subcode 463 is
// "expired". Every other subcode (458 app not installed, 459 checkpointed, 460 password
// changed, 464 unconfirmed user, 467 invalid access token, 492 invalid session) means the
// grant is no longer usable and the person must reauthorize.
const EXPIRED_SUBCODES = new Set([463]);

export class MetaApiError extends Error {
  constructor({ message, kind, httpStatus, code, subcode, type, fbtraceId, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MetaApiError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
    this.subcode = subcode;
    this.type = type;
    this.fbtraceId = fbtraceId;
  }

  get isTokenError() {
    return (
      this.kind === META_ERROR_KINDS.TOKEN_EXPIRED || this.kind === META_ERROR_KINDS.TOKEN_REVOKED
    );
  }

  /** Safe to log: no tokens, only Meta's diagnostic identifiers. */
  toLog() {
    return {
      kind: this.kind,
      httpStatus: this.httpStatus,
      code: this.code,
      subcode: this.subcode,
      type: this.type,
      fbtraceId: this.fbtraceId,
      message: this.message,
    };
  }
}

export function classifyMetaError({ httpStatus, code, subcode, isTransient }) {
  if (code === 102) return META_ERROR_KINDS.TOKEN_EXPIRED;
  if (code === 190) {
    return subcode === undefined || EXPIRED_SUBCODES.has(subcode)
      ? META_ERROR_KINDS.TOKEN_EXPIRED
      : META_ERROR_KINDS.TOKEN_REVOKED;
  }
  if (code === 10 || (code >= 200 && code <= 299)) return META_ERROR_KINDS.PERMISSION_DENIED;
  if (RATE_LIMIT_CODES.has(code) || BUSINESS_USE_CASE_CODES.has(code))
    return META_ERROR_KINDS.RATE_LIMITED;
  // `is_transient` appears in Graph error bodies; honoring it can only make an error retryable.
  if (isTransient || code === 1 || code === 2 || (httpStatus ?? 0) >= 500)
    return META_ERROR_KINDS.TRANSIENT;
  return META_ERROR_KINDS.INVALID_REQUEST;
}

/** Normalises both Graph errors ({error:{...}}) and Instagram token-endpoint errors ({error_type,...}). */
export function parseMetaError(httpStatus, body) {
  const graph = body?.error && typeof body.error === 'object' ? body.error : null;
  const code = Number(graph?.code ?? body?.code ?? NaN);
  const subcode = Number(graph?.error_subcode ?? NaN);
  const details = {
    httpStatus,
    code: Number.isFinite(code) ? code : undefined,
    subcode: Number.isFinite(subcode) ? subcode : undefined,
    type: graph?.type ?? body?.error_type,
    fbtraceId: graph?.fbtrace_id,
    message:
      graph?.message ??
      body?.error_message ??
      body?.error_description ??
      `Meta request failed with HTTP ${httpStatus}`,
  };
  return new MetaApiError({
    ...details,
    kind: classifyMetaError({ ...details, isTransient: graph?.is_transient === true }),
  });
}

const defaultTransport = (url, init) => fetch(url, init);
let transport = defaultTransport;

/** Tests inject a simulated Meta; this is refused outside NODE_ENV=test. */
export function setMetaTransportForTests(fn) {
  if (!config.isTest) throw new Error('Meta transport can only be replaced in tests');
  transport = fn ?? defaultTransport;
}

export function appSecretProof(accessToken, appSecret) {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_DELAY_MS = config.isTest ? 0 : 400;

/**
 * Calls a Meta endpoint and returns parsed JSON, throwing MetaApiError on any failure.
 * `appSecret` adds `appsecret_proof` (required when "Require App Secret" is enabled).
 *
 * Temporary failures (network errors, 5xx, codes 1/2, unreadable bodies) of GET requests are
 * retried `retries` times (default once) with a short backoff. Writes (POST/DELETE) are never
 * retried, because a lost response does not prove the first attempt failed. Rate limits are
 * never retried here: retrying immediately would only make them worse.
 */
export async function metaRequest(url, options = {}) {
  const { method = 'GET', retries = method === 'GET' ? 1 : 0 } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await metaRequestOnce(url, options);
    } catch (err) {
      const retryable = err instanceof MetaApiError && err.kind === META_ERROR_KINDS.TRANSIENT;
      if (!retryable || attempt >= retries) throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

async function metaRequestOnce(url, { method = 'GET', query, form, accessToken, appSecret } = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  }
  if (accessToken) {
    target.searchParams.set('access_token', accessToken);
    if (appSecret)
      target.searchParams.set('appsecret_proof', appSecretProof(accessToken, appSecret));
  }

  const init = {
    method,
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(config.meta.requestTimeoutMs),
  };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }

  let res;
  try {
    res = await transport(target.toString(), init);
  } catch (err) {
    throw new MetaApiError({
      message:
        err?.name === 'TimeoutError' ? 'Meta did not respond in time' : 'Meta could not be reached',
      kind: META_ERROR_KINDS.TRANSIENT,
      cause: err,
    });
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok || body?.error || body?.error_type) throw parseMetaError(res.status, body);
  if (body === null) {
    throw new MetaApiError({
      message: 'Meta returned an unreadable response',
      kind: META_ERROR_KINDS.TRANSIENT,
      httpStatus: res.status,
    });
  }
  return body;
}

/** Some Instagram endpoints wrap their payload as `{ data: [ {...} ] }`; accept both shapes. */
export function unwrapSingle(body) {
  if (Array.isArray(body?.data)) return body.data[0] ?? null;
  return body;
}

export function scopesFrom(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export function expiryFromSeconds(expiresIn, now = Date.now()) {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(now + seconds * 1000) : null;
}

/** A count field (e.g. followers_count) as a non-negative integer, or null when unusable. */
export function countFrom(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** debug_token reports epoch seconds, with 0 meaning "never". */
export function dateFromEpoch(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}
