import { PERMISSIONS, PUBLISHING_MODES } from '@socialhub/shared';
import { Lock, Send } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
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

function Tabs({ active, summary, onSelect }) {
  return (
    <div
      role="group"
      aria-label="Show posts by status"
      className="-mt-3 mb-6 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-white/10"
    >
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const selected = tab.key === active.key;
          const count = tabCount(tab, summary);
          if (OCCASIONAL_TABS.has(tab.key) && !selected && !(count > 0)) return null;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={selected}
              aria-label={count === null ? undefined : `${tab.label} (${count})`}
              onClick={() => onSelect(tab)}
              className={cn(
                'relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                'after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:rounded-full',
                selected
                  ? 'border-transparent text-brand-700 after:bg-gradient-to-r after:from-brand-500 after:to-pink-500 dark:text-brand-300'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-100',
              )}
            >
              {tab.label}
              {count !== null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                    selected
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200'
                      : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
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
      <Card>
        <EmptyState
          icon={Lock}
          title="Publishing is restricted"
          description="You do not have access to posts in this workspace. Ask a workspace owner or admin if you need it."
        />
      </Card>
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
          <PageLoader label="Loading posts…" />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.refetch} />
        ) : jobs.items.length === 0 ? (
          <EmptyState icon={Send} title={empty.title} description={empty.description} />
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
