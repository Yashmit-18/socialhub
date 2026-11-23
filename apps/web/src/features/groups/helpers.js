/** Helpers shared by the Group sharing pages (Phase 6). */
import { PERMISSIONS, hasPermission } from '@socialhub/shared';
import { useMembers } from '../../lib/queries.js';

export const inputClass =
  'block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100';

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
  share.link ? `${share.message}\n\n${share.link}` : share.message;
