/**
 * Role-based access control matrix for SocialHub workspaces.
 *
 * This module is the single source of truth for both the API (enforcement)
 * and the web app (UI gating). The API never trusts the client's view of
 * permissions; the web app only uses it to hide actions a user cannot take.
 */

export const ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
});

export const ROLE_LIST = Object.freeze([ROLES.OWNER, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER]);

/** Roles that can be granted through an invitation or a role change. OWNER moves only by transfer. */
export const ASSIGNABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER]);

export const ROLE_RANK = Object.freeze({
  [ROLES.OWNER]: 4,
  [ROLES.ADMIN]: 3,
  [ROLES.EDITOR]: 2,
  [ROLES.VIEWER]: 1,
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.OWNER]: 'Owner',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.EDITOR]: 'Editor',
  [ROLES.VIEWER]: 'Viewer',
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  [ROLES.OWNER]: 'Full control, including billing-level actions, ownership transfer and deletion.',
  [ROLES.ADMIN]:
    'Manages the team, social connections and all content. Cannot delete the workspace.',
  [ROLES.EDITOR]: 'Creates, schedules and publishes content to the accounts they can access.',
  [ROLES.VIEWER]: 'Read-only access to the workspace, its accounts and content.',
});

export const PERMISSIONS = Object.freeze({
  WORKSPACE_READ: 'workspace:read',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_TRANSFER_OWNERSHIP: 'workspace:transfer_ownership',

  MEMBERS_READ: 'members:read',
  MEMBERS_INVITE: 'members:invite',
  /** Change roles, remove members and edit per-member social account access. */
  MEMBERS_MANAGE: 'members:manage',

  ACTIVITY_READ: 'activity:read',

  SOCIAL_ACCOUNTS_READ: 'social_accounts:read',
  /** Connect, reconnect, refresh and disconnect Meta identities and destinations (Phase 2). */
  SOCIAL_CONNECTIONS_MANAGE: 'social_connections:manage',

  /** Content packages, posts and publishing jobs (Phase 4). */
  CONTENT_READ: 'content:read',
  CONTENT_CREATE: 'content:create',
  CONTENT_PUBLISH: 'content:publish',

  /** Manual Facebook Group distribution workflow (Phase 5). */
  GROUPS_MANAGE: 'groups:manage',
  SHARING_TASKS_COMPLETE: 'sharing_tasks:complete',
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const VIEWER_PERMISSIONS = [
  PERMISSIONS.WORKSPACE_READ,
  PERMISSIONS.MEMBERS_READ,
  PERMISSIONS.SOCIAL_ACCOUNTS_READ,
  PERMISSIONS.CONTENT_READ,
];

const EDITOR_PERMISSIONS = [
  ...VIEWER_PERMISSIONS,
  PERMISSIONS.CONTENT_CREATE,
  PERMISSIONS.CONTENT_PUBLISH,
  PERMISSIONS.SHARING_TASKS_COMPLETE,
];

const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== PERMISSIONS.WORKSPACE_DELETE && p !== PERMISSIONS.WORKSPACE_TRANSFER_OWNERSHIP,
);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: Object.freeze([...ALL_PERMISSIONS]),
  [ROLES.ADMIN]: Object.freeze(ADMIN_PERMISSIONS),
  [ROLES.EDITOR]: Object.freeze(EDITOR_PERMISSIONS),
  [ROLES.VIEWER]: Object.freeze(VIEWER_PERMISSIONS),
});

export function isRole(value) {
  return ROLE_LIST.includes(value);
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}

/** True when `role` is strictly more privileged than `otherRole`. */
export function outranks(role, otherRole) {
  return (ROLE_RANK[role] ?? 0) > (ROLE_RANK[otherRole] ?? 0);
}

/**
 * Whether an actor may grant `targetRole` (via invitation or role change).
 * Owners grant ADMIN/EDITOR/VIEWER; admins grant EDITOR/VIEWER. OWNER is never grantable.
 */
export function canAssignRole(actorRole, targetRole) {
  if (!ASSIGNABLE_ROLES.includes(targetRole)) return false;
  if (!hasPermission(actorRole, PERMISSIONS.MEMBERS_INVITE)) return false;
  return outranks(actorRole, targetRole);
}

/** Whether an actor may change the role of, remove, or edit access for a member holding `targetRole`. */
export function canManageMember(actorRole, targetRole) {
  if (!hasPermission(actorRole, PERMISSIONS.MEMBERS_MANAGE)) return false;
  return outranks(actorRole, targetRole);
}

/** OWNER and ADMIN always see every social account in the workspace; access lists apply to the rest. */
export function hasFullAccountAccess(role) {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}
