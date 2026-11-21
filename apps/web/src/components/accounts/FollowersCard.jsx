import { Users } from 'lucide-react';
import { exactFollowers, formatFollowers, missingFollowersNote } from '../../lib/followers.js';
import { formatDate, timeAgo } from '../../lib/utils.js';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';
import { Card } from '../ui/Card.jsx';
import { Skeleton } from '../ui/Feedback.jsx';

/**
 * Combined followers of every Facebook Page and Instagram account the viewer can see, from the
 * summary's `followers` object. Only counts Meta returned are added up; accounts without one
 * are named in a note, never counted as 0. Nothing is estimated here.
 */
export function FollowersCard({ followers, loading, className }) {
  const note = missingFollowersNote(followers);
  const rows = [
    {
      key: 'facebook',
      label: 'Facebook Pages',
      icon: FacebookIcon,
      value: followers?.facebook,
      tint: 'text-blue-600 dark:text-blue-400',
    },
    {
      key: 'instagram',
      label: 'Instagram accounts',
      icon: InstagramIcon,
      value: followers?.instagram,
      tint: 'text-fuchsia-600 dark:text-fuchsia-400',
    },
  ];

  return (
    <Card className={`relative overflow-hidden p-5 ${className ?? ''}`}>
      <div
        className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-[0.12] blur-2xl"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
              <Users className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <h2 className="text-sm font-medium text-muted">Combined followers</h2>
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-24" />
          ) : (
            <p
              className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white"
              title={exactFollowers(followers?.total)}
              data-testid="followers-total"
            >
              {formatFollowers(followers?.total)}
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
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:max-w-sm">
          {rows.map(({ key, label, icon: Icon, value, tint }) => (
            <div
              key={key}
              className="min-w-0 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/5"
            >
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${tint}`} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </dt>
              <dd
                className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white"
                title={exactFollowers(value)}
              >
                {loading ? <Skeleton className="h-6 w-14" /> : formatFollowers(value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {!loading && (
        <p className="mt-3 text-xs text-muted">
          {followers?.counted
            ? 'Sum of each account’s followers, so someone who follows several accounts is counted once per account.'
            : 'No follower counts yet. Counts are read from Meta when accounts are added or synced.'}
          {note && ` ${note}`}
        </p>
      )}
    </Card>
  );
}
