import mongoose from 'mongoose';
import { FACEBOOK_GROUP_STATUS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * A Facebook Group in the workspace's sharing directory (Phase 6). Entered by people:
 * SocialHub never reads groups from Facebook. `urlKey` (the group id or vanity name,
 * lower-cased) keeps each group in a workspace's directory once.
 */
const facebookGroupSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    /** Canonical https://www.facebook.com/groups/<id-or-name>/ address. */
    url: { type: String, required: true },
    urlKey: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupCategory', default: null },
    /** Relevance tags, lower-case (e.g. "vegan", "london"). */
    tags: { type: [String], default: [] },
    /** Approximate member count as entered by a person (null: unknown). */
    memberCount: { type: Number, min: 0, default: null },
    /** The group's posting rules or anything the team should know. */
    notes: { type: String, trim: true },
    /** Minimum days between two shares in this group (null: no rule). */
    minDaysBetweenShares: { type: Number, min: 1, default: null },
    status: {
      type: String,
      enum: Object.values(FACEBOOK_GROUP_STATUS),
      default: FACEBOOK_GROUP_STATUS.ACTIVE,
    },
    /** When a sharing task for this group was last marked done (kept in step with tasks). */
    lastSharedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

facebookGroupSchema.index(
  { workspace: 1, urlKey: 1 },
  { unique: true, name: 'one_group_per_workspace' },
);
facebookGroupSchema.index({ workspace: 1, status: 1, name: 1 });
facebookGroupSchema.index({ workspace: 1, category: 1 });
facebookGroupSchema.index({ workspace: 1, tags: 1 });

jsonPlugin(facebookGroupSchema, { hidden: ['urlKey'] });

export const FacebookGroup =
  mongoose.models.FacebookGroup ?? mongoose.model('FacebookGroup', facebookGroupSchema);
