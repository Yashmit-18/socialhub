/**
 * Re-encrypts every stored Meta access token from the current TOKEN_ENCRYPTION_KEY to a new
 * one (`npm run secrets:rotate-key -w @socialhub/api`). Tokens are AES-256-GCM envelopes
 * (lib/crypto.js) on SocialConnection and SocialAccount; nothing else is encrypted with the key.
 *
 * Safe by construction:
 *  - a dry run (the default) only reports what would change;
 *  - before writing anything, every token must be readable with the current key (or already
 *    with the new one); if any is not, nothing is written;
 *  - each write only replaces the exact envelope that was read, so a token changed meanwhile
 *    is never overwritten;
 *  - afterwards every token is decrypted again with the new key;
 *  - running it twice is harmless: tokens already on the new key are skipped.
 * No token, key or plaintext is ever returned or logged; only counts and document ids.
 */
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { SocialAccount, SocialConnection } from '../models/index.js';

/** Models that carry the encrypted `accessToken` envelope (encryptedAccessTokenPlugin). */
export const ENCRYPTED_TOKEN_MODELS = Object.freeze([SocialConnection, SocialAccount]);

/** A key as written in .env: 32 bytes, base64 (`npm run secrets` prints one). */
export function parseEncryptionKey(value, name = 'key') {
  const key = Buffer.from(String(value ?? '').trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${name} must be 32 bytes encoded as base64 (generate one with npm run secrets).`,
    );
  }
  return key;
}

const readable = (payload, key) => {
  try {
    decryptSecret(payload, key);
    return true;
  } catch {
    return false;
  }
};

const withTokens = (Model) =>
  Model.collection.find(
    { 'accessToken.ciphertext': { $exists: true } },
    { projection: { accessToken: 1 } },
  );

/**
 * @param {{ currentKey: Buffer, newKey: Buffer, apply?: boolean, models?: object[] }} options
 * @returns per-model counts: tokens, toRotate, alreadyNewKey, unreadable (+ ids), rotated,
 *   changedMeanwhile, verifiedWithNewKey.
 */
export async function rotateTokenKey({
  currentKey,
  newKey,
  apply = false,
  models = ENCRYPTED_TOKEN_MODELS,
}) {
  if (currentKey.equals(newKey)) {
    throw new Error('The new key is the same as the current key: nothing to rotate.');
  }

  // 1. Check every token first.
  const report = { apply, models: {}, unreadable: 0 };
  for (const Model of models) {
    const counts = {
      tokens: 0,
      toRotate: 0,
      alreadyNewKey: 0,
      unreadable: 0,
      unreadableIds: [],
      rotated: 0,
      changedMeanwhile: 0,
      verifiedWithNewKey: 0,
    };
    for await (const doc of withTokens(Model)) {
      counts.tokens += 1;
      if (readable(doc.accessToken, currentKey)) counts.toRotate += 1;
      else if (readable(doc.accessToken, newKey)) counts.alreadyNewKey += 1;
      else {
        counts.unreadable += 1;
        if (counts.unreadableIds.length < 20) counts.unreadableIds.push(String(doc._id));
      }
    }
    report.models[Model.modelName] = counts;
    report.unreadable += counts.unreadable;
  }
  if (!apply) return report;
  if (report.unreadable > 0) {
    const error = new Error(
      `${report.unreadable} token(s) cannot be read with the current or the new key. Nothing was changed.`,
    );
    error.report = report;
    throw error;
  }

  // 2. Re-encrypt, replacing only the envelope that was read.
  for (const Model of models) {
    const counts = report.models[Model.modelName];
    for await (const doc of withTokens(Model)) {
      if (!readable(doc.accessToken, currentKey)) continue; // already on the new key
      const plain = decryptSecret(doc.accessToken, currentKey);
      const envelope = {
        ...encryptSecret(plain, newKey),
        keyVersion: doc.accessToken.keyVersion ?? 1,
      };
      const result = await Model.collection.updateOne(
        { _id: doc._id, 'accessToken.ciphertext': doc.accessToken.ciphertext },
        { $set: { accessToken: envelope } },
      );
      if (result.modifiedCount === 1) counts.rotated += 1;
      else counts.changedMeanwhile += 1;
    }
  }

  // 3. Every token must now open with the new key.
  for (const Model of models) {
    const counts = report.models[Model.modelName];
    for await (const doc of withTokens(Model)) {
      if (readable(doc.accessToken, newKey)) counts.verifiedWithNewKey += 1;
    }
  }
  return report;
}
