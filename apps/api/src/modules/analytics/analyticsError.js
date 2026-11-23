import { META_ERROR_KINDS, MetaApiError } from '../../integrations/meta/http.js';
import { sanitizeProviderText } from '../publishing/publishError.js';

/** Why an insights sync could not (fully) run. Messages are shown to people as they are. */
export const ANALYTICS_ERROR_CODES = Object.freeze({
  ACCOUNT_REMOVED: 'ACCOUNT_REMOVED',
  NEEDS_RECONNECT: 'NEEDS_RECONNECT',
  PERMISSION_MISSING: 'PERMISSION_MISSING',
  RATE_LIMITED: 'RATE_LIMITED',
  PLATFORM_UNAVAILABLE: 'PLATFORM_UNAVAILABLE',
  PLATFORM_REJECTED: 'PLATFORM_REJECTED',
  LIVE_ANALYTICS_DISABLED: 'LIVE_ANALYTICS_DISABLED',
  INTERRUPTED: 'INTERRUPTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export class AnalyticsError extends Error {
  constructor(code, message, { retryable = false, retryAfterMs, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AnalyticsError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const E = ANALYTICS_ERROR_CODES;
const RATE_LIMIT_WAIT_MS = 15 * 60 * 1000;

/** Maps a Meta API failure to an AnalyticsError. Reading insights is safe to repeat. */
export function fromMetaError(err, platformName) {
  if (!(err instanceof MetaApiError)) return err;
  const detail = sanitizeProviderText(err.message);
  switch (err.kind) {
    case META_ERROR_KINDS.TOKEN_EXPIRED:
    case META_ERROR_KINDS.TOKEN_REVOKED:
      return new AnalyticsError(
        E.NEEDS_RECONNECT,
        `${platformName} no longer accepts this login. Reconnect the account, then sync again.`,
        { cause: err },
      );
    case META_ERROR_KINDS.PERMISSION_DENIED:
      return new AnalyticsError(
        E.PERMISSION_MISSING,
        `${platformName} refused to share insights for this account (missing permission or role).`,
        { cause: err },
      );
    case META_ERROR_KINDS.RATE_LIMITED:
      return new AnalyticsError(
        E.RATE_LIMITED,
        `${platformName} asked SocialHub to slow down. The sync will try again later.`,
        { retryable: true, retryAfterMs: RATE_LIMIT_WAIT_MS, cause: err },
      );
    case META_ERROR_KINDS.TRANSIENT:
      return new AnalyticsError(
        E.PLATFORM_UNAVAILABLE,
        `${platformName} had a temporary problem.`,
        { retryable: true, cause: err },
      );
    default:
      return new AnalyticsError(
        E.PLATFORM_REJECTED,
        `${platformName} did not accept the insights request${detail ? `: ${detail}` : '.'}`,
        { cause: err },
      );
  }
}
