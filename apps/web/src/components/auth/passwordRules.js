import { LIMITS } from '@socialhub/shared';

/**
 * The password rules a person can see while typing. They mirror `passwordSchema` in
 * packages/shared/src/schemas.js (the 72-byte ceiling is left out: it is an upper bound nobody
 * reaches by accident, and the field reports it if they do).
 */
export const PASSWORD_RULES = [
  {
    id: 'length',
    label: `${LIMITS.PASSWORD_MIN}+ characters`,
    test: (value) => value.length >= LIMITS.PASSWORD_MIN,
  },
  { id: 'letter', label: 'A letter', test: (value) => /[A-Za-z]/.test(value) },
  { id: 'number', label: 'A number', test: (value) => /\d/.test(value) },
];

/** Each rule with whether `value` meets it. */
export function checkPassword(value = '') {
  return PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(value) }));
}
