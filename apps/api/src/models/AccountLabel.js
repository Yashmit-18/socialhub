import mongoose from 'mongoose';
import { LABEL_COLORS } from '@socialhub/shared';
import { jsonPlugin } from './plugins.js';

/**
 * A workspace label (a client, brand, region…) that destinations carry in
 * SocialAccount.labels. Names are unique per workspace regardless of case.
 */
const accountLabelSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    /** Lower-cased name, for the uniqueness rule. */
    nameKey: { type: String, required: true },
    color: { type: String, enum: LABEL_COLORS, default: 'slate' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

accountLabelSchema.index(
  { workspace: 1, nameKey: 1 },
  { unique: true, name: 'one_label_name_per_workspace' },
);

jsonPlugin(accountLabelSchema, { hidden: ['nameKey'] });

export const AccountLabel =
  mongoose.models.AccountLabel ?? mongoose.model('AccountLabel', accountLabelSchema);
