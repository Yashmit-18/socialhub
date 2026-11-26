import { PERMISSIONS } from '@socialhub/shared';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import {
  EmptyState,
  ErrorState,
  RestrictedState,
  RowsSkeleton,
} from '../../components/ui/Feedback.jsx';
import { FeedArt } from '../../components/ui/illustrations.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useActivity } from '../../lib/queries.js';

export default function ActivityPage() {
  const { workspace, can } = useWorkspace();
  const allowed = can(PERMISSIONS.ACTIVITY_READ);
  const { data, isPending, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useActivity(workspace.id, { enabled: allowed });

  if (!allowed) {
    return (
      <RestrictedState
        title="Activity is restricted"
        description="Only workspace owners and admins can view the audit log."
      />
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="An audit trail of every team and settings change in this workspace."
      />
      <Card>
        {isPending ? (
          <RowsSkeleton rows={8} shape="tile" label="Loading…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState art={FeedArt} title="No activity yet" />
        ) : (
          <>
            <ActivityFeed items={items} grouped />
            {hasNextPage && (
              <div className="flex justify-center border-t border-slate-100 px-5 py-4 dark:border-white/5">
                <Button
                  variant="secondary"
                  loading={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  Load older activity
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
