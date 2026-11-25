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
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useGroupCountsByPage, useSharingTasks } from '../../features/groups/api.js';
import { usePublishJobSummary } from '../../features/publishing/usePublishing.js';
import { useAccountSummary, useOverview } from '../../lib/queries.js';
import { cn, firstName, greeting } from '../../lib/utils.js';

/**
 * Colour per kind of figure, from the logo's indigo → violet → pink plus the platforms' own
 * colours: `tile` for a soft icon chip, `solid` for a highlighted one.
 */
const TONES = {
  brand: {
    tile: 'bg-brand-50 text-brand-600 dark:bg-brand-400/10 dark:text-brand-300',
    solid: 'bg-brand-600 text-white',
    border: 'border-brand-300 dark:border-brand-400/40',
    text: 'text-brand-600 dark:text-brand-300',
  },
  violet: {
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300',
    solid: 'bg-violet-600 text-white',
    border: 'border-violet-300 dark:border-violet-400/40',
    text: 'text-violet-600 dark:text-violet-300',
  },
  pink: {
    tile: 'bg-pink-50 text-pink-600 dark:bg-pink-400/10 dark:text-pink-300',
    solid: 'bg-pink-600 text-white',
    border: 'border-pink-300 dark:border-pink-400/40',
    text: 'text-pink-600 dark:text-pink-300',
  },
  facebook: { tile: 'bg-[#1877F2]/10 text-[#1877F2] dark:bg-[#1877F2]/15 dark:text-[#6ea8fb]' },
  amber: { tile: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300' },
};

/** One figure in the stats strip. */
function Stat({ label, value, icon: Icon, tone = 'brand', hint, loading }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 px-5 py-4">
      {Icon && (
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            TONES[tone].tile,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm leading-tight text-muted">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-12" />
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
            <AnimatedNumber value={value ?? '—'} />
          </p>
        )}
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

/** One step of the everyday workflow: a link with a live line underneath. */
function WorkflowStep({ step, to, icon: Icon, title, text, tone, highlight = false }) {
  const colours = TONES[tone];
  return (
    <Link
      to={to}
      className={cn(
        'surface surface-hover group flex items-start gap-3.5 p-4 focus-visible:outline-2',
        highlight && colours.border,
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          highlight ? colours.solid : colours.tile,
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-xs font-semibold', colours.text)}>Step {step}</span>
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{text}</span>
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
  const setupLeft = !isPending && checklist.length > 0 && doneCount < checklist.length;

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

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : (
        <div className="space-y-6">
          {(canCreate || canRead) && (
            <nav aria-label="Workflow" className="stagger grid gap-3 md:grid-cols-3">
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

          <Card>
            <div className="grid grid-cols-2 divide-slate-100 lg:grid-cols-4 lg:divide-x dark:divide-white/[0.06]">
              <Stat
                label="Facebook Pages"
                icon={FacebookIcon}
                tone="facebook"
                value={stats?.facebookPages}
                loading={isPending}
              />
              <Stat
                label="Instagram accounts"
                icon={InstagramIcon}
                tone="pink"
                value={stats?.instagramAccounts}
                loading={isPending}
              />
              <Stat
                label="Team members"
                icon={Users}
                tone="violet"
                value={stats?.members}
                loading={isPending}
              />
              <Stat
                label="Pending invitations"
                icon={Mail}
                tone="amber"
                value={stats?.pendingInvitations}
                hint={
                  stats && stats.pendingInvitations === null
                    ? 'Visible to owners and admins'
                    : undefined
                }
                loading={isPending}
              />
            </div>
          </Card>

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

          <div className={cn('grid gap-6', setupLeft && 'lg:grid-cols-5')}>
            {setupLeft && (
              <Card className="lg:col-span-2">
                <CardHeader
                  icon={Check}
                  title="Finish setting up"
                  description={`${doneCount} of ${checklist.length} done`}
                />
                <CardBody className="pt-4">
                  <ul className="space-y-2">
                    {checklist.map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-white/10"
                      >
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
                </CardBody>
              </Card>
            )}

            {can(PERMISSIONS.ACTIVITY_READ) && (
              <Card className={cn(setupLeft && 'lg:col-span-3')}>
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
                    <div className="space-y-3">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-10" />
                      ))}
                    </div>
                  ) : data.recentActivity?.length ? (
                    <ActivityFeed items={data.recentActivity} compact />
                  ) : (
                    <EmptyState title="No activity yet" className="py-6" />
                  )}
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
