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

/**
 * Password-confirmed actions (operator actions, password change, ownership transfer, workspace
 * deletion, switching real publishing on). Counted per signed-in person (not per IP), failed
 * attempts only; app.js shares ONE instance between all of them, so a stolen access token
 * cannot be used to guess the password quickly on any route. Must run after `authenticate`.
 */
export function createSensitiveActionLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `sensitive:${req.auth.userId}`,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          ERROR_CODES.RATE_LIMITED,
          'Too many attempts. Please wait a few minutes and try again.',
        ),
      ),
  });
}
