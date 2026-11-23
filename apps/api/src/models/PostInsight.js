import mongoose from 'mongoose';
import { ANALYTICS_SOURCES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { metricsSchema } from './insightMetrics.js';
import { jsonPlugin } from './plugins.js';

/**
 * Lifetime insights of one post that SocialHub published (one PublishDestination), from one
 * source, as of `fetchedAt`. META rows exist only for posts with a real post id from Meta;
 * SIMULATED rows only for simulated posts. Values are replaced on every sync.
 */
const postInsightSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    socialAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    publishDestination: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishDestination',
      required: true,
    },
    platform: { type: String, enum: Object.values(SOCIAL_PLATFORMS), required: true },
    source: { type: String, enum: Object.values(ANALYTICS_SOURCES), required: true },
    /** Meta's post id, for META rows only (never made up). */
    externalPostId: { type: String },
    metrics: { type: metricsSchema, default: () => ({}) },
    fetchedAt: { type: Date, required: true },
    syncRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalyticsSyncRun' },
  },
  { timestamps: true },
);

postInsightSchema.index(
  { publishDestination: 1, source: 1 },
  { unique: true, name: 'one_insight_per_post_and_source' },
);
postInsightSchema.index({ workspace: 1, source: 1, socialAccount: 1 });

jsonPlugin(postInsightSchema);

export const PostInsight =
  mongoose.models.PostInsight ?? mongoose.model('PostInsight', postInsightSchema);
