import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  accountAccessSchema,
  memberAccountAccessPatchSchema,
  createInvitationSchema,
  createWorkspaceSchema,
  cursorPaginationSchema,
  deleteWorkspaceSchema,
  objectIdSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from '@socialhub/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { loadWorkspace, requirePermission } from '../../middleware/workspaceAccess.js';
import { mountAccountPresetRoutes } from '../accountPresets/accountPreset.routes.js';
import { mountAnalyticsRoutes } from '../analytics/analytics.routes.js';
import { mountGroupRoutes } from '../groups/groups.routes.js';
import { listActivity } from '../activity/activity.service.js';
import { mountContentPackageRoutes } from '../contentPackages/contentPackage.routes.js';
import * as invitations from '../invitations/invitation.service.js';
import { mountMediaRoutes } from '../media/media.routes.js';
import * as members from '../members/member.service.js';
import { mountMetaWorkspaceRoutes } from '../meta/meta.routes.js';
import { mountPublishingRoutes } from '../publishing/publishing.routes.js';
import { mountSocialAccountRoutes } from '../socialAccounts/socialAccount.routes.js';
import { listConnections } from '../socialAccounts/socialAccount.service.js';
import * as workspaces from './workspace.service.js';

const memberParams = z.object({ memberId: objectIdSchema });
const invitationParams = z.object({ invitationId: objectIdSchema });

export function workspacesRouter() {
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res) => {
    res.json({ items: await workspaces.listWorkspacesForUser(req.user._id) });
  });

  router.post('/', validate({ body: createWorkspaceSchema }), async (req, res) => {
    res
      .status(201)
      .json(await workspaces.createWorkspace(req.user, req.valid.body, clientContext(req)));
  });

  // Everything below is scoped to a workspace the caller belongs to.
  const scoped = Router({ mergeParams: true });
  router.use('/:workspaceId', loadWorkspace, scoped);

  scoped.get('/', (req, res) => {
    res.json({
      workspace: req.workspace.toJSON(),
      membership: workspaces.membershipView(req.membership),
    });
  });

  scoped.patch(
    '/',
    requirePermission(PERMISSIONS.WORKSPACE_UPDATE),
    validate({ body: updateWorkspaceSchema }),
    async (req, res) => {
      const workspace = await workspaces.updateWorkspace(
        req.workspace,
        req.user,
        req.valid.body,
        clientContext(req),
      );
      res.json({ workspace });
    },
  );

  scoped.delete(
    '/',
    requirePermission(PERMISSIONS.WORKSPACE_DELETE),
    validate({ body: deleteWorkspaceSchema }),
    async (req, res) => {
      await workspaces.deleteWorkspace(req.workspace, req.user, req.valid.body);
      res.status(204).end();
    },
  );

  scoped.get('/overview', async (req, res) => {
    res.json(await workspaces.workspaceOverview(req.workspace, req.membership));
  });

  scoped.post(
    '/transfer-ownership',
    requirePermission(PERMISSIONS.WORKSPACE_TRANSFER_OWNERSHIP),
    validate({ body: transferOwnershipSchema }),
    async (req, res) => {
      await workspaces.transferOwnership(
        req.workspace,
        req.membership,
        req.user,
        req.valid.body,
        clientContext(req),
      );
      res.status(204).end();
    },
  );

  scoped.post('/leave', async (req, res) => {
    await members.leaveWorkspace(req.workspace, req.membership, req.user, clientContext(req));
    res.status(204).end();
  });

  /* --------------------------------------------------------------- members */

  scoped.get('/members', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res) => {
    res.json({ items: await members.listMembers(req.workspace._id) });
  });

  scoped.patch(
    '/members/:memberId',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ params: memberParams, body: updateMemberRoleSchema }),
    async (req, res) => {
      const member = await members.changeMemberRole(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.memberId,
        req.valid.body,
        clientContext(req),
      );
      res.json({ member });
    },
  );

  scoped.put(
    '/members/:memberId/account-access',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ params: memberParams, body: accountAccessSchema }),
    async (req, res) => {
      const member = await members.updateAccountAccess(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.memberId,
        req.valid.body,
        clientContext(req),
      );
      res.json({ member });
    },
  );

  // Incremental change ({ add, remove }) so two admins editing different accounts never
  // overwrite each other; PUT above replaces the whole grant.
  scoped.patch(
    '/members/:memberId/account-access',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ params: memberParams, body: memberAccountAccessPatchSchema }),
    async (req, res) => {
      const member = await members.patchAccountAccess(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.memberId,
        req.valid.body,
        clientContext(req),
      );
      res.json({ member });
    },
  );

  scoped.delete(
    '/members/:memberId',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ params: memberParams }),
    async (req, res) => {
      await members.removeMember(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.memberId,
        clientContext(req),
      );
      res.status(204).end();
    },
  );

  /* ----------------------------------------------------------- invitations */

  scoped.get('/invitations', requirePermission(PERMISSIONS.MEMBERS_INVITE), async (req, res) => {
    res.json({ items: await invitations.listInvitations(req.workspace._id) });
  });

  scoped.post(
    '/invitations',
    requirePermission(PERMISSIONS.MEMBERS_INVITE),
    validate({ body: createInvitationSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await invitations.createInvitation(
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
    '/invitations/:invitationId/resend',
    requirePermission(PERMISSIONS.MEMBERS_INVITE),
    validate({ params: invitationParams }),
    async (req, res) => {
      res.json(
        await invitations.resendInvitation(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.invitationId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.delete(
    '/invitations/:invitationId',
    requirePermission(PERMISSIONS.MEMBERS_INVITE),
    validate({ params: invitationParams }),
    async (req, res) => {
      await invitations.revokeInvitation(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.invitationId,
        clientContext(req),
      );
      res.status(204).end();
    },
  );

  /* -------------------------------------------------------------- activity */

  scoped.get(
    '/activity',
    requirePermission(PERMISSIONS.ACTIVITY_READ),
    validate({ query: cursorPaginationSchema }),
    async (req, res) => {
      res.json(await listActivity(req.workspace._id, req.valid.query));
    },
  );

  /* -------------------------------------------------- social destinations */

  mountSocialAccountRoutes(scoped);

  scoped.get(
    '/social-connections',
    requirePermission(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE),
    async (req, res) => {
      res.json({ items: await listConnections(req.workspace._id) });
    },
  );

  mountMetaWorkspaceRoutes(scoped);

  /* ------------------------------------------- composer: drafts, media, presets */

  mountContentPackageRoutes(scoped);
  mountMediaRoutes(scoped);
  mountAccountPresetRoutes(scoped);
  // Facebook Group distribution (Phase 6): directory, shares and manual sharing tasks.
  mountGroupRoutes(scoped);
  mountPublishingRoutes(scoped);
  // Analytics & Publishing Intelligence (docs/ANALYTICS.md).
  mountAnalyticsRoutes(scoped);

  return router;
}
