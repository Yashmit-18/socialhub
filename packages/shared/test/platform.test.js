import { describe, expect, it } from 'vitest';
import {
  ADMIN_LIMITS,
  PERMISSIONS,
  PLATFORM_ROLES,
  adminAuditQuerySchema,
  adminReactivateUserSchema,
  adminSuspendUserSchema,
  adminUserQuerySchema,
  adminWorkspaceQuerySchema,
  isPlatformAdmin,
} from '../src/index.js';

describe('platform administration', () => {
  it('is not a workspace role and grants no workspace permission', () => {
    expect(isPlatformAdmin({ platformRole: 'PLATFORM_ADMIN' })).toBe(true);
    expect(isPlatformAdmin({ platformRole: 'ADMIN' })).toBe(false);
    expect(isPlatformAdmin({ role: 'OWNER' })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(Object.values(PERMISSIONS).join(' ')).not.toMatch(/platform|admin_console/i);
    expect(PLATFORM_ROLES).toEqual({ PLATFORM_ADMIN: 'PLATFORM_ADMIN' });
  });

  it('parses list queries with defaults, trimming and bounds, and refuses unknown keys', () => {
    expect(adminUserQuerySchema.parse({})).toEqual({ sort: '-createdAt', page: 1, limit: 25 });
    expect(adminUserQuerySchema.parse({ q: '  ada  ', page: '2', limit: '100' })).toMatchObject({
      q: 'ada',
      page: 2,
      limit: 100,
    });
    for (const bad of [
      { limit: '101' },
      { limit: '0' },
      { page: '0' },
      { status: 'BANNED' },
      { sort: 'name' },
      { q: 'x'.repeat(ADMIN_LIMITS.SEARCH_MAX + 1) },
      { role: 'OWNER' },
    ]) {
      expect(adminUserQuerySchema.safeParse(bad).success).toBe(false);
    }
    expect(adminWorkspaceQuerySchema.safeParse({ publishingMode: 'LIVE' }).success).toBe(true);
    expect(adminWorkspaceQuerySchema.safeParse({ publishingMode: 'DISABLED' }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ action: 'platform.user_suspended' }).success).toBe(
      true,
    );
    expect(adminAuditQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
  });

  it('needs a reason of 10 to 500 characters and the password to suspend', () => {
    expect(
      adminSuspendUserSchema.parse({ reason: '  Spam on 40 Pages.  ', password: 'pw' }),
    ).toEqual({ reason: 'Spam on 40 Pages.', password: 'pw' });
    for (const bad of [
      { password: 'pw' },
      { reason: '   short   ', password: 'pw' },
      { reason: 'x'.repeat(501), password: 'pw' },
      { reason: 'A long enough reason' },
      { reason: 'A long enough reason', password: '' },
      { reason: 'A long enough reason', password: 'pw', notify: true },
    ]) {
      expect(adminSuspendUserSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts an optional note of at most 500 characters to reactivate', () => {
    expect(adminReactivateUserSchema.parse({ password: 'pw' })).toEqual({ password: 'pw' });
    expect(adminReactivateUserSchema.parse({ note: '  ok  ', password: 'pw' }).note).toBe('ok');
    expect(
      adminReactivateUserSchema.safeParse({ note: 'x'.repeat(501), password: 'pw' }).success,
    ).toBe(false);
    expect(adminReactivateUserSchema.safeParse({ note: 'ok' }).success).toBe(false);
  });
});
