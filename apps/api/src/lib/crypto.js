import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** URL-safe random token suitable for links (invitations, password resets, refresh tokens). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 digests so a database leak does not expose usable secrets. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
export const ENCRYPTION_KEY_VERSION = 1;

/**
 * Authenticated encryption for third-party credentials at rest (e.g. Meta access tokens).
 * Returns a plain object suitable for embedding in a Mongoose sub-document.
 */
export function encryptSecret(plaintext, key) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('encryptSecret expects a non-empty string');
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('encryptSecret expects a 32-byte key');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: ENCRYPTION_KEY_VERSION,
  };
}

export function decryptSecret(payload, key) {
  if (!payload?.ciphertext || !payload?.iv || !payload?.authTag) {
    throw new TypeError('decryptSecret received an incomplete payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
