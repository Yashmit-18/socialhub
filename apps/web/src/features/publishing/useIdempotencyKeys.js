import { useCallback, useRef } from 'react';
import { newIdempotencyKey } from './labels.js';

/**
 * One idempotency key per distinct "publish" request for as long as the dialog is open.
 *
 * Sending the same request again (a second click, a retry after a network error or a 503)
 * reuses its key, so the server returns the job it may already have created instead of
 * creating a second one. Changing the draft, the accounts or the time is a different request
 * and gets a new key; reusing the old key for it would be refused.
 *
 * "Publish again anyway" keeps the key: it only follows a 409 ALREADY_PUBLISHED answer,
 * which created nothing, so the key is still unused.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map());
  return useCallback((request) => {
    const signature = JSON.stringify({
      p: request.contentPackageId ?? null,
      a: request.socialAccountIds ? [...request.socialAccountIds].sort() : null,
      s: request.scheduledAt ?? null,
    });
    if (!keys.current.has(signature)) keys.current.set(signature, newIdempotencyKey());
    return keys.current.get(signature);
  }, []);
}
