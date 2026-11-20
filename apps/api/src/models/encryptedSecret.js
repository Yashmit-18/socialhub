import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

/** AES-256-GCM envelope stored in place of any third-party credential. */
export const encryptedSecretSchema = new mongoose.Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * Adds `setAccessToken(plain)` / `getAccessToken()` and a hidden `accessToken` path.
 * The path is `select: false`: token material is only loaded when a service explicitly
 * asks for it with `.select('+accessToken')`, and it is always stripped from JSON.
 */
export function encryptedAccessTokenPlugin(schema) {
  schema.add({
    accessToken: { type: encryptedSecretSchema, select: false, default: undefined },
  });

  schema.methods.setAccessToken = function setAccessToken(plain) {
    this.accessToken = encryptSecret(plain, config.tokenEncryptionKey);
  };

  schema.methods.getAccessToken = function getAccessToken() {
    if (!this.accessToken?.ciphertext) return null;
    return decryptSecret(this.accessToken, config.tokenEncryptionKey);
  };

  schema.methods.hasAccessToken = function hasAccessToken() {
    return Boolean(this.accessToken?.ciphertext);
  };
}
