/**
 * Overview cards for account organisation: the person's starred accounts (quick access) and
 * the workspace labels with how many accounts carry each (one click filters the table).
 */
import { AlertTriangle, ArrowRight, Settings2, Star, Tag } from 'lucide-react';
import { Link } from 'react-router';
import { AccountPicture } from './AccountBadges.jsx';
import { LabelChip, LabelChips, StarButton } from './AccountLabels.jsx';
import { Button } from '../ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../ui/Card.jsx';
import { Skeleton } from '../ui/Feedback.jsx';
import { PLATFORM_LABELS } from '../../lib/meta.js';

const STARRED_SHOWN = 6;

/** Up to six starred accounts with links, or a hint on how to star one. */
export function StarredAccountsCard({ list, hrefFor, onShowAll }) {
  const data = list.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  return (
    <Card>
      <CardHeader
        icon={Star}
        title="Your starred accounts"
        description="Only you see your stars. Star an account with ☆ next to its name."
        action={
          total > STARRED_SHOWN ? (
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              Show all {total} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null
        }
      />
      <CardBody className="pt-4">
        {list.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-40" />
          </div>
        ) : list.error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Your starred accounts could not be loaded.{' '}
            <button type="button" className="font-medium underline" onClick={() => list.refetch()}>
              Try again
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            No starred accounts yet. Star the Pages and Instagram accounts you work with most to
            find them here and filter to them in any account table.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {items.slice(0, STARRED_SHOWN).map((account) => {
              const href = hrefFor(account);
              return (
                <li key={account.id} className="flex min-w-0 items-center gap-3 py-2.5">
                  <AccountPicture account={account} size="sm" />
                  <div className="min-w-0 flex-1">
                    {href ? (
                      <Link
                        to={href}
                        className="block truncate text-sm font-semibold hover:text-brand-600 dark:hover:text-brand-300"
                      >
                        {account.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-semibold">{account.name}</span>
                    )}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-xs text-muted">
                        {PLATFORM_LABELS[account.platform]}
                      </span>
                      {account.health?.needsAttention && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Needs attention
                        </span>
                      )}
                      <LabelChips labels={account.labels} max={2} />
                    </span>
                  </div>
                  <StarButton account={account} />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Workspace labels with account counts; a click shows exactly that label's accounts. */
export function LabelsCard({ labels, canManage, onShow, onManage }) {
  const items = labels.data?.items ?? [];
  return (
    <Card>
      <CardHeader
        icon={Tag}
        title="Labels"
        description="Accounts grouped by client, brand, region or anything else your team uses."
        action={
          canManage ? (
            <Button variant="secondary" size="sm" onClick={onManage}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Manage
            </Button>
          ) : null
        }
      />
      <CardBody className="pt-4">
        {labels.isPending ? (
          <div className="flex gap-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-28" />
          </div>
        ) : labels.error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            The labels could not be loaded.{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => labels.refetch()}
            >
              Try again
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            {canManage
              ? 'No labels yet. Create labels such as a client or brand name, then select accounts in the All accounts tab and choose “Labels” to apply them.'
              : 'No labels yet. Workspace owners and admins can create them.'}
          </p>
        ) : (
          <ul aria-label="Labels" className="flex flex-wrap gap-2">
            {items.map((label) => (
              <li key={label.id}>
                <span className="inline-flex items-center gap-1.5">
                  <LabelChip
                    label={label}
                    onClick={() => onShow(label)}
                    title={`Show the accounts labelled ${label.name}`}
                  />
                  <span className="text-xs tabular-nums text-muted">{label.accountCount ?? 0}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
