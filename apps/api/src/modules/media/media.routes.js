import { z } from 'zod';
import { PERMISSIONS, mediaUploadRequestSchema, objectIdSchema } from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as media from './media.service.js';

const mediaParams = z.object({ mediaId: objectIdSchema });

/** Composer media, mounted on the workspace router (membership is already enforced). */
export function mountMediaRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.CONTENT_READ);
  const write = requirePermission(PERMISSIONS.CONTENT_CREATE);

  scoped.post(
    '/media/uploads',
    write,
    validate({ body: mediaUploadRequestSchema }),
    async (req, res) => {
      res.status(201).json(await media.createUpload(req.workspace, req.user, req.valid.body));
    },
  );

  scoped.post(
    '/media/:mediaId/complete',
    write,
    validate({ params: mediaParams }),
    async (req, res) => {
      res.json(
        await media.completeUpload(
          req.workspace,
          req.user,
          req.valid.params.mediaId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.get('/media/:mediaId', read, validate({ params: mediaParams }), async (req, res) => {
    res.json(await media.getMedia(req.workspace, req.valid.params.mediaId));
  });

  scoped.delete('/media/:mediaId', write, validate({ params: mediaParams }), async (req, res) => {
    await media.deleteMedia(
      req.workspace,
      req.membership,
      req.user,
      req.valid.params.mediaId,
      clientContext(req),
    );
    res.status(204).end();
  });
}
