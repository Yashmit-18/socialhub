import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/**
 * Something to share in Facebook Groups (Phase 6): the text and an optional link a person
 * posts by hand. Each target group gets one SharingTask.
 */
const groupShareSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    link: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

groupShareSchema.index({ workspace: 1, _id: -1 });

jsonPlugin(groupShareSchema);

export const GroupShare =
  mongoose.models.GroupShare ?? mongoose.model('GroupShare', groupShareSchema);
