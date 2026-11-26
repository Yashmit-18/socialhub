import { ERROR_CODES } from '@socialhub/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import {
  conflict,
  isDuplicateKeyError,
  unauthenticated,
  validationError,
  AppError,
} from '../../lib/errors.js';
import { signAccessToken } from '../../lib/jwt.js';
import { sendPasswordResetEmail } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { Session, User } from '../../models/index.js';
import { PREVIOUS_TOKEN_HISTORY } from '../../models/Session.js';

const DAY_MS = 86_400_000;

function issueTokens(user, session, refreshToken) {
  return {
    user: user.toJSON(),
    accessToken: signAccessToken({ userId: user._id, sessionId: session._id }),
    accessTokenExpiresIn: config.auth.accessTtlSeconds,
    refreshToken,
  };
}

async function createSession(user, context) {
  const refreshToken = randomToken(48);
  const session = await Session.create({
    user: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + config.auth.refreshTtlDays * DAY_MS),
    ip: context?.ip,
    userAgent: context?.userAgent,
  });
  return issueTokens(user, session, refreshToken);
}

export async function register({ name, email, password }, context) {
  if (await User.exists({ email })) {
    throw conflict('An account with this email already exists', {
      fields: { email: 'An account with this email already exists' },
    });
  }
  let user;
  try {
    user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      lastLoginAt: new Date(),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict('An account with this email already exists', {
        fields: { email: 'An account with this email already exists' },
      });
    }
    throw err;
  }
  return createSession(user, context);
}

/** Shown only after the password was verified. The address is on the public Terms page. */
export const ACCOUNT_SUSPENDED_MESSAGE =
  'This account has been suspended. If you think this is a mistake, write to the address on our Terms of Service page.';

export async function login({ email, password }, context) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid) {
    throw unauthenticated('Email or password is incorrect', ERROR_CODES.INVALID_CREDENTIALS);
  }
  // Said only to someone who proved they know the password, so a stranger cannot learn the
  // state of an account. Every other failure keeps the one generic answer above.
  if (user.status !== 'ACTIVE') {
    throw unauthenticated(ACCOUNT_SUSPENDED_MESSAGE, ERROR_CODES.ACCOUNT_SUSPENDED);
  }
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  return createSession(user, context);
}

/**
 * Rotate a refresh token. The update is conditional on the presented digest, so two
 * concurrent refreshes with the same token cannot both succeed.
 */
export async function refresh(refreshToken, context) {
  if (!refreshToken) throw unauthenticated('No active session');

  const presented = sha256(refreshToken);
  const nextToken = randomToken(48);
  const now = new Date();

  const session = await Session.findOneAndUpdate(
    { tokenHash: presented, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        tokenHash: sha256(nextToken),
        rotatedAt: now,
        lastUsedAt: now,
        ip: context?.ip,
        userAgent: context?.userAgent,
      },
      $push: { previousTokenHashes: { $each: [presented], $slice: -PREVIOUS_TOKEN_HISTORY } },
    },
    { returnDocument: 'after' },
  );

  if (session) {
    const user = await User.findById(session.user);
    if (!user || user.status !== 'ACTIVE') {
      await Session.updateOne(
        { _id: session._id },
        { revokedAt: now, revokedReason: 'account_unavailable' },
      );
      throw unauthenticated('Account unavailable', ERROR_CODES.SESSION_REVOKED);
    }
    return issueTokens(user, session, nextToken);
  }

  // Not the current token. Was it a previously rotated one?
  const reused = await Session.findOne({ previousTokenHashes: presented, revokedAt: null });
  if (reused) {
    const isLatestRotation = reused.previousTokenHashes.at(-1) === presented;
    const withinGrace =
      reused.rotatedAt && now - reused.rotatedAt < config.auth.refreshReuseGraceSeconds * 1000;
    if (isLatestRotation && withinGrace) {
      // Another tab refreshed a moment ago; the browser already holds the new cookie.
      throw new AppError(401, ERROR_CODES.REFRESH_RACE, 'Session was just refreshed; retry');
    }
    await Session.updateOne(
      { _id: reused._id },
      { revokedAt: now, revokedReason: 'refresh_token_reuse' },
    );
    logger.warn(
      { sessionId: String(reused._id), userId: String(reused.user) },
      'Refresh token reuse detected; session revoked',
    );
    throw unauthenticated(
      'Session revoked for security reasons. Please sign in again.',
      ERROR_CODES.SESSION_REVOKED,
    );
  }

  throw unauthenticated('Session expired. Please sign in again.', ERROR_CODES.SESSION_REVOKED);
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  await Session.updateOne(
    { tokenHash: sha256(refreshToken), revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'logout' },
  );
}

export async function revokeAllSessions(userId, { exceptSessionId, reason, session = null }) {
  const filter = { user: userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await Session.updateMany(
    filter,
    { revokedAt: new Date(), revokedReason: reason },
    { session },
  );
  return result.modifiedCount;
}

export async function requestPasswordReset({ email }) {
  const user = await User.findOne({ email, status: 'ACTIVE' });
  // Identical response whether or not the account exists (no account enumeration).
  if (!user) return;

  const token = randomToken(32);
  const ttlMinutes = config.auth.passwordResetTtlMinutes;
  const stored = await User.updateOne(
    { _id: user._id, status: 'ACTIVE' },
    {
      passwordReset: {
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    },
  );
  // Suspended a moment ago: no link, no email. The caller still answers 202 as always.
  if (stored.matchedCount !== 1) return;

  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      url: `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
      ttlMinutes,
    });
  } catch (err) {
    logger.error({ err, userId: String(user._id) }, 'Failed to send password reset email');
  }
}

export async function resetPassword({ token, password }) {
  const passwordHash = await hashPassword(password);
  const now = new Date();
  // Single use: the token condition and its removal happen in one atomic update. A suspended
  // account's link is refused with the same answer as an unknown one.
  const user = await User.findOneAndUpdate(
    {
      'passwordReset.tokenHash': sha256(token),
      'passwordReset.expiresAt': { $gt: now },
      status: 'ACTIVE',
    },
    { $set: { passwordHash, passwordChangedAt: now }, $unset: { passwordReset: 1 } },
    { returnDocument: 'after' },
  );
  if (!user) {
    throw new AppError(400, ERROR_CODES.BAD_REQUEST, 'This reset link is invalid or has expired');
  }
  await revokeAllSessions(user._id, { reason: 'password_reset' });
}

export async function changePassword(userId, sessionId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw validationError({ fields: { currentPassword: 'Current password is incorrect' } });
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id, { exceptSessionId: sessionId, reason: 'password_changed' });
}

/** Re-authentication for destructive actions (workspace deletion, ownership transfer). */
export async function assertPassword(userId, password) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!(await verifyPassword(password, user?.passwordHash))) {
    throw validationError({ fields: { password: 'Password is incorrect' } });
  }
}

export async function updateProfile(user, { name }) {
  user.name = name;
  await user.save();
  return user.toJSON();
}
