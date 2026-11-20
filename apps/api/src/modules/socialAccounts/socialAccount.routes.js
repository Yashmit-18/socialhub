import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  accountIdsSchema,
  accountMembersPatchSchema,
  crossWorkspaceAccountQuerySchema,
  crossWorkspaceSummaryQuerySchema,
  objectIdSchema,
  socialAccountQuerySchema,
} from '@socialhub/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { loadSocialAccount, requirePermission } from '../../middleware/workspaceAccess.js';
import { updateAccountMembers } from '../members/member.service.js';
import { refreshAccounts, removeAccounts } from '../meta/metaConnection.service.js';
import {
  accountAccessList,
  accountDetail,
  queryAccounts,
  summarizeAccounts,
  userScopes,
  workspaceScope,
} from './accountManagement.service.js';

const accountParams = z.object({ accountId: objectIdSchema });

/**
 * Workspace-scoped destination management, mounted on the workspace router (membership is
 * already enforced). Fixed paths are registered before `/:accountId` ones.
 */
export function mountSocialAccountRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.SOCIAL_ACCOUNTS_READ);
  const manageConnections = requirePermission(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const manageMembers = requirePermission(PERMISSIONS.MEMBERS_MANAGE);

  scoped.get(
    '/social-accounts',
    read,
    validate({ query: socialAccountQuerySchema }),
    async (req, res) => {
      res.json(await queryAccounts(workspaceScope(req.workspace, req.membership), req.valid.query));
    },
  );

  scoped.get('/social-accounts/summary', read, async (req, res) => {
    res.json(await summarizeAccounts(workspaceScope(req.workspace, req.membership)));
  });

  scoped.post(
    '/social-accounts/refresh',
    manageConnections,
    validate({ body: accountIdsSchema }),
    async (req, res) => {
      res.json(
        await refreshAccounts(
          req.workspace,
          req.user,
          req.valid.body.accountIds,
          clientContext(req),
        ),
      );
    },
  );

  scoped.post(
    '/social-accounts/remove',
    manageConnections,
    validate({ body: accountIdsSchema }),
    async (req, res) => {
      res.json(
        await removeAccounts(
          req.workspace,
          req.user,
          req.valid.body.accountIds,
          clientContext(req),
        ),
      );
    },
  );

  scoped.get(
    '/social-accounts/:accountId',
    read,
    validate({ params: accountParams }),
    loadSocialAccount,
    async (req, res) => {
      res.json(await accountDetail(req.workspace, req.membership, req.socialAccount));
    },
  );

  scoped.post(
    '/social-accounts/:accountId/refresh',
    manageConnections,
    validate({ params: accountParams }),
    loadSocialAccount,
    async (req, res) => {
      const result = await refreshAccounts(
        req.workspace,
        req.user,
        [req.socialAccount._id],
        clientContext(req),
      );
      res.json({ result: result.results[0], connections: result.connections });
    },
  );

  scoped.get(
    '/social-accounts/:accountId/access',
    manageMembers,
    validate({ params: accountParams }),
    loadSocialAccount,
    async (req, res) => {
      res.json({
        members: await accountAccessList(req.workspace, req.membership, req.socialAccount),
      });
    },
  );

  scoped.patch(
    '/social-accounts/:accountId/access',
    manageMembers,
    validate({ params: accountParams, body: accountMembersPatchSchema }),
    loadSocialAccount,
    async (req, res) => {
      await updateAccountMembers(
        req.workspace,
        req.membership,
        req.user,
        req.socialAccount,
        req.valid.body,
        clientContext(req),
      );
      res.json({
        members: await accountAccessList(req.workspace, req.membership, req.socialAccount),
      });
    },
  );
}

/** Cross-workspace, read-only overview of every destination the user can see. */
export function crossWorkspaceAccountsRouter() {
  const router = Router();
  router.use(authenticate);

  router.get('/', validate({ query: crossWorkspaceAccountQuerySchema }), async (req, res) => {
    const { workspaceId, ...query } = req.valid.query;
    const scopes = await userScopes(req.user._id, { workspaceId });
    res.json(await queryAccounts(scopes, query, { crossWorkspace: true }));
  });

  router.get(
    '/summary',
    validate({ query: crossWorkspaceSummaryQuerySchema }),
    async (req, res) => {
      const scopes = await userScopes(req.user._id, { workspaceId: req.valid.query.workspaceId });
      res.json({ ...(await summarizeAccounts(scopes)), workspaces: scopes.length });
    },
  );

  return router;
}
