import { PUBLISH_ERROR_CODES, UNCERTAIN_PUBLISH_ERROR_CODES } from '@socialhub/shared';
import { META_ERROR_KINDS, MetaApiError } from '../../integrations/meta/http.js';

/**
 * Why one destination could not be published. `message` is written for people and is stored
 * and shown as is, so it must never contain a token, a signed URL or a raw provider dump.
 */
export class PublishError extends Error {
  constructor(code, message, { retryable = false, retryAfterMs, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PublishError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }

  get uncertain() {
    return UNCERTAIN_PUBLISH_ERROR_CODES.includes(this.code);
  }
}

const E = PUBLISH_ERROR_CODES;
const MAX_DETAIL = 240;

/** Removes anything that could be a credential from provider text, and bounds its length. */
export function sanitizeProviderText(text) {
  return String(text ?? '')
    .replace(
      /(access_token|appsecret_proof|client_secret|code|signature|token)=[^&\s"']+/gi,
      '$1=[removed]',
    )
    .replace(/\b(?:EAA|IGQ|IGAA)[A-Za-z0-9_-]{16,}/g, '[removed]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL);
}

const RATE_LIMIT_WAIT_MS = 10 * 60 * 1000;
/** Instagram's 24-hour publishing limit (error subcode 2207042): wait an hour, then check again. */
const PUBLISHING_LIMIT_WAIT_MS = 60 * 60 * 1000;
const IG_PUBLISHING_LIMIT_SUBCODE = 2207042;

/**
 * Turns a failed Meta call into a PublishError.
 *
 * `committing` marks the call that actually creates the post. If such a call fails in a way
 * that does not prove the post was NOT created (no answer, an unreadable answer, a server
 * error without Meta's "transient, retry" marker, or Meta's "unknown error" code 1), the post
 * may or may not exist, so it is never retried automatically: a person checks the account
 * and confirms the retry. Only an explicit refusal (`is_transient`, code 2 "service
 * temporarily unavailable", a rate limit, a validation error) is safe to retry.
 */
export function fromMetaError(err, { platformName, committing = false }) {
  if (err instanceof PublishError) return err;
  if (!(err instanceof MetaApiError)) {
    return new PublishError(E.INTERNAL_ERROR, 'Something went wrong while publishing.', {
      retryable: !committing,
      cause: err,
    });
  }
  const detail = sanitizeProviderText(err.message);
  if (err.subcode === IG_PUBLISHING_LIMIT_SUBCODE) {
    return new PublishError(
      E.RATE_LIMITED,
      `${platformName} says this account reached its limit of posts published through apps in 24 hours. It will be tried again later.`,
      { retryable: true, retryAfterMs: PUBLISHING_LIMIT_WAIT_MS, cause: err },
    );
  }
  switch (err.kind) {
    case META_ERROR_KINDS.TOKEN_EXPIRED:
    case META_ERROR_KINDS.TOKEN_REVOKED:
      return new PublishError(
        E.ACCOUNT_NEEDS_RECONNECT,
        'The login for this account is no longer valid. Reconnect the account, then retry.',
        { cause: err },
      );
    case META_ERROR_KINDS.PERMISSION_DENIED:
      return new PublishError(
        E.PERMISSION_DENIED,
        `${platformName} did not allow this post. The account is missing a permission needed to publish.`,
        { cause: err },
      );
    case META_ERROR_KINDS.RATE_LIMITED:
      return new PublishError(
        E.RATE_LIMITED,
        `${platformName} is limiting how often this account can post. It will be tried again later.`,
        {
          retryable: true,
          // Meta's own estimate when it gives one, but never sooner than 10 minutes.
          retryAfterMs: Math.max(RATE_LIMIT_WAIT_MS, err.retryAfterMs ?? 0),
          cause: err,
        },
      );
    case META_ERROR_KINDS.TRANSIENT:
      if (committing && err.httpStatus === undefined) {
        return new PublishError(
          E.OUTCOME_UNKNOWN,
          `${platformName} did not answer after the post was sent. It may or may not have been published. Check the account before retrying.`,
          { cause: err },
        );
      }
      if (committing && !err.isTransient && err.code !== 2) {
        return new PublishError(
          E.OUTCOME_UNKNOWN,
          `${platformName} reported an error after the post was sent, without confirming whether it was created. It may or may not have been published. Check the account before retrying.`,
          { cause: err },
        );
      }
      return new PublishError(
        E.PLATFORM_UNAVAILABLE,
        `${platformName} could not be reached or had a temporary problem.`,
        { retryable: true, cause: err },
      );
    default:
      return new PublishError(
        E.PLATFORM_REJECTED,
        `${platformName} did not accept this post${detail ? `: ${detail}` : '.'}`,
        { cause: err },
      );
  }
}
