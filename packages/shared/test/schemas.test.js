import { describe, expect, it } from 'vitest';
import {
  accountAccessSchema,
  changePasswordSchema,
  createInvitationSchema,
  createWorkspaceSchema,
  fieldErrorsFromIssues,
  loginSchema,
  registerSchema,
  updateWorkspaceSchema,
} from '../src/index.js';

describe('auth schemas', () => {
  it('normalises email and accepts a valid registration', () => {
    const result = registerSchema.parse({
      name: '  Ada Lovelace ',
      email: '  Ada@Example.COM ',
      password: 'analytical1',
    });
    expect(result).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'analytical1',
    });
  });

  it('enforces the password policy', () => {
    const short = registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'a1' });
    const noDigit = registerSchema.safeParse({
      name: 'A',
      email: 'a@b.co',
      password: 'abcdefghij',
    });
    const tooLong = registerSchema.safeParse({
      name: 'A',
      email: 'a@b.co',
      password: `a1${'é'.repeat(40)}`,
    });
    expect(short.success).toBe(false);
    expect(noDigit.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });

  it('rejects unknown keys (operator injection guard)', () => {
    const result = loginSchema.safeParse({ email: 'a@b.co', password: 'x', $where: '1' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string credentials', () => {
    const result = loginSchema.safeParse({ email: { $gt: '' }, password: 'x' });
    expect(result.success).toBe(false);
  });

  it('requires a new password that differs from the current one', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'same1234',
      newPassword: 'same1234',
    });
    expect(result.success).toBe(false);
    expect(fieldErrorsFromIssues(result.error.issues)).toHaveProperty('newPassword');
  });
});

describe('workspace schemas', () => {
  it('validates slugs and time zones', () => {
    expect(
      createWorkspaceSchema.safeParse({
        name: 'Acme',
        slug: 'acme-social',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(true);
    expect(createWorkspaceSchema.safeParse({ name: 'Acme', slug: 'Bad Slug' }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: 'Acme', slug: 'api' }).success).toBe(false);
    expect(
      createWorkspaceSchema.safeParse({ name: 'Acme', timezone: 'Mars/Olympus' }).success,
    ).toBe(false);
  });

  it('requires at least one field on update', () => {
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ name: 'New name' }).success).toBe(true);
  });
});

describe('membership schemas', () => {
  it('never accepts OWNER as an invitation role', () => {
    expect(createInvitationSchema.safeParse({ email: 'a@b.co', role: 'OWNER' }).success).toBe(
      false,
    );
    expect(createInvitationSchema.safeParse({ email: 'a@b.co', role: 'EDITOR' }).success).toBe(
      true,
    );
  });

  it('only allows an account list in SELECTED mode', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(accountAccessSchema.safeParse({ mode: 'ALL', socialAccountIds: [id] }).success).toBe(
      false,
    );
    expect(
      accountAccessSchema.safeParse({ mode: 'SELECTED', socialAccountIds: [id] }).success,
    ).toBe(true);
    expect(accountAccessSchema.parse({ mode: 'ALL' })).toEqual({
      mode: 'ALL',
      socialAccountIds: [],
    });
    expect(
      accountAccessSchema.safeParse({ mode: 'SELECTED', socialAccountIds: ['nope'] }).success,
    ).toBe(false);
  });
});
