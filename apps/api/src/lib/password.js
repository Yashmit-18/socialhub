import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

// Pre-computed hash used to keep login timing uniform when the email does not exist.
let dummyHashPromise;
function dummyHash() {
  dummyHashPromise ??= bcrypt.hash('socialhub-timing-equaliser-0', config.auth.bcryptRounds);
  return dummyHashPromise;
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  if (!hash) {
    await bcrypt.compare(plain, await dummyHash());
    return false;
  }
  return bcrypt.compare(plain, hash);
}
