/**
 * Facebook Group directory (Phase 6): groups entered by people, their categories, relevance
 * tags and the workspace's Facebook Pages that are members of them. SocialHub never reads,
 * joins or posts to groups on Facebook.
 */
import mongoose from 'mongoose';
import {
  ACTIVITY_ACTIONS,
  GROUP_LIMITS,
  SHARING_TASK_STATUS,
  SOCIAL_PLATFORMS,
  groupNameFromUrl,
  parseFacebookGroupUrl,
} from '@socialhub/shared';
import { conflict, isDuplicateKeyError, notFound, validationError } from '../../lib/errors.js';
import { FacebookGroup, GroupCategory, SharingTask, SocialAccount } from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';

const DAY_MS = 86_400_000;
const id = (v) => String(v?._id ?? v);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const person = (user) => (user?._id ? { id: id(user), name: user.name } : null);

/* -------------------------------------------------------------------------- views */

export function categoryView(category, groupCount) {
  const view = { id: id(category), name: category.name };
  if (groupCount !== undefined) view.groupCount = groupCount;
  return view;
}

/** When the group's "days between shares" rule next allows a share (null: no wait). */
export function nextShareAllowedAt(group, now = new Date()) {
  if (!group.minDaysBetweenShares || !group.lastSharedAt) return null;
  const next = new Date(
    new Date(group.lastSharedAt).getTime() + group.minDaysBetweenShares * DAY_MS,
  );
  return next > now ? next : null;
}

export function groupView(group, { categories, now = new Date() } = {}) {
  const categoryId = group.category ? id(group.category) : null;
  const category = categoryId
    ? (categories?.get(categoryId) ?? (group.category?.name ? group.category : null))
    : null;
  return {
    id: id(group),
    name: group.name,
    url: group.url,
    category: category ? { id: categoryId, name: category.name } : null,
    tags: group.tags ?? [],
    memberCount: group.memberCount ?? null,
    notes: group.notes ?? '',
    minDaysBetweenShares: group.minDaysBetweenShares ?? null,
    status: group.status,
    lastSharedAt: group.lastSharedAt ?? null,
    nextShareAllowedAt: nextShareAllowedAt(group, now),
    // Populated Pages only: a Page removed from the workspace drops out of the list.
    pages: (group.pages ?? [])
      .filter((page) => page?._id)
      .map((page) => ({ id: id(page), name: page.name })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/** Populates a group's Pages (names only); anything that is not a Facebook Page drops out. */
export const GROUP_PAGES = {
  path: 'pages',
  select: 'name',
  match: { platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE },
};

async function categoryMap(workspaceId) {
  const categories = await GroupCategory.find({ workspace: workspaceId });
  return new Map(categories.map((c) => [id(c), c]));
}

/* --------------------------------------------------------------------- categories */

export async function listCategories(workspace) {
  const [categories, counts] = await Promise.all([
    GroupCategory.find({ workspace: workspace._id }).sort({ nameKey: 1 }),
    FacebookGroup.aggregate([
      { $match: { workspace: workspace._id, category: { $ne: null } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);
  const byCategory = new Map(counts.map((row) => [id(row._id), row.count]));
  return { items: categories.map((c) => categoryView(c, byCategory.get(id(c)) ?? 0)) };
}

const duplicateCategory = (name) =>
  conflict(`A category called “${name}” already exists.`, {
    fields: { name: 'A category with this name already exists' },
  });

export async function createCategory(workspace, actor, { name }) {
  if (
    (await GroupCategory.countDocuments({ workspace: workspace._id })) >=
    GROUP_LIMITS.CATEGORIES_MAX
  ) {
    throw conflict(`A workspace can have up to ${GROUP_LIMITS.CATEGORIES_MAX} group categories.`);
  }
  try {
    const category = await GroupCategory.create({
      workspace: workspace._id,
      name,
      nameKey: name.toLowerCase(),
      createdBy: actor._id,
    });
    return { category: categoryView(category, 0) };
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicateCategory(name);
    throw err;
  }
}

async function findCategory(workspace, categoryId) {
  const category = mongoose.isValidObjectId(categoryId)
    ? await GroupCategory.findOne({ _id: categoryId, workspace: workspace._id })
    : null;
  if (!category) throw notFound('Category not found');
  return category;
}

export async function renameCategory(workspace, categoryId, { name }) {
  const category = await findCategory(workspace, categoryId);
  category.name = name;
  category.nameKey = name.toLowerCase();
  try {
    await category.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicateCategory(name);
    throw err;
  }
  const groupCount = await FacebookGroup.countDocuments({ category: category._id });
  return { category: categoryView(category, groupCount) };
}

/** Deletes a category; its groups stay in the directory without a category. */
export async function deleteCategory(workspace, categoryId) {
  const category = await findCategory(workspace, categoryId);
  const { modifiedCount } = await FacebookGroup.updateMany(
    { workspace: workspace._id, category: category._id },
    { $set: { category: null } },
  );
  await GroupCategory.deleteOne({ _id: category._id });
  return { groupsUncategorized: modifiedCount };
}

/* ------------------------------------------------------------------------- groups */

async function assertCategory(workspace, categoryId) {
  if (!categoryId) return null;
  const exists = await GroupCategory.exists({ _id: categoryId, workspace: workspace._id });
  if (!exists) {
    throw validationError({ fields: { categoryId: 'This category no longer exists' } });
  }
  return categoryId;
}

/** Every id must be a Facebook Page of this workspace (422 otherwise). */
async function assertPages(workspace, pageIds) {
  if (!pageIds?.length) return [];
  const found = await SocialAccount.countDocuments({
    workspace: workspace._id,
    _id: { $in: pageIds },
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  });
  if (found !== pageIds.length) {
    throw validationError({
      fields: { pageIds: 'One or more Pages are no longer connected. Reload and try again.' },
    });
  }
  return pageIds.map((pageId) => new mongoose.Types.ObjectId(pageId));
}

async function duplicateGroup(workspace, urlKey) {
  const existing = await FacebookGroup.findOne({ workspace: workspace._id, urlKey }).select('name');
  return conflict(
    existing
      ? `This group is already in the directory as “${existing.name}”.`
      : 'This group is already in the directory.',
    {
      fields: { url: 'This group is already in the directory' },
      groupId: existing ? id(existing) : null,
    },
  );
}

const SORTS = {
  name: { name: 1, _id: 1 },
  '-name': { name: -1, _id: 1 },
  '-lastSharedAt': { lastSharedAt: -1, name: 1 },
  lastSharedAt: { lastSharedAt: 1, name: 1 },
  '-memberCount': { memberCount: -1, name: 1 },
  '-createdAt': { _id: -1 },
};
const COLLATION = { locale: 'en', strength: 2, numericOrdering: true };

/**
 * Searchable, filterable, paginated directory. Facets count the status in view (categories,
 * the 30 most used tags) before the category, tag and search filters, plus both statuses.
 */
export async function listGroups(workspace, query, { now = new Date() } = {}) {
  const base = { workspace: workspace._id };
  const scoped = query.status === 'ALL' ? { ...base } : { ...base, status: query.status };
  const filter = { ...scoped };
  if (query.category === 'none') filter.category = null;
  else if (query.category) filter.category = new mongoose.Types.ObjectId(query.category);
  if (query.tag) filter.tags = query.tag;
  if (query.pageId) filter.pages = new mongoose.Types.ObjectId(query.pageId);
  if (query.q) {
    const needle = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: needle }, { urlKey: needle }, { tags: needle }, { notes: needle }];
  }

  const { page, limit } = query;
  const [groups, total, categories, categoryCounts, tagCounts, statusCounts, pageCounts] =
    await Promise.all([
      FacebookGroup.find(filter)
        .sort(SORTS[query.sort] ?? SORTS.name)
        .collation(COLLATION)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(GROUP_PAGES),
      FacebookGroup.countDocuments(filter),
      categoryMap(workspace._id),
      FacebookGroup.aggregate([
        { $match: scoped },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
      FacebookGroup.aggregate([
        { $match: scoped },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 30 },
      ]),
      FacebookGroup.aggregate([
        { $match: base },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // How many groups (in the status in view) each Page is a member of.
      FacebookGroup.aggregate([
        { $match: scoped },
        { $unwind: '$pages' },
        { $group: { _id: '$pages', count: { $sum: 1 } } },
      ]),
    ]);

  return {
    items: groups.map((g) => groupView(g, { categories, now })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    facets: {
      categories: Object.fromEntries(
        categoryCounts.map((row) => [row._id ? id(row._id) : 'none', row.count]),
      ),
      tags: tagCounts.map((row) => ({ tag: row._id, count: row.count })),
      status: Object.fromEntries(statusCounts.map((row) => [row._id, row.count])),
      pages: Object.fromEntries(pageCounts.map((row) => [id(row._id), row.count])),
    },
  };
}

export async function findGroup(workspace, groupId) {
  const group = mongoose.isValidObjectId(groupId)
    ? await FacebookGroup.findOne({ _id: groupId, workspace: workspace._id }).populate(GROUP_PAGES)
    : null;
  if (!group) throw notFound('Group not found');
  return group;
}

/** One group with its 20 most recent sharing tasks. */
export async function groupDetail(workspace, groupId, { now = new Date() } = {}) {
  const group = await findGroup(workspace, groupId);
  const [categories, tasks] = await Promise.all([
    categoryMap(workspace._id),
    SharingTask.find({ group: group._id })
      .sort({ _id: -1 })
      .limit(20)
      .populate('share', 'title')
      .populate('completedBy', 'name')
      .populate('assignee', 'name'),
  ]);
  return {
    group: groupView(group, { categories, now }),
    history: tasks.map((task) => ({
      id: id(task),
      status: task.status,
      share: task.share ? { id: id(task.share), title: task.share.title } : null,
      assignee: person(task.assignee),
      completedBy: person(task.completedBy),
      completedAt: task.completedAt,
      postUrl: task.postUrl,
      note: task.note,
      createdAt: task.createdAt,
    })),
  };
}

function groupFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.url !== undefined) {
    const parsed = parseFacebookGroupUrl(body.url);
    fields.url = parsed.url;
    fields.urlKey = parsed.key;
  }
  if (body.categoryId !== undefined) fields.category = body.categoryId ?? null;
  if (body.tags !== undefined) fields.tags = body.tags;
  if (body.memberCount !== undefined) fields.memberCount = body.memberCount;
  if (body.notes !== undefined) fields.notes = body.notes;
  if (body.minDaysBetweenShares !== undefined)
    fields.minDaysBetweenShares = body.minDaysBetweenShares;
  if (body.status !== undefined) fields.status = body.status;
  return fields;
}

/** Whether a group's stored Pages (populated or not) are the same set as `next`. */
const samePages = (stored, next) =>
  JSON.stringify((stored ?? []).map((page) => id(page)).sort()) ===
  JSON.stringify(next.map((page) => id(page)).sort());

export async function createGroup(workspace, actor, body, context) {
  if (
    (await FacebookGroup.countDocuments({ workspace: workspace._id })) >= GROUP_LIMITS.GROUPS_MAX
  ) {
    throw conflict(
      `A workspace can have up to ${GROUP_LIMITS.GROUPS_MAX} groups in its directory.`,
    );
  }
  await assertCategory(workspace, body.categoryId);
  const fields = groupFields(body);
  if (body.pageIds !== undefined) fields.pages = await assertPages(workspace, body.pageIds);
  let group;
  try {
    group = await FacebookGroup.create({
      ...fields,
      workspace: workspace._id,
      createdBy: actor._id,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw await duplicateGroup(workspace, fields.urlKey);
    throw err;
  }
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.FACEBOOK_GROUP_ADDED,
    target: { type: 'facebook_group', id: group._id, label: group.name },
    context,
  });
  await group.populate(GROUP_PAGES);
  return { group: groupView(group, { categories: await categoryMap(workspace._id) }) };
}

export async function updateGroup(workspace, actor, groupId, body, context) {
  const group = await findGroup(workspace, groupId);
  if (body.categoryId !== undefined) await assertCategory(workspace, body.categoryId);
  const fields = groupFields(body);
  const changed = Object.keys(fields).filter(
    (key) =>
      key !== 'urlKey' &&
      JSON.stringify(group[key] ?? null) !== JSON.stringify(fields[key] ?? null),
  );
  if (body.pageIds !== undefined) {
    const pages = await assertPages(workspace, body.pageIds);
    if (!samePages(group.pages, pages)) {
      fields.pages = pages;
      changed.push('pageIds');
    }
  }
  if (changed.length > 0) {
    group.set(fields);
    try {
      await group.save();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw await duplicateGroup(workspace, fields.urlKey);
      throw err;
    }
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.FACEBOOK_GROUP_UPDATED,
      target: { type: 'facebook_group', id: group._id, label: group.name },
      metadata: { fields: changed.map((key) => (key === 'category' ? 'categoryId' : key)) },
      context,
    });
  }
  await group.populate(GROUP_PAGES);
  return { group: groupView(group, { categories: await categoryMap(workspace._id) }) };
}

/**
 * Adds many groups by link. Each link is reported on its own: `added` (a new group, named
 * after its link), `existing` (already listed: the Pages given are added to it) or `invalid`
 * (not a Facebook Group link). A link listed twice counts once.
 */
export async function bulkCreateGroups(workspace, actor, body, context) {
  await assertCategory(workspace, body.categoryId);
  const pages = await assertPages(workspace, body.pageIds);
  const invalid = [];
  const wanted = new Map();
  for (const raw of body.urls) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseFacebookGroupUrl(line);
    if (!parsed) invalid.push(line);
    else if (!wanted.has(parsed.key)) wanted.set(parsed.key, parsed);
  }
  if (wanted.size === 0 && invalid.length === 0) {
    throw validationError({ fields: { urls: 'Paste at least one group link' } });
  }
  const existing = await FacebookGroup.find({
    workspace: workspace._id,
    urlKey: { $in: [...wanted.keys()] },
  });
  const existingKeys = new Set(existing.map((group) => group.urlKey));
  const fresh = [...wanted.values()].filter((parsed) => !existingKeys.has(parsed.key));
  const count = await FacebookGroup.countDocuments({ workspace: workspace._id });
  if (count + fresh.length > GROUP_LIMITS.GROUPS_MAX) {
    throw conflict(
      `A workspace can have up to ${GROUP_LIMITS.GROUPS_MAX} groups in its directory. ${Math.max(0, GROUP_LIMITS.GROUPS_MAX - count)} more can be added.`,
    );
  }

  const added = [];
  for (const parsed of fresh) {
    try {
      const group = await FacebookGroup.create({
        workspace: workspace._id,
        name: groupNameFromUrl(parsed.url),
        url: parsed.url,
        urlKey: parsed.key,
        category: body.categoryId ?? null,
        pages,
        createdBy: actor._id,
      });
      added.push(group);
      await recordActivity({
        workspace,
        actor,
        action: ACTIVITY_ACTIONS.FACEBOOK_GROUP_ADDED,
        target: { type: 'facebook_group', id: group._id, label: group.name },
        metadata: { bulk: true },
        context,
      });
    } catch (err) {
      // Added by someone else a moment ago: treated like a group that was already listed.
      if (!isDuplicateKeyError(err)) throw err;
      const raced = await FacebookGroup.findOne({ workspace: workspace._id, urlKey: parsed.key });
      if (raced) existing.push(raced);
    }
  }
  if (pages.length && existing.length) {
    await FacebookGroup.updateMany(
      { _id: { $in: existing.map((group) => group._id) } },
      { $addToSet: { pages: { $each: pages } } },
    );
  }
  const brief = (group) => ({ id: id(group), name: group.name, url: group.url });
  return { added: added.map(brief), existing: existing.map(brief), invalid };
}

/**
 * Removes a group and its open or skipped tasks. A group with completed shares keeps its
 * history: it can only be archived (409).
 */
export async function deleteGroup(workspace, actor, groupId, context) {
  const group = await findGroup(workspace, groupId);
  if (await SharingTask.exists({ group: group._id, status: SHARING_TASK_STATUS.DONE })) {
    throw conflict(
      'This group has completed shares. Archive it instead, so its sharing history is kept.',
    );
  }
  const { deletedCount } = await SharingTask.deleteMany({ group: group._id });
  await FacebookGroup.deleteOne({ _id: group._id });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.FACEBOOK_GROUP_REMOVED,
    target: { type: 'facebook_group', id: group._id, label: group.name },
    metadata: { tasksRemoved: deletedCount },
    context,
  });
  return { tasksRemoved: deletedCount };
}
