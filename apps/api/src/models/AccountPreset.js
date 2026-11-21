import mongoose from 'mongoose';
import { jsonPlugin } from './plugins.js';

/** A named set of social accounts that composers in one workspace reuse. */
const accountPresetSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    /** Lower-cased name: presets are unique per workspace regardless of case. */
    nameKey: { type: String, required: true },
    socialAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

accountPresetSchema.index(
  { workspace: 1, nameKey: 1 },
  { unique: true, name: 'one_preset_name_per_workspace' },
);

jsonPlugin(accountPresetSchema, { hidden: ['nameKey'] });

export const AccountPreset =
  mongoose.models.AccountPreset ?? mongoose.model('AccountPreset', accountPresetSchema);
