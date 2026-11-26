import { useId, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { ChartTooltip, XLabels, YGrid } from './ChartParts.jsx';
import { seriesRole } from './palette.js';
import { formatChartDay, gutterFor, labelIndexes, niceScale } from './scale.js';
import { useChartWidth } from './useChartWidth.js';

const NUMBER = new Intl.NumberFormat();
const M = { top: 12, right: 16, bottom: 26 };

/** A bar from the baseline up, rounded only at its top. */
function barPath(x, yTop, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${yTop + height} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + width - r} Q${x + width},${yTop} ${x + width},${yTop + r} V${yTop + height} Z`;
}

const rectPath = (x, yTop, width, height) =>
  `M${x},${yTop + height} V${yTop} H${x + width} V${yTop + height} Z`;

/**
 * Bars per day for SocialHub's own counts (an empty day is a true 0 and draws nothing).
 * `points` are `{ day, [series.key]: number }`; `series` are `{ key, label, role }` (roles
 * from palette.js). Side by side by default; `stacked` piles them into one column with a
 * 2 px gap. `label` is the chart's accessible name. Columns rise once on first paint (CSS
 * only, so reduced motion shows them at once); hovering a day shows its figures beside it.
 * Pair it with ChartFrame, a Legend and a table view.
 */
export function BarChart({
  points,
  series,
  label,
  stacked = false,
  height = 240,
  integer = true,
  formatValue = (value) => NUMBER.format(value),
  formatX = formatChartDay,
  className,
}) {
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState(null);
  const titleId = useId();
  const h = width < 480 ? Math.min(height, 208) : height;

  const valueOf = (point, key) => (typeof point[key] === 'number' ? point[key] : 0);
  const totals = points.map((p) =>
    stacked
      ? series.reduce((sum, s) => sum + valueOf(p, s.key), 0)
      : Math.max(0, ...series.map((s) => valueOf(p, s.key))),
  );
  const { top, ticks } = niceScale(Math.max(0, ...totals), { integer });
  const left = gutterFor(ticks.map(formatValue));
  const innerWidth = width - left - M.right;
  const innerHeight = h - M.top - M.bottom;
  const slot = innerWidth / Math.max(1, points.length);
  const y = (v) => M.top + innerHeight - (v / top) * innerHeight;
  const xCenter = (i) => left + slot * i + slot / 2;

  const groupWidth = Math.max(2, Math.min(stacked ? 24 : 30, slot * 0.72));
  const gap = stacked || series.length < 2 ? 0 : Math.min(3, groupWidth * 0.12);
  const barWidth = stacked ? groupWidth : (groupWidth - gap * (series.length - 1)) / series.length;
  const radius = Math.min(4, barWidth / 2);

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.floor((event.clientX - rect.left - left) / slot);
    setHover(i >= 0 && i < points.length ? i : null);
  };

  const labels = labelIndexes(points.length, innerWidth).map((i) => ({
    key: points[i].day ?? i,
    index: i,
    x: xCenter(i),
    text: formatX(points[i].day, false),
  }));

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
        <YGrid ticks={ticks} y={y} left={left} right={left + innerWidth} format={formatValue} />
        <XLabels items={labels} y={h - 6} first={0} last={points.length - 1} />
        {hover !== null && (
          <rect
            x={left + slot * hover}
            y={M.top}
            width={slot}
            height={innerHeight}
            rx={4}
            className="fill-slate-100 dark:fill-white/[0.05]"
          />
        )}
        {points.map((point, i) => {
          const x0 = xCenter(i) - groupWidth / 2;
          const faded = hover !== null && hover !== i;
          let base = 0;
          const drawn = series.filter((s) => valueOf(point, s.key) > 0);
          return (
            <g
              key={point.day ?? i}
              className={cn(
                'origin-bottom animate-column-grow transition-opacity duration-150 [transform-box:fill-box]',
                faded && 'opacity-45',
              )}
              style={{ animationDelay: `${Math.min(i, 30) * 18}ms` }}
            >
              {stacked
                ? drawn.map((s, k) => {
                    const value = valueOf(point, s.key);
                    const y0 = y(base);
                    const y1 = y(base + value);
                    base += value;
                    const isTop = k === drawn.length - 1;
                    // A 2 px surface gap between stacked segments.
                    const segment = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
                    return (
                      <path
                        key={s.key}
                        d={
                          isTop
                            ? barPath(x0, y1, barWidth, segment, radius)
                            : rectPath(x0, y1, barWidth, segment)
                        }
                        className={seriesRole(s.role).fill}
                      />
                    );
                  })
                : series.map((s, k) => {
                    const value = valueOf(point, s.key);
                    if (value <= 0) return null;
                    const yTop = y(value);
                    return (
                      <path
                        key={s.key}
                        d={barPath(
                          x0 + k * (barWidth + gap),
                          yTop,
                          barWidth,
                          Math.max(1, M.top + innerHeight - yTop),
                          radius,
                        )}
                        className={seriesRole(s.role).fill}
                      />
                    );
                  })}
            </g>
          );
        })}
      </svg>
      {hover !== null && points[hover] && (
        <ChartTooltip
          x={xCenter(hover)}
          width={width}
          title={formatX(points[hover].day, true)}
          rows={series.map((s) => ({
            key: s.key,
            label: s.label,
            role: s.role,
            value: formatValue(valueOf(points[hover], s.key)),
          }))}
        />
      )}
    </div>
  );
}
