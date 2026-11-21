import { ACCOUNT_ACCESS_MODES, hasFullAccountAccess } from '@socialhub/shared';

/** Helpers for members' social account access (Team page and Team access tab). */

export const memberName = (member) => member.user?.name ?? 'Former member';
export const savedMode = (member) => member.accountAccess?.mode ?? ACCOUNT_ACCESS_MODES.SELECTED;
export const savedIds = (member) => new Set(member.accountAccess?.socialAccountIds ?? []);

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * What a member (or an invitation, which has the same `role` + `accountAccess` shape) can use:
 * `{ kind: 'full' | 'all' | 'none' | 'some', label, hint }`.
 */
export function describeAccess(role, accountAccess) {
  if (hasFullAccountAccess(role)) {
    return {
      kind: 'full',
      label: 'Full access',
      hint: 'Owners and admins always use every social account in this workspace.',
    };
  }
  if (accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) {
    return {
      kind: 'all',
      label: 'All accounts',
      hint: 'Every current and future social account in this workspace.',
    };
  }
  const count = accountAccess?.socialAccountIds?.length ?? 0;
  if (count === 0) {
    return { kind: 'none', label: 'No accounts', hint: 'No social accounts are assigned yet.' };
  }
  return {
    kind: 'some',
    label: plural(count, 'account'),
    hint: `Only the ${plural(count, 'assigned social account')}.`,
  };
}

/** `{ add, remove }` that turns the ids in `before` into the ids in `after` (both in list order). */
export function accessChanges(before, after) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    add: after.filter((id) => !was.has(id)),
    remove: before.filter((id) => !now.has(id)),
  };
}
