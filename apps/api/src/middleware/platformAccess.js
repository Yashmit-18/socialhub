import { isPlatformAdmin } from '@socialhub/shared';

/**
 * Platform admins only; runs after `authenticate`. Everyone else leaves the router and gets
 * the answer of an unknown route (app.js: `app.use('/api', notFoundHandler)`), like
 * /health/details without its token, so the admin API cannot be probed.
 */
export function requirePlatformAdmin(req, _res, next) {
  if (!isPlatformAdmin(req.user)) return next('router');
  next();
}
