import { History, Image as ImageIcon, RotateCcw, Trash2, Video } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.jsx';
import { Callout } from '../../../../components/ui/Callout.jsx';
import { cn, formatDate } from '../../../../lib/utils.js';
import { relativeTime, useNow } from '../../hooks/useNow.js';
import { MEDIA_KINDS } from '../../model/composerState.js';

function exactTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Offers the device draft found when the composer opened (useLocalAutosave().restorable).
 * Autosave stays paused until the person restores or discards it.
 *
 * `missingMedia` — [{ fileName, kind }]: files a device draft cannot keep; listed so they can
 * be added again. `hasCurrentContent` adds a note that restoring replaces the composer content.
 */
export function DraftRestoreBanner({
  savedAt,
  missingMedia = [],
  onRestore,
  onDiscard,
  hasCurrentContent = false,
  className,
}) {
  const now = useNow();
  const relative = relativeTime(savedAt, now);
  const fromWhen = !relative ? 'earlier' : relative === 'just now' ? 'a moment ago' : relative;
  const exact = exactTime(savedAt);
  const files = Array.isArray(missingMedia) ? missingMedia : [];
  const count = files.length;

  return (
    <section
      role="region"
      aria-label="Unsaved draft"
      className={cn('surface relative animate-fade-in overflow-hidden', className)}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand-500" />
      <div
        className={cn(
          'flex flex-col gap-3 p-4 pl-5 sm:flex-row sm:gap-4 sm:px-5 sm:py-3.5 sm:pl-6',
          count > 0 ? 'sm:items-start' : 'sm:items-center',
        )}
      >
        <span
          aria-hidden="true"
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 sm:flex dark:bg-brand-500/10 dark:text-brand-300"
        >
          <History className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            You have an unsaved draft from{' '}
            {exact ? (
              <time dateTime={savedAt} title={exact}>
                {fromWhen}
              </time>
            ) : (
              fromWhen
            )}{' '}
            in this browser.
          </p>
          <p className="mt-1 text-sm text-muted">
            It&apos;s kept on this device only. Restore it to keep working on it, or discard it.
          </p>
          {hasCurrentContent && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              Restoring replaces what&apos;s in the composer now.
            </p>
          )}

          {count > 0 && (
            <Callout tone="warning" className="mt-3">
              <p>
                {count === 1
                  ? "1 media file wasn't kept. Add it again after restoring."
                  : `${count} media files weren't kept. Add them again after restoring.`}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Files to add again">
                {files.map((file, index) => {
                  const Icon = file?.kind === MEDIA_KINDS.VIDEO ? Video : ImageIcon;
                  return (
                    <li
                      key={`${index}:${file?.fileName}`}
                      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-white/80 px-2 py-1 text-xs text-slate-700 ring-1 ring-amber-200/80 ring-inset dark:bg-slate-900/60 dark:text-slate-200 dark:ring-amber-400/20"
                      title={file?.fileName}
                    >
                      <Icon
                        className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300"
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {file?.kind === MEDIA_KINDS.VIDEO ? 'Video:' : 'Image:'}
                      </span>{' '}
                      <span className="min-w-0 truncate">{file?.fileName}</span>
                    </li>
                  );
                })}
              </ul>
            </Callout>
          )}
        </div>

        {/* Side by side like a dialog footer: the main choice last. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Discard draft
          </Button>
          <Button size="sm" onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restore draft
          </Button>
        </div>
      </div>
    </section>
  );
}
