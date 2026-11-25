import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@socialhub/shared';
import {
  Activity,
  ArrowRight,
  Check,
  Clock,
  Share2,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';
import { FollowersCard } from '../../components/accounts/FollowersCard.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { RoleBadge } from '../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useAccountSummary, useOverview } from '../../lib/queries.js';
import { cn, firstName, greeting } from '../../lib/utils.js';

function StatCard({ label, value, icon: Icon, accent, glow, hint, loading }) {
  return (
    <Card interactive className="group relative overflow-hidden p-5">
      <div
        className={cn(
          'absolute -top-10 -right-10 h-32 w-32 rounded-full opacity-[0.14] blur-2xl transition-[opacity,transform] duration-700 ease-out-expo group-hover:scale-125 group-hover:opacity-25',
          accent,
        )}
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl text-white ring-1 ring-white/20 ring-inset transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-6',
            accent,
            glow,
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-16" />
      ) : (
        <p className="relative mt-2 text-[32px] leading-none font-semibold tracking-tight tabular-nums">
          <AnimatedNumber value={value ?? '—'} />
        </p>
      )}
      {hint && <p className="relative mt-2 text-xs text-muted">{hint}</p>}
      <span
        className={cn(
          'absolute inset-x-5 bottom-0 h-px origin-left scale-x-0 opacity-70 transition-transform duration-700 ease-out-expo group-hover:scale-x-100',
          accent,
        )}
        aria-hidden="true"
      />
    </Card>
  );
}

const KEY_PERMISSIONS = [
  [PERMISSIONS.MEMBERS_INVITE, 'Invite teammates'],
  [PERMISSIONS.MEMBERS_MANAGE, 'Manage roles and account access'],
  [PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE, 'Connect and disconnect social accounts'],
  [PERMISSIONS.CONTENT_PUBLISH, 'Create and publish content'],
  [PERMISSIONS.WORKSPACE_UPDATE, 'Change workspace settings'],
  [PERMISSIONS.WORKSPACE_DELETE, 'Delete the workspace'],
];

export default function OverviewPage() {
  const { user } = useAuth();
  const { workspace, role, can } = useWorkspace();
  const { data, isPending, error, refetch } = useOverview(workspace.id);
  const accountSummary = useAccountSummary(workspace.id);
  const stats = data?.stats;
  const base = `/w/${workspace.slug}`;
  const accountsTotal = stats ? stats.facebookPages + stats.instagramAccounts : 0;

  const checklist = [
    { done: true, label: 'Create your workspace' },
    {
      done: (stats?.members ?? 0) > 1,
      label: 'Invite your team',
      to: `${base}/team`,
      show: can(PERMISSIONS.MEMBERS_INVITE),
    },
    {
      done: accountsTotal > 0,
      label: 'Connect Facebook Pages and Instagram accounts',
      to: `${base}/accounts`,
      show: can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE),
    },
  ].filter((c) => c.show !== false);
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title={`${greeting()}, ${firstName(user?.name)}`}
        description="Here's what's happening in your workspace."
        actions={
          can(PERMISSIONS.MEMBERS_INVITE) && (
            <ButtonLink to={`${base}/team?invite=1`}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite teammate
            </ButtonLink>
          )
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Team members"
              value={stats?.members}
              icon={Users}
              accent="bg-gradient-to-br from-brand-500 to-violet-500"
              glow="shadow-lg shadow-brand-500/30"
              loading={isPending}
            />
            <StatCard
              label="Pending invitations"
              value={stats?.pendingInvitations}
              icon={Clock}
              accent="bg-gradient-to-br from-sky-500 to-cyan-500"
              glow="shadow-lg shadow-sky-500/30"
              hint={
                stats && stats.pendingInvitations === null
                  ? 'Visible to owners and admins'
                  : undefined
              }
              loading={isPending}
            />
            <StatCard
              label="Facebook Pages"
              value={stats?.facebookPages}
              icon={FacebookIcon}
              accent="bg-gradient-to-br from-blue-600 to-indigo-500"
              glow="shadow-lg shadow-blue-600/30"
              loading={isPending}
            />
            <StatCard
              label="Instagram accounts"
              value={stats?.instagramAccounts}
              icon={InstagramIcon}
              accent="bg-gradient-to-br from-fuchsia-500 to-orange-400"
              glow="shadow-lg shadow-fuchsia-500/30"
              loading={isPending}
            />
          </div>

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

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader
                  icon={Check}
                  title="Getting started"
                  description="Set up the essentials for your team."
                  action={
                    <span className="text-xs font-medium text-muted tabular-nums">
                      {doneCount} of {checklist.length} done
                    </span>
                  }
                />
                <CardBody>
                  <div
                    className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full origin-left animate-bar-grow rounded-full bg-gradient-to-r from-emerald-400 via-brand-500 to-fuchsia-500 transition-[width] duration-700 ease-out-expo"
                      style={{ width: `${(doneCount / checklist.length) * 100}%` }}
                    />
                  </div>
                  <ul className="stagger space-y-2">
                    {checklist.map((item) => (
                      <li
                        key={item.label}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-[border-color,background-color] duration-200',
                          item.done
                            ? 'border-slate-100 dark:border-white/5'
                            : 'border-slate-200/80 bg-slate-50/50 hover:border-brand-300/60 hover:bg-brand-50/40 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-brand-400/30 dark:hover:bg-brand-500/[0.05]',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                            item.done
                              ? 'animate-pop-in bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/40'
                              : 'border-2 border-dashed border-slate-300 transition-colors group-hover:border-brand-400 dark:border-white/20',
                          )}
                        >
                          {item.done && <Check className="h-3.5 w-3.5" aria-label="Done" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'text-sm font-medium',
                              item.done && 'text-muted line-through decoration-slate-300',
                            )}
                          >
                            {item.label}
                          </p>
                          {item.note && !item.done && (
                            <p className="text-xs text-muted">{item.note}</p>
                          )}
                        </div>
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

              {can(PERMISSIONS.ACTIVITY_READ) && (
                <Card>
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

            <div className="space-y-6">
              <Card>
                <CardHeader
                  icon={ShieldCheck}
                  title="Your access"
                  action={<RoleBadge role={role} />}
                />
                <CardBody>
                  <p className="text-sm text-muted">{ROLE_DESCRIPTIONS[role]}</p>
                  <ul className="mt-4 space-y-2">
                    {KEY_PERMISSIONS.map(([permission, label]) => {
                      const allowed = can(permission);
                      return (
                        <li
                          key={permission}
                          className={cn(
                            'flex items-center gap-2 text-sm',
                            !allowed && 'text-muted',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4.5 w-4.5 items-center justify-center rounded-full',
                              allowed
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-slate-100 text-slate-300 dark:bg-white/5 dark:text-slate-600',
                            )}
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                          <span
                            className={
                              !allowed
                                ? 'line-through decoration-slate-300 dark:decoration-slate-600'
                                : undefined
                            }
                          >
                            {label}
                          </span>
                          <span className="sr-only">{allowed ? '(allowed)' : '(not allowed)'}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-4 text-xs text-muted">
                    Signed in as {ROLE_LABELS[role]} of {workspace.name}.
                  </p>
                </CardBody>
              </Card>

              <Card interactive className="group overflow-hidden">
                <div className="relative isolate overflow-hidden bg-[linear-gradient(120deg,var(--color-brand-600),#9333ea,#db2777,var(--color-brand-600))] bg-[length:240%_240%] p-5 text-white animate-gradient-pan">
                  <div
                    className="absolute -top-10 -right-8 -z-10 h-32 w-32 rounded-full bg-white/20 blur-2xl transition-transform duration-700 ease-out-expo group-hover:scale-150"
                    aria-hidden="true"
                  />
                  <div
                    className="absolute -bottom-12 left-6 -z-10 h-24 w-24 animate-float rounded-full bg-amber-300/25 blur-2xl"
                    aria-hidden="true"
                  />
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur ring-inset">
                    <Share2
                      className="h-5 w-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-12"
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="mt-3 font-semibold">Social accounts</h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/80">
                    {accountsTotal > 0
                      ? `${accountsTotal} destination${accountsTotal === 1 ? '' : 's'} available to you.`
                      : 'Connect Facebook Pages and Instagram professional accounts through official Meta logins.'}
                  </p>
                </div>
                <div className="p-4">
                  <ButtonLink to={`${base}/accounts`} variant="secondary" className="w-full">
                    View social accounts
                  </ButtonLink>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
