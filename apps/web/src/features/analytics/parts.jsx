import { Card } from '../../components/ui/Card.jsx';
import { StatTile } from '../../components/ui/StatTile.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { cn } from '../../lib/utils.js';
import { UNAVAILABLE } from './format.js';

/**
 * One section of the page. While newer figures load for changed filters (`fetching`), the
 * old ones stay in place, dimmed, instead of flashing back to skeletons.
 */
export function SectionCard({ label, fetching = false, className, children }) {
  return (
    <Card
      aria-label={label}
      aria-busy={fetching || undefined}
      className={cn('transition-opacity duration-200', fetching && 'opacity-60', className)}
    >
      {children}
    </Card>
  );
}

/** Headline figures in one hairline band: two across on phones, four from `lg`. */
export function HeadlineBand({ children }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200/80 ring-1 ring-slate-200/80 lg:grid-cols-4 dark:bg-white/[0.08] dark:ring-white/[0.08]">
      {children}
    </div>
  );
}

/**
 * A figure in the band. `value` is already formatted; "Unavailable" is printed in the quiet
 * style, never as 0. No count-up on this page: a figure is either real or unavailable.
 */
export function Figure({ label, value, hint, emphasis }) {
  return (
    <StatTile
      variant="cell"
      className="bg-slate-50 dark:bg-slate-900"
      label={label}
      value={value === UNAVAILABLE ? null : value}
      unknown={UNAVAILABLE}
      hint={hint}
      emphasis={emphasis}
      animate={false}
    />
  );
}

/** Secondary figures as a quiet list: label left, figure right, an optional hint under it. */
export function FactList({ facts, className }) {
  return (
    <dl className={cn('grid content-start gap-x-8', className)}>
      {facts.map((fact) => (
        <div
          key={fact.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-slate-100 py-2.5 last:border-b-0 dark:border-white/[0.06]"
        >
          <dt className="text-sm text-slate-600 dark:text-slate-400">{fact.label}</dt>
          <dd
            className={cn(
              'text-right text-sm tabular-nums',
              fact.value === UNAVAILABLE
                ? 'text-xs text-slate-500 dark:text-slate-400'
                : 'font-semibold text-slate-900 dark:text-white',
            )}
          >
            {fact.value}
          </dd>
          {fact.hint && (
            <dd className="col-span-2 mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
              {fact.hint}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

// The header band stays visible while the rows scroll, so it needs opaque colours.
const STICKY_HEAD =
  'max-h-80 overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[2] [&_thead_tr]:bg-[color-mix(in_oklab,var(--color-slate-50)_60%,white)] dark:[&_thead_tr]:bg-[color-mix(in_oklab,white_2%,var(--color-slate-900))]';

/**
 * The numbers behind a chart, one row per day: for screen readers and anyone who prefers a
 * table. `rows` are `{ key, cells }`; the first cell names the day, the others are numbers.
 */
export function DayTable({ caption, columns, rows }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-white/10">
      <Table caption={caption} className={STICKY_HEAD}>
        <THead>
          {columns.map((column, i) => (
            <Th key={column} align={i === 0 ? 'left' : 'right'}>
              {column}
            </Th>
          ))}
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.key}>
              {row.cells.map((cell, i) =>
                i === 0 ? (
                  <Td key={columns[i]} header className="py-2 whitespace-nowrap">
                    {cell}
                  </Td>
                ) : (
                  <Td key={columns[i]} numeric className="py-2">
                    {cell}
                  </Td>
                ),
              )}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
