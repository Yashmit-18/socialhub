import { X } from 'lucide-react';
import { Button } from '../ui/Button.jsx';

/**
 * Floating bar shown while table rows are selected. `children` are the bulk actions.
 * The count is announced to screen readers as it changes.
 */
export function BulkActionBar({ count, onClear, noun = 'account', children }) {
  if (!count) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-30 mt-4 flex animate-scale-in flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-pop backdrop-blur dark:border-white/10 dark:bg-slate-900/95"
    >
      <p className="text-sm font-medium" aria-live="polite">
        {count} {noun}
        {count === 1 ? '' : 's'} selected
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear selection
        </Button>
      </div>
    </div>
  );
}
