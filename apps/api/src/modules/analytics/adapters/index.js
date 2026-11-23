import { ANALYTICS_SOURCES } from '@socialhub/shared';
import { metaInsightsAdapter } from './meta.js';
import { simulatedInsightsAdapter } from './simulated.js';

/**
 * Insights adapters. Every adapter offers
 *
 *   fetchAccountInsights({ account, connection, accessToken, days, today, attempt })
 *     → { days: [{ day, metrics }], unavailable: [metric keys] }
 *   fetchPostInsights({ account, connection, accessToken, posts })
 *     → { items: [{ postId, metrics }], failed }
 *
 * and throws an AnalyticsError on failure. A run's own source decides the adapter, so a
 * SIMULATED run can only ever produce SIMULATED data.
 */
export function insightsAdapterFor(source) {
  if (source === ANALYTICS_SOURCES.SIMULATED) return simulatedInsightsAdapter;
  if (source === ANALYTICS_SOURCES.META) return metaInsightsAdapter;
  return null;
}
