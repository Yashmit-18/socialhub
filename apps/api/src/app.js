import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { CLIENT_HEADER, QUEUE_STATUS } from '@socialhub/shared';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { databaseState } from './db/mongoose.js';
import { safeEqual } from './lib/crypto.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createApiLimiter, createAuthLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { authRouter, usersRouter } from './modules/auth/auth.routes.js';
import { invitationsRouter } from './modules/invitations/invitation.routes.js';
import { integrationsRouter, metaPublicRouter } from './modules/meta/meta.routes.js';
import { crossWorkspaceAccountsRouter } from './modules/socialAccounts/socialAccount.routes.js';
import { workspacesRouter } from './modules/workspaces/workspace.routes.js';
import { publishingSettings } from './modules/publishing/publishing.settings.js';
import { getPublishQueue, publishQueueStatus } from './queue/publishQueue.js';
import { getStorage } from './storage/index.js';

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = '0.1.0';

const SECRET_QUERY_PARAMS = /([?&](?:code|state|access_token|signed_request|token)=)[^&#]*/gi;

/**
 * Keeps bearer secrets out of access logs: invitation tokens in paths, and OAuth codes /
 * states / tokens in query strings (Meta's callback carries the authorization code).
 */
export function redactUrl(url = '') {
  return url
    .replace(/(\/invitations\/)(?![a-f\d]{24}(?:[/?]|$))[^/?]+/i, '$1[redacted]')
    .replace(SECRET_QUERY_PARAMS, '$1[redacted]');
}

/**
 * Monitoring details for the operator: server-wide queue counts and workers included, so it
 * is only answered with `Authorization: Bearer <HEALTH_DETAILS_TOKEN>`. Without the token
 * configured, or with a wrong one, the route answers like any unknown path (404).
 */
let healthTokenForTests;

/** Test hook: the HEALTH_DETAILS_TOKEN to use (pass undefined to go back to the setting). */
export function setHealthDetailsTokenForTests(token) {
  if (!config.isTest) throw new Error('setHealthDetailsTokenForTests is only available in tests');
  healthTokenForTests = token;
}

async function healthDetails(req, res, next) {
  const expected =
    healthTokenForTests === undefined ? config.healthDetailsToken : healthTokenForTests;
  const given = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
  if (!expected || !given || !safeEqual(given, expected)) return next();
  const db = databaseState();
  const queue = getPublishQueue();
  const queueStatus = publishQueueStatus();
  let counts = null;
  let workers = null;
  if (queue && queueStatus === QUEUE_STATUS.READY) {
    [counts, workers] = await Promise.all([
      queue.counts().catch(() => null),
      queue.workerCount().catch(() => null),
    ]);
  }
  const storage = getStorage();
  res.set('Cache-Control', 'no-store');
  return res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    database: db,
    publishing: { mode: publishingSettings().mode, queue: queueStatus, counts, workers },
    storage: { driver: storage?.name ?? null, publicUrls: Boolean(storage?.publicUrls) },
  });
}

function corsOptions() {
  return {
    origin(origin, callback) {
      // Same-origin and non-browser requests send no Origin header.
      callback(null, !origin || config.clientOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', CLIENT_HEADER, 'X-Request-Id'],
    // Content-Disposition carries the file name of CSV exports to a web app on another origin.
    exposedHeaders: [
      'X-Request-Id',
      'RateLimit',
      'RateLimit-Policy',
      'Retry-After',
      'Content-Disposition',
    ],
    maxAge: 600,
  };
}

function mountWebApp(app, distPath) {
  const resolved = path.resolve(apiDir, distPath);
  const indexFile = path.join(resolved, 'index.html');
  if (!existsSync(indexFile)) {
    logger.warn(
      { resolved },
      'SERVE_WEB_DIST is set but index.html was not found; web app not served',
    );
    return;
  }
  app.use(express.static(resolved, { index: false, maxAge: '1h' }));
  // SPA fallback for client-side routes (anything that is not an API call).
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(indexFile);
  });
  logger.info({ resolved }, 'Serving web app');
}

/**
 * Builds the Express application without binding a port, so tests can drive it with
 * supertest. `overrides.rateLimit` lets tests tighten limits.
 */
export function createApp(overrides = {}) {
  const rateLimit = { ...config.rateLimit, ...overrides.rateLimit };
  const app = express();
  const storage = getStorage();
  // Browsers upload media straight to object storage: allow that one origin, nothing else.
  const connectSrc = storage?.uploadOrigin
    ? { 'connect-src': ["'self'", storage.uploadOrigin] }
    : {};

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      // 502 / 503 are expected operational answers (a provider outage, storage or Meta not
      // configured): warnings, so real server errors stand out in the logs.
      customLogLevel: (_req, res, err) => {
        if (res.statusCode === 502 || res.statusCode === 503) return 'warn';
        return err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      },
      // Lean access logs; never include headers (cookies/tokens) or link tokens embedded in URLs.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Social profile pictures (Meta CDN) are rendered from https URLs. blob: URLs are
          // created by the page itself (local previews of files the user picked in the
          // composer); scripts stay limited to 'self', so nothing else can create them.
          'img-src': ["'self'", 'data:', 'https:', 'blob:'],
          'media-src': ["'self'", 'blob:', 'https:'],
          ...connectSrc,
          // Upgrading requests breaks plain-http local/staging hosts; enforce it in production only.
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
    }),
  );
  app.use('/api', cors(corsOptions()));
  // Drafts carry up to four long texts (63,206 characters each, 3–4 bytes per character in
  // many scripts), so they get a larger body limit than every other route.
  app.use(
    /^\/api\/v1\/workspaces\/[a-f\d]{24}\/content-packages(?:\/|$)/i,
    express.json({ limit: '1mb' }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const v1 = Router();
  // Public: only whether the API and its database are up (load balancers, uptime checks).
  // Versions, queues, workers and modes are on /health/details, for monitoring only.
  v1.get('/health', (_req, res) => {
    const db = databaseState();
    res.status(db === 'connected' ? 200 : 503).json({
      status: db === 'connected' ? 'ok' : 'degraded',
      database: db,
    });
  });
  v1.use(createApiLimiter({ perMinute: rateLimit.apiPerMinute }));
  v1.get('/health/details', healthDetails);
  v1.use(
    '/auth',
    authRouter({
      authLimiter: createAuthLimiter({ windowMs: rateLimit.authWindowMs, max: rateLimit.authMax }),
    }),
  );
  v1.use('/users', usersRouter());
  v1.use('/invitations', invitationsRouter());
  v1.use('/workspaces', workspacesRouter());
  v1.use('/integrations', integrationsRouter());
  v1.use('/social-accounts', crossWorkspaceAccountsRouter());
  // Upload target and file serving of the local-disk storage driver (development / tests).
  if (storage?.router) v1.use('/storage', storage.router());
  // OAuth callbacks and Meta platform callbacks (no SocialHub session; verified by state/signature).
  v1.use(metaPublicRouter());

  app.use('/api/v1', v1);
  app.use('/api', notFoundHandler);

  if (config.serveWebDist) mountWebApp(app, config.serveWebDist);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
