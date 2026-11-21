/**
 * Small building blocks for account organisation: label chips, the colour swatch and the
 * personal star toggle. Labels and stars are SocialHub data only; nothing here talks to Meta.
 */
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useToggleStar } from '../../hooks/useAccountActions.js';
import { labelColorClasses } from '../../lib/accountOrganization.js';
import { cn } from '../../lib/utils.js';

/** Colour swatch of a label. */
export function LabelDot({ color, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        labelColorClasses(color).dot,
        className,
      )}
    />
  );
}

/** One label as a chip. With `onClick` it is a button (for example: filter by this label). */
export function LabelChip({ label, onClick, size = 'sm', className, title }) {
  const classes = cn(
    'inline-flex max-w-[10rem] items-center gap-1 rounded-full font-medium ring-1 ring-inset',
    size === 'xs' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]',
    labelColorClasses(label.color).chip,
    onClick &&
      'transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-brand-500',
    className,
  );
  const content = (
    <>
      <LabelDot color={label.color} className={size === 'xs' ? 'h-1.5 w-1.5' : undefined} />
      <span className="truncate">{label.name}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={classes} title={title ?? label.name}>
      {content}
    </button>
  ) : (
    <span className={classes} title={title ?? label.name}>
      {content}
    </span>
  );
}

/** An account's labels, showing at most `max` and a "+n" for the rest. */
export function LabelChips({ labels, max = 3, size = 'xs', onLabelClick, className }) {
  if (!labels?.length) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <LabelChip
          key={label.id}
          label={label}
          size={size}
          onClick={onLabelClick ? () => onLabelClick(label) : undefined}
          title={onLabelClick ? `Show accounts labelled ${label.name}` : undefined}
        />
      ))}
      {hidden.length > 0 && (
        <span
          className="text-[10px] font-medium text-muted"
          title={hidden.map((label) => label.name).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}

/**
 * Personal star toggle for one account. Stars are private: only the signed-in person sees
 * them. Rows of the all-workspaces view carry their own workspace, which the request uses.
 */
export function StarButton({ account, size = 'sm', className }) {
  const { workspace } = useWorkspace();
  const toggle = useToggleStar(workspace.id);
  const starred = account.starred;
  const label = starred ? `Unstar ${account.name}` : `Star ${account.name}`;
  return (
    <button
      type="button"
      aria-pressed={Boolean(starred)}
      aria-label={label}
      title={starred ? 'Starred — click to unstar' : 'Star this account to find it quickly'}
      disabled={toggle.isPending}
      onClick={() =>
        toggle.mutate(
          {
            accountId: account.id,
            starred: !starred,
            workspaceId: account.workspace?.id ?? workspace.id,
          },
          {
            onError: (error) =>
              toast.error(error?.message ?? 'The star could not be saved. Please try again.'),
          },
        )
      }
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition disabled:opacity-60',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        starred
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-slate-300 hover:text-amber-500 dark:text-slate-600 dark:hover:text-amber-400',
        className,
      )}
    >
      <Star
        className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'}
        fill={starred ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
    </button>
  );
}
