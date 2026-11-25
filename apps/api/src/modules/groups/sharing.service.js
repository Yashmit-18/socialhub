/**
 * Group shares and manual sharing tasks (Phase 6). A share is text (and an optional link)
 * someone will post in Facebook Groups by hand; each target group gets one SharingTask.
 *
 * Duplicate prevention: a share reaches each group at most once (unique (share, group) index),
 * and a group's "days between shares" rule keeps new tasks away until it allows another share.
 * Completing a task never contacts Facebook: the person posts it themselves and says so.
 *
 * Auto share: a real post published to Facebook Pages gets one share, and each group one of
 * those Pages is a member of gets a task as soon as that Page's post is live on Facebook
 * (`queueGroupTasksForDestination`, called by the publishing worker). Simulated posts, posts
 * that failed and posts not live yet create no tasks. People still post in the groups.
 */
import mongoose from 'mongoose';
import {
  ACTIVITY_ACTIONS,
  AUTO_SHARE_REFUSALS,
  DESTINATION_STATES,
  FACEBOOK_GROUP_STATUS,
  GROUP_LIMITS,
  PERMISSIONS,
  PUBLISHING_MODES,
  SHARE_SKIP_REASONS,
  SHARING_TASK_STATUS,
  SOCIAL_PLATFORMS,
  composeCaption,
  hasPermission,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import {
  conflict,
  forbidden,
  isDuplicateKeyError,
  notFound,
  validationError,
} from '../../lib/errors.js';
import {
  FacebookGroup,
  GroupShare,
  Membership,
  PublishDestination,
  PublishJob,
  SharingTask,
} from '../../models/index.js';
import { recordActivity } from '../activity/activity.service.js';
import { jobIsVisible } from '../contentPackages/contentAccess.js';
import { nextShareAllowedAt } from './directory.service.js';

const id = (v) => String(v?._id ?? v);
const person = (user) => (user?._id ? { id: id(user), name: user.name } : null);
const { OPEN, DONE, SKIPPED } = SHARING_TASK_STATUS;

/* -------------------------------------------------------------------------- views */

const emptyCounts = () => ({ open: 0, done: 0, skipped: 0, total: 0 });

function shareView(share, counts = emptyCounts()) {
  return {
    id: id(share),
    title: share.title,
    message: share.message ?? '',
    link: share.link ?? '',
    // Auto share: the real post it was made from.
    auto: Boolean(share.publishJob),
    publishJobId: share.publishJob ? id(share.publishJob) : null,
    skipped: (share.skipped ?? []).map((entry) => ({
      groupId: id(entry.group),
      name: entry.name,
      reason: entry.reason,
      nextShareAllowedAt: entry.nextShareAllowedAt ?? null,
    })),
    createdBy: person(share.createdBy),
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    counts,
  };
}

async function countsByShare(shareIds) {
  if (shareIds.length === 0) return new Map();
  const rows = await SharingTask.aggregate([
    { $match: { share: { $in: shareIds } } },
    { $group: { _id: { share: '$share', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const out = new Map();
  for (const row of rows) {
    const key = id(row._id.share);
    const counts = out.get(key) ?? emptyCounts();
    counts[row._id.status.toLowerCase()] = row.count;
    counts.total += row.count;
    out.set(key, counts);
  }
  return out;
}

/** The live Page post a task shares, when it is live on Facebook (never for simulations). */
function pagePostView(destination) {
  if (!destination?._id) return null;
  const live = destination.state === DESTINATION_STATES.PUBLISHED && !destination.simulated;
  return { state: destination.state, url: live ? (destination.externalUrl ?? null) : null };
}

function taskView(task, { now = new Date() } = {}) {
  const group = task.group?._id ? task.group : null;
  const share = task.share?._id ? task.share : null;
  return {
    id: id(task),
    status: task.status,
    share: share
      ? {
          id: id(share),
          title: share.title,
          message: share.message ?? '',
          link: share.link ?? '',
          auto: Boolean(share.publishJob),
        }
      : null,
    // Auto share: the Page to share as, and its post on Facebook.
    page: task.page?._id ? { id: id(task.page), name: task.page.name } : null,
    pagePost: pagePostView(task.publishDestination),
    group: group
      ? {
          id: id(group),
          name: group.name,
          url: group.url,
          notes: group.notes ?? '',
          status: group.status,
          nextShareAllowedAt: nextShareAllowedAt(group, now),
        }
      : null,
    assignee: person(task.assignee),
    dueAt: task.dueAt,
    completedBy: person(task.completedBy),
    completedAt: task.completedAt,
    postUrl: task.postUrl,
    note: task.note,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

const TASK_POPULATE = [
  { path: 'share', select: 'title message link publishJob' },
  { path: 'page', select: 'name' },
  { path: 'publishDestination', select: 'state simulated externalUrl' },
  { path: 'group', select: 'name url notes status minDaysBetweenShares lastSharedAt' },
  { path: 'assignee', select: 'name' },
  { path: 'completedBy', select: 'name' },
];

/* -------------------------------------------------------------------------- rules */

/** The assignee must be a member who can complete sharing tasks (422 otherwise). */
async function assertAssignee(workspace, assigneeId) {
  if (!assigneeId) return null;
  const membership = await Membership.findOne({ workspace: workspace._id, user: assigneeId });
  if (!membership || !hasPermission(membership.role, PERMISSIONS.SHARING_TASKS_COMPLETE)) {
    throw validationError({
      fields: { assigneeId: 'Choose a member who can complete sharing tasks' },
    });
  }
  return membership.user;
}

/**
 * Splits `groupIds` into groups that get a task and groups that are skipped with the reason.
 * Every id must be a group of this workspace (422 otherwise).
 */
async function planTasks(workspace, shareId, groupIds, now) {
  const unique = [...new Set(groupIds.map((g) => g.toLowerCase()))];
  const groups = await FacebookGroup.find({ workspace: workspace._id, _id: { $in: unique } });
  if (groups.length !== unique.length) {
    throw validationError({
      fields: {
        groupIds: 'One or more groups are no longer in the directory. Reload and try again.',
      },
    });
  }
  const queued = shareId
    ? new Set(
        (await SharingTask.find({ share: shareId, group: { $in: unique } }).select('group')).map(
          (t) => id(t.group),
        ),
      )
    : new Set();
  const create = [];
  const skipped = [];
  for (const group of groups) {
    const base = { groupId: id(group), name: group.name };
    if (queued.has(id(group))) skipped.push({ ...base, reason: SHARE_SKIP_REASONS.ALREADY_QUEUED });
    else if (group.status === FACEBOOK_GROUP_STATUS.ARCHIVED) {
      skipped.push({ ...base, reason: SHARE_SKIP_REASONS.ARCHIVED });
    } else {
      const next = nextShareAllowedAt(group, now);
      if (next) {
        skipped.push({
          ...base,
          reason: SHARE_SKIP_REASONS.TOO_SOON,
          lastSharedAt: group.lastSharedAt,
          nextShareAllowedAt: next,
        });
      } else create.push(group);
    }
  }
  return { create, skipped };
}

/** Inserts tasks; any the unique index refuses (a simultaneous request) count as queued. */
async function insertTasks(workspace, actor, share, groups, { assignee, dueAt }) {
  if (groups.length === 0) return { created: 0, raced: [] };
  const docs = groups.map((group) => ({
    workspace: workspace._id,
    share: share._id,
    group: group._id,
    assignee: assignee ?? null,
    dueAt: dueAt ? new Date(dueAt) : null,
    createdBy: actor._id,
  }));
  try {
    const inserted = await SharingTask.insertMany(docs, { ordered: false });
    return { created: inserted.length, raced: [] };
  } catch (err) {
    if (!isDuplicateKeyError(err) && !err?.writeErrors) throw err;
    const failed = new Set((err.writeErrors ?? []).map((e) => e.index ?? e.err?.index));
    const raced = groups
      .filter((_, index) => failed.has(index))
      .map((group) => ({
        groupId: id(group),
        name: group.name,
        reason: SHARE_SKIP_REASONS.ALREADY_QUEUED,
      }));
    return { created: groups.length - raced.length, raced };
  }
}

/* ------------------------------------------------------------------------- shares */

export async function createShare(workspace, actor, body, context, { now = new Date() } = {}) {
  const assignee = await assertAssignee(workspace, body.assigneeId);
  const { create, skipped } = await planTasks(workspace, null, body.groupIds, now);
  if (create.length === 0) {
    throw conflict('None of the selected groups can get this share right now.', { skipped });
  }
  const share = await GroupShare.create({
    workspace: workspace._id,
    title: body.title,
    message: body.message,
    link: body.link || undefined,
    createdBy: actor._id,
  });
  const { created, raced } = await insertTasks(workspace, actor, share, create, {
    assignee,
    dueAt: body.dueAt,
  });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.GROUP_SHARE_CREATED,
    target: { type: 'group_share', id: share._id, label: share.title },
    metadata: { groups: created, skipped: skipped.length + raced.length },
    context,
  });
  await share.populate('createdBy', 'name');
  const counts = (await countsByShare([share._id])).get(id(share));
  return { share: shareView(share, counts), created, skipped: [...skipped, ...raced] };
}

export async function findShare(workspace, shareId) {
  const share = mongoose.isValidObjectId(shareId)
    ? await GroupShare.findOne({ _id: shareId, workspace: workspace._id }).populate(
        'createdBy',
        'name',
      )
    : null;
  if (!share) throw notFound('Share not found');
  return share;
}

/** Adds groups to an existing share; groups that cannot get it are reported, not created. */
export async function addShareGroups(workspace, actor, shareId, body, { now = new Date() } = {}) {
  const share = await findShare(workspace, shareId);
  const assignee = await assertAssignee(workspace, body.assigneeId);
  const { create, skipped } = await planTasks(workspace, share._id, body.groupIds, now);
  const { created, raced } = await insertTasks(workspace, actor, share, create, {
    assignee,
    dueAt: body.dueAt,
  });
  const counts = (await countsByShare([share._id])).get(id(share));
  return { share: shareView(share, counts), created, skipped: [...skipped, ...raced] };
}

export async function listShares(workspace, { page, limit }) {
  const filter = { workspace: workspace._id };
  const [shares, total] = await Promise.all([
    GroupShare.find(filter)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'name'),
    GroupShare.countDocuments(filter),
  ]);
  const counts = await countsByShare(shares.map((s) => s._id));
  return {
    items: shares.map((s) => shareView(s, counts.get(id(s)))),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function shareDetail(workspace, shareId, { now = new Date() } = {}) {
  const share = await findShare(workspace, shareId);
  const tasks = await SharingTask.find({ share: share._id }).populate(TASK_POPULATE);
  tasks.sort((a, b) =>
    (a.group?.name ?? '').localeCompare(b.group?.name ?? '', undefined, { sensitivity: 'base' }),
  );
  const counts = (await countsByShare([share._id])).get(id(share));
  return { share: shareView(share, counts), tasks: tasks.map((t) => taskView(t, { now })) };
}

export async function updateShare(workspace, shareId, body) {
  const share = await findShare(workspace, shareId);
  if (body.title !== undefined) share.title = body.title;
  if (body.message !== undefined) share.message = body.message;
  if (body.link !== undefined) share.link = body.link || undefined;
  await share.save();
  const counts = (await countsByShare([share._id])).get(id(share));
  return { share: shareView(share, counts) };
}

/** Deletes a share and its tasks, unless it was already posted somewhere (409). */
export async function deleteShare(workspace, actor, shareId, context) {
  const share = await findShare(workspace, shareId);
  if (await SharingTask.exists({ share: share._id, status: DONE })) {
    throw conflict(
      'This share was already posted in at least one group, so its record is kept. Skip the open tasks instead.',
    );
  }
  const { deletedCount } = await SharingTask.deleteMany({ share: share._id });
  await GroupShare.deleteOne({ _id: share._id });
  await recordActivity({
    workspace,
    actor,
    action: ACTIVITY_ACTIONS.GROUP_SHARE_DELETED,
    target: { type: 'group_share', id: share._id, label: share.title },
    metadata: { tasksRemoved: deletedCount },
    context,
  });
  return { tasksRemoved: deletedCount };
}

/* -------------------------------------------------------------------------- tasks */

/**
 * Sharing tasks, open ones oldest first and finished ones newest first. `counts` gives the
 * status totals for the same assignee/share/group filter (for the queue's tabs).
 */
export async function listTasks(workspace, user, query, { now = new Date() } = {}) {
  const scope = { workspace: workspace._id };
  if (query.assignee === 'me') scope.assignee = user._id;
  else if (query.assignee === 'unassigned') scope.assignee = null;
  else if (query.assignee === 'available') scope.assignee = { $in: [user._id, null] };
  if (query.shareId) scope.share = new mongoose.Types.ObjectId(query.shareId);
  if (query.groupId) scope.group = new mongoose.Types.ObjectId(query.groupId);
  const filter = query.status === 'ALL' ? scope : { ...scope, status: query.status };

  const { page, limit } = query;
  const [tasks, total, statusRows] = await Promise.all([
    SharingTask.find(filter)
      .sort(query.status === OPEN ? { _id: 1 } : { updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(TASK_POPULATE),
    SharingTask.countDocuments(filter),
    SharingTask.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const counts = emptyCounts();
  for (const row of statusRows) {
    counts[row._id.toLowerCase()] = row.count;
    counts.total += row.count;
  }
  return {
    items: tasks.map((t) => taskView(t, { now })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
}

async function refreshLastShared(groupId) {
  const [latest] = await SharingTask.find({ group: groupId, status: DONE })
    .sort({ completedAt: -1 })
    .limit(1)
    .select('completedAt');
  await FacebookGroup.updateOne(
    { _id: groupId },
    { $set: { lastSharedAt: latest?.completedAt ?? null } },
  );
}

const ACTIVITY_FOR = {
  [DONE]: ACTIVITY_ACTIONS.SHARING_TASK_COMPLETED,
  [SKIPPED]: ACTIVITY_ACTIONS.SHARING_TASK_SKIPPED,
  [OPEN]: ACTIVITY_ACTIONS.SHARING_TASK_REOPENED,
};

/**
 * Marks a task done (with the post's link if given), skipped or open again, or changes its
 * assignee, link or note. Rules:
 * - groups:manage may change any task and assign it to anyone who can complete tasks;
 * - everyone else with sharing_tasks:complete works on tasks assigned to them or to nobody,
 *   may take an unassigned task or give back their own, and may reopen only what they
 *   finished themselves.
 * The write only succeeds if the task did not change in the meantime (409 otherwise).
 */
export async function updateTask(workspace, membership, actor, taskId, body, context) {
  const task = mongoose.isValidObjectId(taskId)
    ? await SharingTask.findOne({ _id: taskId, workspace: workspace._id })
    : null;
  if (!task) throw notFound('Task not found');

  const manager = hasPermission(membership.role, PERMISSIONS.GROUPS_MANAGE);
  const me = id(actor);
  const assignedTo = task.assignee ? id(task.assignee) : null;
  if (!manager && assignedTo && assignedTo !== me) {
    throw forbidden('This task is assigned to someone else.');
  }

  const set = {};
  if (body.assigneeId !== undefined) {
    const target = body.assigneeId ? body.assigneeId.toLowerCase() : null;
    if (!manager && target && target !== me) {
      throw forbidden('You can only take a task yourself; an admin assigns it to others.');
    }
    if (target) await assertAssignee(workspace, target);
    set.assignee = target ? new mongoose.Types.ObjectId(target) : null;
  }

  const nextStatus = body.status ?? task.status;
  // Finishing a task someone already finished (two people at once) must not look like success.
  if (body.status && body.status !== OPEN && body.status === task.status) {
    await task.populate('completedBy', 'name');
    const by = task.completedBy?.name ? ` by ${task.completedBy.name}` : '';
    throw conflict(
      `This task was already marked as ${task.status === DONE ? 'shared' : 'skipped'}${by}.`,
    );
  }
  if (nextStatus !== task.status) {
    if (nextStatus === OPEN) {
      if (!manager && id(task.completedBy) !== me) {
        throw forbidden('Only the person who finished this task, or an admin, can reopen it.');
      }
      set.status = OPEN;
      set.completedBy = null;
      set.completedAt = null;
      set.postUrl = null;
    } else {
      if (task.status !== OPEN && !(task.status === SKIPPED && nextStatus === DONE)) {
        throw conflict('Reopen this task first.');
      }
      set.status = nextStatus;
      set.completedBy = actor._id;
      set.completedAt = new Date();
    }
  } else if (task.status !== OPEN && (body.postUrl !== undefined || body.note !== undefined)) {
    if (!manager && id(task.completedBy) !== me) {
      throw forbidden('Only the person who finished this task, or an admin, can edit it.');
    }
  }
  if (body.postUrl !== undefined && (set.status ?? task.status) === DONE) {
    set.postUrl = body.postUrl || null;
  }
  if (body.note !== undefined) set.note = body.note || null;
  if (Object.keys(set).length === 0) {
    return { task: taskView(await task.populate(TASK_POPULATE)) };
  }

  const updated = await SharingTask.findOneAndUpdate(
    { _id: task._id, status: task.status, updatedAt: task.updatedAt },
    { $set: set },
    { new: true },
  ).populate(TASK_POPULATE);
  if (!updated) {
    throw conflict('Someone else changed this task a moment ago. Reload to see the latest.');
  }

  if (set.status === DONE || task.status === DONE) await refreshLastShared(task.group);
  if (set.status) {
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_FOR[set.status],
      target: {
        type: 'sharing_task',
        id: task._id,
        label: updated.group?.name ?? 'a group',
      },
      metadata: {
        share: updated.share?.title ?? null,
        group: updated.group?.name ?? null,
        ...(set.status === DONE && set.postUrl ? { postUrl: set.postUrl } : {}),
      },
      context,
    });
  }
  // The group's last-shared date may have changed with this task.
  const fresh = await SharingTask.findById(task._id).populate(TASK_POPULATE);
  return { task: taskView(fresh ?? updated) };
}

/* --------------------------------------------------------------------- auto share */

const AUTO_TITLE_MAX = 80;

/** A short title from the caption's first line, or the date for a post without text. */
function autoTitle(caption, at) {
  const line =
    caption
      .split('\n')
      .find((text) => text.trim())
      ?.trim() ?? '';
  if (!line) {
    return `Post of ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  }
  const chars = [...line];
  return chars.length > AUTO_TITLE_MAX ? `${chars.slice(0, AUTO_TITLE_MAX - 1).join('')}…` : line;
}

/**
 * Creates the tasks for one Facebook Page's live post: one per active group that Page is a
 * member of. A group this share already has a task for (through another Page) is left alone;
 * a group whose "days between shares" rule does not allow a share yet is recorded as skipped.
 */
async function materialize(share, destination, now = new Date()) {
  const groups = await FacebookGroup.find({
    workspace: share.workspace,
    pages: destination.socialAccount,
    status: FACEBOOK_GROUP_STATUS.ACTIVE,
  }).limit(GROUP_LIMITS.GROUPS_MAX);
  if (groups.length === 0) return { created: 0, skipped: [] };
  const queued = new Set(
    (
      await SharingTask.find({ share: share._id, group: { $in: groups.map((g) => g._id) } }).select(
        'group',
      )
    ).map((task) => id(task.group)),
  );
  const create = [];
  const skipped = [];
  for (const group of groups) {
    if (queued.has(id(group))) continue;
    const next = nextShareAllowedAt(group, now);
    if (next) {
      skipped.push({
        group: group._id,
        name: group.name,
        reason: SHARE_SKIP_REASONS.TOO_SOON,
        nextShareAllowedAt: next,
      });
    } else create.push(group);
  }
  let created = 0;
  if (create.length) {
    try {
      const inserted = await SharingTask.insertMany(
        create.map((group) => ({
          workspace: share.workspace,
          share: share._id,
          group: group._id,
          page: destination.socialAccount,
          publishDestination: destination._id,
          createdBy: share.createdBy,
        })),
        { ordered: false },
      );
      created = inserted.length;
    } catch (err) {
      // Another call (the worker and the person's request at once) created some of them.
      if (!isDuplicateKeyError(err) && !err?.writeErrors) throw err;
      created = create.length - (err.writeErrors?.length ?? 0);
    }
  }
  if (skipped.length) {
    const current = await GroupShare.findById(share._id).select('skipped');
    const known = new Set((current?.skipped ?? []).map((entry) => id(entry.group)));
    const fresh = skipped.filter((entry) => !known.has(id(entry.group)));
    if (fresh.length) {
      await GroupShare.updateOne(
        { _id: share._id },
        { $push: { skipped: { $each: fresh, $slice: -GROUP_LIMITS.GROUPS_PER_SHARE_MAX } } },
      );
    }
  }
  return { created, skipped };
}

/** A real post's live Facebook Page posts: the only ones that may get group tasks. */
const liveFacebookPosts = (jobId) =>
  PublishDestination.find({
    job: jobId,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    state: DESTINATION_STATES.PUBLISHED,
    simulated: { $ne: true },
  });

/**
 * Auto share for a real post (idempotent: one share per post). Tasks for the Pages whose post
 * is already live are created now; the others follow when their post goes live.
 */
export async function createAutoShare(workspace, membership, actor, body, context) {
  const job = mongoose.isValidObjectId(body.publishJobId)
    ? await PublishJob.findOne({ _id: body.publishJobId, workspace: workspace._id })
    : null;
  if (!job || !(await jobIsVisible(workspace, membership, job._id))) {
    throw notFound('Publishing job not found');
  }
  if (job.mode !== PUBLISHING_MODES.LIVE) {
    throw conflict(
      'This post was a simulation, so it is not on Facebook and cannot be shared in groups.',
      { reason: AUTO_SHARE_REFUSALS.SIMULATED },
    );
  }
  const pageCount = await PublishDestination.countDocuments({
    job: job._id,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  });
  if (pageCount === 0) {
    throw conflict('This post went to no Facebook Page, so there is nothing to share in groups.', {
      reason: AUTO_SHARE_REFUSALS.NO_FACEBOOK_PAGES,
    });
  }

  let share = await GroupShare.findOne({ publishJob: job._id });
  let created = false;
  if (!share) {
    const caption = composeCaption(
      job.content?.toObject?.() ?? job.content ?? {},
      SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    );
    try {
      share = await GroupShare.create({
        workspace: workspace._id,
        title: autoTitle(caption, job.createdAt ?? new Date()),
        message: caption,
        publishJob: job._id,
        createdBy: actor._id,
      });
      created = true;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      share = await GroupShare.findOne({ publishJob: job._id });
    }
  }

  let tasks = 0;
  for (const destination of await liveFacebookPosts(job._id)) {
    tasks += (await materialize(share, destination)).created;
  }
  if (created) {
    await recordActivity({
      workspace,
      actor,
      action: ACTIVITY_ACTIONS.GROUP_SHARE_CREATED,
      target: { type: 'group_share', id: share._id, label: share.title },
      metadata: { auto: true, groups: tasks },
      context,
    });
  }
  const fresh = await GroupShare.findById(share._id).populate('createdBy', 'name');
  const counts = (await countsByShare([share._id])).get(id(share));
  const waiting = await PublishDestination.countDocuments({
    job: job._id,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    state: { $ne: DESTINATION_STATES.PUBLISHED },
  });
  return { share: shareView(fresh, counts), created, tasksCreated: tasks, pagesWaiting: waiting };
}

/**
 * Called by the publishing worker when a destination is published: if its post has an auto
 * share and it is a real Facebook Page post, the Page's groups get their tasks. Never throws:
 * group tasks must not affect the publishing result.
 */
export async function queueGroupTasksForDestination(destinationId) {
  try {
    const destination = await PublishDestination.findById(destinationId);
    if (
      !destination ||
      destination.platform !== SOCIAL_PLATFORMS.FACEBOOK_PAGE ||
      destination.state !== DESTINATION_STATES.PUBLISHED ||
      destination.simulated
    ) {
      return null;
    }
    const share = await GroupShare.findOne({ publishJob: destination.job });
    if (!share) return null;
    return await materialize(share, destination);
  } catch (err) {
    logger.warn(
      { err, destinationId: String(destinationId) },
      'Could not create group sharing tasks for a published post',
    );
    return null;
  }
}

/** Open tasks of a member who leaves or is removed go back to "anyone". */
export async function releaseTasksOf(workspaceId, userId, session = null) {
  await SharingTask.updateMany(
    { workspace: workspaceId, assignee: userId, status: OPEN },
    { $set: { assignee: null } },
    { session },
  );
}
