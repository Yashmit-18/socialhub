import { ANALYTICS_METRICS, ANALYTICS_SOURCES } from '@socialhub/shared';
import { TrendingUp } from 'lucide-react';
import { useId, useState } from 'react';
import { AreaChart } from '../../components/charts/AreaChart.jsx';
import { ChartFrame } from '../../components/charts/ChartFrame.jsx';
import { seriesRole } from '../../components/charts/palette.js';
import { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, Skeleton } from '../../components/ui/Feedback.jsx';
import { InsightsArt } from '../../components/ui/illustrations.jsx';
import { GRADIENT_TONES } from '../../components/ui/tones.js';
import { cn } from '../../lib/utils.js';
import { SimulatedBadge } from '../publishing/PublishingBadges.jsx';
import {
  UNAVAILABLE,
  coverageText,
  formatDay,
  formatNumber,
  formatSigned,
  isNumber,
  metricLabel,
} from './format.js';
import { missingInsightsSentence } from './labels.js';
import { DayTable, SectionCard } from './parts.jsx';

const TREND_METRICS = ['reach', 'views', 'engagement', 'followers'];
const LONG_DAY = { weekday: 'short', day: 'numeric', month: 'short' };

function tileHint(key, metric) {
  if (!isNumber(metric?.value)) return coverageText(metric);
  if (key === 'reach') {
    return `${ANALYTICS_METRICS.reach.rangeLabel}. ${coverageText(metric) ?? ''}`.trim();
  }
  if (key === 'followers') return `Latest reported. ${coverageText(metric) ?? ''}`.trim();
  return coverageText(metric);
}

/**
 * A metric's figure that is also the switch for the chart below. The button covers the tile
 * and is named by the label alone ("Reach"); the figure and its coverage describe it. The bar
 * under a selected tile has the colour of the line it draws.
 */
function MetricTile({ label, value, hint, selected, role, onSelect }) {
  const id = useId();
  const unavailable = value === UNAVAILABLE;
  return (
    <div
      className={cn(
        'relative min-w-0 rounded-xl border px-4 py-3.5 transition-colors duration-150',
        selected
          ? 'border-brand-300 bg-brand-50/60 dark:border-brand-400/40 dark:bg-brand-500/10'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]',
      )}
    >
      <p
        id={`${id}-label`}
        className="text-[13px] leading-5 font-medium text-slate-600 dark:text-slate-400"
      >
        {label}
      </p>
      <p
        id={`${id}-value`}
        className={cn(
          'mt-1 leading-8 tracking-tight break-words tabular-nums',
          unavailable
            ? 'text-base font-medium text-slate-500 dark:text-slate-400'
            : 'text-2xl font-semibold text-slate-900 dark:text-white',
        )}
      >
        {value}
      </p>
      {hint && (
        <p
          id={`${id}-hint`}
          className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400"
        >
          {hint}
        </p>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-4 bottom-0 h-0.5 rounded-full transition-opacity duration-150',
          seriesRole(role).swatch,
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <button
        type="button"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-value ${id}-hint` : `${id}-value`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 cursor-pointer rounded-xl"
      />
    </div>
  );
}

/** Follower growth has no chart of its own, so it is a plain figure in a quiet well. */
function GrowthTile({ metric }) {
  const value = formatSigned(metric?.value);
  const hint = coverageText(metric);
  return (
    <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-xl bg-slate-50 px-4 py-3.5 ring-1 ring-slate-200/70 ring-inset lg:col-span-1 lg:block dark:bg-white/[0.03] dark:ring-white/[0.08]">
      <p className="text-[13px] leading-5 font-medium text-slate-600 dark:text-slate-400">
        {metricLabel('followerGrowth')}
      </p>
      <p
        className={cn(
          'leading-8 tracking-tight tabular-nums lg:mt-1',
          value === UNAVAILABLE
            ? 'text-base font-medium text-slate-500 dark:text-slate-400'
            : 'text-2xl font-semibold text-slate-900 dark:text-white',
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="col-span-2 mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400">
          {hint}
        </p>
      )}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton
            key={i}
            className={cn('h-[100px] rounded-xl', i === 4 && 'col-span-2 lg:col-span-1')}
          />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/**
 * Reach, views, engagement and followers, from one source at a time (Meta, or demo data the
 * person chose). Without any insight for the range, one panel says why instead of a row of
 * "Unavailable" tiles.
 */
export function InsightsSection({ overview, trends, loading, source, fetching }) {
  const [metric, setMetric] = useState('reach');
  const [table, setTable] = useState(false);
  const insights = overview?.insights;
  const simulated = source === ANALYTICS_SOURCES.SIMULATED;
  const role = simulated ? 'simulated' : 'real';
  const series = trends?.insights?.series ?? [];
  const points = series.map((p) => ({
    day: p.day,
    value: p.metrics?.[metric] ?? null,
    accountsReporting: p.accountsReporting,
  }));
  const reported = points.filter((p) => isNumber(p.value)).length;
  const label = metricLabel(metric);

  let body;
  if (loading) {
    body = <InsightsSkeleton />;
  } else if (insights && !insights.hasData) {
    body = (
      <EmptyState
        layout="inline"
        art={InsightsArt}
        tone="neutral"
        title="No insights for this range"
        description={missingInsightsSentence({
          demoView: simulated,
          serverSource: overview?.analytics?.source,
        })}
      />
    );
  } else {
    body = (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div
            role="group"
            aria-label="Metric"
            className="col-span-2 grid grid-cols-2 gap-3 lg:col-span-4 lg:grid-cols-4"
          >
            {TREND_METRICS.map((key) => {
              const m = insights?.metrics?.[key];
              return (
                <MetricTile
                  key={key}
                  label={metricLabel(key)}
                  value={formatNumber(m?.value ?? null, { short: true })}
                  hint={tileHint(key, m)}
                  selected={metric === key}
                  role={role}
                  onSelect={() => setMetric(key)}
                />
              );
            })}
          </div>
          <GrowthTile metric={insights?.metrics?.followerGrowth} />
        </div>

        <ChartFrame
          title={`${label} per day`}
          note={reported > 0 ? `${reported} of ${points.length} days reported.` : undefined}
          table={table}
          onToggleTable={() => setTable((v) => !v)}
          footnote={
            reported > 0 && metric === 'reach'
              ? 'Each day counts the people reached that day; adding days counts a person once per day.'
              : undefined
          }
        >
          {reported === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:bg-white/[0.03] dark:text-slate-400">
              {label} was not reported for any day in this range, so there is nothing to draw.
            </p>
          ) : table ? (
            <DayTable
              caption={`${label} per day`}
              columns={['Day', label, 'Accounts reporting']}
              rows={series.map((p) => ({
                key: p.day,
                cells: [
                  formatDay(p.day, LONG_DAY),
                  isNumber(p.metrics?.[metric]) ? (
                    formatNumber(p.metrics[metric])
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {UNAVAILABLE}
                    </span>
                  ),
                  formatNumber(p.accountsReporting),
                ],
              }))}
            />
          ) : (
            <AreaChart
              points={points}
              role={role}
              integer
              height={264}
              label={`${label}: ${reported} of ${points.length} days reported`}
              seriesLabel={label}
              tooltipRows={(point) => [
                {
                  key: 'accounts',
                  label: 'Accounts reporting',
                  value: formatNumber(point.accountsReporting),
                },
              ]}
            />
          )}
        </ChartFrame>
      </div>
    );
  }

  return (
    <SectionCard label="Audience and engagement" fetching={fetching}>
      <CardHeader
        icon={TrendingUp}
        tone={GRADIENT_TONES.teal}
        title="Audience and engagement"
        description={simulated ? 'Demo data, made up for testing.' : 'Insights read from Meta.'}
        action={simulated ? <SimulatedBadge>DEMO</SimulatedBadge> : null}
      />
      <CardBody>{body}</CardBody>
    </SectionCard>
  );
}
