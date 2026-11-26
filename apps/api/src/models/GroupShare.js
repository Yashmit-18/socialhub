import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/**
 * Something to share in Facebook Groups (Phase 6): the text and an optional link a person
 * posts by hand. Each target group gets one SharingTask.
 *
 * An auto share belongs to a real post (`publishJob`, at most one share per post): its tasks
 * are created as the post goes live on each Facebook Page, one per group that Page is a member
 * of. Its text is the post's Facebook caption, which may be empty for a photo-only post.
 */
const skippedGroupSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'FacebookGroup', required: true },
    name: { type: String, required: true },
    reason: { type: String, required: true },
    nextShareAllowedAt: { type: Date, default: null },
  },
  { _id: false },
);

const groupShareSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    title: { type: String, required: true, trim: true },
    // Required for shares people write; an auto share copies the post's caption, maybe empty.
    message: {
      type: String,
      default: '',
      required: [
        function messageRequired() {
          return !this.publishJob;
        },
        'Text is required',
      ],
    },
    link: { type: String },
    /** The real post this share was created from (auto share). */
    publishJob: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishJob', default: undefined },
    /**
     * Auto share: the post's topics (relevance keys of its hashtags and keywords). A group with
     * relevance tags gets a task only when one matches; untagged groups get every post. Unset
     * on shares written by hand and on auto shares made before relevance existed: those reach
     * every member group.
     */
    topics: { type: [String], default: undefined },
    /** Groups an auto share could not reach (e.g. shared there too recently), with the reason. */
    skipped: { type: [skippedGroupSchema], default: undefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

groupShareSchema.index({ workspace: 1, _id: -1 });
groupShareSchema.index(
  { publishJob: 1 },
  {
    unique: true,
    partialFilterExpression: { publishJob: { $exists: true } },
    name: 'one_share_per_post',
  },
);

jsonPlugin(groupShareSchema);

export const GroupShare =
  mongoose.models.GroupShare ?? mongoose.model('GroupShare', groupShareSchema);
