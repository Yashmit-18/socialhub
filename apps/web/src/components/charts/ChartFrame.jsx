import { ChartColumn, Table2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/Button.jsx';
import { seriesRole } from './palette.js';

/**
 * The key of a chart with two or more series: `items` are `{ key, label, role }`. A list named
 * "Legend"; each entry is a swatch in the role's colour and the series name in text colour.
 */
export function Legend({ items, className }) {
  return (
    <ul
      aria-label="Legend"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400',
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', seriesRole(item.role).swatch)}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One frame for every chart: the title (a figcaption), an optional short `note` beside it, the
 * `legend` (hidden in the table view), and the "Show table" / "Show chart" switch when
 * `onToggleTable` is given. `table` says which view is showing; the caller renders the chart
 * or its table as `children`. `footnote` sits under it.
 */
export function ChartFrame({
  title,
  note,
  legend,
  table = false,
  onToggleTable,
  footnote,
  className,
  children,
}) {
  return (
    <figure className={cn('min-w-0', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <figcaption className="text-sm font-medium text-slate-900 dark:text-white">
          {title}
        </figcaption>
        {note && <span className="text-xs text-slate-600 dark:text-slate-400">{note}</span>}
        {!table && legend}
        {onToggleTable && (
          <Button variant="ghost" size="sm" className="-mr-2 ml-auto" onClick={onToggleTable}>
            {table ? (
              <ChartColumn className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {table ? 'Show chart' : 'Show table'}
          </Button>
        )}
      </div>
      {children}
      {footnote && (
        <p className="mt-2 text-xs leading-snug text-slate-600 dark:text-slate-400">{footnote}</p>
      )}
    </figure>
  );
}
