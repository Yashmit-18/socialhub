import { PLATFORM_AUDIT_ACTIONS } from '@socialhub/shared';
import { useSearchParams } from 'react-router';
import { FilterSelect } from '../../components/accounts/AccountFilters.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, RowsSkeleton } from '../../components/ui/Feedback.jsx';
import { FeedArt, SearchArt } from '../../components/ui/illustrations.jsx';
import { AuditList } from './AdminUi.jsx';
import { AUDIT_FILTERS } from './adminFormat.js';
import { useAdminAudit } from './api.js';

const ACTIONS = new Set(Object.values(PLATFORM_AUDIT_ACTIONS));

export default function AdminAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('action') ?? '';
  const action = ACTIONS.has(requested) ? requested : '';
  const audit = useAdminAudit({ action });
  const items = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const choose = (next) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set('action', next);
        else params.delete('action');
        return params;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Audit log"
        description="What platform admins did, newest first: suspensions with their reasons, reactivations, and admin access given or removed on the server. Nobody can edit or delete an entry."
        actions={
          <FilterSelect
            label="Filter by action"
            value={action}
            onChange={choose}
            options={AUDIT_FILTERS}
          />
        }
      />
      {audit.isPending ? (
        <Card>
          <RowsSkeleton rows={4} shape="tile" label="Loading the audit log…" />
        </Card>
      ) : audit.isError && items.length === 0 ? (
        <Card>
          <ErrorState
            title="Could not load the audit log"
            error={audit.error}
            onRetry={() => audit.refetch()}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {action ? (
            <EmptyState
              art={SearchArt}
              tone="neutral"
              title="No entries of this kind"
              description="Nothing like this has happened yet. Choose another action, or show them all."
              action={
                <Button variant="secondary" size="sm" onClick={() => choose('')}>
                  Show all actions
                </Button>
              }
            />
          ) : (
            <EmptyState
              art={FeedArt}
              title="Nothing in the audit log yet"
              description="When a platform admin suspends or reactivates an account, or admin access is given or removed on the server, it is recorded here."
            />
          )}
        </Card>
      ) : (
        <Card className={audit.isFetching && !audit.isFetchingNextPage ? 'opacity-60' : undefined}>
          <AuditList items={items} grouped />
          {audit.hasNextPage && (
            <div className="border-t border-slate-100 px-5 py-3 sm:px-6 dark:border-white/5">
              <Button
                variant="secondary"
                size="sm"
                loading={audit.isFetchingNextPage}
                onClick={() => audit.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
