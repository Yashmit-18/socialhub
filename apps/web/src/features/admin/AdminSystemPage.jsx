import {
  BarChart3,
  Database,
  HardDrive,
  Layers,
  Mail,
  RefreshCw,
  Send,
  Server,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { StatGrid, StatTile } from '../../components/ui/StatTile.jsx';
import { cn } from '../../lib/utils.js';
import { StateBadge, StatusRows } from './AdminUi.jsx';
import {
  ANALYTICS_MODE,
  DATABASE_STATE,
  ENVIRONMENT,
  PUBLISHING_MODE,
  UNKNOWN,
  emailState,
  formatAgo,
  formatDateTime,
  formatDuration,
  queueCounts,
  queueState,
  storageState,
  transactionsState,
  workerState,
} from './adminFormat.js';
import { useAdminSystem } from './api.js';

const known = (map, key) => map[key] ?? ['neutral', UNKNOWN, 'The server did not say.'];

const STATUS_TEXT = {
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
  violet: 'text-violet-700 dark:text-violet-300',
  neutral: 'text-slate-700 dark:text-slate-200',
};
const STATUS_DOT = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  violet: 'bg-violet-500',
  neutral: 'bg-slate-400 dark:bg-slate-500',
};

/** One headline state at the top of the page; the cards below explain each one. */
function HealthCell({ icon: Icon, label, state }) {
  const [tone, words] = state;
  return (
    <div className="bg-white px-4 py-4 sm:px-5 dark:bg-slate-900">
      <p className="flex items-center gap-2 text-[13px] leading-5 font-medium text-slate-600 dark:text-slate-400">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </p>
      <p
        className={cn(
          'mt-2 flex items-center gap-2 text-base font-semibold tracking-tight',
          STATUS_TEXT[tone],
        )}
      >
        <span
          aria-hidden="true"
          className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[tone])}
        />
        {words}
      </p>
    </div>
  );
}

const row = (key, label, state, value) => ({
  key,
  label,
  hint: state[2],
  value: value ?? <StateBadge state={state} />,
});

function PublishingCard({ publishing }) {
  const off = publishing.mode === 'DISABLED';
  const { deliveries } = publishing;
  const tile = { variant: 'inset', size: 'sm', animate: false };
  return (
    <Card aria-label="Publishing">
      <CardHeader
        icon={Send}
        title="Publishing"
        description="The mode is the setting of the server that answered. A worker that runs on its own has its own setting."
      />
      <div className="mt-4">
        <StatusRows
          rows={[
            row('mode', 'Mode', known(PUBLISHING_MODE, publishing.mode)),
            row('queue', 'Queue', queueState(publishing.queue.status, { off })),
            {
              key: 'contents',
              label: 'In the queue',
              hint: publishing.queue.counts
                ? 'Jobs the queue holds right now.'
                : 'Shown only when the queue answers.',
              value: queueCounts(publishing.queue.counts),
            },
            row('worker', 'Worker', workerState(publishing.worker, { off })),
          ]}
        />
      </div>
      <CardBody className="border-t border-slate-100 dark:border-white/5">
        <h3 className="text-xs font-medium text-muted">Deliveries right now</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile {...tile} label="Waiting" value={deliveries.waiting} />
          <StatTile {...tile} label="Being sent" value={deliveries.sending} />
          <StatTile
            {...tile}
            label="Late"
            value={deliveries.late}
            emphasis={deliveries.late > 0 ? 'danger' : undefined}
            hint={
              deliveries.late > 0
                ? `in ${deliveries.latePosts === 1 ? '1 post' : `${deliveries.latePosts} posts`}`
                : 'more than 10 minutes'
            }
          />
          <StatTile
            {...tile}
            label="Interrupted"
            value={deliveries.interrupted}
            emphasis={deliveries.interrupted > 0 ? 'warning' : undefined}
            hint="a worker stopped mid-send"
          />
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted">Next one due</dt>
            <dd className="mt-0.5 text-slate-900 dark:text-white">
              {formatDateTime(deliveries.nextDueAt, 'Nothing is waiting')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">Last post finished</dt>
            <dd className="mt-0.5 text-slate-900 dark:text-white">
              {deliveries.lastFinishedAt ? (
                <time
                  dateTime={deliveries.lastFinishedAt}
                  title={formatDateTime(deliveries.lastFinishedAt)}
                >
                  {formatAgo(deliveries.lastFinishedAt)}
                </time>
              ) : (
                'No post has finished yet'
              )}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

function ServerCard({ system }) {
  const { api, database } = system;
  return (
    <Card aria-label="Server">
      <CardHeader icon={Server} title="Server" description="The API process that answered." />
      <div className="mt-4">
        <StatusRows
          rows={[
            {
              key: 'environment',
              label: 'Environment',
              hint: `Version ${api.version}`,
              value: ENVIRONMENT[api.environment] ?? api.environment ?? UNKNOWN,
            },
            {
              key: 'uptime',
              label: 'Running for',
              hint: 'Since this process last started.',
              value: formatDuration(api.uptimeSeconds),
            },
            row('database', 'Database', known(DATABASE_STATE, database.state)),
            row('transactions', 'Saving in one step', transactionsState(database.transactions)),
          ]}
        />
      </div>
    </Card>
  );
}

function StorageCard({ system }) {
  const storage = storageState(system.storage, system.publishing.mode);
  return (
    <Card aria-label="Storage and email">
      <CardHeader icon={HardDrive} title="Storage and email" />
      <div className="mt-4">
        <StatusRows
          rows={[
            row('driver', 'Media storage', storage.driver),
            row('links', 'Media links for Meta', storage.links),
            row('email', 'Email', emailState(system.email)),
          ]}
        />
      </div>
    </Card>
  );
}

function AnalyticsCard({ analytics }) {
  const off = analytics.mode === 'DISABLED';
  return (
    <Card aria-label="Analytics" className="md:col-span-2 xl:col-span-1">
      <CardHeader icon={BarChart3} title="Analytics" description="Collecting insights from Meta." />
      <div className="mt-4">
        <StatusRows
          rows={[
            row('mode', 'Mode', known(ANALYTICS_MODE, analytics.mode)),
            row('queue', 'Queue', queueState(analytics.queue.status, { off })),
            row('worker', 'Worker', workerState(analytics.worker, { off })),
          ]}
        />
      </div>
    </Card>
  );
}

function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}

export default function AdminSystemPage() {
  const query = useAdminSystem();
  const system = query.data;
  const refreshing = query.isFetching && !query.isPending;
  const off = system?.publishing.mode === 'DISABLED';

  return (
    <>
      <PageHeader
        title="System status"
        description="How this SocialHub is running right now. Anything that cannot be read shows as Unknown, never as fine."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            onClick={() => query.refetch()}
          >
            {!refreshing && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Refresh
          </Button>
        }
      />
      {query.isPending ? (
        <>
          <p role="status" className="sr-only">
            Checking the system…
          </p>
          <Loading />
        </>
      ) : query.isError && !system ? (
        <Card>
          <ErrorState
            title="Could not check the system"
            error={query.error}
            onRetry={() => query.refetch()}
          />
        </Card>
      ) : (
        <div className="stagger space-y-6">
          <StatGrid label="At a glance" columns={4}>
            <HealthCell
              icon={Database}
              label="Database"
              state={known(DATABASE_STATE, system.database.state)}
            />
            <HealthCell
              icon={Layers}
              label="Publishing queue"
              state={queueState(system.publishing.queue.status, { off })}
            />
            <HealthCell
              icon={Send}
              label="Publishing worker"
              state={workerState(system.publishing.worker, { off })}
            />
            <HealthCell icon={Mail} label="Email" state={emailState(system.email)} />
          </StatGrid>
          <PublishingCard publishing={system.publishing} />
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 xl:items-start">
            <ServerCard system={system} />
            <StorageCard system={system} />
            <AnalyticsCard analytics={system.analytics} />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Checked {formatAgo(system.generatedAt)}; this page checks again every 30 seconds.
          </p>
        </div>
      )}
    </>
  );
}
