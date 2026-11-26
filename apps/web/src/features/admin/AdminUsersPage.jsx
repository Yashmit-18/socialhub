import { USER_STATUS } from '@socialhub/shared';
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
import { PersonCell, ListToolbar, StateBadge } from './AdminUi.jsx';
import {
  formatAgo,
  formatCount,
  formatDateTime,
  formatDay,
  plural,
  userStatusBadge,
} from './adminFormat.js';
import { useAdminUsers } from './api.js';
import { useListState } from './useListState.js';

const STATUSES = Object.values(USER_STATUS);
const SORTS = [
  ['-createdAt', 'Newest first'],
  ['createdAt', 'Oldest first'],
];

function UserRow({ user }) {
  return (
    <Tr interactive>
      <Td header>
        <PersonCell
          person={user}
          badges={user.platformRole && <Badge tone="violet">Platform admin</Badge>}
        />
      </Td>
      <Td>
        <StateBadge state={userStatusBadge(user.status)} />
        {user.suspendedAt && (
          <p className="mt-1 text-xs whitespace-nowrap text-muted">
            since {formatDay(user.suspendedAt)}
          </p>
        )}
      </Td>
      <Td numeric hide="sm">
        {formatCount(user.workspaceCount)}
      </Td>
      <Td hide="md" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
        {formatDay(user.createdAt)}
      </Td>
      <Td hide="lg" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
        {user.lastLoginAt ? (
          <time dateTime={user.lastLoginAt} title={formatDateTime(user.lastLoginAt)}>
            {formatAgo(user.lastLoginAt)}
          </time>
        ) : (
          <span className="text-muted">Not recorded</span>
        )}
      </Td>
    </Tr>
  );
}

export default function AdminUsersPage() {
  const { state, params, update, clear, filtered } = useListState('status', STATUSES);
  const list = useAdminUsers(params);
  const { data } = list;
  const facets = data?.facets?.status;
  const all = facets ? facets.ACTIVE + facets.DISABLED : undefined;

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with a SocialHub account. Open a person to see their workspaces, or to suspend or reactivate the account."
      />
      <Card>
        <ListToolbar>
          <SearchBox
            value={state.q}
            onSearch={(q) => update({ q })}
            label="Search users"
            placeholder="Search by name or email"
            className="sm:max-w-none lg:w-72 lg:flex-none"
          />
          <SegmentedControl
            label="Filter by status"
            size="sm"
            value={state.filter}
            onChange={(filter) => update({ filter })}
            options={[
              { value: '', label: 'All', count: all },
              { value: USER_STATUS.ACTIVE, label: 'Active', count: facets?.ACTIVE },
              { value: USER_STATUS.DISABLED, label: 'Suspended', count: facets?.DISABLED },
            ]}
          />
          <div className="lg:ml-auto">
            <FilterSelect
              label="Sort users"
              value={state.sort}
              onChange={(sort) => update({ sort })}
              options={SORTS}
              highlight={false}
            />
          </div>
        </ListToolbar>

        {list.isPending ? (
          <TableSkeleton rows={5} columns={5} label="Loading users…" />
        ) : list.isError && !data ? (
          <ErrorState
            title="Could not load the users"
            error={list.error}
            onRetry={() => list.refetch()}
          />
        ) : data.items.length === 0 ? (
          <div className="border-t border-slate-100 dark:border-white/5">
            <EmptyState
              art={SearchArt}
              tone="neutral"
              title="No users match"
              description="Try another name or email, or clear the filters."
              action={
                filtered && (
                  <Button variant="secondary" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table caption="Users" fetching={list.isPlaceholderData}>
              <THead>
                <Th>Person</Th>
                <Th>Status</Th>
                <Th align="right" hide="sm">
                  Workspaces
                </Th>
                <Th hide="md">Joined</Th>
                <Th hide="lg">Last sign-in</Th>
              </THead>
              <TBody>
                {data.items.map((user) => (
                  <UserRow key={user.id} user={user} />
                ))}
              </TBody>
            </Table>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={data.limit}
              noun={data.total === 1 ? 'user' : 'users'}
              onPageChange={(page) => update({ page })}
            />
          </>
        )}
        {data && (
          <p role="status" className="sr-only">
            {plural(data.total, 'user', 'users')}
          </p>
        )}
      </Card>
    </>
  );
}
