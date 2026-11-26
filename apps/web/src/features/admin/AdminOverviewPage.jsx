import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CircleCheck,
  LayoutDashboard,
  RefreshCw,
  Send,
  TriangleAlert,
  UserRoundX,
  Users,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { StatGrid, StatTile } from '../../components/ui/StatTile.jsx';
import { GRADIENT_TONES, softTone } from '../../components/ui/tones.js';
import { cn } from '../../lib/utils.js';
import { AdminActivityChart } from './AdminActivityChart.jsx';
import { UNKNOWN, attentionItem, formatAgo, formatCount, plural } from './adminFormat.js';
import { useAdminOverview } from './api.js';

function NeedsAttention({ items, loading }) {
  const calm = !loading && items.length === 0;
  return (
    <Card aria-label="Needs attention">
      <CardHeader
        icon={calm ? CircleCheck : TriangleAlert}
        iconTone={calm ? 'success' : 'warning'}
        title="Needs attention"
        description="Problems you can do something about."
      />
      {loading ? (
        <div className="space-y-2 px-5 pt-4 pb-5 sm:px-6" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : calm ? (
        <p className="px-5 pt-3 pb-5 text-sm text-slate-600 sm:px-6 dark:text-slate-300">
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
          {items.map((raw) => {
            const item = attentionItem(raw);
            const Icon = item.icon;
            return (
              <li
                key={raw.code}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    softTone(item.tone),
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <p className="min-w-0 flex-1 basis-56 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  <span className="sr-only">{item.severity}: </span>
                  {item.text}
                </p>
                <ButtonLink to={item.to} variant="ghost" size="sm" className="ml-auto">
                  {item.linkLabel}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PlatformNumbers({ data, loading }) {
  const tile = { variant: 'cell', unknown: UNKNOWN, loading };
  const { users, workspaces, accounts, publishing } = data ?? {};
  const week = publishing?.last7Days;
  return (
    <StatGrid label="Platform numbers" columns={4}>
      <StatTile
        {...tile}
        label="Users"
        value={users?.total}
        icon={Users}
        tone="sky"
        hint={users && `${formatCount(users.newLast7Days)} new in the last 7 days`}
        to="/admin/users"
      />
      <StatTile
        {...tile}
        label="Suspended"
        value={users?.suspended}
        icon={UserRoundX}
        tone="danger"
        hint={users && `of ${plural(users.total, 'account', 'accounts')}`}
        to="/admin/users?status=DISABLED"
      />
      <StatTile
        {...tile}
        label="Workspaces"
        value={workspaces?.total}
        icon={Building2}
        tone="brand"
        hint={workspaces && `${formatCount(workspaces.newLast7Days)} new in the last 7 days`}
        to="/admin/workspaces"
      />
      <StatTile
        {...tile}
        label="Publishing for real"
        value={workspaces?.livePublishing}
        icon={Send}
        tone="amber"
        hint="workspaces with it switched on"
        to="/admin/workspaces?publishingMode=LIVE"
      />
      <StatTile
        {...tile}
        label="Facebook Pages"
        value={accounts?.facebookPages}
        icon={FacebookIcon}
        tone="facebook"
        hint="connected across all workspaces"
      />
      <StatTile
        {...tile}
        label="Instagram accounts"
        value={accounts?.instagramAccounts}
        icon={InstagramIcon}
        tone="instagram"
        hint="connected across all workspaces"
      />
      <StatTile
        {...tile}
        label="Posts in progress"
        value={publishing?.postsInProgress}
        icon={CalendarClock}
        tone="violet"
        hint="scheduled, queued or being sent"
      />
      <StatTile
        {...tile}
        label="Real posts, 7 days"
        value={week?.realPosts}
        icon={BadgeCheck}
        tone="success"
        hint={
          week &&
          `${formatCount(week.simulatedPosts)} simulated, ${formatCount(week.failedPosts)} failed`
        }
      />
    </StatGrid>
  );
}

export default function AdminOverviewPage() {
  const overview = useAdminOverview();
  const { data } = overview;
  const refreshing = overview.isFetching && !overview.isPending;

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        tone={GRADIENT_TONES.fuchsia}
        title="Overview"
        description="Everyone and everything on this SocialHub, in numbers. Nothing here shows the content of a workspace."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            onClick={() => overview.refetch()}
          >
            {!refreshing && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Refresh
          </Button>
        }
      />
      {overview.isError && !data ? (
        <Card>
          <ErrorState
            title="Could not load the overview"
            error={overview.error}
            onRetry={() => overview.refetch()}
          />
        </Card>
      ) : (
        <div className="stagger space-y-6">
          <NeedsAttention items={data?.attention ?? []} loading={overview.isPending} />
          <PlatformNumbers data={data} loading={overview.isPending} />
          <Card aria-label="Last 14 days">
            <CardHeader
              icon={Activity}
              title="Last 14 days"
              description="New accounts and real posts published, per day (UTC)."
            />
            <CardBody>
              {data ? (
                <AdminActivityChart days={data.activity.days} />
              ) : (
                <Skeleton className="h-56 w-full" />
              )}
            </CardBody>
          </Card>
          {data && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Counted {formatAgo(data.generatedAt, UNKNOWN)}. Every figure is a count of
              SocialHub&apos;s own records; nothing is estimated.
            </p>
          )}
        </div>
      )}
    </>
  );
}
