import mongoose from 'mongoose';
import {
  ADMIN_CONFLICT_REASONS,
  CLAIMABLE_DESTINATION_STATES,
  DESTINATION_STATES,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_ROLES,
  ROLES,
  USER_STATUS,
  isPlatformAdmin,
} from '@socialhub/shared';
import { logger } from '../../config/logger.js';
import { runInTransaction } from '../../db/mongoose.js';
import { conflict, notFound } from '../../lib/errors.js';
import { Membership, PublishDestination, Session, User } from '../../models/index.js';
import { assertPassword, revokeAllSessions } from '../auth/auth.service.js';
import { adminUserView } from './admin.views.js';
import { recordPlatformAuditOrUndo } from './platformAudit.service.js';

/**
 * Suspending and reactivating SocialHub accounts (docs/ADMIN_PANEL.md). Suspension is
 * `User.status = 'DISABLED'`, enforced by sign-in, refresh, every authenticated request and
 * the publish worker (publishing.processor.js, assertStillAuthorized).
 */

const C = ADMIN_CONFLICT_REASONS;
const WAITING = [...CLAIMABLE_DESTINATION_STATES];
const USER_FIELDS = 'name email status platformRole createdAt lastLoginAt passwordChangedAt';
const objectId = (value) => new mongoose.Types.ObjectId(value);

/** Why `actor` may not suspend `target` right now: `{ reason, message }`, or null. */
export function suspendConflict(actor, target) {
  if (String(target._id) === String(actor._id)) {
    return { reason: C.SELF, message: 'You cannot suspend your own account.' };
  }
  if (isPlatformAdmin(target)) {
    return {
      reason: C.TARGET_IS_PLATFORM_ADMIN,
      message:
        'This person is a platform admin. Remove their admin access first, then suspend the account.',
    };
  }
  if ((target.status ?? USER_STATUS.ACTIVE) !== USER_STATUS.ACTIVE) {
    return { reason: C.ALREADY_SUSPENDED, message: 'This account is already suspended.' };
  }
  return null;
}

const refuse = ({ reason, message }) => conflict(message, { reason });
const alreadySuspended = {
  reason: C.ALREADY_SUSPENDED,
  message: 'This account is already suspended.',
};
const notSuspended = () => conflict('This account is not suspended.', { reason: C.NOT_SUSPENDED });

/**
 * The person as the operator console shows them, read now. `lastActiveAt` is the newest
 * session refresh; null when no session record exists any more (so it is unknown).
 */
export async function loadUserView(userId) {
  const id = objectId(userId);
  const [user, [newest]] = await Promise.all([
    User.findById(id).select(`${USER_FIELDS} +suspension`).lean(),
    Session.find({ user: id }).sort({ lastUsedAt: -1 }).limit(1).select('lastUsedAt').lean(),
  ]);
  if (!user) throw notFound('User not found');
  return adminUserView(user, { lastActiveAt: newest?.lastUsedAt ?? null });
}

/** What suspending this person would end or stop, read now (GET /admin/users/:userId). */
export async function suspensionImpact(userId, { now = new Date() } = {}) {
  const id = objectId(userId);
  const [liveSessions, resetPending, total, owned, [waiting], sendingNow] = await Promise.all([
    Session.countDocuments({ user: id, revokedAt: null, expiresAt: { $gt: now } }),
    // Only whether an unexpired link exists; the stored hash is never read.
    User.exists({ _id: id, 'passwordReset.expiresAt': { $gt: now } }),
    Membership.countDocuments({ user: id }),
    Membership.find({ user: id, role: ROLES.OWNER }).select('workspace').lean(),
    PublishDestination.aggregate([
      { $match: { state: { $in: WAITING }, authorizedBy: id } },
      {
        $group: {
          _id: null,
          deliveries: { $sum: 1 },
          realDeliveries: { $sum: { $cond: [{ $eq: ['$simulated', true] }, 0, 1] } },
          jobs: { $addToSet: '$job' },
        },
      },
      { $project: { _id: 0, deliveries: 1, realDeliveries: 1, posts: { $size: '$jobs' } } },
    ]),
    PublishDestination.countDocuments({ state: DESTINATION_STATES.PROCESSING, authorizedBy: id }),
  ]);
  // Owned workspaces in which nobody else holds the ADMIN role: they would be left without a
  // member who can manage people or connections.
  const withAdmin = owned.length
    ? await Membership.aggregate([
        { $match: { workspace: { $in: owned.map((m) => m.workspace) }, role: ROLES.ADMIN } },
        { $group: { _id: '$workspace' } },
        { $count: 'n' },
      ])
    : [];
  return {
    liveSessions,
    passwordResetPending: Boolean(resetPending),
    workspaces: {
      total,
      owned: owned.length,
      ownedWithoutOtherAdmin: owned.length - (withAdmin[0]?.n ?? 0),
    },
    waitingPosts: {
      posts: waiting?.posts ?? 0,
      deliveries: waiting?.deliveries ?? 0,
      realDeliveries: waiting?.realDeliveries ?? 0,
      sendingNow,
    },
  };
}

/**
 * Suspends an account at once: status, when, by whom and why in one write (which also clears
 * an outstanding reset link), every session revoked, and the audit entry, in one transaction.
 */
export async function suspendUser(actor, userId, { reason, password }, context) {
  const target = await User.findById(userId).select(
    'name email status platformRole +passwordReset',
  );
  if (!target) throw notFound('User not found');
  // Conflicts first: they need no secret and cost no bcrypt round.
  const blocked = suspendConflict(actor, target);
  if (blocked) throw refuse(blocked);
  // The platform admin's own password (422 with fields.password when it is wrong).
  await assertPassword(actor._id, password);

  const now = new Date();
  const resetLinkCleared = Boolean(target.passwordReset && target.passwordReset.expiresAt > now);
  const sessionsEnded = await runInTransaction(async (session) => {
    // Conditional on what was authorised above, so two platform admins cannot both win and a
    // grant made by the command line in between is not overridden.
    const updated = await User.updateOne(
      {
        _id: target._id,
        status: USER_STATUS.ACTIVE,
        platformRole: { $ne: PLATFORM_ROLES.PLATFORM_ADMIN },
      },
      {
        $set: {
          status: USER_STATUS.DISABLED,
          suspension: { at: now, by: actor._id, byName: actor.name, reason },
        },
        $unset: { passwordReset: 1 },
      },
      { session },
    );
    if (updated.modifiedCount !== 1) {
      const current = await User.findById(target._id)
        .select('status platformRole')
        .session(session);
      if (!current) throw notFound('User not found');
      throw refuse(suspendConflict(actor, current) ?? alreadySuspended);
    }
    const ended = await revokeAllSessions(target._id, { reason: 'account_suspended', session });
    // Ended sessions are not brought back by the undo: signing in again is harmless.
    await recordPlatformAuditOrUndo(
      {
        actor,
        action: PLATFORM_AUDIT_ACTIONS.USER_SUSPENDED,
        target: { type: 'user', id: target._id, label: target.name },
        metadata: { email: target.email, reason, sessionsEnded: ended, resetLinkCleared },
        context,
        session,
      },
      () =>
        User.updateOne(
          { _id: target._id, status: USER_STATUS.DISABLED, 'suspension.at': now },
          { $set: { status: USER_STATUS.ACTIVE }, $unset: { suspension: 1 } },
        ),
    );
    return ended;
  });

  // Ids and the count only: never the reason, the email or the request body.
  logger.info(
    { actorId: String(actor._id), userId: String(target._id), sessionsEnded },
    'Account suspended',
  );
  return {
    user: await loadUserView(target._id),
    result: { sessionsEnded, resetLinkCleared },
  };
}

/**
 * Restores sign-in. Sessions stay ended, no reset link comes back, and posts refused during
 * the suspension stay refused; waiting posts are simply no longer refused when their time comes.
 */
export async function reactivateUser(actor, userId, { note, password }, context) {
  const target = await User.findById(userId).select('name email status +suspension');
  if (!target) throw notFound('User not found');
  if (target.status !== USER_STATUS.DISABLED) throw notSuspended();
  await assertPassword(actor._id, password);

  await runInTransaction(async (session) => {
    const updated = await User.updateOne(
      { _id: target._id, status: USER_STATUS.DISABLED },
      { $set: { status: USER_STATUS.ACTIVE }, $unset: { suspension: 1 } },
      { session },
    );
    if (updated.modifiedCount !== 1) throw notSuspended();
    await recordPlatformAuditOrUndo(
      {
        actor,
        action: PLATFORM_AUDIT_ACTIONS.USER_REACTIVATED,
        target: { type: 'user', id: target._id, label: target.name },
        metadata: {
          email: target.email,
          ...(note ? { note } : {}),
          suspendedAt: target.suspension?.at ?? null,
          suspendedReason: target.suspension?.reason ?? null,
        },
        context,
        session,
      },
      () =>
        User.updateOne(
          { _id: target._id, status: USER_STATUS.ACTIVE },
          { $set: { status: USER_STATUS.DISABLED, suspension: target.suspension } },
        ),
    );
  });

  logger.info({ actorId: String(actor._id), userId: String(target._id) }, 'Account reactivated');
  return { user: await loadUserView(target._id) };
}
