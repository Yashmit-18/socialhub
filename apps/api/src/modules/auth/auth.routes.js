import { Router } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { authenticate, requireClientHeader } from '../../middleware/authenticate.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import * as auth from './auth.service.js';

export const REFRESH_COOKIE = 'sh_rt';
const COOKIE_PATH = '/api/v1/auth';

function cookieOptions() {
  const { secure, sameSite, domain } = config.auth.cookie;
  return { httpOnly: true, secure, sameSite, domain, path: COOKIE_PATH };
}

function sendSession(res, status, { refreshToken, ...payload }) {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(),
    maxAge: config.auth.refreshTtlDays * 86_400_000,
  });
  res.status(status).json(payload);
}

function clearSession(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function authRouter({ authLimiter }) {
  const router = Router();

  router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
    sendSession(res, 201, await auth.register(req.valid.body, clientContext(req)));
  });

  router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
    sendSession(res, 200, await auth.login(req.valid.body, clientContext(req)));
  });

  router.post('/refresh', requireClientHeader, async (req, res) => {
    try {
      sendSession(res, 200, await auth.refresh(req.cookies?.[REFRESH_COOKIE], clientContext(req)));
    } catch (err) {
      // Keep the cookie during a benign multi-tab race; otherwise it is useless — drop it.
      if (err.code !== 'REFRESH_RACE') clearSession(res);
      throw err;
    }
  });

  router.post('/logout', requireClientHeader, async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSession(res);
    res.status(204).end();
  });

  router.post('/logout-all', authenticate, async (req, res) => {
    await auth.revokeAllSessions(req.user._id, { reason: 'logout_all' });
    clearSession(res);
    res.status(204).end();
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user.toJSON() });
  });

  router.post(
    '/forgot-password',
    authLimiter,
    validate({ body: forgotPasswordSchema }),
    async (req, res) => {
      await auth.requestPasswordReset(req.valid.body);
      res.status(202).json({
        message: 'If an account exists for that email, a password reset link has been sent.',
      });
    },
  );

  router.post(
    '/reset-password',
    authLimiter,
    validate({ body: resetPasswordSchema }),
    async (req, res) => {
      await auth.resetPassword(req.valid.body);
      clearSession(res);
      res.status(204).end();
    },
  );

  return router;
}

export function usersRouter() {
  const router = Router();
  router.use(authenticate);

  router.patch('/me', validate({ body: updateProfileSchema }), async (req, res) => {
    res.json({ user: await auth.updateProfile(req.user, req.valid.body) });
  });

  router.post('/me/password', validate({ body: changePasswordSchema }), async (req, res) => {
    await auth.changePassword(req.user._id, req.auth.sessionId, req.valid.body);
    res.status(204).end();
  });

  return router;
}
