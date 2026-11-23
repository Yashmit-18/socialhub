import { z } from 'zod';
import {
  PERMISSIONS,
  facebookGroupCreateSchema,
  facebookGroupQuerySchema,
  facebookGroupUpdateSchema,
  groupCategorySchema,
  groupShareAddGroupsSchema,
  groupShareCreateSchema,
  groupShareQuerySchema,
  groupShareUpdateSchema,
  objectIdSchema,
  sharingTaskQuerySchema,
  sharingTaskUpdateSchema,
} from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as directory from './directory.service.js';
import * as sharing from './sharing.service.js';

const params = (name) => z.object({ [name]: objectIdSchema });

/**
 * Facebook Group distribution (Phase 6), mounted on the workspace router (membership is
 * already enforced). Everyone with content:read sees the directory, shares and tasks;
 * groups:manage maintains the directory and creates shares; sharing_tasks:complete works on
 * tasks. Nothing here contacts Facebook.
 */
export function mountGroupRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.CONTENT_READ);
  const manage = requirePermission(PERMISSIONS.GROUPS_MANAGE);
  const complete = requirePermission(PERMISSIONS.SHARING_TASKS_COMPLETE);

  /* ------------------------------------------------------------- categories */

  scoped.get('/group-categories', read, async (req, res) => {
    res.json(await directory.listCategories(req.workspace));
  });
  scoped.post(
    '/group-categories',
    manage,
    validate({ body: groupCategorySchema }),
    async (req, res) => {
      res.status(201).json(await directory.createCategory(req.workspace, req.user, req.valid.body));
    },
  );
  scoped.patch(
    '/group-categories/:categoryId',
    manage,
    validate({ params: params('categoryId'), body: groupCategorySchema }),
    async (req, res) => {
      res.json(
        await directory.renameCategory(req.workspace, req.valid.params.categoryId, req.valid.body),
      );
    },
  );
  scoped.delete(
    '/group-categories/:categoryId',
    manage,
    validate({ params: params('categoryId') }),
    async (req, res) => {
      res.json(await directory.deleteCategory(req.workspace, req.valid.params.categoryId));
    },
  );

  /* ----------------------------------------------------------------- groups */

  scoped.get(
    '/facebook-groups',
    read,
    validate({ query: facebookGroupQuerySchema }),
    async (req, res) => {
      res.json(await directory.listGroups(req.workspace, req.valid.query));
    },
  );
  scoped.post(
    '/facebook-groups',
    manage,
    validate({ body: facebookGroupCreateSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await directory.createGroup(req.workspace, req.user, req.valid.body, clientContext(req)),
        );
    },
  );
  scoped.get(
    '/facebook-groups/:groupId',
    read,
    validate({ params: params('groupId') }),
    async (req, res) => {
      res.json(await directory.groupDetail(req.workspace, req.valid.params.groupId));
    },
  );
  scoped.patch(
    '/facebook-groups/:groupId',
    manage,
    validate({ params: params('groupId'), body: facebookGroupUpdateSchema }),
    async (req, res) => {
      res.json(
        await directory.updateGroup(
          req.workspace,
          req.user,
          req.valid.params.groupId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );
  scoped.delete(
    '/facebook-groups/:groupId',
    manage,
    validate({ params: params('groupId') }),
    async (req, res) => {
      res.json(
        await directory.deleteGroup(
          req.workspace,
          req.user,
          req.valid.params.groupId,
          clientContext(req),
        ),
      );
    },
  );

  /* ----------------------------------------------------------------- shares */

  scoped.get(
    '/group-shares',
    read,
    validate({ query: groupShareQuerySchema }),
    async (req, res) => {
      res.json(await sharing.listShares(req.workspace, req.valid.query));
    },
  );
  scoped.post(
    '/group-shares',
    manage,
    validate({ body: groupShareCreateSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await sharing.createShare(req.workspace, req.user, req.valid.body, clientContext(req)),
        );
    },
  );
  scoped.get(
    '/group-shares/:shareId',
    read,
    validate({ params: params('shareId') }),
    async (req, res) => {
      res.json(await sharing.shareDetail(req.workspace, req.valid.params.shareId));
    },
  );
  scoped.patch(
    '/group-shares/:shareId',
    manage,
    validate({ params: params('shareId'), body: groupShareUpdateSchema }),
    async (req, res) => {
      res.json(await sharing.updateShare(req.workspace, req.valid.params.shareId, req.valid.body));
    },
  );
  scoped.post(
    '/group-shares/:shareId/groups',
    manage,
    validate({ params: params('shareId'), body: groupShareAddGroupsSchema }),
    async (req, res) => {
      res.json(
        await sharing.addShareGroups(
          req.workspace,
          req.user,
          req.valid.params.shareId,
          req.valid.body,
        ),
      );
    },
  );
  scoped.delete(
    '/group-shares/:shareId',
    manage,
    validate({ params: params('shareId') }),
    async (req, res) => {
      res.json(
        await sharing.deleteShare(
          req.workspace,
          req.user,
          req.valid.params.shareId,
          clientContext(req),
        ),
      );
    },
  );

  /* ------------------------------------------------------------------ tasks */

  scoped.get(
    '/sharing-tasks',
    read,
    validate({ query: sharingTaskQuerySchema }),
    async (req, res) => {
      res.json(await sharing.listTasks(req.workspace, req.user, req.valid.query));
    },
  );
  scoped.patch(
    '/sharing-tasks/:taskId',
    complete,
    validate({ params: params('taskId'), body: sharingTaskUpdateSchema }),
    async (req, res) => {
      res.json(
        await sharing.updateTask(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.taskId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );
}
