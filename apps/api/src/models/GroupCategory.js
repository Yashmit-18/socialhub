import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/** A category of the workspace's Facebook Group directory (e.g. "Local", "Food lovers"). */
const groupCategorySchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    /** Lower-cased name: categories are unique per workspace regardless of case. */
    nameKey: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

groupCategorySchema.index(
  { workspace: 1, nameKey: 1 },
  { unique: true, name: 'one_category_name_per_workspace' },
);

jsonPlugin(groupCategorySchema, { hidden: ['nameKey'] });

export const GroupCategory =
  mongoose.models.GroupCategory ?? mongoose.model('GroupCategory', groupCategorySchema);
