import { useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { formatDay, formatNumber, isNumber } from './format.js';

/**
 * Small SVG charts for the Analytics screen (dataviz method: thin marks, one axis, recessive
 * grid, hover tooltip, table view). They draw only the values they are given: a day without a
 * value is a gap in the line, never a 0.
 *
 * Series colours (validated categorical slots 1–2, light and dark):
 *   --series-1 #2a78d6 / #3987e5, --series-2 #eb6834 / #d95926
 */
export const SERIES_COLORS =
  '[--series-1:#2a78d6] [--series-2:#eb6834] dark:[--series-1:#3987e5] dark:[--series-2:#d95926]';

const HEIGHT = 220;
const M = { top: 12, right: 12, bottom: 26, left: 48 };

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () =>
      setWidth(Math.max(240, Math.round(node.getBoundingClientRect().width) || 640));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A round upper bound and 4 ticks from 0. */
function niceScale(max) {
  if (!isNumber(max) || max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}

function xLabels(days) {
  if (days.length <= 1) return days.map((day, i) => ({ day, i }));
  const mid = Math.floor((days.length - 1) / 2);
  return [...new Set([0, mid, days.length - 1])].map((i) => ({ day: days[i], i }));
}

function Grid({ ticks, y, innerWidth, format }) {
  return ticks.map((tick) => (
    <g key={tick} transform={`translate(0, ${y(tick)})`}>
      <line
        x1={M.left}
        x2={M.left + innerWidth}
        className="stroke-slate-200 dark:stroke-white/10"
      />
      <text
        x={M.left - 8}
        dy="0.32em"
        textAnchor="end"
        className="fill-slate-500 text-[11px] dark:fill-slate-400"
      >
        {format(tick)}
      </text>
    </g>
  ));
}

function Tooltip({ left, children }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-slate-900"
      style={{ left }}
    >
      {children}
    </div>
  );
}

/** Data table behind a chart, for screen readers and anyone who prefers numbers. */
export function ChartTable({ caption, columns, rows }) {
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-slate-50 text-xs text-muted dark:bg-slate-900">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={columns[i]} className="px-3 py-1.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One metric over time. `points`: [{ day, value | null }]. Days without a value break the
 * line (gap), and a lone value is drawn as a dot so it is not invisible.
 */
export function LineChart({
  points,
  label,
  formatValue = (v) => formatNumber(v, { short: true }),
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const titleId = useId();
  const innerWidth = width - M.left - M.right;
  const innerHeight = HEIGHT - M.top - M.bottom;
  const values = points.map((p) => p.value).filter(isNumber);
  const { top, ticks } = niceScale(Math.max(0, ...values));
  const x = (i) =>
    M.left + (points.length <= 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth);
  const y = (v) => M.top + innerHeight - (v / top) * innerHeight;

  // Continuous runs of reported days.
  const runs = [];
  let run = [];
  points.forEach((p, i) => {
    if (isNumber(p.value)) run.push({ i, v: p.value });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i =
      points.length <= 1 ? 0 : Math.round(((px - M.left) / innerWidth) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hovered = hover === null ? null : points[hover];
  return (
    <div ref={ref} className={cn('relative', SERIES_COLORS)}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-labelledby={titleId}
        className="block max-w-full touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={titleId}>{`${label}: ${values.length} of ${points.length} days reported`}</title>
        <Grid ticks={ticks} y={y} innerWidth={innerWidth} format={formatValue} />
        {xLabels(points.map((p) => p.day)).map(({ day, i }) => (
          <text
            key={day}
            x={x(i)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="fill-slate-500 text-[11px] dark:fill-slate-400"
          >
            {formatDay(day)}
          </text>
        ))}
        {runs.map((segment) =>
          segment.length === 1 ? (
            <circle
              key={segment[0].i}
              cx={x(segment[0].i)}
              cy={y(segment[0].v)}
              r={4}
              fill="var(--series-1)"
            />
          ) : (
            <polyline
              key={segment[0].i}
              points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {hovered && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={M.top}
              y2={M.top + innerHeight}
              className="stroke-slate-400 dark:stroke-slate-500"
              strokeDasharray="3 3"
            />
            {isNumber(hovered.value) && (
              <circle
                cx={x(hover)}
                cy={y(hovered.value)}
                r={5}
                fill="var(--series-1)"
                className="stroke-white dark:stroke-slate-900"
                strokeWidth={2}
              />
            )}
          </g>
        )}
      </svg>
      {hovered && (
        <Tooltip left={Math.min(Math.max(x(hover), 80), width - 80)}>
          <p className="font-medium text-slate-900 dark:text-white">
            {formatDay(hovered.day, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
          <p className="text-muted">
            {label}:{' '}
            <span className="font-semibold text-slate-900 tabular-nums dark:text-white">
              {isNumber(hovered.value) ? formatNumber(hovered.value) : 'Not reported'}
            </span>
          </p>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Stacked daily bars of two series (bottom first): [{ key, label, color: 'var(--series-n)' }].
 * Days are real SocialHub records, so an empty day is a true 0.
 */
export function StackedBarChart({ points, series, label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const titleId = useId();
  const innerWidth = width - M.left - M.right;
  const innerHeight = HEIGHT - M.top - M.bottom;
  const totals = points.map((p) => series.reduce((sum, s) => sum + (p[s.key] ?? 0), 0));
  const { top, ticks } = niceScale(Math.max(0, ...totals));
  const slot = innerWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v) => M.top + innerHeight - (v / top) * innerHeight;
  const xCenter = (i) => M.left + slot * i + slot / 2;
  const radius = Math.min(4, barWidth / 2);

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.floor((event.clientX - rect.left - M.left) / slot);
    setHover(i >= 0 && i < points.length ? i : null);
  };

  return (
    <div ref={ref} className={cn('relative', SERIES_COLORS)}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-labelledby={titleId}
        className="block max-w-full touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={titleId}>{label}</title>
        <Grid
          ticks={ticks}
          y={y}
          innerWidth={innerWidth}
          format={(v) => formatNumber(v, { short: true })}
        />
        {xLabels(points.map((p) => p.day)).map(({ day, i }) => (
          <text
            key={day}
            x={xCenter(i)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="fill-slate-500 text-[11px] dark:fill-slate-400"
          >
            {formatDay(day)}
          </text>
        ))}
        {hover !== null && (
          <rect
            x={M.left + slot * hover}
            y={M.top}
            width={slot}
            height={innerHeight}
            className="fill-slate-100 dark:fill-white/5"
          />
        )}
        {points.map((p, i) => {
          let base = 0;
          const stack = series.filter((s) => (p[s.key] ?? 0) > 0);
          return stack.map((s, k) => {
            const value = p[s.key];
            const y0 = y(base);
            const y1 = y(base + value);
            base += value;
            const isTop = k === stack.length - 1;
            // 2px surface gap between stacked segments.
            const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
            const yTop = y1;
            const x0 = xCenter(i) - barWidth / 2;
            const path = isTop
              ? `M${x0},${yTop + h} V${yTop + radius} Q${x0},${yTop} ${x0 + radius},${yTop} H${x0 + barWidth - radius} Q${x0 + barWidth},${yTop} ${x0 + barWidth},${yTop + radius} V${yTop + h} Z`
              : `M${x0},${yTop + h} V${yTop} H${x0 + barWidth} V${yTop + h} Z`;
            return <path key={`${p.day}-${s.key}`} d={path} fill={s.color} />;
          });
        })}
      </svg>
      {hover !== null && points[hover] && (
        <Tooltip left={Math.min(Math.max(xCenter(hover), 80), width - 80)}>
          <p className="font-medium text-slate-900 dark:text-white">
            {formatDay(points[hover].day, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5 text-muted">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              {s.label}:{' '}
              <span className="font-semibold text-slate-900 tabular-nums dark:text-white">
                {formatNumber(points[hover][s.key] ?? 0)}
              </span>
            </p>
          ))}
        </Tooltip>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
