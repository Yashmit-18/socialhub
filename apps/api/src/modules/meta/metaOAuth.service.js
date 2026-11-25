/**
 * OAuth round-trip for connecting Meta identities.
 *
 * Start (authenticated XHR): create a single-use, short-lived state and a browser-binding
 * secret. Only their SHA-256 digests are stored. The binding secret goes into an httpOnly
 * cookie named after the state, so a leaked authorization URL cannot be completed in
 * another browser (login-CSRF / account-injection protection), and parallel flows work.
 *
 * Callback (top-level redirect from Meta): validate state, expiry, provider, browser
 * binding and the user's current workspace permission BEFORE exchanging the code.
 */
import {
  META_OAUTH_RESULTS,
  META_PERMISSIONS,
  OAUTH_PURPOSES,
  PERMISSIONS,
  SOCIAL_PROVIDERS,
  ERROR_CODES,
  hasPermission,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, notFound, validationError } from '../../lib/errors.js';
import { instagramSettings, metaSettings } from '../../integrations/meta/settings.js';
import * as facebook from '../../integrations/meta/facebook.js';
import { MetaApiError } from '../../integrations/meta/http.js';
import * as instagram from '../../integrations/meta/instagram.js';
import { Membership, OAuthState, SocialConnection, User, Workspace } from '../../models/index.js';
import {
  IdentityMismatchError,
  NotEligibleError,
  authorizeFacebookIdentity,
  authorizeInstagramIdentity,
  saveAuthorizedConnection,
} from './metaConnection.service.js';

export const OAUTH_COOKIE_PATH = '/api/v1/oauth';
const COOKIE_PREFIX = 'sh_oauth_';

/**
 * A short id for one OAuth attempt in logs and diagnostics: the first 12 hex characters of
 * the SHA-256 digest of its state. The state itself, the binding cookie, the authorization
 * code and tokens are never logged.
 */
export const oauthAttemptId = (stateHash) => stateHash.slice(0, 12);

/** What SocialHub asked Meta for, safe to log: the state is reduced to "present". */
export function describeAuthorizationRequest(authorizationUrl) {
  const url = new URL(authorizationUrl);
  const params = url.searchParams;
  return {
    dialog: `${url.origin}${url.pathname}`,
    clientId: params.get('client_id'),
    redirectUri: params.get('redirect_uri'),
    responseType: params.get('response_type'),
    scopes: params.get('scope')?.split(',') ?? null,
    loginConfiguration: params.has('config_id'),
    authType: params.get('auth_type') ?? null,
    statePresent: Boolean(params.get('state')),
  };
}

const clip = (value, max) =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

/**
 * What a stored attempt's diagnostics mean, in words (used by `npm run meta:oauth-attempts`).
 * An attempt without `callbackAt` never came back from Meta, so it stopped on Meta's side.
 * Attempts started before these diagnostics existed have no callback data either.
 */
export function explainOAuthAttempt(attempt, now = new Date()) {
  const success = [META_OAUTH_RESULTS.CONNECTED, META_OAUTH_RESULTS.RECONNECTED];
  if (attempt.consumedAt && success.includes(attempt.callbackResult)) {
    return `completed: ${attempt.callbackResult}`;
  }
  if (attempt.callbackAt) {
    const meta = attempt.metaError ? ` (Meta error ${attempt.metaError})` : '';
    return `came back to SocialHub and was refused: ${attempt.callbackResult}${meta}`;
  }
  if (attempt.consumedAt) return 'came back to SocialHub (no outcome recorded)';
  if (new Date(attempt.expiresAt) > now) return 'waiting: the person is still at Meta';
  return 'never came back from Meta: the flow stopped on Meta’s side (Facebook login, app access, or the dialog was closed)';
}

/** URL path segment <-> provider. */
export const PROVIDER_SLUGS = Object.freeze({
  facebook: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
  instagram: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN,
});
const SLUG_BY_PROVIDER = Object.fromEntries(Object.entries(PROVIDER_SLUGS).map(([k, v]) => [v, k]));

export function isProviderConfigured(provider) {
  return provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN
    ? facebook.isFacebookConfigured()
    : instagram.isInstagramConfigured();
}

/** The live configuration, with the Meta settings as currently in effect. */
const currentConfig = () => ({ ...config, meta: metaSettings() });

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * Pure configuration review for the admin "Meta configuration" panel. Each check is
 * `{ id, level: 'error' | 'warning' | 'info', provider: 'facebook' | 'instagram' | null, message }`.
 * `error` means connecting will fail; `warning` means something Meta or publishing will need.
 */
export function metaConfigChecks(cfg = currentConfig()) {
  const fb = cfg.meta.facebook;
  const ig = cfg.meta.instagram;
  const checks = [];
  const add = (id, level, provider, message) => checks.push({ id, level, provider, message });

  if (!fb)
    add(
      'FACEBOOK_NOT_CONFIGURED',
      'info',
      'facebook',
      'Facebook Login is disabled. Set META_APP_ID and META_APP_SECRET to enable it.',
    );
  if (!ig)
    add(
      'INSTAGRAM_NOT_CONFIGURED',
      'info',
      'instagram',
      'Instagram Login is disabled. Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to enable it.',
    );
  if (!fb && !ig) return checks;

  const providers = [fb && 'facebook', ig && 'instagram'].filter(Boolean);
  const scope = providers.length === 2 ? null : providers[0];

  if (new URL(cfg.publicApiUrl).protocol !== 'https:') {
    add(
      'PUBLIC_URL_NOT_HTTPS',
      cfg.isProduction ? 'error' : 'warning',
      scope,
      `API_PUBLIC_URL (${cfg.publicApiUrl}) is not HTTPS. Meta requires HTTPS OAuth redirect URIs (Enforce HTTPS).`,
    );
  }

  // The browser-binding cookie is stored for the host the browser used to start the flow.
  const apiHost = hostOf(cfg.publicApiUrl);
  const webHosts = new Set([cfg.appUrl, ...cfg.clientOrigins].map(hostOf).filter(Boolean));
  if (apiHost && !webHosts.has(apiHost)) {
    if (cfg.auth.cookie.sameSite !== 'none') {
      add(
        'CALLBACK_HOST_MISMATCH',
        'error',
        scope,
        `The OAuth callback host (${apiHost}) differs from the web app host. The browser-binding cookie will not reach the callback, so every connection would fail (BROWSER_MISMATCH). Serve the web app and API from the same host, or call the API directly at API_PUBLIC_URL with COOKIE_SAMESITE=none.`,
      );
    } else {
      add(
        'CALLBACK_HOST_SPLIT',
        'warning',
        scope,
        `The OAuth callback host (${apiHost}) differs from the web app host. This only works if the web app calls the API directly at API_PUBLIC_URL (build it with VITE_API_URL).`,
      );
    }
  }

  if (fb) {
    if (!fb.loginConfigId) {
      add(
        'LOGIN_CONFIG_RECOMMENDED',
        'info',
        'facebook',
        'Using the scope parameter. For business-type apps Meta recommends Facebook Login for Business: create a configuration (User access token) and set META_FACEBOOK_LOGIN_CONFIG_ID.',
      );
      const missing = (list) => list.filter((s) => !fb.scopes.includes(s));
      const required = missing(META_PERMISSIONS.FACEBOOK.REQUIRED);
      if (required.length)
        add(
          'FACEBOOK_REQUIRED_SCOPE_MISSING',
          'error',
          'facebook',
          `META_FACEBOOK_SCOPES must include ${required.join(', ')}.`,
        );
      const publishing = missing([
        ...new Set([
          ...META_PERMISSIONS.FACEBOOK.PAGE_PUBLISHING,
          ...META_PERMISSIONS.FACEBOOK.INSTAGRAM_PUBLISHING,
        ]),
      ]);
      if (publishing.length)
        add(
          'FACEBOOK_PUBLISHING_SCOPES_MISSING',
          'warning',
          'facebook',
          `Not requested (needed for publishing later): ${publishing.join(', ')}.`,
        );
    }
  }
  if (ig) {
    const required = META_PERMISSIONS.INSTAGRAM.REQUIRED.filter((s) => !ig.scopes.includes(s));
    if (required.length)
      add(
        'INSTAGRAM_REQUIRED_SCOPE_MISSING',
        'error',
        'instagram',
        `INSTAGRAM_SCOPES must include ${required.join(', ')}.`,
      );
    const publishing = META_PERMISSIONS.INSTAGRAM.PUBLISHING.filter((s) => !ig.scopes.includes(s));
    if (publishing.length)
      add(
        'INSTAGRAM_PUBLISHING_SCOPES_MISSING',
        'warning',
        'instagram',
        `Not requested (needed for publishing later): ${publishing.join(', ')}.`,
      );
  }
  return checks;
}

/** Non-secret integration settings plus the configuration review, shown to admins. */
export function metaIntegrationStatus(cfg = currentConfig()) {
  const fb = cfg.meta.facebook;
  const ig = cfg.meta.instagram;
  const base = `${cfg.publicApiUrl}/api/v1/meta`;
  const checks = metaConfigChecks(cfg);
  const blocked = (provider) =>
    checks.some((c) => c.level === 'error' && (c.provider === provider || c.provider === null));
  return {
    graphApiVersion: cfg.meta.graphVersion,
    publicApiUrl: cfg.publicApiUrl,
    appUrl: cfg.appUrl,
    facebook: {
      configured: Boolean(fb),
      ready: Boolean(fb) && !blocked('facebook'),
      scopes: fb?.loginConfigId ? null : (fb?.scopes ?? null),
      usesLoginConfiguration: Boolean(fb?.loginConfigId),
      redirectUri: `${cfg.publicApiUrl}/api/v1/oauth/facebook/callback`,
      deauthorizeCallbackUrl: `${base}/facebook/deauthorize`,
      dataDeletionCallbackUrl: `${base}/facebook/data-deletion`,
    },
    instagram: {
      configured: Boolean(ig),
      ready: Boolean(ig) && !blocked('instagram'),
      scopes: ig?.scopes ?? null,
      redirectUri: `${cfg.publicApiUrl}/api/v1/oauth/instagram/callback`,
      deauthorizeCallbackUrl: `${base}/instagram/deauthorize`,
      dataDeletionCallbackUrl: `${base}/instagram/data-deletion`,
    },
    checks,
  };
}

export const bindingCookieName = (stateHash) => `${COOKIE_PREFIX}${stateHash.slice(0, 16)}`;

export function bindingCookieOptions() {
  const { secure, sameSite, domain } = config.auth.cookie;
  return {
    httpOnly: true,
    secure,
    // The callback is a cross-site top-level navigation from Meta: Lax cookies are sent on it,
    // Strict ones are not. Keep None only for split-site deployments that require it.
    sameSite: sameSite === 'none' ? 'none' : 'lax',
    domain,
    path: OAUTH_COOKIE_PATH,
  };
}

export async function startAuthorization({ workspace, user, provider, connectionId }) {
  if (!isProviderConfigured(provider)) {
    throw new AppError(
      409,
      ERROR_CODES.META_NOT_CONFIGURED,
      `${provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN ? 'Facebook' : 'Instagram'} Login is not configured on this server.`,
    );
  }

  let connection = null;
  if (connectionId) {
    connection = await SocialConnection.findOne({ _id: connectionId, workspace: workspace._id });
    if (!connection) throw notFound('Connection not found');
    if (connection.provider !== provider) {
      throw validationError({
        fields: { provider: 'Reconnect with the same provider as the original connection' },
      });
    }
  }

  const state = randomToken(32);
  const binding = randomToken(32);
  const stateHash = sha256(state);
  const expiresAt = new Date(Date.now() + config.meta.stateTtlMinutes * 60_000);
  const purpose = connection ? OAUTH_PURPOSES.RECONNECT : OAUTH_PURPOSES.CONNECT;

  await OAuthState.create({
    stateHash,
    browserBindingHash: sha256(binding),
    provider,
    purpose,
    workspace: workspace._id,
    user: user._id,
    connection: connection?._id,
    expiresAt,
  });

  const authorizationUrl =
    provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN
      ? facebook.facebookAuthorizationUrl({
          state,
          rerequest:
            purpose === OAUTH_PURPOSES.RECONNECT || (connection?.declinedScopes?.length ?? 0) > 0,
        })
      : instagram.instagramAuthorizationUrl({
          state,
          forceReauth: purpose === OAUTH_PURPOSES.RECONNECT,
        });

  logger.info(
    {
      oauth: {
        attempt: oauthAttemptId(stateHash),
        stage: 'started',
        provider,
        purpose,
        workspace: workspace.slug,
        user: String(user._id),
        expiresAt,
        request: describeAuthorizationRequest(authorizationUrl),
      },
    },
    'Meta OAuth started',
  );

  return {
    authorizationUrl,
    expiresAt,
    purpose,
    cookie: {
      name: bindingCookieName(stateHash),
      value: binding,
      maxAgeMs: config.meta.stateTtlMinutes * 60_000,
    },
  };
}

function resultUrl(params) {
  const url = new URL(`${config.appUrl}/oauth/meta/result`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const single = (value) => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * Handles Meta's redirect. Always resolves to a browser redirect back to the web app;
 * failures carry only a reason code (no secrets, no Meta error text in the URL).
 */
export async function completeAuthorization({ provider, query, cookies, context }) {
  const providerSlug = SLUG_BY_PROVIDER[provider];
  const state = single(query.state);
  let cookieName = null;
  let workspaceSlug;
  let attempt = null;
  let stored = null;
  let browserBinding = 'not_checked';
  // Meta's own error on the redirect (for example access_denied / user_denied). Short codes
  // only; untrusted input, so clipped.
  const metaError = clip(single(query.error), 64);
  const metaErrorReason = clip(single(query.error_reason), 64);

  /**
   * Diagnostics for every callback: one log line and, when the state is known, the outcome on
   * the stored attempt (also when the callback is refused before the state is used).
   * `failedAt` names the check that refused it; it is absent on success.
   */
  const report = async (result, failedAt) => {
    logger[failedAt ? 'warn' : 'info'](
      {
        oauth: {
          attempt,
          stage: 'callback',
          provider,
          result,
          failedAt,
          statePresent: Boolean(state),
          stateKnown: Boolean(stored),
          browserBinding,
          metaError: metaError
            ? {
                error: metaError,
                reason: metaErrorReason,
                code: clip(single(query.error_code), 16),
                description: clip(single(query.error_description), 200),
              }
            : undefined,
        },
      },
      failedAt ? 'Meta OAuth callback refused' : 'Meta OAuth callback completed',
    );
    if (!stored) return;
    // A replayed callback is counted, but does not overwrite how the attempt itself ended.
    const keepResult = failedAt === 'state_replayed' && Boolean(stored.callbackResult);
    try {
      await OAuthState.updateOne(
        { _id: stored._id },
        {
          $set: {
            callbackAt: new Date(),
            ...(!keepResult && { callbackResult: result }),
            ...(metaError && {
              metaError: [metaError, metaErrorReason].filter(Boolean).join('/'),
            }),
          },
          $inc: { callbackCount: 1 },
        },
      );
    } catch (err) {
      logger.warn({ err, oauth: { attempt } }, 'Could not record OAuth callback diagnostics');
    }
  };

  const fail = async (reason, failedAt) => {
    await report(reason, failedAt);
    return {
      redirectUrl: resultUrl({
        status: 'error',
        reason,
        provider: providerSlug,
        workspace: workspaceSlug,
      }),
      cookieName,
    };
  };

  if (!state || state.length > 256) return fail(META_OAUTH_RESULTS.STATE_MISSING, 'state');
  const stateHash = sha256(state);
  attempt = oauthAttemptId(stateHash);
  cookieName = bindingCookieName(stateHash);

  stored = await OAuthState.findOne({ stateHash });
  if (!stored) return fail(META_OAUTH_RESULTS.STATE_INVALID, 'state');
  const workspace = await Workspace.findById(stored.workspace);
  if (!workspace) return fail(META_OAUTH_RESULTS.STATE_INVALID, 'state');
  workspaceSlug = workspace.slug;

  if (stored.consumedAt) return fail(META_OAUTH_RESULTS.STATE_ALREADY_USED, 'state_replayed');
  if (stored.expiresAt <= new Date())
    return fail(META_OAUTH_RESULTS.STATE_EXPIRED, 'state_expired');
  if (stored.provider !== provider) return fail(META_OAUTH_RESULTS.STATE_INVALID, 'state');

  const binding = single(cookies?.[cookieName]);
  browserBinding = !binding
    ? 'missing'
    : safeEqual(sha256(binding), stored.browserBindingHash)
      ? 'matched'
      : 'mismatched';
  if (browserBinding !== 'matched') {
    return fail(META_OAUTH_RESULTS.BROWSER_MISMATCH, 'browser_binding');
  }

  // Single use, even under concurrent callbacks.
  const claimed = await OAuthState.findOneAndUpdate(
    { _id: stored._id, consumedAt: null },
    { consumedAt: new Date() },
  );
  if (!claimed) return fail(META_OAUTH_RESULTS.STATE_ALREADY_USED, 'state_replayed');

  // The person's access may have changed while they were at Meta.
  const [user, membership] = await Promise.all([
    User.findById(stored.user),
    Membership.findOne({ workspace: workspace._id, user: stored.user }),
  ]);
  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !membership ||
    !hasPermission(membership.role, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)
  ) {
    return fail(META_OAUTH_RESULTS.FORBIDDEN, 'permission_recheck');
  }

  if (single(query.error)) {
    return fail(
      single(query.error) === 'access_denied'
        ? META_OAUTH_RESULTS.USER_CANCELLED
        : META_OAUTH_RESULTS.AUTHORIZATION_FAILED,
      'meta_authorization',
    );
  }
  const code = single(query.code);
  if (!code) return fail(META_OAUTH_RESULTS.CODE_MISSING, 'code');
  if (!isProviderConfigured(provider)) {
    return fail(META_OAUTH_RESULTS.NOT_CONFIGURED, 'configuration');
  }

  let identity;
  try {
    identity =
      provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN
        ? await authorizeFacebookIdentity(code)
        : await authorizeInstagramIdentity(code, instagramSettings().scopes);
  } catch (err) {
    if (err instanceof NotEligibleError) {
      return fail(META_OAUTH_RESULTS.NOT_ELIGIBLE, 'token_exchange');
    }
    if (err instanceof MetaApiError) {
      logger.warn(
        { meta: err.toLog(), provider, oauth: { attempt } },
        'Meta token exchange failed',
      );
      return fail(META_OAUTH_RESULTS.TOKEN_EXCHANGE_FAILED, 'token_exchange');
    }
    await report('UNEXPECTED_ERROR', 'internal');
    throw err;
  }

  let saved;
  try {
    saved = await saveAuthorizedConnection({
      workspace,
      user,
      identity,
      reconnectConnectionId: stored.purpose === OAUTH_PURPOSES.RECONNECT ? stored.connection : null,
      context,
    });
  } catch (err) {
    if (err instanceof IdentityMismatchError) {
      return fail(META_OAUTH_RESULTS.IDENTITY_MISMATCH, 'identity');
    }
    await report('UNEXPECTED_ERROR', 'internal');
    throw err;
  }

  const outcome = saved.isNew ? META_OAUTH_RESULTS.CONNECTED : META_OAUTH_RESULTS.RECONNECTED;
  await report(outcome);
  return {
    redirectUrl: resultUrl({
      status: 'success',
      reason: outcome,
      provider: providerSlug,
      workspace: workspaceSlug,
      connection: String(saved.connection._id),
    }),
    cookieName,
  };
}
