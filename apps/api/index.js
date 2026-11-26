/**
 * Entry point for running the API on Vercel (vercel.json, service "api"). On a server or the
 * PC, `node src/server.js` (npm start) is used instead.
 *
 * Vercel runs the API as a function, not as a long-running process, so this file:
 *  - connects to MongoDB once per function instance, before the first request is handled,
 *    and reuses that connection for later requests (a failed attempt is retried by the next);
 *  - never starts the publishing or analytics workers. Scheduled posts need a process that
 *    keeps running, so they run in their own always-on worker
 *    (scripts/publish-worker.js, the Render worker in render.yaml). Set
 *    PUBLISHING_WORKER_INLINE=false and ANALYTICS_WORKER_INLINE=false on Vercel;
 *  - exports the Express app (default export). Vercel sends every request under /api to it
 *    with its full path (/api/v1/...), which is what the routes expect.
 */
import { ERROR_CODES } from '@socialhub/shared';
import express from 'express';
import { createApp } from './src/app.js';
import { config } from './src/config/env.js';
import { logger } from './src/config/logger.js';
import { connectDatabase, databaseState } from './src/db/mongoose.js';

let connecting = null;

/** Resolves once MongoDB is connected; concurrent first requests share one attempt. */
export function ensureDatabase() {
  if (databaseState() === 'connected') return Promise.resolve();
  connecting ??= connectDatabase(config.mongo.uri, { autoIndex: config.mongo.autoIndex }).finally(
    () => {
      connecting = null;
    },
  );
  return connecting;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  ensureDatabase().then(
    () => next(),
    (err) => {
      // Never log the connection string (it holds the database password).
      const message = String(err?.message ?? err).replace(
        /mongodb(?:\+srv)?:\/\/\S+/gi,
        '[database URI]',
      );
      logger.error({ err: { name: err?.name, message } }, 'MongoDB not reachable');
      res.status(503).json({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'SocialHub cannot reach its database right now. Try again in a moment.',
        },
      });
    },
  );
});
app.use(createApp());

export default app;
