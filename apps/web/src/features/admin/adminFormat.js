/*
 * Everything in the operator console that is not a component: number and date formats, the
 * words for states, and the sentences built from API answers. Rule for every value: `null`
 * means not known and reads "Unknown" (or the wording given for that field), never 0.
 */
import {
  ADMIN_ATTENTION_CODES,
  ADMIN_CONFLICT_REASONS,
  PLATFORM_AUDIT_ACTIONS,
} from '@socialhub/shared';
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  CircleAlert,
  CircleX,
  Clock,
  HardDrive,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { formatDate, timeAgo } from '../../lib/utils.js';

export const UNKNOWN = 'Unknown';

const NUMBER = new Intl.NumberFormat();
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const formatCount = (value) => (isNumber(value) ? NUMBER.format(value) : UNKNOWN);

/** Date and time; `fallback` (what a missing value means) for null. */
export const formatDateTime = (value, fallback = UNKNOWN) =>
  value ? formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }) : fallback;

export const formatDay = (value, fallback = UNKNOWN) => (value ? formatDate(value) : fallback);

/** "3 hours ago"; `fallback` for null. */
export const formatAgo = (value, fallback = UNKNOWN) => (value ? timeAgo(value) : fallback);

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** `0 B`, `512 KB`, `48.2 MB`, `1.3 GB`. */
export function formatBytes(value) {
  if (!isNumber(value)) return UNKNOWN;
  if (value < 1024) return `${value} B`;
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const shown = size >= 100 || unit === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${shown} ${BYTE_UNITS[unit]}`;
}

const DURATION_UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** The largest whole unit only: `45 seconds`, `12 minutes`, `3 hours`, `2 days`. */
export function formatDuration(seconds) {
  if (!isNumber(seconds)) return UNKNOWN;
  for (const [unit, size] of DURATION_UNITS) {
    if (seconds >= size) return plural(Math.floor(seconds / size), unit, `${unit}s`);
  }
  return plural(Math.round(seconds), 'second', 'seconds');
}

export const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;

/** `[badge tone, words]` for a person's account. */
export const USER_STATUS_BADGE = {
  ACTIVE: ['success', 'Active'],
  DISABLED: ['danger', 'Suspended'],
};

/** `[badge tone, words]` for a workspace's own publishing switch. */
export const PUBLISHING_MODE_BADGE = {
  LIVE: ['warning', 'Real publishing'],
  SIMULATED: ['violet', 'Simulation'],
};

export const userStatusBadge = (status) => USER_STATUS_BADGE[status] ?? ['neutral', UNKNOWN];
export const publishingModeBadge = (mode) => PUBLISHING_MODE_BADGE[mode] ?? ['neutral', UNKNOWN];

/* ------------------------------------------------------------------ overview attention */

const SEVERITY = {
  danger: { tone: 'danger', label: 'Urgent' },
  warning: { tone: 'warning', label: 'Needs action' },
  info: { tone: 'sky', label: 'For your information' },
};

const SYSTEM_LINK = { to: '/admin/system', linkLabel: 'Open system status' };

const ATTENTION = {
  [ADMIN_ATTENTION_CODES.QUEUE_UNAVAILABLE]: {
    icon: CircleX,
    text: () =>
      'The publishing queue cannot be reached. New posts cannot be queued until it is back.',
  },
  [ADMIN_ATTENTION_CODES.QUEUE_NOT_CONFIGURED]: {
    icon: CircleAlert,
    text: () => 'The publishing queue is not set up, so posts cannot be queued.',
  },
  [ADMIN_ATTENTION_CODES.WORKER_NOT_RUNNING]: {
    icon: CircleX,
    text: () => 'No publishing worker is running. Waiting posts are not sent until one starts.',
  },
  [ADMIN_ATTENTION_CODES.POSTS_LATE]: {
    icon: Clock,
    text: (n) =>
      n === 1
        ? '1 post is more than 10 minutes late.'
        : `${formatCount(n)} posts are more than 10 minutes late.`,
  },
  [ADMIN_ATTENTION_CODES.DELIVERIES_INTERRUPTED]: {
    icon: TriangleAlert,
    text: (n) =>
      n === 1
        ? '1 delivery was interrupted while it was being sent.'
        : `${formatCount(n)} deliveries were interrupted while they were being sent.`,
  },
  [ADMIN_ATTENTION_CODES.POSTS_FAILED_RECENTLY]: {
    icon: CircleAlert,
    text: (n) =>
      n === 1
        ? '1 post failed in the last 24 hours. Its team can see why on their Posts page.'
        : `${formatCount(n)} posts failed in the last 24 hours. Their teams can see why on their Posts page.`,
  },
  [ADMIN_ATTENTION_CODES.ACCOUNTS_SUSPENDED]: {
    icon: UserRoundX,
    text: (n) =>
      n === 1 ? '1 account is suspended.' : `${formatCount(n)} accounts are suspended.`,
    to: '/admin/users?status=DISABLED',
    linkLabel: 'Show them',
  },
  [ADMIN_ATTENTION_CODES.STORAGE_NOT_PUBLIC]: {
    icon: HardDrive,
    text: () =>
      "Facebook and Instagram cannot fetch media files from this server's storage, so real posts with images or videos will fail.",
  },
  [ADMIN_ATTENTION_CODES.EMAIL_NOT_CONFIGURED]: {
    icon: Mail,
    text: () =>
      'Email is not set up. Password reset emails are not delivered, and invitations work only through the link shown to the person who invites.',
  },
};

/** `{ icon, tone, severity, text, to, linkLabel }` for one `attention` entry of the overview. */
export function attentionItem(item) {
  const known = ATTENTION[item.code];
  const severity = SEVERITY[item.severity] ?? { tone: 'neutral', label: 'Note' };
  if (!known) {
    // A code from a newer API: shown as it is, never hidden.
    return {
      icon: CircleAlert,
      tone: 'neutral',
      severity: 'Note',
      text: item.code,
      ...SYSTEM_LINK,
    };
  }
  return {
    icon: known.icon,
    tone: severity.tone,
    severity: severity.label,
    text: known.text(item.count),
    to: known.to ?? SYSTEM_LINK.to,
    linkLabel: known.linkLabel ?? SYSTEM_LINK.linkLabel,
  };
}

/* ------------------------------------------------------------------ suspension */

/**
 * The 409 answers of suspend and reactivate, in plain words. Each one also refreshes the page
 * behind the dialog (api.js), so the sentence can say the page now shows the current state.
 */
const CONFLICTS = {
  [ADMIN_CONFLICT_REASONS.SELF]:
    'You cannot suspend your own account. Another platform admin would have to do it.',
  [ADMIN_CONFLICT_REASONS.TARGET_IS_PLATFORM_ADMIN]:
    'This person is a platform admin, and platform admins cannot be suspended. Remove their admin access on the server first, then suspend the account.',
  [ADMIN_CONFLICT_REASONS.ALREADY_SUSPENDED]:
    'This account is already suspended, probably by another platform admin a moment ago. The page behind this window now shows it as it is.',
  [ADMIN_CONFLICT_REASONS.NOT_SUSPENDED]:
    'This account is not suspended any more, probably because another platform admin reactivated it a moment ago. The page behind this window now shows it as it is.',
};

/** The sentence for a refused suspend or reactivate, or null when it was not a 409. */
export function conflictMessage(error) {
  if (error?.status !== 409) return null;
  return CONFLICTS[error.details?.reason] ?? error.message;
}

/** The command that removes platform admin access (the only way: the server's command line). */
export const revokeCommand = (email) => `npm run admin:revoke -w @socialhub/api -- ${email}`;

const ownedLines = (memberships) =>
  memberships
    .filter((row) => row.onlyOwner)
    .map((row) => ({
      key: `owned-${row.id}`,
      icon: Building2,
      sub: true,
      text:
        row.adminCount === 0
          ? `${row.workspace.name}: no other admin, so nobody can manage its team or its connected accounts.`
          : `${row.workspace.name}: ${plural(row.adminCount, 'admin', 'admins')} can keep it running.`,
    }));

/**
 * What suspending the person would do, from GET /admin/users/:id (`impact`, `memberships`).
 * Lines are `{ key, icon, text, detail?, sub? }`; `deliveries` says whether a line talks about
 * deliveries (the dialog then explains the word once).
 */
export function suspendImpact({ impact, memberships }) {
  const { liveSessions, passwordResetPending, workspaces, waitingPosts } = impact;
  const lines = [];
  lines.push({
    key: 'sessions',
    icon: LogOut,
    text:
      liveSessions > 0
        ? `They are signed out everywhere. ${liveSessions === 1 ? '1 open session ends.' : `${formatCount(liveSessions)} open sessions end.`}`
        : 'They are not signed in anywhere right now.',
  });
  lines.push({
    key: 'sign-in',
    icon: LogIn,
    text: 'They cannot sign in. If they try with the right password, they are told the account is suspended and to contact you.',
  });
  if (passwordResetPending) {
    lines.push({
      key: 'reset',
      icon: KeyRound,
      text: 'A password reset link that was sent to them stops working.',
    });
  }
  if (waitingPosts.posts > 0) {
    const real =
      waitingPosts.realDeliveries === 0
        ? 'none of them real'
        : `${formatCount(waitingPosts.realDeliveries)} of them real`;
    lines.push({
      key: 'posts',
      icon: CalendarClock,
      text: `${waitingPosts.posts === 1 ? '1 scheduled post' : `${formatCount(waitingPosts.posts)} scheduled posts`} will not be sent while the account is suspended (${plural(waitingPosts.deliveries, 'delivery', 'deliveries')}, ${real}).`,
      detail:
        'Each is refused when its time comes. The team sees it as failed because the account is suspended, and a teammate who may publish can send it again.',
    });
  } else {
    lines.push({
      key: 'posts',
      icon: CalendarClock,
      text: 'They have no posts waiting to go out.',
    });
  }
  if (waitingPosts.sendingNow > 0) {
    lines.push({
      key: 'sending',
      icon: Send,
      text:
        waitingPosts.sendingNow === 1
          ? '1 delivery is being sent at this moment and cannot be stopped.'
          : `${formatCount(waitingPosts.sendingNow)} deliveries are being sent at this moment and cannot be stopped.`,
    });
  }
  if (workspaces.owned > 0) {
    lines.push({
      key: 'owned',
      icon: Building2,
      text:
        workspaces.owned === 1
          ? 'They own 1 workspace. While the account is suspended, nobody can transfer or delete it.'
          : `They own ${formatCount(workspaces.owned)} workspaces. While the account is suspended, nobody can transfer or delete them.`,
    });
    lines.push(...ownedLines(memberships));
  }
  lines.push({
    key: 'kept',
    icon: ShieldCheck,
    text: 'Their workspaces, drafts, connected accounts and published posts stay as they are.',
  });
  return {
    lines,
    deliveries: waitingPosts.posts > 0 || waitingPosts.sendingNow > 0,
  };
}

/** The same facts for an account that is suspended now (present tense, on the detail page). */
export function suspendedImpact({ impact, memberships }) {
  const { workspaces, waitingPosts } = impact;
  const lines = [
    {
      key: 'posts',
      icon: CalendarClock,
      text:
        waitingPosts.posts > 0
          ? `${waitingPosts.posts === 1 ? '1 scheduled post is' : `${formatCount(waitingPosts.posts)} scheduled posts are`} waiting. Each is refused when its time comes, for as long as the account is suspended.`
          : 'They have no posts waiting to go out.',
    },
  ];
  if (workspaces.owned > 0) {
    lines.push({
      key: 'owned',
      icon: Building2,
      text:
        workspaces.owned === 1
          ? 'They own 1 workspace. Nobody can transfer or delete it until the account is reactivated.'
          : `They own ${formatCount(workspaces.owned)} workspaces. Nobody can transfer or delete them until the account is reactivated.`,
    });
    lines.push(...ownedLines(memberships));
  }
  return { lines, deliveries: false };
}

/** What reactivating does, and what it does not undo. */
export function reactivateImpact({ impact }) {
  const lines = [
    { key: 'sign-in', icon: LogIn, text: 'They can sign in again with their password.' },
    {
      key: 'sessions',
      icon: LogOut,
      text: 'Sessions that were ended are not restored. They have to sign in again.',
    },
    {
      key: 'refused',
      icon: RotateCcw,
      text: 'Posts that were refused while the account was suspended are not sent. A teammate can retry them from the Posts page.',
    },
  ];
  if (impact.waitingPosts.posts > 0) {
    lines.push({
      key: 'waiting',
      icon: CalendarClock,
      text:
        impact.waitingPosts.posts === 1
          ? '1 scheduled post is still waiting and will go out at its time.'
          : `${formatCount(impact.waitingPosts.posts)} scheduled posts are still waiting and will go out at their times.`,
    });
  }
  return { lines, deliveries: false };
}

/* ------------------------------------------------------------------ audit log */

/** Choices of the audit log filter: `[action, words]`. */
export const AUDIT_FILTERS = [
  ['', 'All actions'],
  [PLATFORM_AUDIT_ACTIONS.USER_SUSPENDED, 'Suspensions'],
  [PLATFORM_AUDIT_ACTIONS.USER_REACTIVATED, 'Reactivations'],
  [PLATFORM_AUDIT_ACTIONS.ADMIN_GRANTED, 'Admin access given'],
  [PLATFORM_AUDIT_ACTIONS.ADMIN_REVOKED, 'Admin access removed'],
];

const AUDIT = {
  [PLATFORM_AUDIT_ACTIONS.USER_SUSPENDED]: {
    icon: UserRoundX,
    tone: 'danger',
    before: 'suspended',
    after: '',
    detail: (m) => (m.reason ? { label: 'Reason', text: m.reason } : null),
    facts: (m) => [
      isNumber(m.sessionsEnded) && `${plural(m.sessionsEnded, 'session', 'sessions')} ended`,
      m.resetLinkCleared && 'a password reset link stopped working',
    ],
  },
  [PLATFORM_AUDIT_ACTIONS.USER_REACTIVATED]: {
    icon: UserRoundCheck,
    tone: 'success',
    before: 'reactivated',
    after: '',
    detail: (m) => (m.note ? { label: 'Note', text: m.note } : null),
    facts: (m) => [m.suspendedReason && `It had been suspended for: ${m.suspendedReason}`],
  },
  [PLATFORM_AUDIT_ACTIONS.ADMIN_GRANTED]: {
    icon: ShieldCheck,
    tone: 'violet',
    before: 'gave',
    after: 'platform admin access',
    detail: () => null,
    // The actor of these entries is already "Command line".
    facts: () => [],
  },
  [PLATFORM_AUDIT_ACTIONS.ADMIN_REVOKED]: {
    icon: ShieldOff,
    tone: 'neutral',
    before: 'removed platform admin access from',
    after: '',
    detail: () => null,
    // The actor of these entries is already "Command line".
    facts: () => [],
  },
};

/**
 * One audit entry as a sentence: `{actor} {before} {target} {after}`, plus an optional quoted
 * `detail` (`{ label, text }`) and short `facts`. `email` is the target's address then.
 */
export function auditSentence(entry) {
  const known = AUDIT[entry.action];
  const metadata = entry.metadata ?? {};
  if (!known) {
    return {
      icon: BadgeCheck,
      tone: 'neutral',
      before: `did "${entry.action}" to`,
      after: '',
      detail: null,
      facts: [],
      email: metadata.email ?? null,
    };
  }
  return {
    icon: known.icon,
    tone: known.tone,
    before: known.before,
    after: known.after,
    detail: known.detail(metadata),
    facts: known.facts(metadata).filter(Boolean),
    email: metadata.email ?? null,
  };
}

/* ------------------------------------------------------------------ system status */

/**
 * `[tone, words, explanation]` for each state the System page shows. Tones are Badge tones;
 * a state that cannot be read is neutral "Unknown", never green.
 */
export const DATABASE_STATE = {
  connected: ['success', 'Connected', 'Accounts, workspaces and posts can be read and saved.'],
  connecting: ['neutral', 'Connecting', 'The server is connecting to the database.'],
  disconnecting: ['warning', 'Disconnecting', 'The server is closing its database connection.'],
  disconnected: ['danger', 'Disconnected', 'Nothing can be read or saved until it is back.'],
  unknown: ['neutral', UNKNOWN, 'The server could not say how its database connection is.'],
};

export const PUBLISHING_MODE = {
  DISABLED: ['neutral', 'Switched off', 'This server publishes nothing, real or simulated.'],
  SIMULATED: [
    'violet',
    'Simulation only',
    'Posts are simulated. Nothing reaches Facebook or Instagram.',
  ],
  LIVE: [
    'warning',
    'Real publishing allowed',
    'Workspaces that switched on real publishing send real posts.',
  ],
};

export const ANALYTICS_MODE = {
  DISABLED: ['neutral', 'Switched off', 'Insights from Meta are not collected.'],
  SIMULATED: ['violet', 'Demo data', 'Analytics shows made-up figures for testing.'],
  LIVE: ['success', 'Collecting from Meta', 'Insights are read from Meta for connected accounts.'],
};

/** A queue's state. `off`: the feature is switched off, so nothing here is a problem. */
export function queueState(status, { off = false } = {}) {
  const states = {
    NOT_CONFIGURED: [
      off ? 'neutral' : 'warning',
      'Not set up',
      'The server has no queue address (REDIS_URL), so nothing can be queued.',
    ],
    CONNECTING: [
      'neutral',
      'Connecting',
      'Normal for a minute after the server starts. Check again shortly.',
    ],
    READY: ['success', 'Ready', 'Work is handed to the worker through it.'],
    UNAVAILABLE: [
      off ? 'neutral' : 'danger',
      'Cannot be reached',
      'The queue is set up but does not answer. Nothing new can be queued until it is back.',
    ],
  };
  return states[status] ?? ['neutral', UNKNOWN, 'The server could not say how the queue is.'];
}

/** A worker's state, read from the queue (never from this server being up). */
export function workerState(worker, { off = false } = {}) {
  if (worker?.status === 'RUNNING') {
    return [
      'success',
      'Running',
      `${plural(worker.count, 'worker is', 'workers are')} connected to the queue.`,
    ];
  }
  if (worker?.status === 'NOT_RUNNING') {
    return off
      ? ['neutral', 'Not running', 'Not needed while this is switched off.']
      : ['danger', 'Not running', 'Waiting work is not done until a worker starts.'];
  }
  return ['neutral', UNKNOWN, 'The queue could not say whether a worker is connected.'];
}

export const queueCounts = (counts) =>
  counts
    ? `${formatCount(counts.waiting)} waiting, ${formatCount(counts.active)} active, ${formatCount(counts.delayed)} scheduled for later`
    : UNKNOWN;

export const ENVIRONMENT = { production: 'Production', development: 'Development', test: 'Test' };

export function storageState(storage, publishingMode) {
  const driver =
    storage.driver === 's3'
      ? ['success', 'Cloud storage (S3)', 'Uploaded media files are kept in cloud storage.']
      : storage.driver === 'local'
        ? ['neutral', "This server's disk", "Uploaded media files are kept on this server's disk."]
        : ['warning', 'Not set up', 'Media files cannot be uploaded.'];
  const live = publishingMode === 'LIVE';
  const links = storage.publicUrls
    ? ['success', 'Reachable', 'Facebook and Instagram can fetch media files for real posts.']
    : [
        live ? 'warning' : 'neutral',
        'Not reachable',
        live
          ? 'Facebook and Instagram cannot fetch media files, so real posts with images or videos fail.'
          : 'Facebook and Instagram could not fetch media files. This matters only for real publishing.',
      ];
  return { driver, links };
}

export const emailState = (email) =>
  email.configured
    ? ['success', 'Set up', 'Password reset emails and invitations are delivered.']
    : [
        'warning',
        'Not set up',
        'Password reset emails are not delivered, and invitations work only through the link shown to the person who invites.',
      ];

export const transactionsState = (supported) =>
  supported
    ? [
        'success',
        'Supported',
        'Changes made of several steps, like a suspension, save all at once.',
      ]
    : ['warning', 'Not supported', 'Changes made of several steps are saved one step at a time.'];
