import { ANALYTICS_SOURCES, PERMISSIONS } from '@socialhub/shared';
import {
  CalendarRange,
  ChevronDown,
  Download,
  FileText,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, RestrictedState } from '../../components/ui/Feedback.jsx';
import { Menu, MenuItem } from '../../components/ui/Menu.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { download } from '../../lib/api.js';
import { saveBlob } from '../../lib/accountOrganization.js';
import { AccountsSection } from './AccountsSection.jsx';
import { AnalyticsFilters } from './AnalyticsFilters.jsx';
import { apiParams, readFilters } from './filters.js';
import { InsightsSection } from './InsightsSection.jsx';
import { PublishingSection } from './PublishingSection.jsx';
import { TopPostsSection } from './TopPostsSection.jsx';
import {
  cleanParams,
  exportPath,
  useAnalyticsAccounts,
  useAnalyticsOverview,
  useAnalyticsTrends,
  useRefreshWhenSyncEnds,
  useRequestSync,
  useSyncStatus,
  useTopPosts,
} from './useAnalytics.js';

const TITLE = 'Analytics';
const DESCRIPTION =
  "How your posts and accounts are doing: SocialHub's publishing records, and insights from Meta when they are available.";

const EXPORTS = [
  { type: 'accounts', label: 'Accounts', icon: Users },
  { type: 'posts', label: 'Posts', icon: FileText },
  { type: 'publishing', label: 'Publishing history', icon: Send },
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
 * One "Export CSV" button for the three exports of the current filters. The list opens under
 * the button's left edge on phones (where the button sits at the left) and under its right
 * edge from `sm` (where the header actions sit at the right).
 */
function ExportMenu({ exporting, disabled, onExport }) {
  return (
    <Menu
      align="left"
      className="w-52 sm:right-0 sm:left-auto sm:origin-top-right"
      trigger={({ toggle, props }) => (
        <Button
          variant="secondary"
          onClick={toggle}
          loading={Boolean(exporting)}
          disabled={disabled}
          {...props}
        >
          {!exporting && <Download className="h-4 w-4" aria-hidden="true" />}
          Export CSV
          <ChevronDown className="-mr-0.5 h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      )}
    >
      {(close) =>
        EXPORTS.map((item) => (
          <MenuItem
            key={item.type}
            icon={item.icon}
            onClick={() => {
              close();
              onExport(item.type);
            }}
          >
            {item.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
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
  const [rankBy, setRankBy] = useState('engagement');

  const overview = useAnalyticsOverview(workspace.id, params, { enabled });
  const trends = useAnalyticsTrends(workspace.id, params, { enabled });
  const accounts = useAnalyticsAccounts(workspace.id, params, { enabled });
  const topPosts = useTopPosts(workspace.id, { ...params, metric: rankBy, limit: 5 }, { enabled });
  const allAccounts = useSyncStatus(workspace.id, {}, { enabled: allowed });
  const sync = useRequestSync(workspace.id);
  const syncing = Boolean(allAccounts.data?.items?.some((item) => item.active));
  useRefreshWhenSyncEnds(workspace.id, syncing);
  const [exporting, setExporting] = useState(null);

  if (!allowed) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <RestrictedState
          title="Analytics are restricted"
          description="Your role cannot see analytics in this workspace. Ask a workspace owner or admin if you need them."
        />
      </>
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

  // The sync button is the page's one main action only while it can run; otherwise it is a
  // quiet disabled button with its reason under it.
  const actions = (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <ExportMenu exporting={exporting} disabled={Boolean(filters.error)} onExport={runExport} />
        {canSync && (
          <Button
            variant={status?.canSync ? 'primary' : 'secondary'}
            onClick={runSync}
            loading={sync.isPending || syncing}
            disabled={!status?.canSync}
            title={status?.canSync ? undefined : (status?.message ?? undefined)}
            aria-describedby={status?.canSync ? undefined : 'analytics-sync-note'}
          >
            {!sync.isPending && !syncing && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {status?.source === ANALYTICS_SOURCES.SIMULATED
              ? 'Make demo insights'
              : 'Sync insights'}
          </Button>
        )}
      </div>
      {canSync && status && !status.canSync && (
        <p
          id="analytics-sync-note"
          className="max-w-xs text-xs leading-snug text-slate-600 sm:text-right dark:text-slate-400"
        >
          {status.message}
        </p>
      )}
    </div>
  );

  const loadError = overview.error ?? trends.error ?? accounts.error;
  let content;
  if (filters.error) {
    content = (
      <Card>
        <EmptyState
          icon={CalendarRange}
          tone="neutral"
          title="Choose a valid date range"
          description="Fix the dates above to see figures for that range."
        />
      </Card>
    );
  } else if (loadError) {
    content = (
      <Card>
        <ErrorState
          error={loadError}
          onRetry={() => Promise.all([overview.refetch(), trends.refetch(), accounts.refetch()])}
        />
      </Card>
    );
  } else {
    content = (
      <>
        <PublishingSection
          overview={overview.data}
          trends={trends.data}
          loading={overview.isPending}
          trendsLoading={trends.isPending}
          fetching={overview.isPlaceholderData}
        />
        <InsightsSection
          overview={overview.data}
          trends={trends.data}
          loading={overview.isPending || trends.isPending}
          fetching={overview.isPlaceholderData || trends.isPlaceholderData}
          source={filters.source}
        />
        <AccountsSection
          data={accounts.data}
          loading={accounts.isPending}
          fetching={accounts.isPlaceholderData}
        />
        <TopPostsSection
          data={topPosts.data}
          loading={topPosts.isPending}
          fetching={topPosts.isPlaceholderData}
          error={topPosts.error}
          onRetry={() => topPosts.refetch()}
          metric={rankBy}
          onMetricChange={overview.data?.insights?.hasData ? setRankBy : undefined}
          timeZone={workspace.timezone ?? 'UTC'}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} actions={actions} />
      <div className="stagger space-y-6">
        <Card className="px-4 py-4 sm:px-5">
          <AnalyticsFilters
            filters={filters}
            accounts={(allAccounts.data?.items ?? []).map((item) => item.account)}
            onChange={update}
          />
          {filters.error && (
            <p role="alert" className="mt-3 text-sm font-medium text-rose-600 dark:text-rose-400">
              {filters.error}
            </p>
          )}
        </Card>

        {filters.source === ANALYTICS_SOURCES.SIMULATED && (
          <Callout tone="violet" role="note" title="DEMO DATA.">
            Reach, views, likes and other insights below are made up by SocialHub's simulation for
            testing. They are not your Facebook or Instagram performance. Publishing figures are
            SocialHub's own records.
          </Callout>
        )}

        {content}
      </div>
    </>
  );
}
