import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  accountIdsSchema,
  accountLabelAssignSchema,
  accountLabelCreateSchema,
  accountLabelUpdateSchema,
  accountNotesSchema,
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
import { accountsCsv, exportFileName } from './accountExport.js';
import {
  assignLabels,
  createLabel,
  deleteLabel,
  listLabels,
  setNotes,
  setStar,
  updateLabel,
} from './accountOrganization.service.js';
import {
  accountAccessList,
  accountDetail,
  filteredAccounts,
  queryAccounts,
  summarizeAccounts,
  userScopes,
  workspaceScope,
} from './accountManagement.service.js';

const accountParams = z.object({ accountId: objectIdSchema });
const labelParams = z.object({ labelId: objectIdSchema });

/** Sends the CSV export: never cached, always a download. */
function sendCsv(res, csv, fileName) {
  res.set('Cache-Control', 'no-store');
  res.attachment(fileName);
  res.type('text/csv; charset=utf-8');
  res.send(csv);
}

/**
 * Workspace-scoped destination management, mounted on the workspace router (membership is
 * already enforced). Fixed paths are registered before `/:accountId` ones.
 */
export function mountSocialAccountRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.SOCIAL_ACCOUNTS_READ);
  const manageConnections = requirePermission(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const manageMembers = requirePermission(PERMISSIONS.MEMBERS_MANAGE);

  mountAccountLabelRoutes(scoped);

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

  // Same filters and access rules as the listing, every matching row, as CSV.
  scoped.get(
    '/social-accounts/export',
    read,
    validate({ query: socialAccountQuerySchema }),
    async (req, res) => {
      const { items } = await filteredAccounts(
        workspaceScope(req.workspace, req.membership),
        req.valid.query,
      );
      sendCsv(res, accountsCsv(items), exportFileName(req.workspace.slug));
    },
  );

  scoped.post(
    '/social-accounts/labels',
    manageConnections,
    validate({ body: accountLabelAssignSchema }),
    async (req, res) => {
      res.json(
        await assignLabels(
          req.workspace,
          req.membership,
          req.user,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

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

  // Stars are personal: anyone who can see the destination may star it for themselves.
  scoped.put(
    '/social-accounts/:accountId/star',
    read,
    validate({ params: accountParams }),
    loadSocialAccount,
    async (req, res) => {
      res.json(await setStar(req.workspace, req.user, req.socialAccount, true));
    },
  );

  scoped.delete(
    '/social-accounts/:accountId/star',
    read,
    validate({ params: accountParams }),
    loadSocialAccount,
    async (req, res) => {
      res.json(await setStar(req.workspace, req.user, req.socialAccount, false));
    },
  );

  scoped.put(
    '/social-accounts/:accountId/notes',
    manageConnections,
    validate({ params: accountParams, body: accountNotesSchema }),
    loadSocialAccount,
    async (req, res) => {
      res.json(
        await setNotes(
          req.workspace,
          req.user,
          req.socialAccount,
          req.valid.body.notes,
          clientContext(req),
        ),
      );
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

/**
 * Workspace labels (a client, brand, region…) that destinations carry. Everyone who can see
 * accounts can read them; creating, renaming, recolouring and deleting needs
 * social_connections:manage, like labelling destinations.
 */
export function mountAccountLabelRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.SOCIAL_ACCOUNTS_READ);
  const manage = requirePermission(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);

  scoped.get('/account-labels', read, async (req, res) => {
    res.json(await listLabels(req.workspace, req.membership));
  });

  scoped.post(
    '/account-labels',
    manage,
    validate({ body: accountLabelCreateSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(await createLabel(req.workspace, req.user, req.valid.body, clientContext(req)));
    },
  );

  scoped.patch(
    '/account-labels/:labelId',
    manage,
    validate({ params: labelParams, body: accountLabelUpdateSchema }),
    async (req, res) => {
      res.json(
        await updateLabel(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.labelId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  scoped.delete(
    '/account-labels/:labelId',
    manage,
    validate({ params: labelParams }),
    async (req, res) => {
      res.json(
        await deleteLabel(req.workspace, req.user, req.valid.params.labelId, clientContext(req)),
      );
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

  router.get('/export', validate({ query: crossWorkspaceAccountQuerySchema }), async (req, res) => {
    const { workspaceId, ...query } = req.valid.query;
    const scopes = await userScopes(req.user._id, { workspaceId });
    const { items } = await filteredAccounts(scopes, query, { crossWorkspace: true });
    const slug = workspaceId ? scopes[0]?.workspace?.slug : 'all-workspaces';
    sendCsv(res, accountsCsv(items, { crossWorkspace: true }), exportFileName(slug));
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
