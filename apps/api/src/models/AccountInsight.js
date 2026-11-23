import mongoose from 'mongoose';
import { ANALYTICS_SOURCES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { metricsSchema } from './insightMetrics.js';
import { jsonPlugin } from './plugins.js';

/**
 * One day of insights for one Facebook Page or Instagram account, from one source.
 *
 * `day` is the reporting day as the platform states it (YYYY-MM-DD). META rows were read
 * from Meta's official Graph API; SIMULATED rows were made by the development adapter and
 * are only ever shown labelled as demo data. The two never share a row.
 */
const accountInsightSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    socialAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    platform: { type: String, enum: Object.values(SOCIAL_PLATFORMS), required: true },
    source: { type: String, enum: Object.values(ANALYTICS_SOURCES), required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    metrics: { type: metricsSchema, default: () => ({}) },
    fetchedAt: { type: Date, required: true },
    syncRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalyticsSyncRun' },
  },
  { timestamps: true },
);

// One row per account, source and day: a re-sync updates it instead of adding a duplicate.
accountInsightSchema.index(
  { socialAccount: 1, source: 1, day: 1 },
  { unique: true, name: 'one_insight_per_account_source_day' },
);
// Dashboards: a workspace's rows of one source over a range of days.
accountInsightSchema.index({ workspace: 1, source: 1, day: 1 });

jsonPlugin(accountInsightSchema);

export const AccountInsight =
  mongoose.models.AccountInsight ?? mongoose.model('AccountInsight', accountInsightSchema);
