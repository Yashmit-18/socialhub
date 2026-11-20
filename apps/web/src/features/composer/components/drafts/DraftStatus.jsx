import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CloudCheck,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '../../../../lib/utils.js';
import { relativeTime, useNow } from '../../hooks/useNow.js';
import { SERVER_DRAFT_CONFLICT_MESSAGE } from '../../hooks/useServerDraft.js';

const ICON_TONES = {
  muted: 'text-slate-400 dark:text-slate-500',
  progress: 'text-brand-500 dark:text-brand-400',
  success: 'text-emerald-500 dark:text-emerald-400',
  warning: 'text-amber-500 dark:text-amber-400',
  danger: 'text-rose-500 dark:text-rose-400',
};

const SAVED_HERE = 'Saved in this browser';
const UNAVAILABLE_HERE = 'Autosave is off: this browser blocks storage';

const localErrorLabel = (reason) =>
  reason === 'quota'
    ? "Couldn't autosave: this browser's storage is full"
    : "Couldn't autosave in this browser";

/**
 * Wording for device autosave (useLocalAutosave). `announcement` feeds the polite live region:
 * it stays the same while typing so only outcomes are announced, never every keystroke.
 */
function localView(local) {
  switch (local?.status) {
    case 'pending':
      return {
        icon: LoaderCircle,
        tone: 'progress',
        spin: true,
        label: 'Saving in this browser…',
        announcement: local.reason
          ? local.reason === 'unavailable'
            ? UNAVAILABLE_HERE
            : localErrorLabel(local.reason)
          : local.savedAt
            ? SAVED_HERE
            : '',
      };
    case 'saved':
      return {
        icon: CircleCheck,
        tone: 'success',
        label: SAVED_HERE,
        savedAt: local.savedAt,
        title: 'Only you can see it, on this device. Attached files are not kept.',
        announcement: SAVED_HERE,
      };
    case 'paused':
      return {
        icon: CirclePause,
        tone: 'warning',
        label: 'Autosave paused',
        title: 'Restore or discard your earlier draft to turn autosave back on.',
        announcement: 'Autosave paused',
      };
    case 'error': {
      const label = localErrorLabel(local.reason);
      return { icon: TriangleAlert, tone: 'danger', label, announcement: label };
    }
    case 'unavailable':
      return {
        icon: Ban,
        tone: 'warning',
        label: UNAVAILABLE_HERE,
        title: "Drafts can't be kept in this browser, for example in some private windows.",
        announcement: UNAVAILABLE_HERE,
      };
    default:
      return { icon: CircleDashed, tone: 'muted', label: 'Not saved yet', announcement: '' };
  }
}

/** Wording for team drafts (useServerDraft). "Saved" only reflects a real server response. */
function serverView(server, local) {
  switch (server.status) {
    case 'saving':
      return {
        icon: LoaderCircle,
        tone: 'progress',
        spin: true,
        label: 'Saving…',
        announcement: 'Saving draft…',
      };
    case 'saved':
      return {
        icon: CloudCheck,
        tone: 'success',
        label: 'Saved to team drafts',
        savedAt: server.draft?.savedAt ?? null,
        announcement: 'Saved to team drafts',
      };
    case 'error':
      return {
        icon: TriangleAlert,
        tone: 'danger',
        label: "Couldn't save",
        title: server.error?.message,
        announcement: "Couldn't save the draft",
      };
    case 'conflict':
      return {
        icon: TriangleAlert,
        tone: 'warning',
        label: 'Not saved: someone else changed this draft',
        title: server.error?.message ?? SERVER_DRAFT_CONFLICT_MESSAGE,
        announcement: SERVER_DRAFT_CONFLICT_MESSAGE,
      };
    default:
      if (server.dirty) {
        return {
          icon: CircleDot,
          tone: 'warning',
          label: 'Unsaved changes',
          detail: local?.status === 'saved' ? 'kept in this browser' : null,
          announcement: '',
        };
      }
      return { icon: CircleDashed, tone: 'muted', label: 'Not saved yet', announcement: '' };
  }
}

/**
 * Compact save status for the composer action bar.
 *
 * `local`  — the useLocalAutosave() result (device wording: "Saved in this browser · 2 min ago").
 * `server` — the useServerDraft() result; when `server.available`, team-draft wording is used
 *            instead ("Saved to team drafts · …", "Saving…", "Couldn't save", "Unsaved changes").
 */
export function DraftStatus({ local, server, className }) {
  const now = useNow();
  const view = server?.available ? serverView(server, local) : localView(local);
  const Icon = view.icon;
  const when = view.savedAt ? relativeTime(view.savedAt, now) : null;
  const text = [view.label, when, view.detail].filter(Boolean).join(' · ');

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 text-xs text-slate-600 sm:text-sm dark:text-slate-300',
        className,
      )}
      title={view.title ?? text}
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', ICON_TONES[view.tone], view.spin && 'animate-spin')}
        aria-hidden="true"
      />
      <p className="min-w-0 truncate">
        <span className="font-medium text-slate-700 dark:text-slate-200">{view.label}</span>
        {when && (
          <span className="text-muted">
            {' · '}
            <time dateTime={view.savedAt}>{when}</time>
          </span>
        )}
        {view.detail && <span className="hidden text-muted sm:inline"> · {view.detail}</span>}
      </p>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {view.announcement}
      </span>
    </div>
  );
}
