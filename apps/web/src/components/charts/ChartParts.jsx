import { cn } from '../../lib/utils.js';
import { seriesRole } from './palette.js';

/** Horizontal grid lines with their value on the left. `y` maps a value to a pixel. */
export function YGrid({ ticks, y, left, right, format }) {
  return ticks.map((tick) => (
    <g key={tick} transform={`translate(0, ${y(tick)})`}>
      <line
        x1={left}
        x2={right}
        className={
          tick === 0
            ? 'stroke-slate-300 dark:stroke-white/20'
            : 'stroke-slate-200/80 dark:stroke-white/[0.07]'
        }
      />
      <text
        x={left - 8}
        dy="0.32em"
        textAnchor="end"
        className="fill-slate-500 text-[11px] tabular-nums dark:fill-slate-400"
      >
        {format(tick)}
      </text>
    </g>
  ));
}

/** Labels under the plot at the given x positions; the first and last align to the edges. */
export function XLabels({ items, y, first, last }) {
  return items.map(({ key, x, text, index }) => (
    <text
      key={key}
      x={x}
      y={y}
      textAnchor={index === first ? 'start' : index === last ? 'end' : 'middle'}
      className="fill-slate-500 text-[11px] dark:fill-slate-400"
    >
      {text}
    </text>
  ));
}

/**
 * The hover card, placed beside the hovered x (never on top of it, where the highest marks
 * are). `rows` are `{ key, label, value, role }`; a row without a role has no colour key.
 * `mark` shapes the key like the chart's marks: 'bar' (a square) or 'line'.
 */
export function ChartTooltip({ x, width, title, rows, mark = 'bar' }) {
  const style = x < width / 2 ? { left: x + 12 } : { right: width - x + 12 };
  return (
    <div
      role="presentation"
      style={style}
      className="pointer-events-none absolute top-2 z-10 min-w-40 animate-fade-in rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift dark:border-white/10 dark:bg-slate-800"
    >
      <p className="mb-1 font-medium text-slate-900 dark:text-white">{title}</p>
      {rows.map((row) => (
        <p key={row.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            {row.role && (
              <span
                aria-hidden="true"
                className={cn(
                  mark === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-sm',
                  seriesRole(row.role).swatch,
                )}
              />
            )}
            {row.label}
          </span>
          <span className="font-semibold text-slate-900 tabular-nums dark:text-white">
            {row.value}
          </span>
        </p>
      ))}
    </div>
  );
}
