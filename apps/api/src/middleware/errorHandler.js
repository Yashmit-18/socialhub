import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES, fieldErrorsFromIssues } from '@socialhub/shared';
import { logger } from '../config/logger.js';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, ERROR_CODES.NOT_FOUND, `Route not found: ${req.method} ${req.path}`));
}

function normalise(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'Some fields are invalid', {
      fields: fieldErrorsFromIssues(err.issues),
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return new AppError(400, ERROR_CODES.BAD_REQUEST, 'Request body is not valid JSON');
  }
  if (err?.type === 'entity.too.large') {
    return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large');
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(404, ERROR_CODES.NOT_FOUND, 'Resource not found');
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    return new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'Some fields are invalid', { fields });
  }
  if (isDuplicateKeyError(err)) {
    return new AppError(409, ERROR_CODES.CONFLICT, 'Resource already exists');
  }
  return null;
}

// Express identifies error middleware by arity, so all four parameters are required.
export function errorHandler(err, req, res, _next) {
  const known = normalise(err);
  const status = known?.status ?? 500;

  if (known && status >= 500) {
    // An expected operational condition (storage not configured, a provider outage): worth a
    // warning, but it is not a crash, so no stack trace.
    (req.log ?? logger).warn({ code: known.code, requestId: req.id }, known.message);
  } else if (!known) {
    (req.log ?? logger).error({ err, requestId: req.id }, 'Unhandled error');
  }

  const body = {
    error: {
      code: known?.code ?? ERROR_CODES.INTERNAL_ERROR,
      message: known?.message ?? 'Something went wrong. Please try again.',
      requestId: req.id,
    },
  };
  if (known?.details !== undefined) body.error.details = known.details;

  res.status(status).json(body);
}
