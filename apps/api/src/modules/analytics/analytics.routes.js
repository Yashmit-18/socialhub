import {
  PERMISSIONS,
  analyticsExportQuerySchema,
  analyticsPostsQuerySchema,
  analyticsQuerySchema,
  analyticsSyncSchema,
  analyticsTopPostsQuerySchema,
} from '@socialhub/shared';
import { clientContext } from '../../middleware/requestContext.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/workspaceAccess.js';
import * as analytics from './analytics.service.js';
import { exportAnalytics } from './analytics.export.js';
import { requestSync } from './analyticsSync.service.js';

/**
 * Analytics, mounted on the workspace router (membership is already enforced). Reading needs
 * analytics:read (every role); starting a sync needs analytics:sync. Every service call is
 * limited to the accounts the member may use (docs/ANALYTICS.md).
 */
export function mountAnalyticsRoutes(scoped) {
  const read = requirePermission(PERMISSIONS.ANALYTICS_READ);
  const sync = requirePermission(PERMISSIONS.ANALYTICS_SYNC);
  const get = (path, schema, handler) =>
    scoped.get(path, read, validate({ query: schema }), async (req, res) => {
      res.json(await handler(req.workspace, req.membership, req.valid.query));
    });

  get('/analytics/overview', analyticsQuerySchema, analytics.getOverview);
  get('/analytics/trends', analyticsQuerySchema, analytics.getTrends);
  get('/analytics/accounts', analyticsQuerySchema, analytics.getAccounts);
  get('/analytics/posts', analyticsPostsQuerySchema, analytics.getPosts);
  get('/analytics/top-posts', analyticsTopPostsQuerySchema, analytics.getTopPosts);
  get(
    '/analytics/publishing-performance',
    analyticsQuerySchema,
    analytics.getPublishingPerformance,
  );
  get('/analytics/sync-status', analyticsQuerySchema, analytics.getSyncStatus);

  scoped.get(
    '/analytics/export',
    read,
    validate({ query: analyticsExportQuerySchema }),
    async (req, res) => {
      const { filename, csv } = await exportAnalytics(
        req.workspace,
        req.membership,
        req.valid.query,
      );
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.set('Cache-Control', 'no-store');
      // Byte order mark, so spreadsheet apps read the file as UTF-8 (as accountExport.js does).
      res.send(`${String.fromCharCode(0xfeff)}${csv}`);
    },
  );

  scoped.post(
    '/analytics/sync',
    sync,
    validate({ body: analyticsSyncSchema }),
    async (req, res) => {
      const result = await requestSync(
        req.workspace,
        req.membership,
        req.user,
        req.valid.body,
        clientContext(req),
      );
      res.status(result.queued.length ? 202 : 200).json(result);
    },
  );
}
