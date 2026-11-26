import mongoose from 'mongoose';
import { PlatformAuditLog } from '../../models/index.js';
import { platformAuditView } from './admin.views.js';

/**
 * Appends a platform audit entry (an operator action; it belongs to no workspace). Pass the
 * active transaction `session` so the entry commits or rolls back with the change it
 * describes. `actor` is the platform admin; the command line passes `actorName` instead.
 */
export async function recordPlatformAudit({
  actor,
  actorName,
  action,
  target,
  metadata,
  context,
  session = null,
}) {
  const [entry] = await PlatformAuditLog.create(
    [
      {
        actor: actor?._id,
        actorName: actor?.name ?? actorName,
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

/**
 * Writes the audit entry of a change made in the same `runInTransaction` callback. Inside a
 * transaction a failed write rolls the change back. Without one (a standalone MongoDB) the
 * change is already saved, so `undo` reverses it before the error is passed on: an operator
 * action is never kept without its record.
 */
export async function recordPlatformAuditOrUndo(entry, undo) {
  if (entry.session) return recordPlatformAudit(entry);
  try {
    return await recordPlatformAudit(entry);
  } catch (err) {
    await undo();
    throw err;
  }
}

const objectId = (value) => new mongoose.Types.ObjectId(value);

/** Newest first, one page after `cursor`. Never selects or returns `ip` or `userAgent`. */
export async function listPlatformAudit({ action, targetId, cursor, limit }) {
  const filter = {};
  if (action) filter.action = action;
  if (targetId) filter['target.id'] = objectId(targetId);
  if (cursor) filter._id = { $lt: objectId(cursor) };

  const rows = await PlatformAuditLog.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .select('actor actorName action target metadata createdAt')
    .lean();

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(platformAuditView);
  return { items, nextCursor: hasMore ? items.at(-1).id : null };
}
