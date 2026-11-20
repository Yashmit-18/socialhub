import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal.jsx';
import { cn } from '../../../../lib/utils.js';
import { INSPECTION_STATUS, MEDIA_KINDS, UPLOAD_STATUS } from '../../model/composerState.js';
import {
  describeAspectRatio,
  formatBytes,
  formatDuration,
  formatLabel,
} from '../../model/media.js';

/** Arrow keys belong to these elements (text caret, select options, video seeking). */
function ownsArrowKeys(element) {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(element.tagName);
}

function uploadLabel(upload) {
  switch (upload?.status) {
    case UPLOAD_STATUS.UPLOADING:
      return `Uploading (${Math.round((upload.progress || 0) * 100)}%)`;
    case UPLOAD_STATUS.PROCESSING:
      return 'Processing';
    case UPLOAD_STATUS.UPLOADED:
      return 'Uploaded';
    case UPLOAD_STATUS.FAILED:
      return 'Upload failed';
    default:
      return 'In this browser (not uploaded)';
  }
}

/**
 * The media itself. Falls back from <video> to <img> (server items may carry a still
 * thumbnail for a video) and then to a message. Remounted per item (key).
 */
function Stage({ item }) {
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;
  const [mode, setMode] = useState(() => (!item.previewUrl ? 'none' : isVideo ? 'video' : 'image'));

  if (mode === 'video') {
    return (
      <video
        src={item.previewUrl}
        controls
        playsInline
        preload="metadata"
        aria-label={`Video: ${item.fileName}`}
        onError={() => setMode('image')}
        className="mx-auto block max-h-[60vh] w-full bg-black"
      />
    );
  }
  if (mode === 'image') {
    return (
      <div className="flex min-h-[14rem] items-center justify-center">
        <img
          src={item.previewUrl}
          alt={item.altText?.trim() || item.fileName}
          onError={() => setMode('none')}
          className="block max-h-[60vh] w-auto max-w-full object-contain"
        />
        {isVideo && (
          <span className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-2 py-1 text-[11px] font-medium text-white">
            Thumbnail · the video can't play in this browser
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <ImageOff className="h-8 w-8 text-slate-500" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-200">Preview isn't available</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">
        This browser can't display {item.fileName}. It is still attached to the post.
      </p>
    </div>
  );
}

function Meta({ label, children, wide = false }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-full')}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900 wrap-anywhere dark:text-white">
        {children}
      </dd>
    </div>
  );
}

const navButton =
  'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg ring-1 ring-slate-900/10 backdrop-blur transition hover:bg-white disabled:pointer-events-none disabled:opacity-30 dark:bg-slate-900/85 dark:text-white dark:ring-white/15 dark:hover:bg-slate-900';

/**
 * Full-size preview of one attached file, with previous/next navigation (buttons and the
 * ArrowLeft / ArrowRight keys). Open while `media[index]` exists; `onNavigate(index)` moves,
 * `onClose()` closes. Shows what is in this browser only — it is not a publishing preview.
 */
export function MediaPreviewDialog({ media = [], index = null, onClose, onNavigate }) {
  const total = media.length;
  const valid = Number.isInteger(index) && index >= 0 && index < total;
  const item = valid ? media[index] : null;
  const open = Boolean(item);
  const navigable = Boolean(onNavigate) && total > 1;
  const hasPrevious = valid && index > 0;
  const hasNext = valid && index < total - 1;

  // Modal re-runs its focus effect whenever `onClose` changes; give it a stable callback so
  // re-renders (upload progress, inspection results) never move focus.
  const latest = useRef({ onClose, onNavigate });
  useLayoutEffect(() => {
    latest.current = { onClose, onNavigate };
  });
  const close = useCallback(() => latest.current.onClose?.(), []);

  const previousRef = useRef(null);
  const nextRef = useRef(null);
  /** Which nav button started the last move, to keep focus on an enabled one. */
  const navFocusRef = useRef(null);

  const goTo = (target, via) => {
    navFocusRef.current = via;
    latest.current.onNavigate?.(target);
  };

  useEffect(() => {
    if (!open || !navigable) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || ownsArrowKeys(event.target)) return;
      const target = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (target < 0 || target >= total) return;
      event.preventDefault();
      const active = document.activeElement;
      navFocusRef.current =
        active === previousRef.current ? 'previous' : active === nextRef.current ? 'next' : null;
      latest.current.onNavigate?.(target);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, navigable, index, total]);

  useEffect(() => {
    const via = navFocusRef.current;
    navFocusRef.current = null;
    if (!open || !via) return;
    const same = via === 'previous' ? previousRef.current : nextRef.current;
    const other = via === 'previous' ? nextRef.current : previousRef.current;
    const target = same && !same.disabled ? same : other;
    if (target && !target.disabled && document.activeElement !== target) target.focus();
  }, [open, index]);

  const isVideo = item?.kind === MEDIA_KINDS.VIDEO;
  const inspected = item?.inspection === INSPECTION_STATUS.DONE;
  const ratio = inspected ? describeAspectRatio(item.width, item.height) : null;
  const readingLabel =
    item?.inspection === INSPECTION_STATUS.PENDING ? 'Reading file…' : "Couldn't read";

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={item && <span className="block wrap-anywhere">{item.fileName}</span>}
      description={item ? `${index + 1} of ${total}` : undefined}
    >
      {item && (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-900/5 dark:ring-white/10">
            <Stage key={`${item.id}:${item.previewUrl ?? ''}`} item={item} />
            {navigable && (
              <>
                <button
                  ref={previousRef}
                  type="button"
                  aria-label="Previous file"
                  disabled={!hasPrevious}
                  onClick={() => goTo(index - 1, 'previous')}
                  className={cn(navButton, 'left-3')}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  ref={nextRef}
                  type="button"
                  aria-label="Next file"
                  disabled={!hasNext}
                  onClick={() => goTo(index + 1, 'next')}
                  className={cn(navButton, 'right-3')}
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Meta label="Type">
              {formatLabel(item.mimeType)} {isVideo ? 'video' : 'image'}
            </Meta>
            <Meta label="Size">{formatBytes(item.sizeBytes)}</Meta>
            <Meta label="Dimensions">
              {inspected && item.width && item.height
                ? `${item.width} × ${item.height} px`
                : inspected
                  ? '—'
                  : readingLabel}
            </Meta>
            <Meta label="Aspect ratio">{inspected ? (ratio ?? '—') : readingLabel}</Meta>
            {isVideo && (
              <Meta label="Duration">
                {inspected
                  ? Number.isFinite(item.durationSec)
                    ? formatDuration(item.durationSec)
                    : '—'
                  : readingLabel}
              </Meta>
            )}
            <Meta label="Status">{uploadLabel(item.upload)}</Meta>
            {!isVideo && (
              <Meta label="Alt text" wide>
                {item.altText?.trim() ? (
                  <span className="font-normal">{item.altText}</span>
                ) : (
                  <span className="font-normal text-muted">Not added</span>
                )}
              </Meta>
            )}
          </dl>
        </div>
      )}
    </Modal>
  );
}
