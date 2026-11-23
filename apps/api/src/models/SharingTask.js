import mongoose from 'mongoose';
import { SHARING_TASK_STATUS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * One manual share of a GroupShare in one Facebook Group (Phase 6). A person posts it on
 * Facebook and marks it done, optionally with the post's link. The unique (share, group)
 * index is the duplicate prevention: a share reaches each group at most once.
 */
const sharingTaskSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    share: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupShare', required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'FacebookGroup', required: true },
    status: {
      type: String,
      enum: Object.values(SHARING_TASK_STATUS),
      default: SHARING_TASK_STATUS.OPEN,
    },
    /** Who should post it (null: anyone who can complete sharing tasks). */
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dueAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    /** Link to the post in the group, when the person who shared it added one. */
    postUrl: { type: String, default: null },
    note: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

sharingTaskSchema.index(
  { share: 1, group: 1 },
  { unique: true, name: 'one_task_per_share_and_group' },
);
sharingTaskSchema.index({ workspace: 1, status: 1, _id: -1 });
sharingTaskSchema.index({ workspace: 1, assignee: 1, status: 1 });
sharingTaskSchema.index({ group: 1, status: 1, completedAt: -1 });

jsonPlugin(sharingTaskSchema);

export const SharingTask =
  mongoose.models.SharingTask ?? mongoose.model('SharingTask', sharingTaskSchema);
