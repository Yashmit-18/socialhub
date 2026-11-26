import { WORKSPACE_PUBLISHING_MODES } from '@socialhub/shared';
import { Building2 } from 'lucide-react';
import { Link } from 'react-router';
import { FilterSelect, SearchBox } from '../../components/accounts/AccountFilters.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { SearchArt } from '../../components/ui/illustrations.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';
import { TBody, THead, Table, TableSkeleton, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { ListToolbar, StateBadge, WorkspaceCell } from './AdminUi.jsx';
import { formatCount, formatDay, plural, publishingModeBadge } from './adminFormat.js';
import { useAdminWorkspaces } from './api.js';
import { useListState } from './useListState.js';

const MODES = Object.values(WORKSPACE_PUBLISHING_MODES);
const SORTS = [
  ['-createdAt', 'Newest first'],
  ['createdAt', 'Oldest first'],
];

function OwnerCell({ owner }) {
  if (!owner) return <span className="text-muted">No owner on record</span>;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={`/admin/users/${owner.id}`}
          className="truncate font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
        >
          {owner.name}
        </Link>
        {owner.status === 'DISABLED' && <Badge tone="danger">Suspended</Badge>}
      </div>
      <p className="truncate text-xs text-muted">{owner.email}</p>
    </div>
  );
}

function WorkspaceRow({ workspace }) {
  const { accounts } = workspace;
  return (
    <Tr interactive>
      <Td header>
        <WorkspaceCell workspace={workspace} />
      </Td>
      <Td hide="sm" className="max-w-56">
        <OwnerCell owner={workspace.owner} />
      </Td>
      <Td numeric hide="md">
        {formatCount(workspace.memberCount)}
      </Td>
      <Td hide="lg" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
        {plural(accounts.facebookPages, 'Page', 'Pages')}, {formatCount(accounts.instagramAccounts)}{' '}
        Instagram
      </Td>
      <Td>
        <StateBadge state={publishingModeBadge(workspace.publishingMode)} />
      </Td>
      <Td hide="md" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
        {formatDay(workspace.createdAt)}
      </Td>
    </Tr>
  );
}

export default function AdminWorkspacesPage() {
  const { state, params, update, clear, filtered } = useListState('publishingMode', MODES);
  const list = useAdminWorkspaces(params);
  const { data } = list;
  const facets = data?.facets?.publishingMode;
  const all = facets ? facets.LIVE + facets.SIMULATED : undefined;

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Every workspace on this SocialHub. You see names, people and counts, never a workspace's posts, media or the names of its connected accounts."
      />
      <Card>
        <ListToolbar>
          <SearchBox
            value={state.q}
            onSearch={(q) => update({ q })}
            label="Search workspaces"
            placeholder="Search by name or address"
            className="sm:max-w-none lg:w-72 lg:flex-none"
          />
          <SegmentedControl
            label="Filter by publishing mode"
            size="sm"
            value={state.filter}
            onChange={(filter) => update({ filter })}
            options={[
              { value: '', label: 'All', count: all },
              { value: 'LIVE', label: 'Real publishing', count: facets?.LIVE },
              { value: 'SIMULATED', label: 'Simulation', count: facets?.SIMULATED },
            ]}
          />
          <div className="lg:ml-auto">
            <FilterSelect
              label="Sort workspaces"
              value={state.sort}
              onChange={(sort) => update({ sort })}
              options={SORTS}
              highlight={false}
            />
          </div>
        </ListToolbar>

        {list.isPending ? (
          <TableSkeleton rows={5} columns={5} label="Loading workspaces…" />
        ) : list.isError && !data ? (
          <ErrorState
            title="Could not load the workspaces"
            error={list.error}
            onRetry={() => list.refetch()}
          />
        ) : data.items.length === 0 ? (
          <div className="border-t border-slate-100 dark:border-white/5">
            {filtered ? (
              <EmptyState
                art={SearchArt}
                tone="neutral"
                title="No workspaces match"
                description="Try another name, or clear the filters."
                action={
                  <Button variant="secondary" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="No workspaces yet"
                description="Nobody has created a workspace on this SocialHub."
              />
            )}
          </div>
        ) : (
          <>
            <Table caption="Workspaces" fetching={list.isPlaceholderData}>
              <THead>
                <Th>Workspace</Th>
                <Th hide="sm">Owner</Th>
                <Th align="right" hide="md">
                  Members
                </Th>
                <Th hide="lg">Connected</Th>
                <Th>Publishing</Th>
                <Th hide="md">Created</Th>
              </THead>
              <TBody>
                {data.items.map((workspace) => (
                  <WorkspaceRow key={workspace.id} workspace={workspace} />
                ))}
              </TBody>
            </Table>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={data.limit}
              noun={data.total === 1 ? 'workspace' : 'workspaces'}
              onPageChange={(page) => update({ page })}
            />
          </>
        )}
        {data && (
          <p role="status" className="sr-only">
            {plural(data.total, 'workspace', 'workspaces')}
          </p>
        )}
      </Card>
    </>
  );
}
