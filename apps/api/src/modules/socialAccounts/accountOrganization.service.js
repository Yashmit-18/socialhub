/**
 * Account organisation inside a workspace: labels (coloured tags such as a client, brand or
 * region), per-person stars and team notes. All of it is SocialHub data only; nothing here
 * calls Meta.
 *
 * Every read and write about destinations starts from accessibleAccountFilter(), so a member
 * never learns about, labels or stars a destination they may not use (answered as 404).
 */
import mongoose from 'mongoose';
import { ACCOUNT_LABEL_LIMITS, ACTIVITY_ACTIONS } from '@socialhub/shared';
import { conflict, isDuplicateKeyError, notFound, validationError } from '../../lib/errors.js';
import { AccountLabel, AccountStar, SocialAccount } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { accessibleAccountFilter } from './socialAccount.service.js';

const id = (v) => String(v?._id ?? v);
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** API view of a label; `accountCount` counts only destinations the member can use. */
export function labelView(label, accountCount) {
  const view = { id: id(label), name: label.name, color: label.color ?? 'slate' };
  if (accountCount !== undefined) view.accountCount = accountCount;
  return view;
}

/** Labels carried by a destination whose `labels` path was populated, sorted by name. */
export function accountLabels(account) {
  if (!account.populated?.('labels')) return [];
  return (account.labels ?? [])
    .filter((label) => label && label.name)
    .map((label) => labelView(label))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/* ------------------------------------------------------------------------- labels */

function duplicateName(name) {
  return conflict(`A label called “${name}” already exists. Choose a different name.`, {
    fields: { name: 'A label with this name already exists' },
  });
}

async function findLabel(workspace, labelId) {
  const label = mongoose.isValidObjectId(labelId)
    ? await AccountLabel.findOne({ _id: labelId, workspace: workspace._id })
    : null;
  if (!label) throw notFound('Label not found');
  return label;
}

/** Every label of the workspace with how many of the member's visible destinations carry it. */
export async function listLabels(workspace, membership) {
  const [labels, counts] = await Promise.all([
    AccountLabel.find({ workspace: workspace._id }).sort({ nameKey: 1 }),
    SocialAccount.aggregate([
      { $match: accessibleAccountFilter(membership) },
      { $unwind: '$labels' },
      { $group: { _id: '$labels', count: { $sum: 1 } } },
    ]),
  ]);
  const byLabel = new Map(counts.map((row) => [id(row._id), row.count]));
  return {
    items: labels.map((label) => labelView(label, byLabel.get(id(label)) ?? 0)),
    limit: ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX,
  };
}

export async function createLabel(workspace, actor, { name, color }, context) {
  const existing = await AccountLabel.countDocuments({ workspace: workspace._id });
  if (existing >= ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX) {
    throw conflict(
      `A workspace can have up to ${ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX} labels. Delete one you no longer use first.`,
    );
  }
  let label;
  try {
    label = await AccountLabel.create({
      workspace: workspace._id,
      name,
      nameKey: name.toLowerCase(),
      color,
      createdBy: actor._id,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    throw duplicateName(name);
  }
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.ACCOUNT_LABEL_CREATED,
    target: { type: 'account_label', id: label._id, label: label.name },
    metadata: { color: label.color },
    context,
  });
  return { label: labelView(label, 0) };
}

export async function updateLabel(workspace, membership, actor, labelId, patch, context) {
  const label = await findLabel(workspace, labelId);
  const before = { name: label.name, color: label.color };
  if (patch.name !== undefined) {
    label.name = patch.name;
    label.nameKey = patch.name.toLowerCase();
  }
  if (patch.color !== undefined) label.color = patch.color;
  const changed = label.name !== before.name || label.color !== before.color;
  if (changed) {
    try {
      await label.save();
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      throw duplicateName(patch.name);
    }
    const metadata = {};
    if (label.name !== before.name) metadata.name = { from: before.name, to: label.name };
    if (label.color !== before.color) metadata.color = { from: before.color, to: label.color };
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.ACCOUNT_LABEL_UPDATED,
      target: { type: 'account_label', id: label._id, label: label.name },
      metadata,
      context,
    });
  }
  const accountCount = await SocialAccount.countDocuments({
    $and: [accessibleAccountFilter(membership), { labels: label._id }],
  });
  return { label: labelView(label, accountCount) };
}

/** Deletes a label and takes it off every destination of the workspace. */
export async function deleteLabel(workspace, actor, labelId, context) {
  const label = await findLabel(workspace, labelId);
  const { modifiedCount } = await SocialAccount.updateMany(
    { workspace: workspace._id, labels: label._id },
    { $pull: { labels: label._id } },
  );
  await AccountLabel.deleteOne({ _id: label._id });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.ACCOUNT_LABEL_DELETED,
    target: { type: 'account_label', id: label._id, label: label.name },
    metadata: { removedFromAccounts: modifiedCount },
    context,
  });
  return { removedFromAccounts: modifiedCount };
}

/**
 * Adds and removes labels on several destinations. Every label must belong to the workspace
 * (422 otherwise) and every destination must be one the member can use (404 otherwise, as if
 * it did not exist). Nothing is written unless the whole request is valid, including the
 * per-destination label limit. One activity entry is recorded per destination that changed.
 */
export async function assignLabels(workspace, membership, actor, body, context) {
  const accountIds = [...new Set(body.accountIds.map((v) => v.toLowerCase()))];
  const add = [...new Set(body.add.map((v) => v.toLowerCase()))];
  const remove = [...new Set(body.remove.map((v) => v.toLowerCase()))];

  const labelIds = [...add, ...remove];
  const labels = await AccountLabel.find({ workspace: workspace._id, _id: { $in: labelIds } });
  if (labels.length !== labelIds.length) {
    throw validationError({
      fields: { labels: 'One or more labels no longer exist. Reload and try again.' },
    });
  }
  const labelById = new Map(labels.map((label) => [id(label), label]));

  const accounts = await SocialAccount.find({
    $and: [accessibleAccountFilter(membership), { _id: { $in: accountIds } }],
  }).select('name platform labels');
  if (accounts.length !== accountIds.length) throw notFound('Social account not found');

  const removeSet = new Set(remove);
  const plan = accounts.map((account) => {
    const before = (account.labels ?? []).map(id);
    const after = [...new Set([...before.filter((l) => !removeSet.has(l)), ...add])];
    const added = after.filter((l) => !before.includes(l));
    const removed = before.filter((l) => !after.includes(l));
    return { account, after, added, removed };
  });
  const overLimit = plan.filter((p) => p.after.length > ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX);
  if (overLimit.length > 0) {
    throw validationError({
      fields: {
        add: `${overLimit[0].account.name} would have more than ${ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX} labels. Remove some first.`,
      },
    });
  }

  const changed = plan.filter((p) => p.added.length + p.removed.length > 0);
  if (changed.length > 0) {
    const ids = changed.map((p) => p.account._id);
    const toObjectIds = (list) => list.map((l) => new mongoose.Types.ObjectId(l));
    // $pull and $addToSet cannot touch the same path in one update: removals go first.
    if (remove.length > 0) {
      await SocialAccount.updateMany(
        { _id: { $in: ids } },
        { $pull: { labels: { $in: toObjectIds(remove) } } },
      );
    }
    if (add.length > 0) {
      await SocialAccount.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { labels: { $each: toObjectIds(add) } } },
      );
    }
    const names = (list) => list.map((l) => labelById.get(l)?.name).filter(Boolean);
    for (const p of changed) {
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_LABELS_UPDATED,
        target: { type: 'social_account', id: p.account._id, label: p.account.name },
        metadata: { added: names(p.added), removed: names(p.removed) },
        context,
      });
    }
  }

  const updated = await SocialAccount.find({ _id: { $in: accountIds } })
    .select('labels')
    .populate('labels', 'name color');
  return {
    updated: changed.length,
    accounts: updated.map((account) => ({ id: id(account), labels: accountLabels(account) })),
  };
}

/* -------------------------------------------------------------------------- stars */

/** Ids (strings) of the destinations among `accountIds` that `userId` starred. */
export async function starredAmong(userId, accountIds) {
  if (!userId || accountIds.length === 0) return new Set();
  const stars = await AccountStar.find({
    user: userId,
    socialAccount: { $in: accountIds },
  }).select('socialAccount');
  return new Set(stars.map((star) => id(star.socialAccount)));
}

/** Stars or un-stars a destination for the requesting person only (idempotent). */
export async function setStar(workspace, user, account, starred) {
  if (starred) {
    await AccountStar.updateOne(
      { user: user._id, socialAccount: account._id },
      { $setOnInsert: { workspace: workspace._id, user: user._id, socialAccount: account._id } },
      { upsert: true },
    ).catch((err) => {
      // Two simultaneous stars: the other request already created it.
      if (!isDuplicateKeyError(err)) throw err;
    });
  } else {
    await AccountStar.deleteOne({ user: user._id, socialAccount: account._id });
  }
  return { starred };
}

/* -------------------------------------------------------------------------- notes */

/** The notes block of the destination detail. */
export function notesView(account) {
  if (!account.notes) return { text: '', updatedAt: null, updatedBy: null };
  const by = account.notesUpdatedBy;
  return {
    text: account.notes,
    updatedAt: account.notesUpdatedAt ?? null,
    updatedBy: by?._id ? { id: id(by), name: by.name } : null,
  };
}

/** Replaces the team notes of one destination; an empty string clears them. */
export async function setNotes(workspace, actor, account, notes, context) {
  const text = notes.trim();
  if ((account.notes ?? '') !== text) {
    await SocialAccount.updateOne(
      { _id: account._id },
      text
        ? { $set: { notes: text, notesUpdatedAt: new Date(), notesUpdatedBy: actor._id } }
        : { $unset: { notes: 1, notesUpdatedAt: 1, notesUpdatedBy: 1 } },
    );
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_NOTES_UPDATED,
      target: { type: 'social_account', id: account._id, label: account.name },
      // The text itself stays on the account; the audit trail only says what happened.
      metadata: { cleared: !text, length: text.length },
      context,
    });
  }
  const fresh = await SocialAccount.findById(account._id)
    .select('notes notesUpdatedAt notesUpdatedBy')
    .populate('notesUpdatedBy', 'name');
  if (!fresh) throw notFound('Social account not found');
  return { notes: notesView(fresh) };
}
