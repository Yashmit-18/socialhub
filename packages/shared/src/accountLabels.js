/**
 * Account organisation: workspace labels (coloured tags such as a client, brand or region
 * that destinations carry), per-person starred destinations and team notes on a destination.
 * Shared by the API (authoritative) and the web app (instant form feedback).
 */
import { z } from 'zod';
import { LIMITS, objectIdSchema } from './schemas.js';

export const ACCOUNT_LABEL_LIMITS = Object.freeze({
  NAME_MAX: 32,
  /** Labels one workspace can define. */
  PER_WORKSPACE_MAX: 100,
  /** Labels one destination can carry. */
  PER_ACCOUNT_MAX: 20,
  NOTES_MAX: 2000,
});

/** Label colours: names only, every client maps them to its own palette. */
export const LABEL_COLORS = Object.freeze([
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'sky',
  'indigo',
  'violet',
  'pink',
]);

export const accountLabelNameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, { error: 'Name is required' })
  .max(ACCOUNT_LABEL_LIMITS.NAME_MAX, {
    error: `Use at most ${ACCOUNT_LABEL_LIMITS.NAME_MAX} characters`,
  });

const labelColorSchema = z.enum(LABEL_COLORS, { error: 'Choose one of the label colours' });

export const accountLabelCreateSchema = z.strictObject({
  name: accountLabelNameSchema,
  color: labelColorSchema.default('slate'),
});

export const accountLabelUpdateSchema = z
  .strictObject({
    name: accountLabelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    error: 'Change the name or the colour',
  });

const labelIdList = z
  .array(objectIdSchema)
  .max(ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX, {
    error: `Use at most ${ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX} labels at a time`,
  })
  .default([]);

/**
 * Adds and/or removes labels on several destinations at once. A label may not be both added
 * and removed, and at least one change is required.
 */
export const accountLabelAssignSchema = z
  .strictObject({
    accountIds: z
      .array(objectIdSchema)
      .min(1, { error: 'Select at least one account' })
      .max(LIMITS.BULK_MAX),
    add: labelIdList,
    remove: labelIdList,
  })
  .refine((value) => value.add.length + value.remove.length > 0, {
    error: 'Choose a label to add or remove',
  })
  .refine(
    (value) => {
      const added = new Set(value.add.map((v) => v.toLowerCase()));
      return !value.remove.some((v) => added.has(v.toLowerCase()));
    },
    { error: 'A label cannot be added and removed at the same time' },
  );

/** Team notes on one destination. An empty string clears them. */
export const accountNotesSchema = z.strictObject({
  notes: z
    .string()
    .trim()
    .max(ACCOUNT_LABEL_LIMITS.NOTES_MAX, {
      error: `Use at most ${ACCOUNT_LABEL_LIMITS.NOTES_MAX} characters`,
    }),
});
