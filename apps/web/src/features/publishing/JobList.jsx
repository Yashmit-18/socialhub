import { ACTIVE_JOB_STATUSES } from '@socialhub/shared';
import { CalendarClock, Film, Image as ImageIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { cn, timeAgo } from '../../lib/utils.js';
import {
  JobStatusBadge,
  PlatformIcon,
  SimulatedBadge,
  SimulatedNote,
} from './PublishingBadges.jsx';
import {
  destinationStateLabel,
  destinationStateTone,
  formatDateTime,
  hiddenAccountsText,
  mediaCountText,
} from './labels.js';
import { formatInZone } from './schedule.js';

const CHIP_TONES = {
  neutral: 'border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-200',
  sky: 'border-sky-200 text-sky-800 dark:border-sky-400/20 dark:text-sky-200',
  brand: 'border-brand-200 text-brand-800 dark:border-brand-400/20 dark:text-brand-200',
  warning: 'border-amber-200 text-amber-800 dark:border-amber-400/20 dark:text-amber-200',
  success: 'border-emerald-200 text-emerald-800 dark:border-emerald-400/20 dark:text-emerald-200',
  danger: 'border-rose-200 text-rose-800 dark:border-rose-400/20 dark:text-rose-200',
  violet: 'border-violet-200 text-violet-800 dark:border-violet-400/20 dark:text-violet-200',
};

/** One account of a job: platform, name and what happened there, in words. */
function DestinationChip({ destination, simulated }) {
  const isSimulated = simulated || destination.simulated;
  const tone = destinationStateTone(destination.state, isSimulated);
  return (
    <li
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-xs dark:bg-white/[0.03]',
        CHIP_TONES[tone] ?? CHIP_TONES.neutral,
      )}
    >
      <PlatformIcon platform={destination.platform} className="h-3.5 w-3.5" />
      <span className="min-w-0 truncate font-medium">{destination.accountName}</span>
      <span className="shrink-0 opacity-80">
        · {destinationStateLabel(destination.state, isSimulated)}
      </span>
    </li>
  );
}

export function CaptionPreview({ text, className }) {
  return text ? (
    <p className={cn('break-words text-sm font-medium text-slate-900 dark:text-white', className)}>
      {text}
    </p>
  ) : (
    <p className={cn('text-sm italic text-muted', className)}>No caption</p>
  );
}

/** "Sat, 22 Nov 2026, 09:30 GMT+5:30 (in 3 hours)", in the workspace time zone when known. */
export function ScheduledTime({ value, timeZone, className }) {
  let text;
  try {
    text = timeZone ? formatInZone(value, timeZone) : formatDateTime(value);
  } catch {
    text = formatDateTime(value);
  }
  return (
    <span className={className}>
      <time dateTime={value}>{text}</time> ({timeAgo(value)})
    </span>
  );
}

function JobRow({ job, onOpen, onReschedule, timeZone }) {
  const MediaIcon = job.content?.hasVideo ? Film : ImageIcon;
  const destinations = job.destinations ?? [];
  const caption = job.content?.captionPreview ?? '';
  return (
    <li className="px-5 py-4 sm:px-6" data-testid={`publish-job-${job.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <CaptionPreview text={caption} className="line-clamp-2" />
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <MediaIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {mediaCountText(job.content?.mediaCount, job.content?.hasVideo)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {job.createdBy?.name ? `Created by ${job.createdBy.name}` : 'Created'}{' '}
              <time dateTime={job.createdAt} title={formatDateTime(job.createdAt)}>
                {timeAgo(job.createdAt)}
              </time>
            </span>
          </p>
          {/* Its own line: beside the other facts it wrapped awkwardly on narrow rows. */}
          {job.scheduledAt && (
            <p className="mt-1 flex items-start gap-1 text-xs text-muted">
              <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                {job.status === 'SCHEDULED' ? 'Goes out' : 'Scheduled for'}{' '}
                <ScheduledTime value={job.scheduledAt} timeZone={timeZone} />
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <JobStatusBadge status={job.status} simulated={job.simulated} />
          {job.simulated && <SimulatedBadge />}
          {onReschedule && job.canReschedule && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReschedule(job)}
              aria-label={`Change time${caption ? `: ${caption}` : ''}`}
            >
              Change time
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpen(job)}
            aria-label={`View details${caption ? `: ${caption}` : ''}`}
          >
            View details
          </Button>
        </div>
      </div>

      {job.simulated && (
        <SimulatedNote className="mt-2" pending={ACTIVE_JOB_STATUSES.includes(job.status)} />
      )}

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Accounts">
        {destinations.map((destination) => (
          <DestinationChip
            key={destination.id}
            destination={destination}
            simulated={job.simulated}
          />
        ))}
        {job.hiddenDestinationCount > 0 && (
          <li className="inline-flex items-center rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-muted dark:border-white/15">
            {hiddenAccountsText(job.hiddenDestinationCount)}
          </li>
        )}
      </ul>
    </li>
  );
}

export function JobList({ jobs, onOpen, onReschedule, timeZone }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-white/5">
      {jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          onOpen={onOpen}
          onReschedule={onReschedule}
          timeZone={timeZone}
        />
      ))}
    </ul>
  );
}
