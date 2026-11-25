import { Users } from 'lucide-react';
import { exactFollowers, formatFollowers, missingFollowersNote } from '../../lib/followers.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';
import { AnimatedNumber } from '../ui/AnimatedNumber.jsx';
import { Card } from '../ui/Card.jsx';
import { Skeleton } from '../ui/Feedback.jsx';

const NUMBER = new Intl.NumberFormat();

const PLATFORMS = [
  {
    key: 'facebook',
    label: 'Facebook Pages',
    icon: FacebookIcon,
    countKey: 'facebookPages',
    unit: ['Page', 'Pages'],
    tint: 'text-blue-600 dark:text-blue-400',
    bar: 'bg-[#1877f2]',
  },
  {
    key: 'instagram',
    label: 'Instagram accounts',
    icon: InstagramIcon,
    countKey: 'instagramAccounts',
    unit: ['account', 'accounts'],
    tint: 'text-fuchsia-600 dark:text-fuchsia-400',
    bar: 'bg-gradient-to-r from-[#feda75] via-[#d62976] to-[#4f5bd5]',
  },
];

const plural = (n, [one, many]) => `${NUMBER.format(n)} ${n === 1 ? one : many}`;

/**
 * Which accounts a platform's figure covers: "Across 6 Pages", or "4 of 6 Pages counted"
 * when Meta has not returned a count for some of them. Null without account counts.
 */
function coverage(accounts, followers, { countKey, key, unit }) {
  const n = accounts?.[countKey];
  if (typeof n !== 'number') return null;
  if (n === 0) return `No ${unit[1]} yet`;
  const missing = followers?.[`${key}Missing`] ?? 0;
  if (missing > 0 && missing <= n)
    return `${NUMBER.format(n - missing)} of ${plural(n, unit)} counted`;
  return `Across ${plural(n, unit)}`;
}

/**
 * Combined followers of every Facebook Page and Instagram account the viewer can see, from the
 * summary's `followers` object, with a Facebook total, an Instagram total and a split bar.
 * Only counts Meta returned are added up; accounts without one are named in a note, never
 * counted as 0. Nothing is estimated here.
 *
 * `accounts` (the summary's `accounts` object) is optional: it adds "Across 6 Pages" lines and,
 * when the viewer has no accounts at all, an empty state that shows `emptyAction`.
 */
export function FollowersCard({ followers, accounts, loading, emptyAction, className }) {
  const note = missingFollowersNote(followers);
  const empty = !loading && accounts?.total === 0;
  const total = followers?.total;
  const segments =
    !loading && typeof total === 'number' && total > 0
      ? PLATFORMS.filter(({ key }) => (followers[key] ?? 0) > 0).map((platform) => ({
          ...platform,
          share: (followers[platform.key] / total) * 100,
        }))
      : [];

  return (
    <Card className={cn('relative overflow-hidden p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-400/10 dark:text-brand-300">
              <Users className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <h2 className="text-sm font-medium text-muted">Combined followers</h2>
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-24" />
          ) : (
            <p
              className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white"
              title={exactFollowers(total)}
              data-testid="followers-total"
            >
              <AnimatedNumber value={total} format={formatFollowers} />
            </p>
          )}
          {!loading && followers?.asOf && (
            <p className="mt-1 text-xs text-muted">
              As of{' '}
              <time
                dateTime={followers.asOf}
                title={formatDate(followers.asOf, { dateStyle: 'medium', timeStyle: 'short' })}
              >
                {timeAgo(followers.asOf)}
              </time>{' '}
              · updated when accounts sync
            </p>
          )}
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:max-w-md">
          {PLATFORMS.map((platform) => {
            const { key, label, icon: Icon, tint } = platform;
            const value = followers?.[key];
            const covers = loading ? null : coverage(accounts, followers, platform);
            return (
              <div
                key={key}
                className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2.5 transition-colors duration-200 hover:border-slate-200 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-white/10"
                data-testid={`followers-${key}`}
              >
                <dt className="flex items-center gap-1.5 text-xs text-muted">
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', tint)} aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </dt>
                <dd
                  className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white"
                  title={exactFollowers(value)}
                >
                  {loading ? (
                    <Skeleton className="h-6 w-14" />
                  ) : (
                    <AnimatedNumber value={value} format={formatFollowers} />
                  )}
                </dd>
                {covers && <dd className="truncate text-[11px] text-muted">{covers}</dd>}
              </div>
            );
          })}
        </dl>
      </div>

      {segments.length > 0 && (
        <div
          className="mt-4 flex h-2 gap-1"
          role="img"
          aria-label={segments
            .map(({ label, share }) => `${label} ${Math.round(share)}%`)
            .join(', ')}
          data-testid="followers-split"
        >
          {segments.map(({ key, bar, share, label }) => (
            <span
              key={key}
              className={cn('h-full min-w-1.5 origin-left animate-bar-grow rounded-full', bar)}
              style={{ flex: `${share} 1 0%` }}
              title={`${label}: ${Math.round(share)}% of combined followers`}
            />
          ))}
        </div>
      )}

      {!loading &&
        (empty ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              No Facebook Pages or Instagram accounts are available to you yet. Once they are, their
              followers are added up here.
            </p>
            {emptyAction}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">
            {followers?.counted
              ? 'Sum of each account’s followers, so someone who follows several accounts is counted once per account.'
              : 'No follower counts yet. Counts are read from Meta when accounts are added or synced.'}
            {note && ` ${note}`}
          </p>
        ))}
    </Card>
  );
}
