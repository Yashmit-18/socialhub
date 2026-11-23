import { ANALYTICS_SOURCES, PERMISSIONS } from '@socialhub/shared';
import { Download, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { download } from '../../lib/api.js';
import { saveBlob } from '../../lib/accountOrganization.js';
import { AnalyticsFilters } from './AnalyticsFilters.jsx';
import { apiParams, readFilters } from './filters.js';
import {
  AccountsSection,
  InsightsSection,
  PublishingSection,
  SourceNotice,
  TopPostsSection,
} from './sections.jsx';
import {
  cleanParams,
  exportPath,
  useAnalyticsAccounts,
  useAnalyticsOverview,
  useAnalyticsTrends,
  useRequestSync,
  useSyncStatus,
  useTopPosts,
} from './useAnalytics.js';

const EXPORTS = [
  { type: 'accounts', label: 'Accounts' },
  { type: 'posts', label: 'Posts' },
  { type: 'publishing', label: 'Publishing history' },
];

function syncToast(result) {
  const queued = result.queued.length;
  const running = result.alreadyRunning.length;
  const skipped = result.skipped.length;
  const what = result.simulated ? 'Demo sync' : 'Sync';
  const parts = [
    queued ? `${what} started for ${queued} ${queued === 1 ? 'account' : 'accounts'}` : null,
    running ? `${running} already syncing` : null,
    skipped ? `${skipped} skipped (reconnect needed)` : null,
  ].filter(Boolean);
  return {
    title: parts.join(' · ') || 'Nothing to sync',
    description: result.simulated ? 'Demo data only: nothing is read from Meta.' : undefined,
  };
}

/**
 * Analytics & Publishing Intelligence — /w/:slug/analytics.
 *
 * Publishing figures come from SocialHub's records (simulated posts are labelled). Insights
 * come from one source at a time: Meta (default) or demo data, which is announced as such and
 * never mixed with Meta's. Missing metrics read "Unavailable", never 0.
 */
export default function AnalyticsPage() {
  const { workspace, can } = useWorkspace();
  const allowed = can(PERMISSIONS.ANALYTICS_READ);
  const canSync = can(PERMISSIONS.ANALYTICS_SYNC);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams, workspace.timezone);
  const params = apiParams(filters);
  const enabled = allowed && !filters.error;

  const overview = useAnalyticsOverview(workspace.id, params, { enabled });
  const trends = useAnalyticsTrends(workspace.id, params, { enabled });
  const accounts = useAnalyticsAccounts(workspace.id, params, { enabled });
  const topPosts = useTopPosts(
    workspace.id,
    { ...params, metric: 'engagement', limit: 5 },
    { enabled },
  );
  const allAccounts = useSyncStatus(workspace.id, {}, { enabled: allowed });
  const sync = useRequestSync(workspace.id);
  const [exporting, setExporting] = useState(null);

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Analytics are restricted"
          description="Your role cannot see analytics in this workspace. Ask a workspace owner or admin if you need them."
        />
      </Card>
    );
  }

  const update = (patch) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (next.get('range') === '30d') next.delete('range');
      if (next.get('source') === ANALYTICS_SOURCES.META) next.delete('source');
      return next;
    });

  const status = allAccounts.data?.analytics ?? overview.data?.analytics;
  const runSync = () =>
    sync.mutate(
      {},
      {
        onSuccess: (result) => {
          const message = syncToast(result);
          toast.success(message.title, { description: message.description });
        },
        onError: (err) => toast.error(err.message),
      },
    );

  const runExport = async (type) => {
    setExporting(type);
    try {
      const { blob, fileName } = await download(exportPath(workspace.id), {
        query: cleanParams({ ...params, type }),
      });
      saveBlob(blob, fileName ?? `socialhub-${type}.csv`);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err?.message ?? 'The export could not be downloaded. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const loadError = overview.error ?? trends.error ?? accounts.error;
  return (
    <>
      <PageHeader
        title="Analytics"
        description="How your posts and accounts are doing: SocialHub's publishing records, and insights from Meta when they are available."
        actions={
          canSync && (
            <Button
              onClick={runSync}
              loading={sync.isPending}
              disabled={!status?.canSync}
              title={status?.canSync ? undefined : (status?.message ?? undefined)}
              aria-describedby={status?.canSync ? undefined : 'analytics-sync-note'}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {status?.source === ANALYTICS_SOURCES.SIMULATED
                ? 'Make demo insights'
                : 'Sync insights'}
            </Button>
          )
        }
      />
      {canSync && status && !status.canSync && (
        <p id="analytics-sync-note" className="-mt-5 mb-6 text-xs text-muted">
          {status.message}
        </p>
      )}

      <div className="space-y-6">
        <SourceNotice
          source={filters.source}
          analytics={status}
          hasInsights={Boolean(overview.data?.insights?.hasData)}
        />

        <Card>
          <CardBody className="space-y-3">
            <AnalyticsFilters
              filters={filters}
              accounts={(allAccounts.data?.items ?? []).map((item) => item.account)}
              onChange={update}
            />
            {filters.error && (
              <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
                {filters.error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV:</span>
              {EXPORTS.map((item) => (
                <Button
                  key={item.type}
                  variant="ghost"
                  size="sm"
                  loading={exporting === item.type}
                  disabled={Boolean(exporting) || Boolean(filters.error)}
                  onClick={() => runExport(item.type)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </CardBody>
        </Card>

        {loadError ? (
          <Card>
            <ErrorState
              error={loadError}
              onRetry={() =>
                Promise.all([overview.refetch(), trends.refetch(), accounts.refetch()])
              }
            />
          </Card>
        ) : (
          <>
            <PublishingSection
              overview={overview.data}
              trends={trends.data}
              loading={overview.isPending}
            />
            <InsightsSection
              overview={overview.data}
              trends={trends.data}
              loading={overview.isPending || trends.isPending}
              source={filters.source}
            />
            <AccountsSection data={accounts.data} loading={accounts.isPending} />
            <TopPostsSection
              data={topPosts.data}
              loading={topPosts.isPending}
              metric="engagement"
              timeZone={workspace.timezone ?? 'UTC'}
            />
          </>
        )}
      </div>
    </>
  );
}
