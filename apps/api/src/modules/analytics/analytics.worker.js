import { ANALYTICS_MODES, QUEUE_STATUS } from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { getAnalyticsQueue } from '../../queue/analyticsQueue.js';
import { processSyncRun, recoverAnalyticsSync } from './analyticsSync.processor.js';
import { analyticsSettings } from './analytics.settings.js';

/**
 * Starts the analytics worker in this process: it takes sync-run ids from the analytics queue
 * (separate from the publishing queue, so it never holds up publishing) and runs the recovery
 * sweep every minute. Returns null (and says why) when analytics are off or Redis is not set.
 * It never falls back to an in-memory queue.
 */
export function startAnalyticsWorker() {
  const settings = analyticsSettings();
  if (settings.mode === ANALYTICS_MODES.DISABLED) {
    logger.info(
      'Analytics sync is switched off (ANALYTICS_MODE); the analytics worker was not started',
    );
    return null;
  }
  const queue = getAnalyticsQueue();
  if (!queue) {
    logger.warn('REDIS_URL is not set: the analytics worker was not started');
    return null;
  }
  const worker = queue.startWorker((runId) => processSyncRun(runId), {
    concurrency: settings.concurrency,
  });
  let sweeping = false;
  const sweep = async () => {
    if (sweeping || queue.status() !== QUEUE_STATUS.READY) return;
    sweeping = true;
    try {
      const result = await recoverAnalyticsSync();
      if (result.requeued || result.interrupted) logger.info(result, 'Analytics recovery sweep');
    } catch (err) {
      logger.error({ err }, 'Analytics recovery sweep failed');
    } finally {
      sweeping = false;
    }
  };
  const timer = setInterval(sweep, settings.recoveryIntervalMs);
  timer.unref();
  setTimeout(sweep, 3000).unref();
  logger.info(
    { mode: settings.mode, concurrency: settings.concurrency },
    settings.mode === ANALYTICS_MODES.SIMULATED
      ? 'Analytics worker started in SIMULATION mode: demo insights only, nothing is read from Meta'
      : 'Analytics worker started',
  );
  return {
    isRunning: () => worker.isRunning(),
    async close() {
      clearInterval(timer);
      await worker.close();
    },
  };
}
