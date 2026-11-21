import { z } from 'zod';
import {
  PERMISSIONS,
  contentPackageInputSchema,
  contentPackageQuerySchema,
  contentPackageUpdateSchema,
  objectIdSchema,
} from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as drafts from './contentPackage.service.js';

const packageParams = z.object({ packageId: objectIdSchema });

/** Composer drafts, mounted on the workspace router (membership is already enforced). */
export function mountContentPackageRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.CONTENT_READ);
  const write = requirePermission(PERMISSIONS.CONTENT_CREATE);

  scoped.get(
    '/content-packages',
    read,
    validate({ query: contentPackageQuerySchema }),
    async (req, res) => {
      res.json(await drafts.listDrafts(req.workspace, req.membership, req.valid.query));
    },
  );

  scoped.post(
    '/content-packages',
    write,
    validate({ body: contentPackageInputSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await drafts.createDraft(
            req.workspace,
            req.membership,
            req.user,
            req.valid.body,
            clientContext(req),
          ),
        );
    },
  );

  scoped.get(
    '/content-packages/:packageId',
    read,
    validate({ params: packageParams }),
    async (req, res) => {
      res.json(await drafts.getDraft(req.workspace, req.membership, req.valid.params.packageId));
    },
  );

  scoped.patch(
    '/content-packages/:packageId',
    write,
    validate({ params: packageParams, body: contentPackageUpdateSchema }),
    async (req, res) => {
      res.json(
        await drafts.updateDraft(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.packageId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  scoped.delete(
    '/content-packages/:packageId',
    write,
    validate({ params: packageParams }),
    async (req, res) => {
      await drafts.deleteDraft(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.packageId,
        clientContext(req),
      );
      res.status(204).end();
    },
  );
}
