import { Router } from 'express';
import { z } from 'zod';
import {
  adminAuditQuerySchema,
  adminReactivateUserSchema,
  adminSuspendUserSchema,
  adminUserQuerySchema,
  adminWorkspaceQuerySchema,
  objectIdSchema,
} from '@socialhub/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformAdmin } from '../../middleware/platformAccess.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import * as admin from './admin.service.js';
import * as audit from './platformAudit.service.js';
import * as suspension from './suspension.service.js';
import * as system from './systemStatus.js';

const userParams = z.object({ userId: objectIdSchema });
const workspaceParams = z.object({ workspaceId: objectIdSchema });

/**
 * The operator console API (/api/v1/admin, docs/ADMIN_PANEL.md). Platform admins only: anyone
 * else signed in gets exactly the answer of an unknown route, and the guard runs before any
 * validation, so the routes and their parameters cannot be probed. Nothing here grants or
 * revokes platform admin access (scripts/platform-admin.js does).
 */
export function adminRouter({ sensitiveLimiter }) {
  const router = Router();
  router.use(authenticate, requirePlatformAdmin);
  // Operator data is never cached by a browser or a proxy.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/overview', validate(), async (_req, res) => {
    res.json(await admin.getOverview());
  });

  router.get('/users', validate({ query: adminUserQuerySchema }), async (req, res) => {
    res.json(await admin.listUsers(req.valid.query));
  });

  router.get('/users/:userId', validate({ params: userParams }), async (req, res) => {
    res.json(await admin.getUserDetail(req.user, req.valid.params.userId));
  });

  router.post(
    '/users/:userId/suspend',
    sensitiveLimiter,
    validate({ params: userParams, body: adminSuspendUserSchema }),
    async (req, res) => {
      res.json(
        await suspension.suspendUser(
          req.user,
          req.valid.params.userId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  router.post(
    '/users/:userId/reactivate',
    sensitiveLimiter,
    validate({ params: userParams, body: adminReactivateUserSchema }),
    async (req, res) => {
      res.json(
        await suspension.reactivateUser(
          req.user,
          req.valid.params.userId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  router.get('/workspaces', validate({ query: adminWorkspaceQuerySchema }), async (req, res) => {
    res.json(await admin.listWorkspaces(req.valid.query));
  });

  router.get(
    '/workspaces/:workspaceId',
    validate({ params: workspaceParams }),
    async (req, res) => {
      res.json(await admin.getWorkspaceDetail(req.valid.params.workspaceId));
    },
  );

  router.get('/system', validate(), async (_req, res) => {
    res.json(await system.systemStatus());
  });

  router.get('/audit-log', validate({ query: adminAuditQuerySchema }), async (req, res) => {
    res.json(await audit.listPlatformAudit(req.valid.query));
  });

  return router;
}
