import { ActivityLog } from '../../models/index.js';

/**
 * Append an audit entry. Pass the active transaction `session` so the log entry commits
 * (or rolls back) atomically with the change it describes.
 */
export async function recordActivity({
  workspace,
  actor,
  action,
  target,
  metadata,
  context,
  session = null,
}) {
  const [entry] = await ActivityLog.create(
    [
      {
        workspace: workspace._id ?? workspace,
        actor: actor?._id,
        actorName: actor?.name,
        action,
        target,
        metadata,
        ip: context?.ip,
        userAgent: context?.userAgent,
      },
    ],
    { session },
  );
  return entry;
}

export async function listActivity(workspaceId, { cursor, limit }) {
  const filter = { workspace: workspaceId };
  if (cursor) filter._id = { $lt: cursor };

  const rows = await ActivityLog.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .select('-ip -userAgent');

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => r.toJSON());
  return { items, nextCursor: hasMore ? items.at(-1).id : null };
}
