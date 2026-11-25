import {
  ANALYTICS_API_ERRORS,
  ANALYTICS_MODES,
  QUEUE_STATUS,
  sourceForMode,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { analyticsQueueStatus } from '../../queue/analyticsQueue.js';

/**
 * Analytics settings (config.analytics), read through here so tests can change them.
 *
 * Real Meta analytics are off unless the server operator sets ANALYTICS_MODE=live (default:
 * disabled). LIVE only reads insights (GET) with the stored tokens; without the insights
 * permissions (read_insights, instagram_manage_insights) a sync stops with PERMISSION_MISSING
 * and stores nothing (never 0), and LIVE figures are kept apart from simulated ones. The
 * Meta insights adapter is tested against a simulated Meta; it has not yet been run against a
 * real account with the insights permissions (docs/ANALYTICS.md).
 */
const DEFAULTS = Object.freeze({
  mode: ANALYTICS_MODES.DISABLED,
  inlineWorker: true,
  concurrency: 2,
  maxAttempts: 4,
  retryBaseMs: 60_000,
  retryMaxMs: 30 * 60_000,
  claimMs: 10 * 60_000,
  recoveryIntervalMs: 60_000,
});

let override;

export function analyticsSettings() {
  return override ?? { ...DEFAULTS, ...(config.analytics ?? {}) };
}

/** Pass a partial object (e.g. `{ mode: 'LIVE' }`); pass nothing to reset. */
export function setAnalyticsSettingsForTests(partial) {
  if (!config.isTest) throw new Error('Analytics settings can only be overridden in tests');
  override = partial ? { ...DEFAULTS, ...(config.analytics ?? {}), ...partial } : undefined;
}

const QUEUE_MESSAGES = {
  [QUEUE_STATUS.NOT_CONFIGURED]:
    'The analytics queue has not been set up on this server yet (REDIS_URL is not set).',
  [QUEUE_STATUS.CONNECTING]: 'The analytics queue is still connecting. Try again in a moment.',
  [QUEUE_STATUS.UNAVAILABLE]:
    'The analytics queue (Redis) cannot be reached right now. Nothing was started. Try again in a moment.',
};

export const queueMessage = (status) => QUEUE_MESSAGES[status] ?? null;

/** What the dashboard needs to know about syncing on this server. */
export function analyticsStatus() {
  const { mode } = analyticsSettings();
  const queue = analyticsQueueStatus();
  const disabled = mode === ANALYTICS_MODES.DISABLED;
  const reason = disabled
    ? ANALYTICS_API_ERRORS.ANALYTICS_DISABLED
    : queue !== QUEUE_STATUS.READY
      ? ANALYTICS_API_ERRORS.QUEUE_UNAVAILABLE
      : null;
  return {
    mode,
    /** Which insights a sync writes now: META (live), SIMULATED (demo) or none. */
    source: sourceForMode(mode),
    canSync: reason === null,
    reason,
    message: disabled
      ? 'Insights are not read from Meta on this server yet. Publishing figures from SocialHub are still shown.'
      : queueMessage(queue),
    queue: { status: queue },
  };
}
