import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './db/mongoose.js';

async function main() {
  await connectDatabase(config.mongo.uri, { autoIndex: config.mongo.autoIndex });

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'SocialHub API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await disconnectDatabase().catch((err) => logger.error({ err }, 'Error closing MongoDB'));
      clearTimeout(forceExit);
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
