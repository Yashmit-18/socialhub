import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useFacebookPages } from './api.js';

/**
 * Chooses which of the workspace's Facebook Pages are members of a group. Shown as toggle
 * chips: a real post to one of the chosen Pages gets a sharing task for this group.
 */
export function PagePicker({ id, value, onChange, disabled = false }) {
  const { pages, isPending } = useFacebookPages();
  const selected = new Set(value);
  const toggle = (pageId) =>
    onChange(selected.has(pageId) ? value.filter((v) => v !== pageId) : [...value, pageId]);

  return (
    <fieldset id={id} className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Your Pages in this group
      </legend>
      {isPending ? (
        <p className="text-xs text-muted">Loading your Pages…</p>
      ) : pages.length === 0 ? (
        <p className="text-xs text-muted">
          No Facebook Pages are connected yet. Connect one on Social accounts first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {pages.map((page) => {
            const on = selected.has(page.id);
            return (
              <button
                key={page.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(page.id)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  on
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-500/15 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200',
                )}
              >
                <Check
                  className={cn('h-3.5 w-3.5', on ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
                {page.name}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">
        When you publish to one of these Pages, this group gets a sharing task automatically.
      </p>
    </fieldset>
  );
}
