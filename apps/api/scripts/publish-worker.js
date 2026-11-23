/**
 * Runs the publish worker as its own process.
 *
 *   npm run worker -w @socialhub/api
 *
 * Use it together with PUBLISHING_WORKER_INLINE=false on the API, so publishing keeps going
 * while the API restarts. By default the API runs the worker itself and this is not needed.
 */
import { config } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { startAnalyticsWorker } from '../src/modules/analytics/analytics.worker.js';
import { startPublishWorker } from '../src/modules/publishing/publishing.worker.js';
import { closeAnalyticsQueue } from '../src/queue/analyticsQueue.js';
import { WORKER_DRAIN_MS, closePublishQueue } from '../src/queue/publishQueue.js';

await connectDatabase(config.mongo.uri, { autoIndex: false });
const worker = startPublishWorker();
// The analytics worker runs here too when ANALYTICS_WORKER_INLINE=false on the API.
const analyticsWorker = config.analytics.inlineWorker ? null : startAnalyticsWorker();
if (!worker && !analyticsWorker) {
  await disconnectDatabase();
  process.exit(2);
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Stopping publish worker');
  // Later than the workers' own limit, so a post being published can finish first.
  setTimeout(() => process.exit(1), WORKER_DRAIN_MS + 10_000).unref();
  // Both stop taking entries at once and finish the ones in hand before Redis and MongoDB
  // are closed.
  await Promise.all([worker?.close().catch(() => {}), analyticsWorker?.close().catch(() => {})]);
  await closePublishQueue().catch(() => {});
  await closeAnalyticsQueue().catch(() => {});
  await disconnectDatabase().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Windows has no SIGTERM. Process managers (pm2, a parent process) ask for a clean stop by
// sending the message "shutdown" instead.
process.on('message', (message) => {
  if (message === 'shutdown') stop('shutdown message');
});
