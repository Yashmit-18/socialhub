import { z } from 'zod';
import {
  PERMISSIONS,
  createPublishJobSchema,
  objectIdSchema,
  publishJobQuerySchema,
  rescheduleJobSchema,
  retryDestinationSchema,
  updatePublishingModeSchema,
} from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as publishing from './publishing.service.js';

const jobParams = z.object({ jobId: objectIdSchema });
const destinationParams = z.object({ jobId: objectIdSchema, destinationId: objectIdSchema });
const noBody = z.strictObject({});

/**
 * Publishing jobs, mounted on the workspace router (membership is already enforced).
 * Reading needs content:read; creating, rescheduling, cancelling and retrying need
 * content:publish, and the service additionally checks access to every account involved.
 */
export function mountPublishingRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.CONTENT_READ);
  const publish = requirePermission(PERMISSIONS.CONTENT_PUBLISH);

  scoped.get('/publishing/status', read, async (req, res) => {
    res.json(await publishing.getStatus(req.workspace));
  });

  // Simulated or real publishing for this workspace: owners and admins only.
  scoped.put(
    '/publishing/mode',
    requirePermission(PERMISSIONS.WORKSPACE_UPDATE),
    validate({ body: updatePublishingModeSchema }),
    async (req, res) => {
      res.json(
        await publishing.setPublishingMode(
          req.workspace,
          req.user,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  scoped.get('/publish-jobs/summary', read, async (req, res) => {
    res.json(await publishing.getSummary(req.workspace, req.membership));
  });

  scoped.get(
    '/publish-jobs',
    read,
    validate({ query: publishJobQuerySchema }),
    async (req, res) => {
      res.json(await publishing.listJobs(req.workspace, req.membership, req.valid.query));
    },
  );

  scoped.post(
    '/publish-jobs',
    publish,
    validate({ body: createPublishJobSchema }),
    async (req, res) => {
      const result = await publishing.createJob(
        req.workspace,
        req.membership,
        req.user,
        req.valid.body,
        clientContext(req),
      );
      // 200 when the same request had already created this job.
      res.status(result.created ? 201 : 200).json(result);
    },
  );

  scoped.get('/publish-jobs/:jobId', read, validate({ params: jobParams }), async (req, res) => {
    res.json(await publishing.getJob(req.workspace, req.membership, req.valid.params.jobId));
  });

  scoped.post(
    '/publish-jobs/:jobId/cancel',
    publish,
    validate({ params: jobParams, body: noBody.optional() }),
    async (req, res) => {
      res.json(
        await publishing.cancelJob(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.jobId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.patch(
    '/publish-jobs/:jobId/schedule',
    publish,
    validate({ params: jobParams, body: rescheduleJobSchema }),
    async (req, res) => {
      res.json(
        await publishing.rescheduleJob(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.jobId,
          req.valid.body,
          clientContext(req),
        ),
      );
    },
  );

  scoped.post(
    '/publish-jobs/:jobId/destinations/:destinationId/cancel',
    publish,
    validate({ params: destinationParams, body: noBody.optional() }),
    async (req, res) => {
      res.json(
        await publishing.cancelDestination(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.jobId,
          req.valid.params.destinationId,
          clientContext(req),
        ),
      );
    },
  );

  scoped.post(
    '/publish-jobs/:jobId/destinations/:destinationId/retry',
    publish,
    validate({ params: destinationParams, body: retryDestinationSchema.optional() }),
    async (req, res) => {
      res.json(
        await publishing.retryDestination(
          req.workspace,
          req.membership,
          req.user,
          req.valid.params.jobId,
          req.valid.params.destinationId,
          req.valid.body ?? { acknowledgeDuplicateRisk: false },
          clientContext(req),
        ),
      );
    },
  );
}
