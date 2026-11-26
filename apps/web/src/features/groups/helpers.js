/** Helpers shared by the Group sharing pages (Phase 6). */
import { PERMISSIONS, hasPermission } from '@socialhub/shared';
import { useMembers } from '../../lib/queries.js';

/*
 * The look of the kit's fields (components/ui/Field.jsx) for the group dialogs' own markup:
 * 40 px tall, 16 px text on phones (no zoom on focus), the same hover and focus ring.
 */
export const inputClass =
  'block min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-base text-slate-900 shadow-[0_1px_2px_rgb(24_20_51/0.05)] transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 focus:outline-none sm:text-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-white/20 dark:focus:border-brand-400 dark:focus:ring-brand-400/20';

/** A native select with the app's one chevron. */
export const selectClass = `${inputClass} select-chevron pr-9`;

/** Members who can complete sharing tasks (assignee options). */
export function useAssignableMembers(workspaceId) {
  const members = useMembers(workspaceId);
  return (members.data ?? []).filter(
    (m) => m.user && hasPermission(m.role, PERMISSIONS.SHARING_TASKS_COMPLETE),
  );
}

/** Midday on the chosen local date, as ISO (a date input gives no time). */
export const dueFromDate = (date) => (date ? new Date(`${date}T12:00:00`).toISOString() : null);

/** The text a person pastes into the group: the message, then the link. */
export const shareText = (share) =>
  [share.message, share.link].filter((part) => part?.trim()).join('\n\n');

/**
 * What a task's "Copy text" copies: the share's text and link, then the link to the live Page
 * post (Facebook shows a preview of it, with its photo, in the group).
 */
export const taskText = (task) =>
  [shareText(task.share ?? { message: '' }), task.pagePost?.url]
    .filter((part) => part?.trim())
    .join('\n\n');

/** The toast after an auto share was set up: what happens now, in one sentence. */
export function autoShareMessage({ tasksCreated = 0, pagesWaiting = 0 } = {}) {
  if (tasksCreated > 0) {
    return {
      title: `${tasksCreated} ${tasksCreated === 1 ? 'group is' : 'groups are'} ready to share`,
      description: 'Open Group sharing to copy the post and share it in each group.',
    };
  }
  if (pagesWaiting > 0) {
    return {
      title: 'Group sharing is set up',
      description:
        'Each matching group your Pages are in gets a sharing task as soon as the post is live on Facebook. A group matches when one of its tags is in the post’s hashtags or keywords, or when it has no tags.',
    };
  }
  return {
    title: 'No groups to share in',
    description:
      'No group matched: none of these Pages is listed in a group yet, no group’s tags are in the post’s hashtags or keywords, or the groups were shared in too recently.',
  };
}
