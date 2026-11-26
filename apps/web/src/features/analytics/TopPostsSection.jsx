import { ANALYTICS_SOURCES } from '@socialhub/shared';
import { ExternalLink, Image as ImageIcon, Trophy, Type } from 'lucide-react';
import { PlatformMark } from '../../components/accounts/AccountBadges.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { buttonClass } from '../../components/ui/buttonClass.js';
import { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { RankingArt } from '../../components/ui/illustrations.jsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';
import { GRADIENT_TONES } from '../../components/ui/tones.js';
import { resolveApiLink } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { SimulatedBadge } from '../publishing/PublishingBadges.jsx';
import { safeExternalUrl } from '../publishing/labels.js';
import {
  formatDate,
  formatNumber,
  formatPercent,
  isNumber,
  metricLabel,
  platformLabel,
} from './format.js';
import { SectionCard } from './parts.jsx';

const POST_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saves', 'engagement'];
// What the list can be ranked by. Facebook posts never get an engagement value from Meta, so
// reach or views may be the only way to rank them.
const RANK_METRICS = ['engagement', 'reach', 'views', 'likes'];

/** The metric the list is ranked by first, then the others in their usual order. */
function metricsOf(post, ranked) {
  const keys = [ranked, ...POST_METRICS.filter((k) => k !== ranked)].filter(
    (k) => POST_METRICS.includes(k) && isNumber(post.metrics[k]),
  );
  const rows = keys.map((k) => ({
    key: k,
    label: metricLabel(k),
    value: formatNumber(post.metrics[k], { short: true }),
    ranked: k === ranked,
  }));
  if (isNumber(post.engagementRate)) {
    rows.push({
      key: 'engagementRate',
      label: 'Engagement rate',
      value: formatPercent(post.engagementRate),
      ranked: ranked === 'engagementRate',
    });
  }
  return rows;
}

function Thumbnail({ post }) {
  return (
    <div className="relative h-14 w-14 shrink-0 sm:row-span-2">
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-900/5 ring-inset dark:bg-white/[0.06] dark:ring-white/10">
        {post.thumbnailUrl ? (
          <img
            src={resolveApiLink(post.thumbnailUrl)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : post.mediaCount > 0 ? (
          <ImageIcon className="h-5 w-5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        ) : (
          <Type className="h-5 w-5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        )}
      </div>
      <span className="absolute -right-1 -bottom-1">
        <PlatformMark
          platform={post.platform}
          size="h-5 w-5 rounded-md ring-2 ring-white dark:ring-slate-900 [&_svg]:h-3 [&_svg]:w-3"
        />
      </span>
    </div>
  );
}

function PostRow({ post, index, metric, timeZone }) {
  const href = safeExternalUrl(post.url);
  return (
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:gap-x-4">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums sm:row-span-2',
          index === 0
            ? 'bg-brand-600 text-white dark:bg-brand-500'
            : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
        )}
      >
        {index + 1}
      </span>
      <Thumbnail post={post} />
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-medium break-words text-slate-900 dark:text-white">
          {post.captionPreview || (
            <span className="text-slate-500 italic dark:text-slate-400">No caption</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{post.account.name}</span>
          <span aria-hidden="true">·</span>
          <span>{platformLabel(post.platform)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(post.publishedAt, timeZone)}</span>
          {post.simulated && <SimulatedBadge />}
          {post.metricsSource === ANALYTICS_SOURCES.SIMULATED && (
            <Badge tone="violet">Demo metrics</Badge>
          )}
        </p>
      </div>
      <dl className="col-span-3 -mx-2.5 -my-1 grid grid-cols-3 gap-1 sm:col-span-1 sm:col-start-3 sm:flex sm:flex-wrap sm:gap-x-2">
        {metricsOf(post, metric).map((m) => (
          <div
            key={m.key}
            className={cn(
              'flex min-w-0 flex-col-reverse rounded-lg px-2.5 py-1 sm:min-w-16',
              m.ranked &&
                'bg-brand-50 ring-1 ring-brand-100 ring-inset dark:bg-brand-500/10 dark:ring-brand-400/20',
            )}
          >
            <dt className="text-[11px] leading-4 text-slate-600 dark:text-slate-400">{m.label}</dt>
            <dd className="text-sm font-semibold text-slate-900 tabular-nums dark:text-white">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={buttonClass({
            variant: 'secondary',
            size: 'sm',
            className:
              'col-span-3 justify-self-start sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:self-start',
          })}
        >
          View post <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}

function TopPostsSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-slate-100 dark:divide-white/5">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn('h-3.5', i % 2 ? 'w-1/2' : 'w-3/5')} />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-6 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Posts published through SocialHub, ranked by one metric. Only the link Meta returned is
 * offered, and only when it is an http(s) address; a simulated post never has one.
 * `onMetricChange` offers the choice of metric (only useful while there are insights).
 */
export function TopPostsSection({
  data,
  loading,
  fetching,
  error,
  onRetry,
  metric,
  onMetricChange,
  timeZone = 'UTC',
}) {
  const items = data?.items ?? [];
  return (
    <SectionCard label="Top posts" fetching={fetching}>
      <CardHeader
        icon={Trophy}
        tone={GRADIENT_TONES.pink}
        title="Top posts"
        description={`Posts published through SocialHub with the highest ${metricLabel(metric).toLowerCase()}. Only posts with that metric are ranked.`}
      />
      <CardBody>
        {onMetricChange && !error && (
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Rank by
            </span>
            <SegmentedControl
              label="Rank by"
              size="sm"
              value={metric}
              onChange={onMetricChange}
              options={RANK_METRICS.map((key) => [key, metricLabel(key)])}
            />
          </div>
        )}
        {error ? (
          <ErrorState error={error} onRetry={onRetry} title="Top posts could not be loaded" />
        ) : loading ? (
          <TopPostsSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            layout="inline"
            art={RankingArt}
            tone="neutral"
            title="No post metrics yet"
            description="Posts are ranked once their insights have been read. Until then their metrics are unavailable."
          />
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((post, index) => (
              <PostRow
                key={post.id}
                post={post}
                index={index}
                metric={metric}
                timeZone={timeZone}
              />
            ))}
          </ol>
        )}
      </CardBody>
    </SectionCard>
  );
}
