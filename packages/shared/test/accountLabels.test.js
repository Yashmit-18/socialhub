import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LABEL_LIMITS,
  ACCOUNT_SORTS,
  LABEL_COLORS,
  accountLabelAssignSchema,
  accountLabelCreateSchema,
  accountLabelUpdateSchema,
  accountNotesSchema,
  socialAccountQuerySchema,
} from '../src/index.js';

const ID = (n) => String(n).padStart(24, 'a');

describe('account label schemas', () => {
  it('trims names, defaults the colour and rejects unknown colours or keys', () => {
    expect(accountLabelCreateSchema.parse({ name: '  Client A ' })).toEqual({
      name: 'Client A',
      color: 'slate',
    });
    expect(LABEL_COLORS).toContain('sky');
    expect(accountLabelCreateSchema.safeParse({ name: 'X', color: 'gold' }).success).toBe(false);
    expect(accountLabelCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      accountLabelCreateSchema.safeParse({ name: 'x'.repeat(ACCOUNT_LABEL_LIMITS.NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(accountLabelCreateSchema.safeParse({ name: 'X', $where: '1' }).success).toBe(false);
  });

  it('requires a change when updating a label', () => {
    expect(accountLabelUpdateSchema.safeParse({}).success).toBe(false);
    expect(accountLabelUpdateSchema.parse({ color: 'red' })).toEqual({ color: 'red' });
  });

  it('requires accounts and at least one change, never the same label added and removed', () => {
    expect(accountLabelAssignSchema.parse({ accountIds: [ID(1)], add: [ID(2)] })).toEqual({
      accountIds: [ID(1)],
      add: [ID(2)],
      remove: [],
    });
    expect(accountLabelAssignSchema.safeParse({ accountIds: [ID(1)] }).success).toBe(false);
    expect(accountLabelAssignSchema.safeParse({ accountIds: [], add: [ID(2)] }).success).toBe(
      false,
    );
    expect(
      accountLabelAssignSchema.safeParse({
        accountIds: [ID(1)],
        add: [ID(2).toUpperCase()],
        remove: [ID(2)],
      }).success,
    ).toBe(false);
  });

  it('limits notes and lets an empty string clear them', () => {
    expect(accountNotesSchema.parse({ notes: '  hi  ' })).toEqual({ notes: 'hi' });
    expect(accountNotesSchema.parse({ notes: '' })).toEqual({ notes: '' });
    expect(
      accountNotesSchema.safeParse({ notes: 'x'.repeat(ACCOUNT_LABEL_LIMITS.NOTES_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe('account listing query', () => {
  it('accepts the label and starred filters and the follower sorts', () => {
    expect(socialAccountQuerySchema.parse({ label: ID(3), starred: 'false' })).toMatchObject({
      label: ID(3),
      starred: false,
    });
    expect(ACCOUNT_SORTS).toEqual(expect.arrayContaining(['-followers', 'followers']));
    expect(socialAccountQuerySchema.safeParse({ label: 'nope' }).success).toBe(false);
    expect(socialAccountQuerySchema.safeParse({ starred: 'yes' }).success).toBe(false);
  });
});
