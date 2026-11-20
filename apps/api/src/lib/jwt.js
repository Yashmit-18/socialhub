import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '@socialhub/shared';
import { config } from '../config/env.js';
import { unauthenticated } from './errors.js';

const ISSUER = 'socialhub-api';
const AUDIENCE = 'socialhub-web';

export function signAccessToken({ userId, sessionId }) {
  return jwt.sign({ sid: String(sessionId) }, config.auth.accessSecret, {
    subject: String(userId),
    expiresIn: config.auth.accessTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.auth.accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated('Access token expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    throw unauthenticated('Invalid access token');
  }
}
