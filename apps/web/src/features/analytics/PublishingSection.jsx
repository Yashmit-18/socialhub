import { PUBLISHING_MODES } from '@socialhub/shared';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { BarChart } from '../../components/charts/BarChart.jsx';
import { ChartFrame, Legend } from '../../components/charts/ChartFrame.jsx';
import { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, Skeleton } from '../../components/ui/Feedback.jsx';
import { PostsArt } from '../../components/ui/illustrations.jsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';
import { GRADIENT_TONES } from '../../components/ui/tones.js';
import { SimulatedBadge } from '../publishing/PublishingBadges.jsx';
import { D, formatDay, formatDuration, formatNumber, formatPercent } from './format.js';
import { DayTable, FactList, Figure, HeadlineBand, SectionCard } from './parts.jsx';

const LONG_DAY = { weekday: 'short', day: 'numeric', month: 'short' };

/**
 * Bars per day. In simulation nothing reached Meta, so the first series says so and takes the
 * app's violet for "simulated"; live and simulated are never drawn in one chart.
 */
const seriesFor = (simulated) => [
  simulated
    ? { key: 'published', label: 'Published (simulated)', role: 'simulated' }
    : { key: 'published', label: 'Published', role: 'real' },
  { key: 'failed', label: 'Failed', role: 'failed' },
];

function PublishingMode({ stats, activity, trendsLoading, modeSwitch }) {
  const [table, setTable] = useState(false);
  const simulated = stats.mode === PUBLISHING_MODES.SIMULATED;
  const by = stats.destinations.byState;
  const failed = by[D.FAILED];
  const series = seriesFor(simulated);
  const chartName = `${simulated ? 'Simulated' : 'Live'} publishing results per day`;
  const retried = stats.retries.destinationsRetried;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {simulated ? 'Simulated publishing' : 'Live publishing'}
        </h3>
        {simulated && <SimulatedBadge>Simulated: nothing was posted to Meta</SimulatedBadge>}
        {modeSwitch}
      </div>

      <HeadlineBand>
        <Figure
          label="Posts"
          value={formatNumber(stats.jobs.total)}
          hint={`${formatNumber(stats.destinations.total)} account deliveries`}
        />
        <Figure
          label={simulated ? 'Simulated' : 'Published'}
          value={formatNumber(by[D.PUBLISHED])}
          hint="account deliveries"
        />
        <Figure
          label="Failed"
          value={formatNumber(failed)}
          hint="account deliveries"
          emphasis={failed > 0 ? 'danger' : undefined}
        />
        <Figure
          label="Success rate"
          value={formatPercent(stats.successRate)}
          hint="Published ÷ (published + failed) deliveries"
        />
      </HeadlineBand>

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
        {activity ? (
          <ChartFrame
            title="Results per day"
            legend={<Legend items={series} />}
            table={table}
            onToggleTable={() => setTable((v) => !v)}
          >
            {table ? (
              <DayTable
                caption={chartName}
                columns={['Day', 'Created', 'Published', 'Failed']}
                rows={activity.series.map((p) => ({
                  key: p.day,
                  cells: [
                    formatDay(p.day, LONG_DAY),
                    formatNumber(p.created),
                    formatNumber(p.published),
                    formatNumber(p.failed),
                  ],
                }))}
              />
            ) : (
              <BarChart stacked points={activity.series} series={series} label={chartName} />
            )}
          </ChartFrame>
        ) : (
          trendsLoading && <Skeleton className="h-64 rounded-xl" />
        )}
        <FactList
          className="border-t border-slate-100 pt-1 sm:grid-cols-2 lg:grid-cols-1 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6 dark:border-white/[0.06]"
          facts={[
            {
              key: 'partly',
              label: 'Partly published posts',
              value: formatNumber(stats.jobs.byStatus.PARTIALLY_PUBLISHED),
            },
            { key: 'scheduled', label: 'Scheduled', value: formatNumber(by[D.SCHEDULED]) },
            { key: 'cancelled', label: 'Cancelled', value: formatNumber(by[D.CANCELLED]) },
            {
              key: 'duration',
              label: 'Average publishing time',
              value: formatDuration(stats.averageDurationSec),
              hint: 'First attempt to result, published deliveries',
            },
            {
              key: 'retries',
              label: 'Retries',
              value: formatNumber(stats.retries.extraAttempts),
              hint:
                retried === 1
                  ? '1 delivery needed more than one attempt'
                  : `${formatNumber(retried)} deliveries needed more than one attempt`,
            },
          ]}
        />
      </div>
    </div>
  );
}

function PublishingSkeleton() {
  return (
    <div className="space-y-5">
      <p role="status" className="sr-only">
        Loading analytics…
      </p>
      <div aria-hidden="true" className="space-y-5">
        <Skeleton className="h-4 w-36" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

/**
 * SocialHub's own publishing records: the one part of the page that is always real. One mode
 * at a time (live first, as the API sends them); simulated figures are labelled and never added
 * to live ones.
 */
export function PublishingSection({ overview, trends, loading, trendsLoading, fetching }) {
  const [mode, setMode] = useState(null);
  const modes = overview?.publishing ?? [];
  const stats = modes.find((m) => m.mode === mode) ?? modes[0];
  return (
    <SectionCard label="Publishing performance" fetching={fetching}>
      <CardHeader
        icon={Send}
        tone={GRADIENT_TONES.violet}
        title="Publishing performance"
        description="From SocialHub's own records: every post sent through SocialHub in this range, per account."
      />
      <CardBody>
        {loading ? (
          <PublishingSkeleton />
        ) : !stats ? (
          <EmptyState
            art={PostsArt}
            tone="violet"
            title="Nothing was published in this range"
            description="Posts sent from the composer or the Posts page show up here."
            className="py-8"
          />
        ) : (
          <PublishingMode
            key={stats.mode}
            stats={stats}
            activity={trends?.publishing?.find((a) => a.mode === stats.mode)}
            trendsLoading={trendsLoading}
            modeSwitch={
              modes.length > 1 && (
                <SegmentedControl
                  className="ml-auto"
                  size="sm"
                  label="Publishing mode"
                  value={stats.mode}
                  onChange={setMode}
                  options={modes.map((m) => [m.mode, m.simulated ? 'Simulated' : 'Live'])}
                />
              )
            }
          />
        )}
      </CardBody>
    </SectionCard>
  );
}
