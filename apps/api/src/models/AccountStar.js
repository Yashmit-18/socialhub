import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/**
 * One person's star on one destination ("my important accounts"). Stars are private to the
 * person who set them; a star on a destination the person can no longer use is simply never
 * shown, because every read starts from the destinations the member may access.
 */
const accountStarSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    socialAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

accountStarSchema.index(
  { user: 1, socialAccount: 1 },
  { unique: true, name: 'one_star_per_person_and_account' },
);
accountStarSchema.index({ workspace: 1, socialAccount: 1 });

jsonPlugin(accountStarSchema);

export const AccountStar =
  mongoose.models.AccountStar ?? mongoose.model('AccountStar', accountStarSchema);
