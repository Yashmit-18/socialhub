import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { FlaskConical } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { cn } from '../../lib/utils.js';
import {
  SIMULATED_LABEL,
  SIMULATED_NOTICE,
  SIMULATED_PENDING_NOTICE,
  destinationStateLabel,
  destinationStateTone,
  jobStatusLabel,
  jobStatusTone,
  platformLabel,
} from './labels.js';

export function JobStatusBadge({ status, simulated }) {
  return (
    <Badge tone={jobStatusTone(status, simulated)} dot>
      {jobStatusLabel(status, simulated)}
    </Badge>
  );
}

export function DestinationStateBadge({ state, simulated }) {
  return (
    <Badge tone={destinationStateTone(state, simulated)} dot>
      {destinationStateLabel(state, simulated)}
    </Badge>
  );
}

/** Marks anything simulated or demo; `children` replaces the default label. */
export function SimulatedBadge({ children = SIMULATED_LABEL }) {
  return (
    <Badge tone="violet">
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {children}
    </Badge>
  );
}

/**
 * The sentence that goes with every simulated job, so it is never mistaken for a real post.
 * `pending`: the job has not finished, so it speaks of the future.
 */
export function SimulatedNote({ className, pending = false }) {
  return (
    <p className={cn('text-xs font-medium text-violet-700 dark:text-violet-300', className)}>
      {pending ? SIMULATED_PENDING_NOTICE : SIMULATED_NOTICE}
    </p>
  );
}

/** Platform mark with a text alternative. */
export function PlatformIcon({ platform, className }) {
  const Icon = platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT ? InstagramIcon : FacebookIcon;
  return (
    <span className="inline-flex shrink-0 items-center">
      <Icon
        className={cn(
          'h-4 w-4',
          platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT
            ? 'text-pink-600 dark:text-pink-400'
            : 'text-blue-600 dark:text-blue-400',
          className,
        )}
      />
      <span className="sr-only">{platformLabel(platform)}: </span>
    </span>
  );
}
