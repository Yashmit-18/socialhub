import { cn } from '../../lib/utils.js';
import { Skeleton } from './Feedback.jsx';

const HIDE = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' };

/*
 * The first and last cell of every row get the card's side padding, so cells only set their
 * own right padding. A sticky first column (wide tables on a phone) needs opaque backgrounds.
 */
const EDGES =
  '[&_tr>*:first-child]:pl-5 sm:[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-5 sm:[&_tr>*:last-child]:pr-6';
const STICKY =
  '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] [&_tbody_tr>*:first-child]:bg-white [&_thead_tr>*:first-child]:bg-[color-mix(in_oklab,var(--color-slate-50)_60%,white)] dark:[&_tbody_tr>*:first-child]:bg-slate-900 dark:[&_thead_tr>*:first-child]:bg-[color-mix(in_oklab,white_2%,var(--color-slate-900))]';

/**
 * A data table inside a card, edge to edge: it scrolls sideways inside its own box, so the page
 * never does. `caption` names it for screen readers (visually hidden). `fetching` dims the rows
 * while a newer page loads (never a skeleton flash). `stickyFirst` pins the first column when
 * the table scrolls. `minWidth` is a class such as 'min-w-[680px]'.
 */
export function Table({
  caption,
  fetching = false,
  stickyFirst = false,
  minWidth,
  className,
  children,
}) {
  return (
    <div
      className={cn(
        'overflow-x-auto transition-opacity duration-200',
        fetching && 'opacity-60',
        className,
      )}
      aria-busy={fetching || undefined}
    >
      <table className={cn('w-full text-left text-sm', EDGES, stickyFirst && STICKY, minWidth)}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

/** The header row: a faint band with small uppercase labels. Children are `Th` cells. */
export function THead({ children }) {
  return (
    <thead>
      <tr className="border-y border-slate-100 bg-slate-50/60 text-[11px] tracking-wider text-slate-500 uppercase dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
        {children}
      </tr>
    </thead>
  );
}

/** A column header. `hide` ('sm' | 'md' | 'lg' | 'xl') hides it below that width; give the cells the same. */
export function Th({ align = 'left', hide, className, children, ...rest }) {
  return (
    <th
      scope="col"
      className={cn(
        'py-2.5 pr-4 font-semibold whitespace-nowrap',
        ALIGN[align],
        align === 'right' && 'pr-8',
        HIDE[hide],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-slate-100 dark:divide-white/5">{children}</tbody>;
}

/** A body row. `interactive` for rows that open something (hover tint); `selected` tints it. */
export function Tr({ interactive = false, selected = false, className, children, ...rest }) {
  return (
    <tr
      className={cn(
        'align-middle',
        interactive && 'transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.02]',
        selected && 'bg-brand-50/50 dark:bg-brand-500/[0.06]',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

/**
 * A body cell. `numeric` right-aligns it with tabular figures; `hide` as on `Th`; `header`
 * renders a row header (`<th scope="row">`) for the cell that names the row.
 */
export function Td({ align, numeric = false, hide, header = false, className, children, ...rest }) {
  const Tag = header ? 'th' : 'td';
  return (
    <Tag
      scope={header ? 'row' : undefined}
      className={cn(
        'py-3 pr-4',
        header && 'font-normal',
        numeric && 'text-right tabular-nums',
        (numeric || align === 'right') && 'pr-8',
        ALIGN[align],
        HIDE[hide],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** First-load rows in the table's shape: `columns` cells per row, the first one wider. */
export function TableSkeleton({ rows = 4, columns = 4, label }) {
  return (
    <div>
      {label && (
        <p role="status" className="sr-only">
          {label}
        </p>
      )}
      <div
        aria-hidden="true"
        className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5"
      >
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
            <div className="flex min-w-0 flex-[2] items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className={cn('h-3.5', row % 2 ? 'w-2/5' : 'w-1/2')} />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            {Array.from({ length: Math.max(0, columns - 1) }, (_, col) => (
              <Skeleton
                key={col}
                className={cn(
                  'h-3.5 flex-1',
                  col > 0 && 'hidden sm:block',
                  col > 1 && 'sm:hidden md:block',
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
