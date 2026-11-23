import { ANALYTICS_METRICS, ANALYTICS_SOURCES, PUBLISHING_MODES } from '@socialhub/shared';
import {
  BarChart3,
  ExternalLink,
  FlaskConical,
  Image as ImageIcon,
  Info,
  Send,
  Trophy,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, Skeleton } from '../../components/ui/Feedback.jsx';
import { cn, timeAgo } from '../../lib/utils.js';
import { SimulatedBadge } from '../publishing/PublishingBadges.jsx';
import { safeExternalUrl } from '../publishing/labels.js';
import { ChartTable, LineChart, StackedBarChart } from './charts.jsx';
import {
  D,
  UNAVAILABLE,
  coverageText,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSigned,
  isNumber,
  metricLabel,
  platformLabel,
} from './format.js';

/* ------------------------------------------------------------------ shared bits */

export function StatTile({ label, value, hint, tone }) {
  const unavailable = value === UNAVAILABLE;
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 break-words text-xl font-semibold tabular-nums',
          unavailable
            ? 'text-base font-medium text-slate-400 dark:text-slate-500'
            : 'text-slate-900 dark:text-white',
          tone === 'danger' && !unavailable && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export function TilesSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}

/** Where the numbers on the screen come from. Demo data is announced loudly. */
export function SourceNotice({ source, analytics, hasInsights }) {
  if (source === ANALYTICS_SOURCES.SIMULATED) {
    return (
      <div
        role="note"
        className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100"
      >
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">DEMO DATA.</span> Reach, views, likes and other insights
          below are made up by SocialHub's simulation for testing. They are not your Facebook or
          Instagram performance. Publishing figures are SocialHub's own records.
        </p>
      </div>
    );
  }
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-100"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Data sources.</span> Publishing figures come from
        SocialHub's own records. Reach, views and engagement come only from Meta
        {hasInsights
          ? '.'
          : analytics?.source === ANALYTICS_SOURCES.META
            ? ', and none has been read yet for this range: sync the accounts to read them.'
            : ': reading insights from Meta is not switched on for this server yet, so they show as unavailable.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ publishing */

const ACTIVITY_SERIES = [
  { key: 'published', label: 'Published', color: 'var(--series-1)' },
  { key: 'failed', label: 'Failed', color: 'var(--series-2)' },
];

function PublishingMode({ stats, activity }) {
  const [table, setTable] = useState(false);
  const simulated = stats.mode === PUBLISHING_MODES.SIMULATED;
  const by = stats.destinations.byState;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {simulated ? 'Simulated publishing' : 'Live publishing'}
        </h3>
        {simulated && <SimulatedBadge>Simulated: nothing was posted to Meta</SimulatedBadge>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Posts"
          value={formatNumber(stats.jobs.total)}
          hint={`${formatNumber(stats.destinations.total)} account deliveries`}
        />
        <StatTile
          label={simulated ? 'Simulated' : 'Published'}
          value={formatNumber(by[D.PUBLISHED])}
        />
        <StatTile
          label="Failed"
          value={formatNumber(by[D.FAILED])}
          tone={by[D.FAILED] > 0 ? 'danger' : undefined}
        />
        <StatTile
          label="Partly published posts"
          value={formatNumber(stats.jobs.byStatus.PARTIALLY_PUBLISHED)}
        />
        <StatTile label="Scheduled" value={formatNumber(by[D.SCHEDULED])} />
        <StatTile label="Cancelled" value={formatNumber(by[D.CANCELLED])} />
        <StatTile
          label="Success rate"
          value={formatPercent(stats.successRate)}
          hint="Published ÷ (published + failed) deliveries"
        />
        <StatTile
          label="Average publishing time"
          value={formatDuration(stats.averageDurationSec)}
          hint="First attempt to result, published deliveries"
        />
        <StatTile
          label="Retries"
          value={formatNumber(stats.retries.extraAttempts)}
          hint={
            stats.retries.destinationsRetried === 1
              ? '1 delivery needed more than one attempt'
              : `${formatNumber(stats.retries.destinationsRetried)} deliveries needed more than one attempt`
          }
        />
      </div>
      {activity && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">Results per day</p>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
              aria-pressed={table}
              onClick={() => setTable((v) => !v)}
            >
              {table ? 'Show chart' : 'Show table'}
            </button>
          </div>
          {table ? (
            <ChartTable
              caption={`${simulated ? 'Simulated' : 'Live'} publishing results per day`}
              columns={['Day', 'Created', 'Published', 'Failed']}
              rows={activity.series.map((p) => [p.day, p.created, p.published, p.failed])}
            />
          ) : (
            <StackedBarChart
              points={activity.series}
              series={ACTIVITY_SERIES}
              label={`${simulated ? 'Simulated' : 'Live'} publishing results per day`}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function PublishingSection({ overview, trends, loading }) {
  const modes = overview?.publishing ?? [];
  return (
    <Card aria-label="Publishing performance">
      <CardHeader
        icon={Send}
        title="Publishing performance"
        description="From SocialHub's own records: every post sent through SocialHub in this range, per account."
      />
      <CardBody className="space-y-8">
        {loading ? (
          <TilesSkeleton count={6} />
        ) : modes.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Nothing was published in this range"
            description="Posts sent from the composer or the Publishing screen show up here."
            className="py-6"
          />
        ) : (
          modes.map((stats) => (
            <PublishingMode
              key={stats.mode}
              stats={stats}
              activity={trends?.publishing?.find((a) => a.mode === stats.mode)}
            />
          ))
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ insights */

const TREND_METRICS = ['reach', 'views', 'engagement', 'followers'];
const TILE_METRICS = ['reach', 'views', 'engagement', 'followers', 'followerGrowth'];

export function InsightsSection({ overview, trends, loading, source }) {
  const [metric, setMetric] = useState('reach');
  const [table, setTable] = useState(false);
  const insights = overview?.insights;
  const series = trends?.insights?.series ?? [];
  const simulated = source === ANALYTICS_SOURCES.SIMULATED;
  const points = series.map((p) => ({ day: p.day, value: p.metrics?.[metric] ?? null }));
  const reported = points.filter((p) => isNumber(p.value)).length;
  return (
    <Card aria-label="Audience and engagement">
      <CardHeader
        icon={BarChart3}
        title="Audience and engagement"
        description={simulated ? 'Demo data, made up for testing.' : 'Insights read from Meta.'}
        action={simulated ? <SimulatedBadge>DEMO</SimulatedBadge> : null}
      />
      <CardBody className="space-y-6">
        {loading ? (
          <TilesSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {TILE_METRICS.map((key) => {
              const m = insights?.metrics?.[key];
              const value =
                key === 'followerGrowth'
                  ? formatSigned(m?.value)
                  : formatNumber(m?.value ?? null, { short: true });
              const hint =
                key === 'reach' && isNumber(m?.value)
                  ? `${ANALYTICS_METRICS.reach.rangeLabel}. ${coverageText(m) ?? ''}`.trim()
                  : key === 'followers' && isNumber(m?.value)
                    ? `Latest reported. ${coverageText(m) ?? ''}`.trim()
                    : coverageText(m);
              return <StatTile key={key} label={metricLabel(key)} value={value} hint={hint} />;
            })}
          </div>
        )}
        {!loading && insights && !insights.hasData ? (
          <EmptyState
            icon={BarChart3}
            title="No insights for this range"
            description={
              simulated
                ? 'No demo data has been made for these accounts yet. Use "Make demo insights" while the server runs in demo mode.'
                : overview?.analytics?.source === ANALYTICS_SOURCES.SIMULATED
                  ? 'This server makes demo insights only and never reads them from Meta. To see them, choose "Demo data (made up)" under Insights.'
                  : 'Insights appear after accounts are synced with Meta. Until then they are unavailable, never shown as 0.'
            }
            className="py-6"
          />
        ) : (
          !loading && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div
                  role="group"
                  aria-label="Metric"
                  className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5"
                >
                  {TREND_METRICS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={metric === key}
                      onClick={() => setMetric(key)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-medium',
                        metric === key
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                      )}
                    >
                      {metricLabel(key)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                  aria-pressed={table}
                  onClick={() => setTable((v) => !v)}
                >
                  {table ? 'Show chart' : 'Show table'}
                </button>
              </div>
              {reported === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-muted dark:bg-white/5">
                  {metricLabel(metric)} was not reported for any day in this range, so there is
                  nothing to draw.
                </p>
              ) : table ? (
                <ChartTable
                  caption={`${metricLabel(metric)} per day`}
                  columns={['Day', metricLabel(metric), 'Accounts reporting']}
                  rows={series.map((p) => [
                    p.day,
                    isNumber(p.metrics?.[metric]) ? formatNumber(p.metrics[metric]) : UNAVAILABLE,
                    p.accountsReporting,
                  ])}
                />
              ) : (
                <>
                  <LineChart points={points} label={metricLabel(metric)} />
                  <p className="mt-1 text-[11px] text-muted">
                    {reported} of {points.length} days reported.
                    {metric === 'reach' &&
                      ' Each day counts the people reached that day; adding days counts a person once per day.'}
                  </p>
                </>
              )}
            </div>
          )
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ accounts */

function syncText(sync) {
  if (!sync?.last) return 'Never synced';
  if (sync.active) return 'Syncing…';
  const at = sync.lastSuccess?.finishedAt;
  if (sync.last.status === 'FAILED')
    return `Last sync failed${sync.last.error ? `: ${sync.last.error.message}` : ''}`;
  return at ? `Synced ${timeAgo(at)}` : 'Never synced';
}

/**
 * One line per publishing mode. Simulated and live deliveries are never added together: a
 * simulated "published" did not reach Meta.
 */
function AccountPublishing({ modes }) {
  const shown = modes.filter((p) => p.total > 0);
  if (shown.length === 0) return <span className="text-muted">No deliveries</span>;
  return (
    <ul className="space-y-0.5 text-xs whitespace-nowrap">
      {shown.map((p) => (
        <li key={p.mode} className="tabular-nums">
          <span
            className={cn(
              'mr-1 font-semibold',
              p.simulated
                ? 'text-violet-700 dark:text-violet-300'
                : 'text-slate-900 dark:text-white',
            )}
          >
            {p.simulated ? 'Simulated' : 'Live'}
          </span>
          <span className="text-slate-700 dark:text-slate-300">
            {formatNumber(p.byState.PUBLISHED)} published · {formatNumber(p.byState.FAILED)} failed
            {p.successRate === null ? '' : ` · ${formatPercent(p.successRate)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AccountsSection({ data, loading }) {
  const items = data?.items ?? [];
  return (
    <Card aria-label="Accounts">
      <CardHeader
        icon={Users}
        title="Accounts"
        description="Each Facebook Page and Instagram account you can use, side by side."
      />
      <CardBody>
        {loading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No accounts"
            description="No account matches these filters, or none has been shared with you."
            className="py-6"
          />
        ) : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th scope="col" className="py-2 pr-3 pl-5 font-semibold sm:pl-6">
                    Account
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Publishing
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Reach
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Views
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Engagement
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Followers
                  </th>
                  <th scope="col" className="py-2 pr-5 pl-3 font-semibold sm:pr-6">
                    Insights sync
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {items.map((item) => {
                  const m = item.insights.metrics;
                  const cell = (key) => {
                    const v = m?.[key]?.value;
                    return isNumber(v) ? (
                      formatNumber(v, { short: true })
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">{UNAVAILABLE}</span>
                    );
                  };
                  return (
                    <tr key={item.account.id}>
                      <th scope="row" className="py-2.5 pr-3 pl-5 font-normal sm:pl-6">
                        <span className="block font-medium text-slate-900 dark:text-white">
                          {item.account.name}
                        </span>
                        <span className="text-xs text-muted">
                          {platformLabel(item.account.platform)}
                        </span>
                      </th>
                      <td className="px-3 py-2.5">
                        <AccountPublishing modes={item.publishing} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{cell('reach')}</td>
                      <td className="px-3 py-2.5 tabular-nums">{cell('views')}</td>
                      <td className="px-3 py-2.5 tabular-nums">{cell('engagement')}</td>
                      <td className="px-3 py-2.5 tabular-nums">{cell('followers')}</td>
                      <td className="py-2.5 pr-5 pl-3 text-xs text-muted sm:pr-6">
                        {syncText(item.sync)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ top posts */

const POST_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saves', 'engagement'];

export function TopPostsSection({ data, loading, metric, timeZone = 'UTC' }) {
  const items = data?.items ?? [];
  return (
    <Card aria-label="Top posts">
      <CardHeader
        icon={Trophy}
        title="Top posts"
        description={`Posts published through SocialHub with the highest ${metricLabel(metric).toLowerCase()}. Only posts with that metric are ranked.`}
      />
      <CardBody>
        {loading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No post metrics yet"
            description="Posts are ranked once their insights have been read. Until then their metrics are unavailable."
            className="py-6"
          />
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((post, index) => (
              <li key={post.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-5 shrink-0 pt-1 text-sm font-semibold text-muted tabular-nums">
                  {index + 1}
                </span>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-white/5">
                  {post.thumbnailUrl ? (
                    <img
                      src={post.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-sm font-medium text-slate-900 dark:text-white">
                    {post.captionPreview || <span className="italic text-muted">No caption</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>{post.account.name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{platformLabel(post.platform)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(post.publishedAt, timeZone)}</span>
                    {post.simulated && <SimulatedBadge />}
                    {post.metricsSource === ANALYTICS_SOURCES.SIMULATED && (
                      <Badge tone="violet">Demo metrics</Badge>
                    )}
                  </p>
                  <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {POST_METRICS.filter((k) => isNumber(post.metrics[k])).map((k) => (
                      <div key={k} className="flex gap-1">
                        <dt className="text-muted">{metricLabel(k)}</dt>
                        <dd className="font-semibold text-slate-900 tabular-nums dark:text-white">
                          {formatNumber(post.metrics[k], { short: true })}
                        </dd>
                      </div>
                    ))}
                    {isNumber(post.engagementRate) && (
                      <div className="flex gap-1">
                        <dt className="text-muted">Engagement rate</dt>
                        <dd className="font-semibold text-slate-900 tabular-nums dark:text-white">
                          {formatPercent(post.engagementRate)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {safeExternalUrl(post.url) && (
                    <a
                      href={safeExternalUrl(post.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                    >
                      View post <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
