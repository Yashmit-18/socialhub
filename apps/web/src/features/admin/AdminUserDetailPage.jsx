import {
  Building2,
  CalendarClock,
  ScrollText,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { BackLink } from '../../components/ui/BackLink.jsx';
import { Badge, RoleBadge } from '../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, RowsSkeleton } from '../../components/ui/Feedback.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { AuditList, Facts, ImpactList, StateBadge, WorkspaceCell } from './AdminUi.jsx';
import {
  formatCount,
  formatDateTime,
  formatDay,
  plural,
  revokeCommand,
  suspendImpact,
  suspendedImpact,
  userStatusBadge,
} from './adminFormat.js';
import { useAdminAudit, useAdminUser } from './api.js';
import { ReactivateUserDialog, SuspendUserDialog } from './SuspensionDialogs.jsx';

const BACK = { to: '/admin/users', label: 'All users' };

function Notices({ user, actions }) {
  if (user.status === 'DISABLED') {
    const { suspension } = user;
    return (
      <Callout tone="warning" role="status" title="This account is suspended.">
        {suspension
          ? `Suspended on ${formatDateTime(suspension.at)} by ${suspension.by.name}. Reason: ${suspension.reason}`
          : 'It was not suspended from this console, so there is no record of when, by whom or why.'}
      </Callout>
    );
  }
  if (actions.blockedBy === 'SELF') {
    return (
      <Callout tone="neutral" role="note" title="This is your own account.">
        You cannot suspend yourself.
      </Callout>
    );
  }
  if (actions.blockedBy === 'TARGET_IS_PLATFORM_ADMIN') {
    return (
      <Callout tone="neutral" role="note" title="This person is a platform admin.">
        To suspend the account, first remove their admin access on the server:{' '}
        <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs break-all ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
          {revokeCommand(user.email)}
        </code>
      </Callout>
    );
  }
  return null;
}

function AccountCard({ user, impact, className }) {
  return (
    <Card aria-label="Account" className={className}>
      <CardHeader icon={UserRound} title="Account" />
      <CardBody>
        <Facts
          items={[
            {
              label: 'Status',
              value: (
                <span className="flex flex-wrap gap-1.5">
                  <StateBadge state={userStatusBadge(user.status)} />
                  {user.platformRole && <Badge tone="violet">Platform admin</Badge>}
                </span>
              ),
            },
            { label: 'Email', value: user.email },
            { label: 'Joined', value: formatDateTime(user.createdAt) },
            { label: 'Last sign-in', value: formatDateTime(user.lastLoginAt, 'Not recorded') },
            {
              label: 'Last active',
              value: formatDateTime(user.lastActiveAt, 'Unknown (no session on record)'),
            },
            {
              label: 'Password last changed',
              value: formatDateTime(user.passwordChangedAt, 'Never changed'),
            },
            {
              label: 'Open sessions',
              value:
                impact.liveSessions === 0
                  ? 'None'
                  : plural(impact.liveSessions, 'session', 'sessions'),
            },
            {
              label: 'User ID',
              value: <code className="font-mono text-xs break-all text-muted">{user.id}</code>,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function ImpactCard({ detail }) {
  const suspended = detail.user.status === 'DISABLED';
  const { lines, deliveries } = suspended ? suspendedImpact(detail) : suspendImpact(detail);
  return (
    // Second on a phone (after the account), first and wider beside it on a large screen.
    <Card aria-label="Posts and sessions" className="lg:order-first lg:col-span-3">
      <CardHeader
        icon={CalendarClock}
        iconTone={suspended ? 'warning' : undefined}
        title={suspended ? 'While this account is suspended' : 'What a suspension affects'}
        description="Counted just now."
      />
      <CardBody>
        <ImpactList lines={lines} />
        {deliveries && (
          <p className="mt-4 text-xs text-muted">
            A delivery is one post going to one Facebook Page or Instagram account.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function WorkspacesCard({ detail }) {
  const { memberships, membershipsTruncated, impact } = detail;
  return (
    <Card aria-label="Workspaces">
      <CardHeader
        icon={Building2}
        title="Workspaces"
        description={`${formatCount(impact.workspaces.total)} in total, ${formatCount(impact.workspaces.owned)} owned`}
      />
      {memberships.length === 0 ? (
        <div className="px-5 pt-4 pb-5 sm:px-6">
          <EmptyState
            layout="inline"
            icon={Building2}
            title="No workspaces"
            description="This person is not a member of any workspace."
          />
        </div>
      ) : (
        <div className="mt-4">
          <Table caption="Workspaces of this person" stickyFirst minWidth="min-w-[480px]">
            <THead>
              <Th>Workspace</Th>
              <Th>Role</Th>
              <Th align="right" hide="sm">
                Members
              </Th>
              <Th>Notes</Th>
              <Th hide="md">Joined</Th>
            </THead>
            <TBody>
              {memberships.map((row) => (
                <Tr key={row.id} interactive>
                  <Td header>
                    <WorkspaceCell workspace={row.workspace} />
                  </Td>
                  <Td>
                    <RoleBadge role={row.role} />
                  </Td>
                  <Td numeric hide="sm">
                    {formatCount(row.memberCount)}
                  </Td>
                  <Td>
                    {row.onlyOwner && (
                      <>
                        <Badge tone="warning">Only owner</Badge>
                        <p className="mt-1 text-xs whitespace-nowrap text-muted">
                          {row.adminCount === 0
                            ? 'No other admin'
                            : `${plural(row.adminCount, 'admin', 'admins')} can keep it running`}
                        </p>
                      </>
                    )}
                  </Td>
                  <Td hide="md" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {formatDay(row.joinedAt, '—')}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {membershipsTruncated && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-muted sm:px-6 dark:border-white/5">
              Showing the first 200 workspaces.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function HistoryCard({ userId }) {
  const audit = useAdminAudit({ targetId: userId, limit: 10 });
  const items = audit.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Card aria-label="Admin history">
      <CardHeader
        icon={ScrollText}
        title="Admin history"
        description="What platform admins did to this account."
      />
      {audit.isPending ? (
        <RowsSkeleton rows={2} shape="tile" className="mt-2" />
      ) : audit.isError ? (
        <ErrorState
          title="Could not load the history"
          error={audit.error}
          onRetry={() => audit.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-muted sm:px-6">Nothing yet.</p>
      ) : (
        <div className="mt-4">
          <AuditList items={items} showTarget={false} />
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
        </div>
      )}
    </Card>
  );
}

export default function AdminUserDetailPage() {
  const { userId } = useParams();
  const query = useAdminUser(userId);
  const [dialog, setDialog] = useState(null);
  const detail = query.data;

  if (!detail) {
    return (
      <>
        {query.error?.status !== 404 && <BackLink to={BACK.to}>{BACK.label}</BackLink>}
        {query.isPending ? (
          <Card>
            <RowsSkeleton rows={3} label="Loading this account…" />
          </Card>
        ) : query.error?.status === 404 ? (
          <Card>
            <EmptyState
              icon={UserRound}
              tone="neutral"
              title="User not found"
              description="This account does not exist."
              action={<ButtonLink to={BACK.to}>All users</ButtonLink>}
            />
          </Card>
        ) : (
          <Card>
            <ErrorState
              title="Could not load this user"
              error={query.error}
              onRetry={() => query.refetch()}
            />
          </Card>
        )}
      </>
    );
  }

  const { user, actions } = detail;
  const showImpact = actions.canSuspend || user.status === 'DISABLED';

  return (
    <>
      <PageHeader
        back={BACK}
        media={<Avatar name={user.name} seed={user.id} size="lg" className="ring-0" />}
        title={user.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="break-all">{user.email}</span>
            <StateBadge state={userStatusBadge(user.status)} />
            {user.platformRole && <Badge tone="violet">Platform admin</Badge>}
          </span>
        }
        actions={
          actions.canSuspend ? (
            <Button variant="danger-outline" onClick={() => setDialog('suspend')}>
              <UserRoundX className="h-4 w-4" aria-hidden="true" />
              Suspend account
            </Button>
          ) : actions.canReactivate ? (
            <Button onClick={() => setDialog('reactivate')}>
              <UserRoundCheck className="h-4 w-4" aria-hidden="true" />
              Reactivate account
            </Button>
          ) : null
        }
      />
      <div className="stagger space-y-6">
        <Notices user={user} actions={actions} />
        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <AccountCard
            user={user}
            impact={detail.impact}
            className={showImpact ? 'lg:col-span-2' : 'lg:col-span-5'}
          />
          {showImpact && <ImpactCard detail={detail} />}
        </div>
        <WorkspacesCard detail={detail} />
        <HistoryCard userId={userId} />
      </div>
      {dialog === 'suspend' && (
        <SuspendUserDialog userId={userId} onClose={() => setDialog(null)} />
      )}
      {dialog === 'reactivate' && (
        <ReactivateUserDialog userId={userId} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
