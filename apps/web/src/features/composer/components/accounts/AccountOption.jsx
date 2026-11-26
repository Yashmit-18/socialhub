import { Star, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { LabelChips } from '../../../../components/accounts/AccountLabels.jsx';
import { Badge } from '../../../../components/ui/Badge.jsx';
import { cn } from '../../../../lib/utils.js';
import { platformLabel } from '../../constants/platformRules.js';
import { accountBlocker, describeAccount } from '../../model/accounts.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';

/**
 * One selectable destination. The whole row is the checkbox's label; its accessible name is
 * "{name} ({platform})" so a Page and an Instagram account with the same name stay distinct.
 * Accounts with a connection or permission problem stay selectable, with the reason shown.
 */
export function AccountOption({ account, selected = false, onToggle, className }) {
  const id = useId();
  const nameId = `${id}-name`;
  const platformId = `${id}-platform`;
  const detailId = `${id}-detail`;
  const attentionId = `${id}-attention`;
  const blocker = accountBlocker(account);
  const attentionText = blocker ?? account.attention?.[0]?.message ?? null;
  const flagged = Boolean(blocker) || Boolean(account.needsAttention);

  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors duration-150 ring-inset',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
        selected
          ? 'bg-brand-50/70 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-400/25'
          : 'ring-transparent hover:bg-slate-50 dark:hover:bg-white/[0.04]',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle?.(account.id)}
        aria-labelledby={`${nameId} ${platformId}`}
        aria-describedby={flagged ? `${detailId} ${attentionId}` : detailId}
        className="mt-3 h-4 w-4 shrink-0 cursor-pointer checkbox"
      />
      <AccountAvatar account={account} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline">
          <span
            id={nameId}
            className="truncate text-sm font-medium text-slate-900 dark:text-white"
            title={account.name}
          >
            {account.name}
          </span>
          <span id={platformId} className="sr-only">
            ({platformLabel(account.platform)})
          </span>
          {account.starred && (
            <Star
              className="ml-1.5 h-3.5 w-3.5 shrink-0 self-center text-amber-500"
              fill="currentColor"
              aria-label="Starred"
              role="img"
            />
          )}
        </span>
        <span
          id={detailId}
          className="mt-0.5 block text-xs leading-relaxed break-words text-slate-500 dark:text-slate-400"
        >
          {describeAccount(account)}
          {account.linkedPageName && <> · Linked to {account.linkedPageName}</>}
        </span>
        <LabelChips labels={account.labels} max={3} className="mt-1" />
        {flagged && (
          <span id={attentionId} className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="warning">Needs attention</Badge>{' '}
            {attentionText && (
              <span className="inline-flex min-w-0 items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{attentionText}</span>
              </span>
            )}
          </span>
        )}
      </span>
    </label>
  );
}
