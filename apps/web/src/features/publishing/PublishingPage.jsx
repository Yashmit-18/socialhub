import { PERMISSIONS, PUBLISHING_MODES } from '@socialhub/shared';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import {
  EmptyState,
  ErrorState,
  RestrictedState,
  Skeleton,
} from '../../components/ui/Feedback.jsx';
import { PostsArt } from '../../components/ui/illustrations.jsx';
import { TabButtons } from '../../components/ui/Tabs.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { cn } from '../../lib/utils.js';
import { JobDetailsModal } from './JobDetailsModal.jsx';
import { JobList } from './JobList.jsx';
import { PublishDraftDialog } from './PublishDraftDialog.jsx';
import { RescheduleDialog } from './RescheduleDialog.jsx';
import { Notice, StatusBanner } from './StatusBanner.jsx';
import { DEFAULT_TAB, EMPTY_TEXT, TABS, statusNotices, tabCount, tabFromParam } from './labels.js';
import {
  refreshIntervalForJobs,
  usePublishJobSummary,
  usePublishJobs,
  usePublishingStatus,
} from './usePublishing.js';

/** Tabs for states that are usually empty: shown only while they hold posts (or are open). */
const OCCASIONAL_TABS = new Set(['queue', 'processing', 'partial', 'cancelled']);

// Failed and partly published posts are why people open this page: their counts stand out.
const ATTENTION = { failed: 'danger', partial: 'warning' };

function Tabs({ active, summary, onSelect }) {
  const tabs = TABS.flatMap((tab) => {
    const count = tabCount(tab, summary);
    const selected = tab.key === active.key;
    if (OCCASIONAL_TABS.has(tab.key) && !selected && !(count > 0)) return [];
    return [{ key: tab.key, label: tab.label, count, attention: ATTENTION[tab.key] }];
  });
  return (
    <TabButtons
      label="Show posts by status"
      value={active.key}
      onChange={(key) => onSelect(TABS.find((tab) => tab.key === key))}
      tabs={tabs}
      className="-mt-3 mb-6"
    />
  );
}

/** First load: rows shaped like the posts that are coming. */
function JobsSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading posts…</span>
      <ul aria-hidden="true" className="divide-y divide-slate-100 dark:divide-white/5">
        {[0, 1, 2].map((n) => (
          <li key={n} className="px-5 py-4 sm:px-6">
            <Skeleton className={cn('h-4', n % 2 ? 'w-1/2' : 'w-2/3')} />
            <div className="mt-2.5 flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="mt-3 flex gap-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-28" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PublishingPage() {
  const { workspace, can } = useWorkspace();
  const allowed = can(PERMISSIONS.CONTENT_READ);
  const canAct = can(PERMISSIONS.CONTENT_PUBLISH);

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParam(searchParams.get('tab'));
  const [openJob, setOpenJob] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);

  const status = usePublishingStatus(workspace.id, { enabled: allowed });
  const jobs = usePublishJobs(workspace.id, tab.statuses, { enabled: allowed, order: tab.order });
  const summary = usePublishJobSummary(workspace.id, {
    enabled: allowed,
    interval: refreshIntervalForJobs(jobs.items),
  });

  if (!allowed) {
    return (
      <RestrictedState
        title="Publishing is restricted"
        description="You do not have access to posts in this workspace. Ask a workspace owner or admin if you need it."
      />
    );
  }

  const selectTab = (next) =>
    setSearchParams((params) => {
      const updated = new URLSearchParams(params);
      if (next.key === DEFAULT_TAB.key) updated.delete('tab');
      else updated.set('tab', next.key);
      return updated;
    });

  const simulatedMode = status.data?.mode === PUBLISHING_MODES.SIMULATED;
  const canPublishNow = canAct && status.data?.canPublish === true;
  const showsSimulatedJobs = !simulatedMode && jobs.items.some((job) => job.simulated);
  const empty = EMPTY_TEXT[tab.key];

  return (
    <>
      <PageHeader
        title="Posts"
        description="Everything you published or scheduled, and how it went on each account."
        actions={
          canPublishNow && (
            <Button onClick={() => setDraftDialogOpen(true)}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Publish a draft
            </Button>
          )
        }
      />

      <div className="mb-6 space-y-3 empty:hidden">
        {status.error && (
          <Notice
            tone="warning"
            title="We could not check whether publishing is available."
            text="New posts cannot be sent from here until this is known."
          />
        )}
        <StatusBanner notices={statusNotices(status.data)} />
        {showsSimulatedJobs && (
          <Notice
            tone="info"
            title="Some posts below were simulated."
            text="Nothing was posted to Facebook or Instagram for them."
          />
        )}
      </div>

      <Tabs active={tab} summary={summary.data} onSelect={selectTab} />

      <Card>
        {jobs.isPending ? (
          <JobsSkeleton />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.refetch} />
        ) : jobs.items.length === 0 ? (
          <EmptyState art={PostsArt} title={empty.title} description={empty.description} />
        ) : (
          <>
            <JobList
              jobs={jobs.items}
              onOpen={setOpenJob}
              onReschedule={canAct ? setRescheduling : undefined}
              timeZone={workspace.timezone}
            />
            {jobs.hasNextPage && (
              <div className="flex justify-center border-t border-slate-100 px-5 py-4 dark:border-white/5">
                <Button
                  variant="secondary"
                  loading={jobs.isFetchingNextPage}
                  onClick={() => jobs.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {openJob && (
        <JobDetailsModal
          key={openJob.id}
          workspaceId={workspace.id}
          job={openJob}
          canAct={canAct}
          timeZone={workspace.timezone}
          onReschedule={(job) => {
            setOpenJob(null);
            setRescheduling(job);
          }}
          onClose={() => setOpenJob(null)}
        />
      )}
      {rescheduling && (
        <RescheduleDialog
          key={rescheduling.id}
          workspaceId={workspace.id}
          job={rescheduling}
          workspaceTimeZone={workspace.timezone}
          onClose={() => setRescheduling(null)}
        />
      )}
      {draftDialogOpen && (
        <PublishDraftDialog
          workspaceId={workspace.id}
          workspaceTimeZone={workspace.timezone}
          simulatedMode={simulatedMode}
          onClose={() => setDraftDialogOpen(false)}
        />
      )}
    </>
  );
}
