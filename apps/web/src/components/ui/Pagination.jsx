import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './Button.jsx';

/** Previous / next pagination with a "Showing x–y of n" summary. Hidden when there is nothing to page. */
export function Pagination({ page, pages, total, limit, onPageChange, noun = 'items', className }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-muted sm:px-6 dark:border-white/5',
        className,
      )}
    >
      <p>
        Showing <span className="font-medium text-slate-700 dark:text-slate-200">{from}</span>–
        <span className="font-medium text-slate-700 dark:text-slate-200">{to}</span> of{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span> {noun}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
          </Button>
          <span aria-live="polite">
            Page {page} of {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
