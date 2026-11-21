import { Check, Star } from 'lucide-react';
import { useId } from 'react';
import { LabelDot } from '../../../../components/accounts/AccountLabels.jsx';
import { cn } from '../../../../lib/utils.js';

/**
 * One-click selection by group: the person's starred accounts and each workspace label
 * (client, brand, region…). A chip adds its accounts to the selection; when all of them are
 * already selected it is pressed, and clicking it removes them again. Other selected accounts
 * are never touched. Groups come from model/accounts.js → quickSelectGroups().
 */
export function QuickSelect({ groups, selectedSet, onSelect, onDeselect, className }) {
  const labelId = useId();
  if (!groups?.length) return null;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      <span id={labelId} className="mr-1 text-xs font-medium text-muted">
        Quick select
      </span>
      {groups.map((group) => {
        const all = group.ids.every((id) => selectedSet.has(id));
        const count = group.ids.length;
        return (
          <button
            key={group.key}
            type="button"
            aria-pressed={all}
            title={
              all
                ? `Remove the ${count} ${group.name} account${count === 1 ? '' : 's'} from the selection`
                : `Add the ${count} ${group.name} account${count === 1 ? '' : 's'} to the selection`
            }
            onClick={() => (all ? onDeselect?.(group.ids) : onSelect?.(group.ids))}
            className={cn(
              'inline-flex h-7 max-w-[12rem] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition',
              all
                ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/40 dark:bg-brand-500/10 dark:text-brand-200'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-white/5',
            )}
          >
            {group.key === 'starred' ? (
              <Star
                className="h-3.5 w-3.5 shrink-0 text-amber-500"
                fill="currentColor"
                aria-hidden="true"
              />
            ) : (
              <LabelDot color={group.color} />
            )}
            <span className="truncate">{group.name}</span>
            <span className="tabular-nums text-muted">{count}</span>
            {all && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
