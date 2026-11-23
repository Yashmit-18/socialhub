import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './db/mongoose.js';
import { startPublishWorker } from './modules/publishing/publishing.worker.js';
import { WORKER_DRAIN_MS, closePublishQueue, getPublishQueue } from './queue/publishQueue.js';

async function main() {
  await connectDatabase(config.mongo.uri, { autoIndex: config.mongo.autoIndex });

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'SocialHub API listening');
  });

  // Connects to Redis when REDIS_URL is set; the API starts either way and reports the
  // queue's state on /health and on the publishing screen.
  getPublishQueue();
  const publishWorker = config.publishing.inlineWorker ? startPublishWorker() : null;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    // Later than the workers' own limit, so a post being published can finish first.
    const forceExit = setTimeout(() => process.exit(1), WORKER_DRAIN_MS + 10_000).unref();
    // At once and side by side: the HTTP server stops taking requests, and both workers stop
    // taking queue entries and finish the ones in hand (up to WORKER_DRAIN_MS).
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      publishWorker?.close().catch((err) => logger.error({ err }, 'Error stopping worker')),
    ]);
    await closePublishQueue().catch(() => {});
    await disconnectDatabase().catch((err) => logger.error({ err }, 'Error closing MongoDB'));
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Windows has no SIGTERM: a process manager asks for a clean stop with this message.
  process.on('message', (message) => {
    if (message === 'shutdown') shutdown('shutdown message');
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
