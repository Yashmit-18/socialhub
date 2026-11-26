import { Users } from 'lucide-react';
import { exactFollowers, formatFollowers, missingFollowersNote } from '../../lib/followers.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { SERIES } from '../charts/palette.js';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';
import { AnimatedNumber } from '../ui/AnimatedNumber.jsx';
import { Card } from '../ui/Card.jsx';
import { Skeleton } from '../ui/Feedback.jsx';
import { SplitBar } from '../ui/SplitBar.jsx';
import { useSectionTone } from '../ui/sectionTone.js';
import { softTone } from '../ui/tones.js';

const NUMBER = new Intl.NumberFormat();

// Solid platform colours from the chart palette: a data colour is never a gradient.
const PLATFORMS = [
  {
    key: 'facebook',
    label: 'Facebook Pages',
    icon: FacebookIcon,
    countKey: 'facebookPages',
    unit: ['Page', 'Pages'],
    tint: 'text-blue-600 dark:text-blue-400',
    swatch: SERIES.facebook.swatch,
  },
  {
    key: 'instagram',
    label: 'Instagram accounts',
    icon: InstagramIcon,
    countKey: 'instagramAccounts',
    unit: ['account', 'accounts'],
    tint: 'text-fuchsia-600 dark:text-fuchsia-400',
    swatch: SERIES.instagram.swatch,
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
 * summary's `followers` object: the total, a split bar, and the two platform figures under the
 * bar as its legend. Only counts Meta returned are added up; accounts without one are named in
 * a note, never counted as 0. Nothing is estimated here.
 *
 * `accounts` (the summary's `accounts` object) is optional: it adds "Across 6 Pages" lines and,
 * when the viewer has no accounts at all, an empty state that shows `emptyAction`.
 */
export function FollowersCard({ followers, accounts, loading, emptyAction, className }) {
  const section = useSectionTone();
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
    <Card className={cn('p-5 sm:p-6', className)}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            softTone(section?.soft),
          )}
        >
          <Users className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium text-muted">Combined followers</h2>
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-10 w-28 sm:h-12" />
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <p
            className="text-4xl font-semibold tracking-tight tabular-nums text-slate-900 sm:text-5xl dark:text-white"
            title={exactFollowers(total)}
            data-testid="followers-total"
          >
            <AnimatedNumber value={total} format={formatFollowers} />
          </p>
          {followers?.asOf && (
            <p className="pb-1 text-xs text-muted">
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
      )}

      <SplitBar
        className="mt-4"
        label={segments.map(({ label, share }) => `${label} ${Math.round(share)}%`).join(', ')}
        parts={segments.map(({ key, label, share, swatch }) => ({
          key,
          label: `${label}: ${Math.round(share)}% of combined followers`,
          value: share,
          className: swatch,
        }))}
        data-testid="followers-split"
      />

      {/* The figures sit under the bar, each with the swatch of its part: the bar's legend. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:gap-x-12">
        {PLATFORMS.map((platform) => {
          const { key, label, icon: Icon, tint, swatch } = platform;
          const value = followers?.[key];
          const segment = segments.find((s) => s.key === key);
          const covers = loading ? null : coverage(accounts, followers, platform);
          return (
            <div key={key} className="min-w-0" data-testid={`followers-${key}`}>
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    segment ? swatch : 'border border-slate-300 dark:border-white/20',
                  )}
                />
                <Icon className={cn('h-3.5 w-3.5 shrink-0', tint)} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </dt>
              <dd
                className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white"
                title={exactFollowers(value)}
              >
                {loading ? (
                  <Skeleton className="h-6 w-14" />
                ) : (
                  <AnimatedNumber value={value} format={formatFollowers} />
                )}
                {segment && (
                  <span className="text-xs font-normal text-muted">
                    {Math.round(segment.share)}%
                  </span>
                )}
              </dd>
              {covers && <dd className="truncate text-xs text-muted">{covers}</dd>}
            </div>
          );
        })}
      </dl>

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
          <p className="mt-4 text-xs text-muted">
            {followers?.counted
              ? 'Sum of each account’s followers, so someone who follows several accounts is counted once per account.'
              : 'No follower counts yet. Counts are read from Meta when accounts are added or synced.'}
            {note && ` ${note}`}
          </p>
        ))}
    </Card>
  );
}
