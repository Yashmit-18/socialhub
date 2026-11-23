/**
 * Words shown on the Publishing screen. Every label is derived from what the API returned;
 * a simulated job or destination is never described as really published.
 */
import {
  DESTINATION_STATES,
  PUBLISH_JOB_STATUS,
  PUBLISH_WARNINGS,
  QUEUE_STATUS,
  SOCIAL_PLATFORMS,
} from '@socialhub/shared';
import { formatDate, timeAgo } from '../../lib/utils.js';
import { formatInZone } from './schedule.js';

const J = PUBLISH_JOB_STATUS;
const D = DESTINATION_STATES;

export const SIMULATED_LABEL = 'Simulated';
export const SIMULATED_NOTICE = 'Nothing was posted to Facebook or Instagram.';
/** For a simulated job that has not finished yet. */
export const SIMULATED_PENDING_NOTICE = 'Nothing will be posted to Facebook or Instagram.';

/** Tabs of the job list. `statuses` is what the list endpoint is asked for (empty = all). */
export const TABS = Object.freeze([
  { key: 'all', label: 'All', statuses: [] },
  // Soonest first: the order a schedule is read in.
  { key: 'scheduled', label: 'Scheduled', statuses: [J.SCHEDULED], order: 'scheduled' },
  { key: 'queue', label: 'Queue', statuses: [J.QUEUED, J.SCHEDULED] },
  { key: 'processing', label: 'Processing', statuses: [J.PROCESSING] },
  { key: 'published', label: 'Published', statuses: [J.PUBLISHED] },
  { key: 'partial', label: 'Partially published', statuses: [J.PARTIALLY_PUBLISHED] },
  { key: 'failed', label: 'Failed', statuses: [J.FAILED] },
  { key: 'cancelled', label: 'Cancelled', statuses: [J.CANCELLED] },
]);

export const DEFAULT_TAB = TABS[0];

export function tabFromParam(value) {
  return TABS.find((tab) => tab.key === value) ?? DEFAULT_TAB;
}

/** Number shown next to a tab, or null while the summary has not loaded. */
export function tabCount(tab, summary) {
  if (!summary) return null;
  if (tab.statuses.length === 0) return summary.total ?? null;
  return tab.statuses.reduce((sum, status) => sum + (summary.counts?.[status] ?? 0), 0);
}

export const EMPTY_TEXT = Object.freeze({
  all: {
    title: 'Nothing has been sent yet',
    description:
      'Posts you send to your accounts will show up here, with the result for each account.',
  },
  scheduled: {
    title: 'Nothing is scheduled',
    description:
      'Posts scheduled for later show up here, soonest first. Schedule one from the composer or with “Publish a draft”.',
  },
  queue: {
    title: 'Nothing is waiting',
    description: 'Posts that are scheduled or waiting to be sent will show up here.',
  },
  processing: {
    title: 'Nothing is being sent right now',
    description: 'Posts appear here while they are on their way to your accounts.',
  },
  published: {
    title: 'No published posts yet',
    description: 'Posts that reached every account will show up here.',
  },
  partial: {
    title: 'No partly published posts',
    description: 'Posts that reached some accounts but not others will show up here.',
  },
  failed: {
    title: 'No failed posts',
    description: 'Posts that could not be sent to any account will show up here.',
  },
  cancelled: {
    title: 'No cancelled posts',
    description: 'Posts that were cancelled before they were sent will show up here.',
  },
});

const JOB_LABELS = {
  [J.SCHEDULED]: 'Scheduled',
  [J.QUEUED]: 'Waiting',
  [J.PROCESSING]: 'Publishing…',
  [J.PUBLISHED]: 'Published',
  [J.PARTIALLY_PUBLISHED]: 'Partly published',
  [J.FAILED]: 'Failed',
  [J.CANCELLED]: 'Cancelled',
};

const SIMULATED_JOB_LABELS = {
  [J.PROCESSING]: 'Simulating…',
  [J.PUBLISHED]: 'Simulation finished',
  [J.PARTIALLY_PUBLISHED]: 'Simulation partly finished',
};

const JOB_TONES = {
  [J.SCHEDULED]: 'sky',
  [J.QUEUED]: 'neutral',
  [J.PROCESSING]: 'brand',
  [J.PUBLISHED]: 'success',
  [J.PARTIALLY_PUBLISHED]: 'warning',
  [J.FAILED]: 'danger',
  [J.CANCELLED]: 'neutral',
};

export function jobStatusLabel(status, simulated = false) {
  return (simulated && SIMULATED_JOB_LABELS[status]) || JOB_LABELS[status] || 'Unknown';
}

export function jobStatusTone(status, simulated = false) {
  if (simulated && status === J.PUBLISHED) return 'violet';
  return JOB_TONES[status] ?? 'neutral';
}

const DESTINATION_LABELS = {
  [D.SCHEDULED]: 'Scheduled',
  [D.QUEUED]: 'Waiting',
  [D.PROCESSING]: 'Publishing…',
  [D.RETRY_SCHEDULED]: 'Will retry',
  [D.PUBLISHED]: 'Published',
  [D.FAILED]: 'Failed',
  [D.CANCELLED]: 'Cancelled',
};

const DESTINATION_TONES = {
  [D.SCHEDULED]: 'sky',
  [D.QUEUED]: 'neutral',
  [D.PROCESSING]: 'brand',
  [D.RETRY_SCHEDULED]: 'warning',
  [D.PUBLISHED]: 'success',
  [D.FAILED]: 'danger',
  [D.CANCELLED]: 'neutral',
};

export function destinationStateLabel(state, simulated = false) {
  if (simulated && state === D.PUBLISHED) return SIMULATED_LABEL;
  if (simulated && state === D.PROCESSING) return 'Simulating…';
  return DESTINATION_LABELS[state] ?? 'Unknown';
}

export function destinationStateTone(state, simulated = false) {
  if (simulated && state === D.PUBLISHED) return 'violet';
  return DESTINATION_TONES[state] ?? 'neutral';
}

export function platformLabel(platform) {
  if (platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) return 'Facebook Page';
  if (platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT) return 'Instagram';
  return 'Account';
}

const WARNING_TEXT = {
  [PUBLISH_WARNINGS.FIRST_COMMENT_NOT_SENT]: 'The first comment was not sent.',
  [PUBLISH_WARNINGS.HASHTAGS_NOT_SENT]:
    'The hashtags were not sent, because they were set to go in the first comment.',
  [PUBLISH_WARNINGS.ALT_TEXT_NOT_SENT]: 'The image descriptions (alt text) were not sent.',
};

export function warningText(code) {
  return WARNING_TEXT[code] ?? 'Part of this post was not sent.';
}

export function attemptOutcomeLabel(outcome, simulated = false) {
  if (outcome === 'PUBLISHED') return simulated ? SIMULATED_LABEL : 'Published';
  if (outcome === 'RETRY') return 'Did not work, will try again';
  if (outcome === 'FAILED') return 'Failed';
  return 'In progress';
}

export function mediaCountText(count = 0, hasVideo = false) {
  if (!count) return 'No media';
  const files = count === 1 ? '1 file' : `${count} files`;
  return hasVideo ? `${files}, with video` : files;
}

export function accountCountText(count = 0) {
  return count === 1 ? '1 account' : `${count} accounts`;
}

export function hiddenAccountsText(count) {
  return count === 1
    ? '+1 account you do not have access to'
    : `+${count} accounts you do not have access to`;
}

export function formatDateTime(value) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "21 Nov 2026, 10:30 (in 5 minutes)" */
export function dateWithRelative(value) {
  return `${formatDateTime(value)} (${timeAgo(value)})`;
}

/** Only http(s) links from the API are ever rendered as links. */
export function safeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** What the status banner should say, from `GET /publishing/status`. Returns a list of notices. */
export function statusNotices(status) {
  if (!status) return [];
  if (status.mode === 'DISABLED') {
    return [
      {
        key: 'disabled',
        tone: 'neutral',
        title: 'Publishing is switched off on this server.',
        text: status.reason === 'PUBLISHING_DISABLED' ? status.message : null,
      },
    ];
  }

  const notices = [];
  if (status.mode === 'SIMULATED') {
    notices.push({
      key: 'simulated',
      tone: 'info',
      title: 'Simulation mode.',
      text: 'Posts go through the whole process, but nothing is sent to Facebook or Instagram.',
    });
  }

  const queue = status.queue?.status;
  if (queue && queue !== QUEUE_STATUS.READY) {
    const fallback =
      queue === QUEUE_STATUS.NOT_CONFIGURED
        ? 'The publishing queue has not been set up on this server yet.'
        : 'The publishing queue is not available right now. New posts cannot be sent until it is back.';
    notices.push({
      key: 'queue',
      tone: 'warning',
      title: (status.reason === 'QUEUE_UNAVAILABLE' && status.message) || fallback,
    });
  } else if (queue === QUEUE_STATUS.READY && status.worker?.status === 'NOT_RUNNING') {
    notices.push({
      key: 'worker',
      tone: 'warning',
      title: 'The publishing worker is not running.',
      text: 'Posts will wait in the queue until it is started.',
    });
  }
  return notices;
}

/** Messages to show for a failed "publish" request: one per invalid field, else the main one. */
export function errorMessages(error) {
  if (!error) return [];
  const fields = Object.values(error.details?.fields ?? {}).filter(
    (value) => typeof value === 'string' && value,
  );
  return fields.length > 0 ? fields : [error.message ?? 'Something went wrong. Please try again.'];
}

/** A key the server uses to recognise a repeated "publish" click (letters and digits only). */
export function newIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Words for the toast after a job was created. Never says "published" for a simulation. */
export function createdMessage({ simulated, scheduledAt, timeZone, created }) {
  if (created === false) {
    return { title: 'This post was already sent. Nothing new was created.' };
  }
  const when = scheduledAt ? formatInZone(scheduledAt, timeZone) : null;
  if (simulated) {
    return {
      title: when ? `Simulation scheduled for ${when}` : 'Simulation started',
      description: 'Nothing will be posted to Facebook or Instagram.',
    };
  }
  return { title: when ? `Scheduled for ${when}` : 'Sent to the publishing queue' };
}
