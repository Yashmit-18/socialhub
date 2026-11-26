import { FolderOpen, ImagePlus, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button.jsx';
import { cn } from '../../../../lib/utils.js';
import { MEDIA_KINDS, MEDIA_MAX_ITEMS } from '../../model/composerState.js';
import { ACCEPTED_TYPES, ACCEPT_ATTRIBUTE, formatLabel } from '../../model/media.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';

/** "JPEG, PNG, GIF, WebP · MP4, MOV", derived from the accepted types. */
const FORMATS = [MEDIA_KINDS.IMAGE, MEDIA_KINDS.VIDEO]
  .map((kind) => ACCEPTED_TYPES[kind].map(formatLabel).join(', '))
  .join(' · ');

/** Shown while the media API is available: files leave this device as soon as they're added. */
export const UPLOAD_NOTE =
  'Files upload to SocialHub as soon as you add them. Nothing is posted to Facebook or Instagram.';

/** Drags of files (not text, links or the composer's own media tiles). */
function carriesFiles(dataTransfer) {
  if (!dataTransfer) return false;
  try {
    return Array.from(dataTransfer.types ?? []).includes('Files');
  } catch {
    return false;
  }
}

function filesFrom(transfer) {
  const files = Array.from(transfer?.files ?? []).filter(Boolean);
  if (files.length > 0) return files;
  return Array.from(transfer?.items ?? [])
    .filter((item) => item?.kind === 'file')
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

/**
 * Messages for files that couldn't be added (`useMediaManager().rejections`). The live
 * region is always rendered so screen readers announce new messages.
 */
export function MediaRejections({ rejections = [], onDismiss, onClear, className }) {
  return (
    <div aria-live="polite" className={className}>
      {rejections.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-3 dark:border-amber-500/20 dark:bg-amber-500/[0.07]">
          <ul role="list" className="space-y-2">
            {rejections.map((rejection) => (
              <li
                key={rejection.id}
                className="flex items-start gap-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100/90"
              >
                <TriangleAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 wrap-anywhere">{rejection.reason}</span>
                {onDismiss && (
                  <button
                    type="button"
                    onClick={() => onDismiss(rejection.id)}
                    aria-label={`Dismiss message about ${rejection.fileName}`}
                    className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-amber-700 transition hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {onClear && rejections.length > 1 && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onClear}
                className="rounded-md px-1.5 py-0.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                Dismiss all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Drop target + file picker for photos and videos.
 *
 * Accepts dropped files, files picked with "Browse files", and files pasted while focus is
 * inside the zone. It only hands `File`s to `onFiles(files)`; whether each file is accepted is
 * decided by `useMediaManager().addFiles`. Nothing here uploads anything.
 */
export function MediaDropzone({
  onFiles,
  disabled = false,
  count = 0,
  max = MEDIA_MAX_ITEMS,
  uploadAvailable = false,
  compact = false,
  rejections,
  onDismissRejection,
  onClearRejections,
  className,
}) {
  const inputRef = useRef(null);
  const zoneRef = useRef(null);
  /** Focus was inside the zone when files were delivered (restored after a layout switch). */
  const refocusRef = useRef(false);
  const depthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const hintId = useId();
  const countId = useId();
  const full = count >= max;
  const blocked = disabled || full;
  const active = dragging && !blocked;

  // A file dropped just outside the zone would make the browser open it in place of the app
  // (and lose the post). Swallow file drops that nothing else handled while the zone exists.
  useEffect(() => {
    const guard = (event) => {
      if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  const deliver = (files) => {
    if (blocked || files.length === 0) return;
    refocusRef.current = Boolean(zoneRef.current?.contains(document.activeElement));
    onFiles?.(files);
  };

  // Adding the first file switches to the compact layout, which remounts "Browse files". If
  // the keyboard was on it, put focus on its replacement instead of letting it fall to <body>.
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    const zone = zoneRef.current;
    if (!zone || zone.contains(document.activeElement)) return;
    (zone.querySelector('button:not([disabled])') ?? zone).focus();
  }, [compact]);

  const handleDragEnter = (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current += 1;
    setDragging(true);
  };
  const handleDragOver = (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
  };
  const handleDragLeave = (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  };
  const handleDrop = (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current = 0;
    setDragging(false);
    deliver(filesFrom(event.dataTransfer));
  };
  const handlePaste = (event) => {
    if (blocked) return;
    const files = filesFrom(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    deliver(files);
  };
  const handleInputChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
    deliver(files);
  };
  const browse = () => inputRef.current?.click();

  const title = active
    ? 'Drop to add'
    : full
      ? `You've added ${max} files`
      : compact
        ? 'Add more'
        : 'Drag photos and videos here';
  const hint = full
    ? 'That is the most one post can have. Remove a file to add a different one.'
    : compact
      ? 'Drag photos and videos here, or paste an image'
      : FORMATS;
  const countLabel = `${count} of ${max} files`;

  const browseButton = (
    <Button variant="secondary" size="sm" onClick={browse} disabled={blocked}>
      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
      Browse files
    </Button>
  );

  return (
    <div className={className}>
      <div
        ref={zoneRef}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={`${hintId} ${countId}`}
        tabIndex={-1}
        data-dragging={active ? 'true' : undefined}
        data-disabled={blocked ? 'true' : undefined}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={cn(
          'relative isolate border-dashed transition-[border-color,background-color,box-shadow] duration-200 focus:outline-none',
          compact
            ? 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-[1.5px] px-3.5 py-3 sm:px-4'
            : 'flex flex-col items-center justify-center rounded-2xl border-2 px-5 py-10 text-center sm:px-8 sm:py-12',
          blocked
            ? 'border-slate-200 bg-slate-50/50 dark:border-white/10 dark:bg-white/[0.015]'
            : active
              ? 'border-brand-500 bg-brand-50/80 ring-4 ring-brand-500/15 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400/15'
              : 'border-slate-300/80 bg-slate-50/70 hover:border-brand-300 hover:bg-brand-50/40 focus:border-brand-400 dark:border-white/15 dark:bg-white/[0.02] dark:hover:border-brand-400/50 dark:hover:bg-brand-500/[0.05] dark:focus:border-brand-400/60',
        )}
      >
        {compact ? (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200',
                blocked
                  ? 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500'
                  : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-slate-900/10',
                active && 'scale-110',
              )}
            >
              <ImagePlus className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <p
                id={titleId}
                className="truncate text-sm font-medium text-slate-900 dark:text-white"
              >
                {title}
              </p>
              <p id={hintId} className="truncate text-xs text-muted" title={hint}>
                {hint}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <span id={countId} className="text-xs font-medium tabular-nums text-muted">
                {countLabel}
              </span>
              {browseButton}
            </div>
          </>
        ) : (
          <>
            <span className="relative mb-4" aria-hidden="true">
              {!blocked && (
                <span
                  className={cn(
                    'absolute inset-0 rounded-2xl bg-brand-500/25 blur-xl transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-60',
                  )}
                />
              )}
              <span
                className={cn(
                  'relative flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-200',
                  blocked
                    ? 'bg-slate-200 text-slate-400 dark:bg-white/5 dark:text-slate-500'
                    : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-brand-600/25 ring-1 ring-white/20 ring-inset',
                  active && '-rotate-3 scale-110',
                )}
              >
                <ImagePlus className="h-6 w-6" />
              </span>
            </span>
            <p id={titleId} className="text-sm font-semibold text-slate-900 dark:text-white">
              {title}
            </p>
            <p id={hintId} className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
              {hint}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              {browseButton}
              {!blocked && <span className="text-xs text-muted">or paste an image</span>}
            </div>
            <p id={countId} className="mt-4 text-xs font-medium tabular-nums text-muted">
              {countLabel}
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          hidden
          tabIndex={-1}
          disabled={blocked}
          aria-label="Choose photos and videos to add"
          onChange={handleInputChange}
        />
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{uploadAvailable ? UPLOAD_NOTE : CAPABILITY_MESSAGES.mediaUpload}</span>
      </p>

      {rejections !== undefined && (
        <MediaRejections
          rejections={rejections}
          onDismiss={onDismissRejection}
          onClear={onClearRejections}
        />
      )}
    </div>
  );
}
