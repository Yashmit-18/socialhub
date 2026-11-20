import { rateLimit } from 'express-rate-limit';
import { ERROR_CODES } from '@socialhub/shared';
import { AppError } from '../lib/errors.js';

/**
 * In-memory limiter: correct for a single API instance. When the API is scaled horizontally,
 * swap in a shared store (e.g. rate-limit-redis on the Redis instance used by BullMQ).
 */
function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, ERROR_CODES.RATE_LIMITED, message)),
  });
}

export function createAuthLimiter({ windowMs, max }) {
  return limiter({
    windowMs,
    limit: max,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  });
}

export function createApiLimiter({ perMinute }) {
  return limiter({
    windowMs: 60_000,
    limit: perMinute,
    message: 'Too many requests. Please slow down.',
  });
}
