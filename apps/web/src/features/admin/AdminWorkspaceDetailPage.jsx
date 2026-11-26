import { Building2, CalendarClock, FileText, Image, Megaphone, Send, Users } from 'lucide-react';
import { useParams } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { BackLink } from '../../components/ui/BackLink.jsx';
import { Badge, RoleBadge } from '../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, RowsSkeleton } from '../../components/ui/Feedback.jsx';
import { StatGrid, StatTile } from '../../components/ui/StatTile.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { Facts, PersonCell, StateBadge } from './AdminUi.jsx';
import {
  UNKNOWN,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDay,
  plural,
  publishingModeBadge,
  userStatusBadge,
} from './adminFormat.js';
import { useAdminWorkspace } from './api.js';

const BACK = { to: '/admin/workspaces', label: 'All workspaces' };

const POST_STATES = [
  ['SCHEDULED', 'Scheduled'],
  ['QUEUED', 'Queued'],
  ['PROCESSING', 'Being sent'],
  ['PUBLISHED', 'Published'],
  ['PARTIALLY_PUBLISHED', 'Partly published'],
  ['FAILED', 'Failed'],
  ['CANCELLED', 'Cancelled'],
];

const LOGIN_STATES = [
  ['ACTIVE', 'Working'],
  ['EXPIRED', 'Expired'],
  ['REVOKED', 'Access removed'],
  ['ERROR', 'Error'],
  ['DISCONNECTED', 'Disconnected'],
];

const sumOf = (counts, keys) => keys.reduce((total, key) => total + (counts?.[key] ?? 0), 0);

/** Counts by state: the words on the left, the figure on the right. */
function CountList({ title, rows, counts }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-medium text-muted">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
        {rows.map(([key, label]) => (
          <div key={key} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
            <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
            <dd
              className={
                counts[key] > 0
                  ? 'font-medium text-slate-900 tabular-nums dark:text-white'
                  : 'text-muted tabular-nums'
              }
            >
              {formatCount(counts[key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Numbers({ counts }) {
  const tile = { variant: 'cell', unknown: UNKNOWN };
  const { posts } = counts;
  return (
    <StatGrid label="Workspace numbers" columns={4}>
      <StatTile
        {...tile}
        label="Members"
        value={counts.members}
        icon={Users}
        tone="sky"
        hint={
          counts.pendingInvitations === 0
            ? 'no invitations pending'
            : `${plural(counts.pendingInvitations, 'invitation', 'invitations')} pending`
        }
      />
      <StatTile
        {...tile}
        label="Facebook Pages"
        value={counts.accounts.facebookPages}
        icon={FacebookIcon}
        tone="facebook"
      />
      <StatTile
        {...tile}
        label="Instagram accounts"
        value={counts.accounts.instagramAccounts}
        icon={InstagramIcon}
        tone="instagram"
      />
      <StatTile
        {...tile}
        label="Facebook Groups"
        value={counts.facebookGroups}
        icon={Megaphone}
        tone="pink"
        hint={`${plural(counts.openSharingTasks, 'sharing task', 'sharing tasks')} open`}
      />
      <StatTile {...tile} label="Drafts" value={counts.drafts} icon={FileText} tone="brand" />
      <StatTile
        {...tile}
        label="Media files"
        value={counts.mediaFiles}
        icon={Image}
        tone="violet"
        hint={`${formatBytes(counts.mediaBytes)} stored`}
      />
      <StatTile
        {...tile}
        label="Posts waiting"
        value={sumOf(posts, ['SCHEDULED', 'QUEUED', 'PROCESSING'])}
        icon={CalendarClock}
        tone="amber"
        hint="scheduled, queued or being sent"
      />
      <StatTile
        {...tile}
        label="Posts published"
        value={sumOf(posts, ['PUBLISHED', 'PARTIALLY_PUBLISHED'])}
        icon={Send}
        tone="success"
        hint={`${formatCount(posts.FAILED)} failed, ${formatCount(posts.CANCELLED)} cancelled`}
      />
    </StatGrid>
  );
}

function WorkspaceFacts({ workspace }) {
  return (
    <Card aria-label="Workspace">
      <CardHeader icon={Building2} title="Workspace" />
      <CardBody>
        <Facts
          items={[
            {
              label: 'Publishing',
              value: (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StateBadge state={publishingModeBadge(workspace.publishingMode)} />
                  <span className="text-xs text-muted">
                    {workspace.publishingModeChangedAt
                      ? `since ${formatDay(workspace.publishingModeChangedAt)}`
                      : 'never switched'}
                  </span>
                </span>
              ),
            },
            { label: 'Time zone', value: workspace.timezone ?? UNKNOWN },
            { label: 'Created', value: formatDateTime(workspace.createdAt) },
            {
              label: 'Last activity',
              value: formatDateTime(workspace.lastActivityAt, 'Nothing recorded yet'),
            },
            { label: 'Address', value: `/w/${workspace.slug}` },
            {
              label: 'Workspace ID',
              value: <code className="font-mono text-xs break-all text-muted">{workspace.id}</code>,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function StatesCard({ counts }) {
  return (
    <Card aria-label="Posts and logins">
      <CardHeader
        icon={Send}
        title="Posts and logins"
        description="How many, in each state. Never what they say."
      />
      <CardBody className="grid gap-6 sm:grid-cols-2">
        <CountList title="Posts" rows={POST_STATES} counts={counts.posts} />
        <CountList
          title="Facebook and Instagram logins"
          rows={LOGIN_STATES}
          counts={counts.connections}
        />
      </CardBody>
    </Card>
  );
}

function MembersCard({ members, total, truncated }) {
  return (
    <Card aria-label="Members">
      <CardHeader
        icon={Users}
        title="Members"
        description={`${plural(total, 'person', 'people')}, owner first`}
      />
      <div className="mt-4">
        <Table caption="Members of this workspace">
          <THead>
            <Th>Person</Th>
            <Th>Role</Th>
            <Th hide="sm">Account</Th>
            <Th hide="md">Joined</Th>
          </THead>
          <TBody>
            {members.map((member) => (
              <Tr key={member.id} interactive>
                <Td header>
                  <PersonCell
                    person={member.user}
                    // On a phone the Account column is hidden: a suspension shows here.
                    badges={
                      member.user.status === 'DISABLED' && (
                        <Badge tone="danger" className="sm:hidden">
                          Suspended
                        </Badge>
                      )
                    }
                  />
                </Td>
                <Td>
                  <RoleBadge role={member.role} />
                </Td>
                <Td hide="sm">
                  <StateBadge state={userStatusBadge(member.user.status)} />
                </Td>
                <Td hide="md" className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                  {formatDay(member.joinedAt, '—')}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {truncated && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-muted sm:px-6 dark:border-white/5">
            Showing the first 200 members.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function AdminWorkspaceDetailPage() {
  const { workspaceId } = useParams();
  const query = useAdminWorkspace(workspaceId);
  const detail = query.data;

  if (!detail) {
    return (
      <>
        {query.error?.status !== 404 && <BackLink to={BACK.to}>{BACK.label}</BackLink>}
        {query.isPending ? (
          <Card>
            <RowsSkeleton rows={3} shape="tile" label="Loading this workspace…" />
          </Card>
        ) : query.error?.status === 404 ? (
          <Card>
            <EmptyState
              icon={Building2}
              tone="neutral"
              title="Workspace not found"
              description="This workspace does not exist, or it was deleted."
              action={<ButtonLink to={BACK.to}>All workspaces</ButtonLink>}
            />
          </Card>
        ) : (
          <Card>
            <ErrorState
              title="Could not load this workspace"
              error={query.error}
              onRetry={() => query.refetch()}
            />
          </Card>
        )}
      </>
    );
  }

  const { workspace, members, counts } = detail;
  return (
    <>
      <PageHeader
        back={BACK}
        media={
          <Avatar name={workspace.name} seed={workspace.id} size="lg" square className="ring-0" />
        }
        title={workspace.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span>/w/{workspace.slug}</span>
            <StateBadge state={publishingModeBadge(workspace.publishingMode)} />
          </span>
        }
      />
      <div className="stagger space-y-6">
        <Numbers counts={counts} />
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <WorkspaceFacts workspace={workspace} />
          <StatesCard counts={counts} />
        </div>
        <MembersCard members={members} total={counts.members} truncated={detail.membersTruncated} />
        <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
          Only names, people and counts are shown here. The workspace&apos;s posts, drafts, media,
          notes, group directory and the names of its connected Pages and Instagram accounts stay
          private to its team.
        </p>
      </div>
    </>
  );
}
