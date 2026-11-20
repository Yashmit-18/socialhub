import mongoose from 'mongoose';
import { CLIENT_HEADER, ERROR_CODES } from '@socialhub/shared';
import { AppError, unauthenticated } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { Session, User } from '../models/index.js';

function bearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

/**
 * Requires a valid access token AND a live session, so logout / logout-all / password
 * resets take effect immediately instead of waiting for the JWT to expire.
 */
export async function authenticate(req, _res, next) {
  const token = bearerToken(req);
  if (!token) throw unauthenticated();

  const { userId, sessionId } = verifyAccessToken(token);
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(sessionId)) {
    throw unauthenticated('Invalid access token');
  }

  const [session, user] = await Promise.all([
    Session.findOne({
      _id: sessionId,
      user: userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .select('_id')
      .lean(),
    User.findById(userId),
  ]);

  if (!session) throw unauthenticated('Session has ended', ERROR_CODES.SESSION_REVOKED);
  if (!user || user.status !== 'ACTIVE') throw unauthenticated('Account unavailable');

  req.user = user;
  req.auth = { userId: String(user._id), sessionId: String(session._id) };
  next();
}

/**
 * Cookie-authenticated endpoints (refresh, logout) require a custom header. Browsers cannot
 * attach custom headers to cross-site requests without a CORS preflight, which our CORS
 * policy only grants to trusted origins — a lightweight CSRF guard.
 */
export function requireClientHeader(req, _res, next) {
  if (req.get(CLIENT_HEADER) !== 'web') {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, `Missing ${CLIENT_HEADER} header`);
  }
  next();
}
