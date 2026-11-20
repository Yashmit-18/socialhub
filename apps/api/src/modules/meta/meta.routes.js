import express, { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  cursorPaginationSchema,
  objectIdSchema,
  selectSocialAccountsSchema,
  startMetaAuthorizationSchema,
  syncConnectionsSchema,
} from '@socialhub/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import { notFound } from '../../lib/errors.js';
import {
  dataDeletionStatus,
  handleDataDeletion,
  handleDeauthorize,
} from './metaCallbacks.service.js';
import { connectionDetail, listSyncRuns } from '../socialAccounts/accountManagement.service.js';
import * as connections from './metaConnection.service.js';
import {
  OAUTH_COOKIE_PATH,
  PROVIDER_SLUGS,
  bindingCookieOptions,
  completeAuthorization,
  metaIntegrationStatus,
  startAuthorization,
} from './metaOAuth.service.js';

const connectionParams = z.object({ connectionId: objectIdSchema });
const accountParams = z.object({ accountId: objectIdSchema });
const signedRequestBody = z.object({ signed_request: z.string().min(10).max(8192) });
const formParser = express.urlencoded({ extended: false, limit: '16kb' });

function providerFrom(req) {
  const provider = PROVIDER_SLUGS[req.params.provider];
  if (!provider) throw notFound('Unknown provider');
  return provider;
}

/** Routes Meta calls directly (browser redirects and server-to-server callbacks). */
export function metaPublicRouter() {
  const router = Router();

  router.get('/oauth/:provider/callback', async (req, res) => {
    const provider = providerFrom(req);
    const { redirectUrl, cookieName } = await completeAuthorization({
      provider,
      query: req.query,
      cookies: req.cookies,
      context: clientContext(req),
    });
    if (cookieName) res.clearCookie(cookieName, bindingCookieOptions());
    res.set('Cache-Control', 'no-store');
    res.redirect(302, redirectUrl);
  });

  router.post(
    '/meta/:provider/deauthorize',
    formParser,
    validate({ body: signedRequestBody }),
    async (req, res) => {
      await handleDeauthorize(providerFrom(req), req.valid.body.signed_request);
      res.json({ success: true });
    },
  );

  router.post(
    '/meta/:provider/data-deletion',
    formParser,
    validate({ body: signedRequestBody }),
    async (req, res) => {
      res.json(await handleDataDeletion(providerFrom(req), req.valid.body.signed_request));
    },
  );

  router.get(
    '/meta/data-deletion/:code',
    validate({ params: z.object({ code: z.string().regex(/^[A-Z0-9_-]{6,64}$/i) }) }),
    async (req, res) => {
      res.json(await dataDeletionStatus(req.valid.params.code));
    },
  );

  return router;
}

/** Authenticated, non-workspace integration info (which Meta logins are available). */
export function integrationsRouter() {
  const router = Router();
  router.get('/meta', authenticate, (_req, res) => {
    res.json(metaIntegrationStatus());
  });
  return router;
}

/** Workspace-scoped Meta management, mounted on the workspace router. */
export function mountMetaWorkspaceRoutes(scoped) {
  const manage = requirePermission(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);

  scoped.post(
    '/meta/authorizations',
    manage,
    validate({ body: startMetaAuthorizationSchema }),
    async (req, res) => {
      const { authorizationUrl, expiresAt, purpose, cookie } = await startAuthorization({
        workspace: req.workspace,
        user: req.user,
        ...req.valid.body,
      });
      res.cookie(cookie.name, cookie.value, { ...bindingCookieOptions(), maxAge: cookie.maxAgeMs });
      res.status(201).json({ authorizationUrl, expiresAt, purpose, cookiePath: OAUTH_COOKIE_PATH });
    },
  );

  // Synchronize every (or the listed) connection of the workspace. Registered before the
  // `/:connectionId` routes; one failure never stops the others.
  scoped.post(
    '/social-connections/sync',
    manage,
    validate({ body: syncConnectionsSchema }),
    async (req, res) => {
      res.json(
        await connections.syncWorkspaceConnections(
          req.workspace,
          req.user,
          { connectionIds: req.valid.body.connectionIds },
          clientContext(req),
        ),
      );
    },
  );

  scoped.get(
    '/social-connections/:connectionId',
    manage,
    validate({ params: connectionParams }),
    async (req, res) => {
      res.json(await connectionDetail(req.workspace, req.valid.params.connectionId));
    },
  );

  scoped.get(
    '/social-connections/:connectionId/sync-runs',
    manage,
    validate({ params: connectionParams, query: cursorPaginationSchema }),
    async (req, res) => {
      res.json(await listSyncRuns(req.workspace, req.valid.params.connectionId, req.valid.query));
    },
  );

  scoped.get(
    '/social-connections/:connectionId/discovery',
    manage,
    validate({ params: connectionParams }),
    async (req, res) => {
      res.json(
        await connections.discoverAccounts(req.workspace, req.valid.params.connectionId, {
          context: clientContext(req),
        }),
      );
    },
  );

  scoped.post(
    '/social-connections/:connectionId/accounts',
    manage,
    validate({ params: connectionParams, body: selectSocialAccountsSchema }),
    async (req, res) => {
      res.json(
        await connections.connectAccounts(
          req.workspace,
          req.user,
          req.valid.params.connectionId,
          req.valid.body.accounts,
          clientContext(req),
        ),
      );
    },
  );

  scoped.post(
    '/social-connections/:connectionId/sync',
    manage,
    validate({ params: connectionParams }),
    async (req, res) => {
      res.json(
        await connections.syncWorkspaceConnection(
          req.workspace,
          req.user,
          req.valid.params.connectionId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.post(
    '/social-connections/:connectionId/disconnect',
    manage,
    validate({ params: connectionParams }),
    async (req, res) => {
      res.json(
        await connections.disconnectConnection(
          req.workspace,
          req.user,
          req.valid.params.connectionId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.delete(
    '/social-connections/:connectionId',
    manage,
    validate({ params: connectionParams }),
    async (req, res) => {
      res.json(
        await connections.removeConnection(
          req.workspace,
          req.user,
          req.valid.params.connectionId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.delete(
    '/social-accounts/:accountId',
    manage,
    validate({ params: accountParams }),
    async (req, res) => {
      await connections.removeAccount(
        req.workspace,
        req.user,
        req.valid.params.accountId,
        clientContext(req),
      );
      res.status(204).end();
    },
  );
}
