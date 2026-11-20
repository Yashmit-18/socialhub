import { createHmac, timingSafeEqual } from 'node:crypto';

export class SignedRequestError extends Error {}

/**
 * Verifies and decodes a Meta `signed_request` (deauthorize / data-deletion callbacks):
 * "<base64url HMAC-SHA256 signature>.<base64url JSON payload>", signed with the app secret.
 */
export function parseSignedRequest(signedRequest, appSecret) {
  if (typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
    throw new SignedRequestError('Malformed signed_request');
  }
  const [encodedSignature, encodedPayload] = signedRequest.split('.', 2);
  if (!encodedSignature || !encodedPayload)
    throw new SignedRequestError('Malformed signed_request');

  const signature = Buffer.from(encodedSignature, 'base64url');
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new SignedRequestError('Invalid signed_request signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new SignedRequestError('Malformed signed_request payload');
  }
  if (String(payload.algorithm ?? '').toUpperCase() !== 'HMAC-SHA256') {
    throw new SignedRequestError('Unsupported signed_request algorithm');
  }
  if (!payload.user_id) throw new SignedRequestError('signed_request has no user_id');
  return payload;
}
