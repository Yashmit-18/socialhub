import { PERMISSIONS } from '@socialhub/shared';
import { History, Lock } from 'lucide-react';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useActivity } from '../../lib/queries.js';

export default function ActivityPage() {
  const { workspace, can } = useWorkspace();
  const allowed = can(PERMISSIONS.ACTIVITY_READ);
  const { data, isPending, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useActivity(workspace.id, { enabled: allowed });

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Activity is restricted"
          description="Only workspace owners and admins can view the audit log."
        />
      </Card>
    );
  }
  if (isPending) return <PageLoader />;

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="An audit trail of every team and settings change in this workspace."
      />
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState icon={History} title="No activity yet" />
        ) : (
          <CardBody>
            <ActivityFeed items={items} />
            {hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  loading={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  Load older activity
                </Button>
              </div>
            )}
          </CardBody>
        )}
      </Card>
    </>
  );
}
