import { useId, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { ChartTooltip, XLabels, YGrid } from './ChartParts.jsx';
import { seriesRole } from './palette.js';
import { formatChartDay, gutterFor, isChartNumber, labelIndexes, niceScale } from './scale.js';
import { useChartWidth } from './useChartWidth.js';

const NUMBER = new Intl.NumberFormat();
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const M = { top: 14, right: 16, bottom: 26 };

/**
 * One metric over time as a line with a soft wash under it. `points` are `{ day, value }`; a
 * day whose value is null is a gap (the line and the wash break there), never a 0, and a lone
 * reported day is a dot. The last reported day gets an end dot. `label` is the accessible name
 * (say how many days were reported); `seriesLabel` names the value in the tooltip; `role`
 * picks the colour (palette.js); `tooltipRows(point)` adds rows such as accounts reporting.
 */
export function AreaChart({
  points,
  label,
  seriesLabel,
  role = 'real',
  height = 240,
  integer = false,
  formatValue = (value) => NUMBER.format(value),
  formatTick = (value) => COMPACT.format(value),
  formatX = formatChartDay,
  tooltipRows,
  className,
}) {
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState(null);
  const titleId = useId();
  const colour = seriesRole(role);
  const h = width < 480 ? Math.min(height, 208) : height;

  const values = points.map((p) => p.value).filter(isChartNumber);
  const { top, ticks } = niceScale(Math.max(0, ...values), { integer });
  const left = gutterFor(ticks.map(formatTick));
  const innerWidth = width - left - M.right;
  const innerHeight = h - M.top - M.bottom;
  const baseline = M.top + innerHeight;
  const x = (i) =>
    left + (points.length <= 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth);
  const y = (v) => baseline - (v / top) * innerHeight;

  // Continuous runs of reported days.
  const runs = [];
  let run = [];
  points.forEach((p, i) => {
    if (isChartNumber(p.value)) run.push({ i, v: p.value });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const last = runs.at(-1)?.at(-1);

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = points.length <= 1 ? 0 : Math.round(((px - left) / innerWidth) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const labels = labelIndexes(points.length, innerWidth).map((i) => ({
    key: points[i].day ?? i,
    index: i,
    x: x(i),
    text: formatX(points[i].day, false),
  }));
  const hovered = hover === null ? null : points[hover];

  return (
    <div ref={ref} className={cn('relative', className)}>
      <svg
        width={width}
        height={h}
        role="img"
        aria-labelledby={titleId}
        className="block max-w-full touch-pan-y select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={titleId}>{label}</title>
        <YGrid ticks={ticks} y={y} left={left} right={left + innerWidth} format={formatTick} />
        <XLabels items={labels} y={h - 6} first={0} last={points.length - 1} />
        <g className="animate-fade-in">
          {runs.map((segment) =>
            segment.length === 1 ? (
              <circle
                key={segment[0].i}
                cx={x(segment[0].i)}
                cy={y(segment[0].v)}
                r={4}
                className={colour.fill}
              />
            ) : (
              <g key={segment[0].i}>
                <polygon
                  points={[
                    `${x(segment[0].i)},${baseline}`,
                    ...segment.map((p) => `${x(p.i)},${y(p.v)}`),
                    `${x(segment.at(-1).i)},${baseline}`,
                  ].join(' ')}
                  className={colour.wash}
                />
                <polyline
                  points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={colour.stroke}
                />
              </g>
            ),
          )}
          {last && (
            <circle
              cx={x(last.i)}
              cy={y(last.v)}
              r={4}
              strokeWidth={2}
              className={cn(colour.fill, 'stroke-white dark:stroke-slate-900')}
            />
          )}
        </g>
        {hovered && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={M.top}
              y2={baseline}
              className="stroke-slate-300 dark:stroke-white/20"
            />
            {isChartNumber(hovered.value) && (
              <circle
                cx={x(hover)}
                cy={y(hovered.value)}
                r={5}
                strokeWidth={2}
                className={cn(colour.fill, 'stroke-white dark:stroke-slate-900')}
              />
            )}
          </g>
        )}
      </svg>
      {hovered && (
        <ChartTooltip
          x={x(hover)}
          width={width}
          mark="line"
          title={formatX(hovered.day, true)}
          rows={[
            {
              key: 'value',
              label: seriesLabel ?? label,
              role,
              value: isChartNumber(hovered.value) ? formatValue(hovered.value) : 'Not reported',
            },
            ...(tooltipRows?.(hovered) ?? []),
          ]}
        />
      )}
    </div>
  );
}
