import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  canAssignRole,
  canManageMember,
  hasFullAccountAccess,
  hasPermission,
  outranks,
  permissionsForRole,
} from '../src/index.js';

describe('RBAC matrix', () => {
  it('grants owners every permission', () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(hasPermission(ROLES.OWNER, permission)).toBe(true);
    }
  });

  it('reserves deletion and ownership transfer for owners', () => {
    for (const role of [ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER]) {
      expect(hasPermission(role, PERMISSIONS.WORKSPACE_DELETE)).toBe(false);
      expect(hasPermission(role, PERMISSIONS.WORKSPACE_TRANSFER_OWNERSHIP)).toBe(false);
    }
  });

  it('lets admins manage the team and social connections', () => {
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.MEMBERS_INVITE)).toBe(true);
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.MEMBERS_MANAGE)).toBe(true);
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)).toBe(true);
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.ACTIVITY_READ)).toBe(true);
  });

  it('lets editors publish but not manage people or connections', () => {
    expect(hasPermission(ROLES.EDITOR, PERMISSIONS.CONTENT_CREATE)).toBe(true);
    expect(hasPermission(ROLES.EDITOR, PERMISSIONS.CONTENT_PUBLISH)).toBe(true);
    expect(hasPermission(ROLES.EDITOR, PERMISSIONS.MEMBERS_INVITE)).toBe(false);
    expect(hasPermission(ROLES.EDITOR, PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)).toBe(false);
    expect(hasPermission(ROLES.EDITOR, PERMISSIONS.ACTIVITY_READ)).toBe(false);
  });

  it('keeps viewers read-only', () => {
    const writes = permissionsForRole(ROLES.VIEWER).filter((p) => !p.endsWith(':read'));
    expect(writes).toEqual([]);
  });

  it('returns no permissions for unknown roles', () => {
    expect(permissionsForRole('ROOT')).toEqual([]);
    expect(hasPermission(undefined, PERMISSIONS.WORKSPACE_READ)).toBe(false);
  });

  it('orders roles by rank', () => {
    expect(outranks(ROLES.OWNER, ROLES.ADMIN)).toBe(true);
    expect(outranks(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
    expect(outranks(ROLES.VIEWER, ROLES.EDITOR)).toBe(false);
  });

  it('never allows OWNER to be assigned', () => {
    expect(canAssignRole(ROLES.OWNER, ROLES.OWNER)).toBe(false);
  });

  it('allows owners to assign admin, but admins only lower roles', () => {
    expect(canAssignRole(ROLES.OWNER, ROLES.ADMIN)).toBe(true);
    expect(canAssignRole(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
    expect(canAssignRole(ROLES.ADMIN, ROLES.EDITOR)).toBe(true);
    expect(canAssignRole(ROLES.ADMIN, ROLES.VIEWER)).toBe(true);
    expect(canAssignRole(ROLES.EDITOR, ROLES.VIEWER)).toBe(false);
  });

  it('only allows managing strictly lower-ranked members', () => {
    expect(canManageMember(ROLES.OWNER, ROLES.ADMIN)).toBe(true);
    expect(canManageMember(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
    expect(canManageMember(ROLES.ADMIN, ROLES.OWNER)).toBe(false);
    expect(canManageMember(ROLES.ADMIN, ROLES.EDITOR)).toBe(true);
    expect(canManageMember(ROLES.EDITOR, ROLES.VIEWER)).toBe(false);
  });

  it('gives full social account access only to owners and admins', () => {
    expect(hasFullAccountAccess(ROLES.OWNER)).toBe(true);
    expect(hasFullAccountAccess(ROLES.ADMIN)).toBe(true);
    expect(hasFullAccountAccess(ROLES.EDITOR)).toBe(false);
    expect(hasFullAccountAccess(ROLES.VIEWER)).toBe(false);
  });
});
