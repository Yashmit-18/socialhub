import mongoose from 'mongoose';
import { METRIC_KEYS } from '@socialhub/shared';

/**
 * Normalized metric values (packages/shared ANALYTICS_METRICS). Every field is optional: a
 * metric the platform did not report is ABSENT, which the API returns as null and the web app
 * shows as "unavailable". 0 is only ever stored when the platform reported 0.
 */
export const metricsSchema = new mongoose.Schema(
  Object.fromEntries(METRIC_KEYS.map((key) => [key, { type: Number, min: 0 }])),
  { _id: false },
);

/** Keeps only finite, non-negative numbers for known metrics (provider data is not trusted). */
export function cleanMetrics(input) {
  const out = {};
  for (const key of METRIC_KEYS) {
    const value = input?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}
