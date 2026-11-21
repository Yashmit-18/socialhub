import mongoose from 'mongoose';
import { CONTENT_PACKAGE_STATUS, HASHTAG_PLACEMENTS, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * The content of one post, independent of where and when it is published. In status DRAFT it
 * is a composer draft and also remembers the intended destinations (`targetAccounts`) and
 * per-platform captions, so it can be reopened exactly as it was left.
 *
 * `version` increases on every successful save and is the optimistic-concurrency token:
 * an update must name the version it was based on.
 */
const contentPackageSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    status: {
      type: String,
      enum: Object.values(CONTENT_PACKAGE_STATUS),
      default: CONTENT_PACKAGE_STATUS.DRAFT,
    },
    version: { type: Number, default: 1, min: 1 },
    caption: { type: String, default: '' },
    /** Only customized platforms are present; an absent platform uses `caption`. */
    platformCaptions: {
      type: new mongoose.Schema(
        {
          [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: { type: String },
          [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: { type: String },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    hashtags: { type: [String], default: [] },
    hashtagPlacement: {
      type: String,
      enum: Object.values(HASHTAG_PLACEMENTS),
      default: HASHTAG_PLACEMENTS.CAPTION,
    },
    /** Internal SEO keywords. Never published. */
    keywords: { type: [String], default: [] },
    firstComment: { type: String, default: '' },
    /** Ordered; the first item is the cover. */
    media: {
      type: [
        new mongoose.Schema(
          {
            media: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
            altText: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    targetAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Last time an "updated" activity entry was written (autosaves are not logged one by one). */
    updateLoggedAt: { type: Date },
  },
  { timestamps: true },
);

// Draft list: newest first, stable paging.
contentPackageSchema.index({ workspace: 1, status: 1, updatedAt: -1, _id: -1 });
// "Is this file still used?" (media deletion and clean-up).
contentPackageSchema.index({ 'media.media': 1 });

jsonPlugin(contentPackageSchema);

export const ContentPackage =
  mongoose.models.ContentPackage ?? mongoose.model('ContentPackage', contentPackageSchema);
