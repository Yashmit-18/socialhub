import { PERMISSIONS } from '@socialhub/shared';
import {
  Activity,
  ArrowRight,
  Check,
  Mail,
  Megaphone,
  Send,
  SquarePen,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';
import { FollowersCard } from '../../components/accounts/FollowersCard.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FeedArt } from '../../components/ui/illustrations.jsx';
import { StatTile } from '../../components/ui/StatTile.jsx';
import { GRADIENT_TONES } from '../../components/ui/tones.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useGroupCountsByPage, useSharingTasks } from '../../features/groups/api.js';
import { usePublishJobSummary } from '../../features/publishing/usePublishing.js';
import { useAccountSummary, useOverview } from '../../lib/queries.js';
import { cn, firstName, greeting } from '../../lib/utils.js';

/**
 * Each step wears the colour of the section it opens (the sidebar gradients), so the step that
 * leads to Posts looks like Posts. `text` is the "Step N" label, `dot` marks a live sentence.
 */
const STEP_TONES = {
  brand: {
    gradient: GRADIENT_TONES.brand,
    text: 'text-brand-600 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  violet: {
    gradient: GRADIENT_TONES.violet,
    text: 'text-violet-600 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  pink: {
    gradient: GRADIENT_TONES.pink,
    text: 'text-pink-700 dark:text-pink-300',
    dot: 'bg-pink-500',
  },
};

// A viewer sees two steps: never leave an empty third column.
const STEP_COLUMNS = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/**
 * One step of the everyday workflow, a segment of one strip. `live` promotes the sentence when
 * it reports something waiting (weight and a dot, so colour is not the only cue).
 */
function WorkflowStep({
  step,
  to,
  icon: Icon,
  title,
  text,
  tone,
  live = false,
  highlight = false,
}) {
  const colours = STEP_TONES[tone];
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-start gap-3.5 px-5 py-4 transition-colors duration-150 focus-visible:-outline-offset-2',
        highlight
          ? 'bg-pink-50/60 hover:bg-pink-50 dark:bg-pink-500/[0.06] dark:hover:bg-pink-500/10'
          : 'hover:bg-slate-50/80 dark:hover:bg-white/[0.03]',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md shadow-slate-900/10 ring-1 ring-white/20 ring-inset',
          colours.gradient,
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-xs font-semibold', colours.text)}>Step {step}</span>
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        {/* Two lines reserved, so the strip keeps its height when a live sentence arrives. */}
        <span
          className={cn(
            'mt-0.5 flex min-h-8 items-start gap-1.5 text-xs',
            live ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-muted',
          )}
        >
          {live && (
            <span
              aria-hidden="true"
              className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', colours.dot)}
            />
          )}
          <span>{text}</span>
        </span>
      </span>
      <ArrowRight
        className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500 dark:text-slate-600"
        aria-hidden="true"
      />
    </Link>
  );
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export default function OverviewPage() {
  const { user } = useAuth();
  const { workspace, can } = useWorkspace();
  const { data, isPending, error, refetch } = useOverview(workspace.id);
  const accountSummary = useAccountSummary(workspace.id);
  const canCreate = can(PERMISSIONS.CONTENT_CREATE);
  const canRead = can(PERMISSIONS.CONTENT_READ);
  const canShare = can(PERMISSIONS.SHARING_TASKS_COMPLETE);
  const canActivity = can(PERMISSIONS.ACTIVITY_READ);
  const jobs = usePublishJobSummary(workspace.id, { enabled: canRead });
  const tasks = useSharingTasks(
    workspace.id,
    { status: 'OPEN', assignee: 'available', limit: 1 },
    { enabled: canShare },
  );
  const groupCounts = useGroupCountsByPage(workspace.id, {
    enabled: can(PERMISSIONS.GROUPS_MANAGE),
  });
  const stats = data?.stats;
  const base = `/w/${workspace.slug}`;
  const accountsTotal = stats ? stats.facebookPages + stats.instagramAccounts : 0;
  const scheduled = jobs.data?.counts?.SCHEDULED ?? 0;
  const toShare = tasks.data?.total ?? 0;
  const groupLinks = Object.values(groupCounts.data ?? {}).reduce((a, b) => a + b, 0);
  const stepCount = (canCreate ? 1 : 0) + (canRead ? 2 : 0);

  const checklist = [
    {
      done: accountsTotal > 0,
      label: 'Connect your Facebook Pages and Instagram accounts',
      to: `${base}/accounts`,
      show: can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE),
    },
    {
      done: groupLinks > 0,
      label: 'Add the Facebook Groups your Pages are in',
      to: `${base}/groups/directory`,
      show: can(PERMISSIONS.GROUPS_MANAGE) && !groupCounts.isPending && !groupCounts.error,
    },
    {
      done: (stats?.members ?? 0) > 1,
      label: 'Invite your team',
      to: `${base}/team`,
      show: can(PERMISSIONS.MEMBERS_INVITE),
    },
  ].filter((c) => c.show !== false);
  const doneCount = checklist.filter((c) => c.done).length;
  // Without the overview figures nothing is known to be done, so nothing is listed as open.
  const setupLeft = !isPending && !error && checklist.length > 0 && doneCount < checklist.length;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name)}`}
        description={`Here’s what’s happening in ${workspace.name}.`}
        actions={
          <>
            {can(PERMISSIONS.MEMBERS_INVITE) && (
              <ButtonLink to={`${base}/team?invite=1`} variant="secondary">
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite teammate
              </ButtonLink>
            )}
            {canCreate && (
              <ButtonLink to={`${base}/compose`}>
                <SquarePen className="h-4 w-4" aria-hidden="true" /> Create post
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {stepCount > 0 && (
          <nav
            aria-label="Workflow"
            className={cn(
              'surface grid divide-y divide-slate-100 overflow-hidden md:divide-x md:divide-y-0 dark:divide-white/[0.06]',
              STEP_COLUMNS[stepCount],
            )}
          >
            {canCreate && (
              <WorkflowStep
                step={1}
                to={`${base}/compose`}
                icon={SquarePen}
                tone="brand"
                title="Create a post"
                text="Write it once for your Pages and Instagram."
              />
            )}
            {canRead && (
              <WorkflowStep
                step={2}
                to={`${base}/publishing`}
                icon={Send}
                tone="violet"
                title="Track your posts"
                live={scheduled > 0}
                text={
                  scheduled > 0
                    ? `${plural(scheduled, 'post', 'posts')} scheduled.`
                    : 'See what went out and what is waiting.'
                }
              />
            )}
            {canRead && (
              <WorkflowStep
                step={3}
                to={`${base}/groups`}
                icon={Megaphone}
                tone="pink"
                title="Share in groups"
                live={toShare > 0}
                highlight={toShare > 0}
                text={
                  toShare > 0
                    ? `${plural(toShare, 'group is', 'groups are')} waiting for your post.`
                    : 'Your posts, ready for the groups your Pages are in.'
                }
              />
            )}
          </nav>
        )}

        {/* Totals cover only the accounts this member may see. Always shown, even with none. */}
        {accountSummary.error ? (
          <Card>
            <ErrorState
              title="Couldn’t load combined followers"
              error={accountSummary.error}
              onRetry={accountSummary.refetch}
            />
          </Card>
        ) : (
          <FollowersCard
            followers={accountSummary.data?.followers}
            accounts={accountSummary.data?.accounts}
            loading={accountSummary.isPending}
            emptyAction={
              can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE) ? (
                <ButtonLink to={`${base}/accounts`} variant="secondary" size="sm">
                  Connect accounts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </ButtonLink>
              ) : (
                <p className="text-xs text-muted">Ask a workspace owner or admin for access.</p>
              )
            }
          />
        )}

        {/* Only this part depends on the overview request, so only this part shows its error. */}
        {error ? (
          <Card>
            <ErrorState error={error} onRetry={refetch} />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
            {canActivity && (
              <Card className="lg:col-span-3">
                <CardHeader
                  icon={Activity}
                  title="Recent activity"
                  action={
                    <ButtonLink to={`${base}/activity`} variant="ghost" size="sm">
                      View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </ButtonLink>
                  }
                />
                <CardBody className="pt-3">
                  {isPending ? (
                    <div className="space-y-0.5" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-3 py-2">
                          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                          <Skeleton className={cn('h-3.5', i === 1 ? 'w-2/5' : 'w-3/5')} />
                        </div>
                      ))}
                    </div>
                  ) : data.recentActivity?.length ? (
                    <ActivityFeed items={data.recentActivity} compact />
                  ) : (
                    <EmptyState art={FeedArt} title="No activity yet" className="py-6" />
                  )}
                </CardBody>
              </Card>
            )}

            <div className={cn('space-y-6', canActivity ? 'lg:col-span-2' : 'lg:col-span-5')}>
              {setupLeft && (
                <Card>
                  <CardHeader
                    icon={Check}
                    title="Finish setting up"
                    description={`${doneCount} of ${checklist.length} done`}
                    action={
                      // The description already says how many are done, so the meter is hidden.
                      <div aria-hidden="true" className="mt-2 flex w-20 gap-1">
                        {checklist.map((item) => (
                          <span
                            key={item.label}
                            className={cn(
                              'h-1.5 flex-1 rounded-full',
                              item.done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-white/10',
                            )}
                          />
                        ))}
                      </div>
                    }
                  />
                  <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
                    {checklist.map((item) => (
                      <li key={item.label} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            item.done
                              ? 'bg-emerald-500 text-white'
                              : 'border-2 border-slate-300 dark:border-white/20',
                          )}
                        >
                          {item.done && <Check className="h-3 w-3" aria-label="Done" />}
                        </span>
                        <p
                          className={cn(
                            'min-w-0 flex-1 text-sm font-medium',
                            item.done && 'text-muted line-through decoration-slate-300',
                          )}
                        >
                          {item.label}
                        </p>
                        {item.to && !item.done && (
                          <ButtonLink to={item.to} variant="ghost" size="sm">
                            Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </ButtonLink>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="grid grid-cols-2 gap-4">
                <StatTile
                  label="Team members"
                  icon={Users}
                  tone="sky"
                  value={stats?.members}
                  loading={isPending}
                  to={`${base}/team`}
                />
                <StatTile
                  label="Pending invitations"
                  icon={Mail}
                  tone="neutral"
                  value={stats?.pendingInvitations}
                  loading={isPending}
                  hint={
                    stats && stats.pendingInvitations === null
                      ? 'Visible to owners and admins'
                      : undefined
                  }
                  to={can(PERMISSIONS.MEMBERS_INVITE) ? `${base}/team` : undefined}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
