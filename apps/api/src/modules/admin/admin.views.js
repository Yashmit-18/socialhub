import {
  PLATFORM_AUDIT_ACTIONS,
  ROLES,
  USER_STATUS,
  WORKSPACE_PUBLISHING_MODES,
} from '@socialhub/shared';

/**
 * Allow-list views of the operator console. Each function builds a new object and names every
 * field: none spreads a document, calls toJSON or copies metadata wholesale, so no password
 * hash, reset data, token, session, IP address or browser can leave through a new field. Ids
 * are strings and absent values are null.
 */

const id = (value) => String(value);
const statusOf = (user) => user.status ?? USER_STATUS.ACTIVE;

/** A person on the Users page. */
export function adminUserListView(user, { workspaceCount = 0 } = {}) {
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    status: statusOf(user),
    platformRole: user.platformRole ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    suspendedAt: user.suspension?.at ?? null,
    workspaceCount,
  };
}

/** A person on their detail page and in the answers of suspend and reactivate. */
export function adminUserView(user, { lastActiveAt = null } = {}) {
  const s = user.suspension;
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    status: statusOf(user),
    platformRole: user.platformRole ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    lastActiveAt,
    passwordChangedAt: user.passwordChangedAt ?? null,
    suspension: s ? { at: s.at, by: { id: id(s.by), name: s.byName }, reason: s.reason } : null,
  };
}

/** One of a person's workspaces on their detail page. */
export function adminMembershipView(membership, workspace, { memberCount, adminCount }) {
  return {
    id: id(membership._id),
    workspace: { id: id(workspace._id), name: workspace.name, slug: workspace.slug },
    role: membership.role,
    joinedAt: membership.joinedAt ?? null,
    memberCount,
    adminCount,
    // A workspace has exactly one owner (one_owner_per_workspace), so an owner is the only one.
    onlyOwner: membership.role === ROLES.OWNER,
  };
}

/** Name, email and state of a person shown inside a workspace answer. */
const personView = (user) => ({
  id: id(user._id),
  name: user.name,
  email: user.email,
  status: statusOf(user),
});

const publishingModeOf = (workspace) =>
  workspace.publishingMode ?? WORKSPACE_PUBLISHING_MODES.SIMULATED;

/** A workspace on the Workspaces page. Accounts are counts only: no name, picture or follower count. */
export function adminWorkspaceListView(workspace, { owner, memberCount, accounts }) {
  return {
    id: id(workspace._id),
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt,
    publishingMode: publishingModeOf(workspace),
    owner: owner ? personView(owner) : null,
    memberCount,
    accounts: {
      facebookPages: accounts.facebookPages,
      instagramAccounts: accounts.instagramAccounts,
    },
  };
}

/** A workspace on its detail page. Only the time of the newest activity, never the entry. */
export function adminWorkspaceView(workspace, { lastActivityAt = null } = {}) {
  return {
    id: id(workspace._id),
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    createdAt: workspace.createdAt,
    publishingMode: publishingModeOf(workspace),
    publishingModeChangedAt: workspace.publishingModeChangedAt ?? null,
    lastActivityAt,
  };
}

/** A member of a workspace on its detail page. */
export function adminMemberView(membership, user) {
  return {
    id: id(membership._id),
    user: personView(user),
    role: membership.role,
    joinedAt: membership.joinedAt ?? null,
  };
}

const AUDIT_METADATA_KEYS = {
  [PLATFORM_AUDIT_ACTIONS.USER_SUSPENDED]: ['email', 'reason', 'sessionsEnded', 'resetLinkCleared'],
  [PLATFORM_AUDIT_ACTIONS.USER_REACTIVATED]: ['email', 'note', 'suspendedAt', 'suspendedReason'],
  [PLATFORM_AUDIT_ACTIONS.ADMIN_GRANTED]: ['email', 'via'],
  [PLATFORM_AUDIT_ACTIONS.ADMIN_REVOKED]: ['email', 'via'],
};

/** One entry of the platform audit log. `ip` and `userAgent` are never named. */
export function platformAuditView(entry) {
  const metadata = {};
  for (const key of AUDIT_METADATA_KEYS[entry.action] ?? []) {
    if (entry.metadata?.[key] !== undefined) metadata[key] = entry.metadata[key];
  }
  return {
    id: id(entry._id),
    action: entry.action,
    actor: { id: entry.actor ? id(entry.actor) : null, name: entry.actorName },
    target: {
      type: entry.target.type,
      id: entry.target.id ? id(entry.target.id) : null,
      label: entry.target.label ?? null,
    },
    metadata,
    createdAt: entry.createdAt,
  };
}
