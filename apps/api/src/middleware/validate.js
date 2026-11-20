import { z } from 'zod';
import { fieldErrorsFromIssues } from '@socialhub/shared';
import { validationError } from '../lib/errors.js';

const emptyObject = z.strictObject({});

/**
 * Validates request parts against Zod schemas and exposes the parsed values on
 * `req.valid.{body,query,params}`. Parts without a schema must be empty for body/query
 * (strict by default) so unexpected input never reaches a handler.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const issues = [];
    const out = {};

    const run = (part, schema, value, { allowMissing = false } = {}) => {
      if (!schema) return;
      const input = value === undefined && allowMissing ? {} : value;
      const result = schema.safeParse(input);
      if (result.success) out[part] = result.data;
      else issues.push(...result.error.issues.map((i) => ({ ...i, path: [part, ...i.path] })));
    };

    run('params', params, req.params);
    run('query', query ?? emptyObject, { ...req.query });
    if (body) run('body', body, req.body);

    if (issues.length) {
      const fields = fieldErrorsFromIssues(issues.map((i) => ({ ...i, path: i.path.slice(1) })));
      return next(
        validationError({
          fields,
          issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
        }),
      );
    }

    req.valid = { body: out.body, query: out.query ?? {}, params: out.params ?? req.params };
    next();
  };
}
