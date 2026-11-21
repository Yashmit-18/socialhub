import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS, PERMISSIONS, hasPermission } from '@socialhub/shared';
import {
  conflict,
  forbidden,
  isDuplicateKeyError,
  notFound,
  validationError,
} from '../../lib/errors.js';
import { AccountPreset, SocialAccount } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { accessibleAccountFilter } from '../socialAccounts/socialAccount.service.js';

/**
 * Workspace account presets (docs/COMPOSER_API_CONTRACT.md §6): named sets of social
 * accounts. A preset can only be created from accounts its author can use, and readers only
 * ever see the accounts they can use themselves.
 */

async function accessibleAmong(membership, candidates) {
  if (candidates.length === 0) return new Set();
  const rows = await SocialAccount.find({
    $and: [accessibleAccountFilter(membership), { _id: { $in: candidates } }],
  }).select('_id');
  return new Set(rows.map((row) => String(row._id)));
}

function view(preset, visible) {
  return {
    id: String(preset._id),
    name: preset.name,
    socialAccountIds: preset.socialAccounts.map(String).filter((id) => visible.has(id)),
    createdBy: preset.createdBy?._id
      ? { id: String(preset.createdBy._id), name: preset.createdBy.name }
      : null,
    createdAt: preset.createdAt,
  };
}

export async function listPresets(workspace, membership) {
  const presets = await AccountPreset.find({ workspace: workspace._id })
    .sort({ nameKey: 1 })
    .populate('createdBy', 'name');
  const all = [...new Set(presets.flatMap((p) => p.socialAccounts.map(String)))];
  const visible = await accessibleAmong(membership, all);
  return { items: presets.map((preset) => view(preset, visible)) };
}

export async function createPreset(
  workspace,
  membership,
  actor,
  { name, socialAccountIds },
  context,
) {
  const allowed = await accessibleAmong(membership, socialAccountIds);
  if (socialAccountIds.some((id) => !allowed.has(id.toLowerCase()))) {
    throw validationError({
      fields: {
        socialAccountIds:
          'One or more selected accounts are not available to you in this workspace',
      },
    });
  }
  let preset;
  try {
    preset = await AccountPreset.create({
      workspace: workspace._id,
      name,
      nameKey: name.toLowerCase(),
      socialAccounts: socialAccountIds,
      createdBy: actor._id,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    throw conflict(`A preset called “${name}” already exists. Choose a different name.`, {
      fields: { name: 'A preset with this name already exists' },
    });
  }
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.ACCOUNT_PRESET_CREATED,
    target: { type: 'account_preset', id: preset._id, label: preset.name },
    metadata: { accountCount: socialAccountIds.length },
    context,
  });
  await preset.populate('createdBy', 'name');
  return { preset: view(preset, allowed) };
}

export async function deletePreset(workspace, membership, actor, presetId, context) {
  const preset = mongoose.isValidObjectId(presetId)
    ? await AccountPreset.findOne({ _id: presetId, workspace: workspace._id })
    : null;
  if (!preset) throw notFound('Preset not found');
  const own = String(preset.createdBy) === String(actor._id);
  if (!own && !hasPermission(membership.role, PERMISSIONS.MEMBERS_MANAGE)) {
    throw forbidden('Only the person who created this preset, or an admin, can delete it.');
  }
  await AccountPreset.deleteOne({ _id: preset._id });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.ACCOUNT_PRESET_DELETED,
    target: { type: 'account_preset', id: preset._id, label: preset.name },
    context,
  });
}
