import { z } from 'zod';
import { PERMISSIONS, accountPresetSchema, objectIdSchema } from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as presets from './accountPreset.service.js';

const presetParams = z.object({ presetId: objectIdSchema });

/** Account presets, mounted on the workspace router (membership is already enforced). */
export function mountAccountPresetRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.CONTENT_READ);
  const write = requirePermission(PERMISSIONS.CONTENT_CREATE);

  scoped.get('/account-presets', read, async (req, res) => {
    res.json(await presets.listPresets(req.workspace, req.membership));
  });

  scoped.post(
    '/account-presets',
    write,
    validate({ body: accountPresetSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await presets.createPreset(
            req.workspace,
            req.membership,
            req.user,
            req.valid.body,
            clientContext(req),
          ),
        );
    },
  );

  scoped.delete(
    '/account-presets/:presetId',
    write,
    validate({ params: presetParams }),
    async (req, res) => {
      await presets.deletePreset(
        req.workspace,
        req.membership,
        req.user,
        req.valid.params.presetId,
        clientContext(req),
      );
      res.status(204).end();
    },
  );
}
