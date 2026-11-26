import { PLATFORM_AUDIT_ACTIONS, PLATFORM_ROLES, USER_STATUS } from '@socialhub/shared';
import { runInTransaction } from '../db/mongoose.js';
import { User } from '../models/index.js';
import { recordPlatformAuditOrUndo } from '../modules/admin/platformAudit.service.js';

/**
 * Giving, removing and listing platform admin access (the operator console at /admin). The only
 * way in: no web page and no API request can do this. Used by scripts/platform-admin.js; every
 * grant and revoke is written to the platform audit log in the same transaction. Reads no
 * password hash, token or session. `email` is expected trimmed and in lower case.
 */

export const CLI_ACTOR_NAME = 'Command line';

const ADMIN = PLATFORM_ROLES.PLATFORM_ADMIN;
const FIELDS = 'name email status platformRole';
const person = (user) => ({ id: String(user._id), name: user.name, email: user.email });
const countAdmins = () => User.countDocuments({ platformRole: ADMIN });

/** Why access cannot be given to this account, or null. */
function grantBlocker(user) {
  if (!user) return 'NOT_FOUND';
  // A suspended account is never made a platform admin (the API refuses the reverse).
  if ((user.status ?? USER_STATUS.ACTIVE) !== USER_STATUS.ACTIVE) return 'SUSPENDED';
  if (user.platformRole === ADMIN) return 'ALREADY_ADMIN';
  return null;
}

/** The audit entry of a grant or revoke; without a transaction a failed write runs `undo`. */
const audit = (action, user, session, undo) =>
  recordPlatformAuditOrUndo(
    {
      actorName: CLI_ACTOR_NAME,
      action,
      target: { type: 'user', id: user._id, label: user.name },
      metadata: { email: user.email, via: 'CLI' },
      session,
    },
    undo,
  );

/** @returns {{ code: 'GRANTED'|'ALREADY_ADMIN'|'NOT_FOUND'|'SUSPENDED', user: object|null }} */
export async function grantPlatformAdmin(email) {
  const user = await User.findOne({ email }).select(FIELDS).lean();
  const blocked = grantBlocker(user);
  if (blocked) return { code: blocked, user: user ? person(user) : null };

  const code = await runInTransaction(async (session) => {
    // Conditional, so a suspension landing in between is never overridden.
    const updated = await User.updateOne(
      { _id: user._id, status: USER_STATUS.ACTIVE, platformRole: { $ne: ADMIN } },
      { $set: { platformRole: ADMIN } },
      { session },
    );
    if (updated.modifiedCount !== 1) {
      const current = await User.findById(user._id).select(FIELDS).session(session).lean();
      const reason = grantBlocker(current);
      if (reason) return reason;
      throw new Error('The account changed while access was being given. Run the command again.');
    }
    await audit(PLATFORM_AUDIT_ACTIONS.ADMIN_GRANTED, user, session, () =>
      User.updateOne({ _id: user._id, platformRole: ADMIN }, { $unset: { platformRole: 1 } }),
    );
    return 'GRANTED';
  });
  return { code, user: person(user) };
}

/** @returns {{ code: 'REVOKED'|'NOT_ADMIN'|'NOT_FOUND', user: object|null, remaining: number }} */
export async function revokePlatformAdmin(email) {
  const user = await User.findOne({ email }).select(FIELDS).lean();
  if (!user) return { code: 'NOT_FOUND', user: null, remaining: await countAdmins() };
  if (user.platformRole !== ADMIN) {
    return { code: 'NOT_ADMIN', user: person(user), remaining: await countAdmins() };
  }

  const code = await runInTransaction(async (session) => {
    const updated = await User.updateOne(
      { _id: user._id, platformRole: ADMIN },
      { $unset: { platformRole: 1 } },
      { session },
    );
    if (updated.modifiedCount !== 1) return 'NOT_ADMIN';
    await audit(PLATFORM_AUDIT_ACTIONS.ADMIN_REVOKED, user, session, () =>
      User.updateOne({ _id: user._id }, { $set: { platformRole: ADMIN } }),
    );
    return 'REVOKED';
  });
  // The last platform admin may be removed: the command line is the way back in anyway.
  return { code, user: person(user), remaining: await countAdmins() };
}

/** @returns {Array<{ id, name, email, status }>} oldest account first */
export async function listPlatformAdmins() {
  const users = await User.find({ platformRole: ADMIN })
    .sort({ _id: 1 })
    .select('name email status')
    .lean();
  return users.map((user) => ({ ...person(user), status: user.status ?? USER_STATUS.ACTIVE }));
}
