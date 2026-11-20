import { Router } from 'express';
import { z } from 'zod';
import { invitationTokenSchema } from '@socialhub/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { acceptInvitation, previewInvitation } from './invitation.service.js';

const tokenParams = z.object({ token: invitationTokenSchema });

/** Token-addressed invitation endpoints used by the invitee (not workspace-scoped). */
export function invitationsRouter() {
  const router = Router();

  router.get('/:token', validate({ params: tokenParams }), async (req, res) => {
    res.json({ invitation: await previewInvitation(req.valid.params.token) });
  });

  router.post(
    '/:token/accept',
    authenticate,
    validate({ params: tokenParams }),
    async (req, res) => {
      res.json(await acceptInvitation(req.valid.params.token, req.user, clientContext(req)));
    },
  );

  return router;
}
