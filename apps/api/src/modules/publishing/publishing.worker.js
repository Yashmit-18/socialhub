import { PUBLISHING_MODES, QUEUE_STATUS } from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { getPublishQueue } from '../../queue/publishQueue.js';
import { processDestination, recoverPublishing } from './publishing.processor.js';
import { publishingSettings } from './publishing.settings.js';

/** How often the recovery sweep runs while a worker is alive. */
export const RECOVERY_INTERVAL_MS = 60 * 1000;

/**
 * Starts the publish worker in this process: it takes destination ids from the queue and
 * processes them, and runs the recovery sweep every minute.
 *
 * Returns null (and says why in the log) when there is nothing to start: publishing is
 * switched off, or REDIS_URL is not set. It never falls back to an in-memory queue.
 */
export function startPublishWorker() {
  const settings = publishingSettings();
  if (settings.mode === PUBLISHING_MODES.DISABLED) {
    logger.info('Publishing is switched off (PUBLISHING_MODE); the publish worker was not started');
    return null;
  }
  const queue = getPublishQueue();
  if (!queue) {
    logger.warn(
      'REDIS_URL is not set: the publishing queue is unavailable and the publish worker was not started',
    );
    return null;
  }

  const worker = queue.startWorker((destinationId) => processDestination(destinationId), {
    concurrency: settings.concurrency,
  });
  let sweeping = false;
  const sweep = async () => {
    if (sweeping || queue.status() !== QUEUE_STATUS.READY) return;
    sweeping = true;
    try {
      const result = await recoverPublishing();
      if (Object.values(result).some(Boolean)) logger.info(result, 'Publishing recovery sweep');
    } catch (err) {
      logger.error({ err }, 'Publishing recovery sweep failed');
    } finally {
      sweeping = false;
    }
  };
  const timer = setInterval(sweep, settings.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS);
  timer.unref();
  // Shortly after start, once the connection is up.
  setTimeout(sweep, 3000).unref();

  logger.info(
    { mode: settings.mode, concurrency: settings.concurrency },
    settings.mode === PUBLISHING_MODES.SIMULATED
      ? 'Publish worker started in SIMULATION mode: nothing is sent to Meta'
      : 'Publish worker started',
  );
  return {
    isRunning: () => worker.isRunning(),
    async close() {
      clearInterval(timer);
      await worker.close();
    },
  };
}
