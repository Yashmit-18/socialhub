import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Film,
  HardDrive,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Badge } from '../../../../components/ui/Badge.jsx';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES } from '../../constants/platformRules.js';
import {
  ALT_TEXT_MAX,
  INSPECTION_STATUS,
  MEDIA_KINDS,
  UPLOAD_STATUS,
} from '../../model/composerState.js';
import {
  describeAspectRatio,
  formatBytes,
  formatDuration,
  formatLabel,
} from '../../model/media.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';

const LOCAL_UPLOAD = Object.freeze({
  status: UPLOAD_STATUS.LOCAL,
  progress: 0,
  mediaId: null,
  error: null,
});

const listOf = (labels) => labels.join(' and ');
const ALT_SUPPORTED = Object.values(PLATFORM_RULES)
  .filter((rules) => rules.altText?.supported)
  .map((rules) => rules.label);
const ALT_UNSUPPORTED = Object.values(PLATFORM_RULES)
  .filter((rules) => !rules.altText?.supported)
  .map((rules) => rules.label);
/** Which destinations use alt text comes from the platform rules, not from this file. */
const ALT_TEXT_HINT = [
  'Helps people who use screen readers.',
  ALT_SUPPORTED.length > 0 &&
    `${listOf(ALT_SUPPORTED)} ${ALT_SUPPORTED.length === 1 ? 'supports' : 'support'} alt text for images${
      ALT_UNSUPPORTED.length > 0 ? `; SocialHub can't send it to ${listOf(ALT_UNSUPPORTED)}.` : '.'
    }`,
]
  .filter(Boolean)
  .join(' ');

const NUMBER = new Intl.NumberFormat('en-US');

const tileButton =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white';
const iconButton =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white';
const overlayChip =
  'pointer-events-none absolute z-20 inline-flex items-center gap-1 rounded-md bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm';

/**
 * Local video previews: ask for the frame at 0.1 s so browsers that don't paint the first
 * frame with preload="metadata" (iOS Safari) still show a picture.
 */
const posterFrame = (url) => (url.startsWith('blob:') && !url.includes('#') ? `${url}#t=0.1` : url);

/**
 * The square thumbnail. Falls back from <video> to <img> (items restored from the server can
 * carry a still thumbnail URL for a video) and then to a file-type placeholder. Remount it
 * (key) when the URL changes.
 */
function Thumbnail({ item }) {
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;
  const [mode, setMode] = useState(() => (!item.previewUrl ? 'none' : isVideo ? 'video' : 'image'));
  const KindIcon = isVideo ? Film : ImageIcon;

  if (mode === 'video') {
    return (
      <video
        src={posterFrame(item.previewUrl)}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        aria-hidden="true"
        onError={() => setMode('image')}
        className="pointer-events-none h-full w-full object-cover"
      />
    );
  }
  if (mode === 'image') {
    return (
      <img
        src={item.previewUrl}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => setMode('none')}
        className="pointer-events-none h-full w-full select-none object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-slate-100 to-slate-200/70 text-slate-400 dark:from-slate-800 dark:to-slate-900 dark:text-slate-500">
      <KindIcon className="h-7 w-7" aria-hidden="true" />
      <span className="text-[10px] font-semibold uppercase tracking-wider">No preview</span>
    </div>
  );
}

function PlayBadge() {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/55 shadow-lg ring-1 ring-white/25 backdrop-blur-sm transition-transform duration-150 group-hover/thumb:scale-110">
      <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
    </span>
  );
}

function Details({ item }) {
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;
  const parts = [formatBytes(item.sizeBytes)];
  if (item.inspection === INSPECTION_STATUS.DONE) {
    if (item.width && item.height) {
      parts.push(`${item.width}×${item.height}`);
      const ratio = describeAspectRatio(item.width, item.height);
      if (ratio) parts.push(ratio);
    }
    if (isVideo && Number.isFinite(item.durationSec)) parts.push(formatDuration(item.durationSec));
  }

  return (
    <div className="text-[11px] leading-4">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-x-1.5 whitespace-nowrap">
            {i > 0 && <span aria-hidden="true">·</span>}
            <span className="tabular-nums">{part}</span>
          </span>
        ))}
      </p>
      {item.inspection === INSPECTION_STATUS.PENDING && (
        <p className="mt-0.5 flex items-center gap-1 text-muted">
          <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
          Reading file…
        </p>
      )}
      {item.inspection === INSPECTION_STATUS.FAILED && (
        <p
          className="mt-0.5 flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
          title={`This browser couldn't read the file's ${
            isVideo ? 'length and dimensions' : 'dimensions'
          }, so platform limits can't be checked for it.`}
        >
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          Couldn't read details
        </p>
      )}
    </div>
  );
}

/** What screen readers hear when the upload status changes (never the moving percentage). */
function statusAnnouncement(item, upload) {
  switch (upload.status) {
    case UPLOAD_STATUS.UPLOADING:
      return `Uploading ${item.fileName}`;
    case UPLOAD_STATUS.PROCESSING:
      return `${item.fileName} is processing`;
    case UPLOAD_STATUS.UPLOADED:
      return `${item.fileName} uploaded`;
    case UPLOAD_STATUS.FAILED:
      return `Upload of ${item.fileName} failed. ${upload.error ?? ''}`.trim();
    default:
      return '';
  }
}

function UploadStatus({ item, upload, uploadAvailable, onRetryUpload, onCancelUpload }) {
  const name = item.fileName;

  if (upload.status === UPLOAD_STATUS.UPLOADING) {
    const percent = Math.round(Math.min(1, Math.max(0, upload.progress || 0)) * 100);
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="min-w-0 truncate font-medium text-brand-700 dark:text-brand-300">
            Uploading <span className="tabular-nums">{percent}%</span>
          </span>
          {onCancelUpload && (
            <button
              type="button"
              onClick={() => onCancelUpload(item.id)}
              aria-label={`Cancel upload of ${name}`}
              className="-my-0.5 rounded-md px-1 py-0.5 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
            >
              Cancel
            </button>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (upload.status === UPLOAD_STATUS.PROCESSING) {
    return (
      <Badge tone="sky" className="gap-1 px-2 text-[11px]">
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
        Processing
      </Badge>
    );
  }

  if (upload.status === UPLOAD_STATUS.UPLOADED) {
    return (
      <Badge tone="success" className="gap-1 px-2 text-[11px]">
        <CircleCheck className="h-3 w-3" aria-hidden="true" />
        Uploaded
      </Badge>
    );
  }

  if (upload.status === UPLOAD_STATUS.FAILED) {
    // Files reopened from a team draft have no local copy to send again: "Retry" would do
    // nothing, so the way forward is to remove the file and add it again.
    const hasLocalFile = !String(item.id).startsWith('remote_');
    return (
      <div className="space-y-1 text-[11px] leading-4">
        <p className="flex items-start gap-1 text-rose-600 dark:text-rose-400">
          <CircleX className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-semibold">Upload failed</span>
            {upload.error && (
              <span className="line-clamp-3 wrap-anywhere" title={upload.error}>
                {upload.error}
              </span>
            )}
          </span>
        </p>
        {!hasLocalFile && (
          <p className="text-slate-600 dark:text-slate-300">Remove it and add the file again.</p>
        )}
        {uploadAvailable && onRetryUpload && hasLocalFile && (
          <button
            type="button"
            onClick={() => onRetryUpload(item.id)}
            aria-label={`Retry upload of ${name}`}
            className={cn(tileButton, '-ml-2 text-rose-700 dark:text-rose-300')}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    );
  }

  // LOCAL: the file only exists in this browser tab. Never described as uploaded.
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        title={uploadAvailable ? 'Not uploaded yet.' : CAPABILITY_MESSAGES.mediaUpload}
        className="inline-flex"
      >
        <Badge tone="neutral" className="gap-1 px-2 text-[11px]">
          <HardDrive className="h-3 w-3" aria-hidden="true" />
          In this browser
          <span className="sr-only"> (not uploaded)</span>
        </Badge>
      </span>
      {uploadAvailable && onRetryUpload && (
        <button
          type="button"
          onClick={() => onRetryUpload(item.id)}
          aria-label={`Upload ${name}`}
          className={tileButton}
        >
          <Upload className="h-3 w-3" aria-hidden="true" />
          Upload
        </button>
      )}
    </div>
  );
}

function AltTextEditor({ item, id, onChange, onDone }) {
  const length = item.altText?.length ?? 0;
  return (
    <div className="mt-1 animate-fade-in rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-white/10 dark:bg-white/[0.03]">
      <label
        htmlFor={id}
        className="block text-[11px] font-medium text-slate-700 dark:text-slate-200"
      >
        Alt text
      </label>
      <textarea
        id={id}
        autoFocus
        rows={3}
        maxLength={ALT_TEXT_MAX}
        value={item.altText ?? ''}
        placeholder="Describe what's in the image"
        aria-label={`Alt text for ${item.fileName}`}
        aria-describedby={`${id}-hint ${id}-count`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
        className="mt-1 block w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400"
      />
      <div className="mt-1 flex items-start justify-between gap-2 text-[11px] leading-4">
        <p id={`${id}-hint`} className="min-w-0 text-muted">
          {ALT_TEXT_HINT}
        </p>
        <span id={`${id}-count`} className="shrink-0 tabular-nums text-muted">
          <span aria-hidden="true">
            {NUMBER.format(length)}/{NUMBER.format(ALT_TEXT_MAX)}
          </span>
          <span className="sr-only">
            {NUMBER.format(length)} of {NUMBER.format(ALT_TEXT_MAX)} characters
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-7 items-center rounded-lg bg-white px-2.5 text-[11px] font-medium text-slate-800 shadow-xs ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-slate-800/70 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-slate-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * One attached photo or video: square thumbnail (click to preview), file details, upload
 * status, alt text (images) and reorder controls.
 *
 * `onMove(id, toIndex, via)` — `via` is 'move-earlier' | 'move-later' for the buttons and is
 * only used by MediaGrid for focus management. `dragProps` (from MediaGrid) are spread on the
 * tile for HTML5 drag reordering; `dropPosition` ('before' | 'after') draws the drop marker.
 */
export function MediaTile({
  item,
  index = 0,
  total = 1,
  uploadAvailable = false,
  onRemove,
  onMove,
  onAltTextChange,
  onPreview,
  onRetryUpload,
  onCancelUpload,
  dragging = false,
  dropPosition = null,
  dragProps,
  className,
}) {
  const [altOpen, setAltOpen] = useState(false);
  const altToggleRef = useRef(null);
  const altId = useId();
  const isVideo = item.kind === MEDIA_KINDS.VIDEO;
  const KindIcon = isVideo ? Film : ImageIcon;
  const upload = item.upload ?? LOCAL_UPLOAD;
  const name = item.fileName;
  const hasAlt = Boolean(item.altText?.trim());
  const canEditAlt = !isVideo && Boolean(onAltTextChange);
  const canReorder = Boolean(onMove) && total > 1;
  const { draggable: wantsDrag, ...dragHandlers } = dragProps ?? {};
  const draggable = Boolean(wantsDrag) && !altOpen;

  const closeAltText = () => {
    setAltOpen(false);
    altToggleRef.current?.focus();
  };

  return (
    <li
      data-media-id={item.id}
      data-drop-position={dropPosition ?? undefined}
      {...dragHandlers}
      draggable={draggable || undefined}
      className={cn(
        // `isolate`: the tile's own layers (badges, remove button) must not rise above page
        // chrome such as the sticky action bar.
        '@container relative isolate flex min-w-0 flex-col rounded-2xl border bg-white p-2 shadow-xs transition duration-150 dark:bg-white/[0.03]',
        dropPosition
          ? 'border-brand-400 ring-4 ring-brand-500/15 dark:border-brand-400/70'
          : 'border-slate-200/80 dark:border-white/10',
        dragging && 'scale-[0.97] opacity-50',
        draggable && 'cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      {dropPosition && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-4 z-40 w-1 rounded-full bg-brand-500 ring-2 ring-brand-500/25',
            dropPosition === 'before' ? '-left-2' : '-right-2',
          )}
        />
      )}

      <div className="group/thumb relative aspect-square overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800/70">
        <Thumbnail key={item.previewUrl ?? 'none'} item={item} />

        {onPreview ? (
          <button
            type="button"
            data-media-action="preview"
            aria-label={`Preview ${name}`}
            onClick={() => onPreview(item.id)}
            className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-950/0 text-white transition-colors duration-150 hover:bg-slate-950/25 focus-visible:-outline-offset-4 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
          >
            {isVideo ? (
              <PlayBadge />
            ) : (
              <Maximize2
                className="h-5 w-5 opacity-0 drop-shadow transition-opacity duration-150 group-hover/thumb:opacity-100"
                aria-hidden="true"
              />
            )}
          </button>
        ) : (
          isVideo && (
            <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-white">
              <PlayBadge />
            </span>
          )
        )}

        {index === 0 ? (
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 inline-flex items-center rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900 shadow-sm backdrop-blur dark:bg-slate-900/85 dark:text-white">
            Cover
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1.5 top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-950/55 px-1.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm"
          >
            {index + 1}
          </span>
        )}

        <span aria-hidden="true" className={cn(overlayChip, 'bottom-1.5 left-1.5')}>
          <KindIcon className="h-3 w-3" />
          {formatLabel(item.mimeType)}
        </span>
        {isVideo && Number.isFinite(item.durationSec) && (
          <span aria-hidden="true" className={cn(overlayChip, 'bottom-1.5 right-1.5 tabular-nums')}>
            {formatDuration(item.durationSec)}
          </span>
        )}

        {onRemove && (
          <button
            type="button"
            data-media-action="remove"
            aria-label={`Remove ${name}`}
            title="Remove"
            onClick={() => onRemove(item.id)}
            className="absolute right-1.5 top-1.5 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/60 text-white shadow-sm ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-rose-600 hover:ring-rose-500"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-2 flex min-w-0 flex-1 flex-col gap-1.5 px-0.5">
        <p className="min-w-0 text-xs font-medium text-slate-800 dark:text-slate-100">
          <span className="sr-only">{isVideo ? 'Video' : 'Image'}: </span>
          <span className="block truncate" title={name}>
            {name}
          </span>
        </p>
        <Details item={item} />
        <UploadStatus
          item={item}
          upload={upload}
          uploadAvailable={uploadAvailable}
          onRetryUpload={onRetryUpload}
          onCancelUpload={onCancelUpload}
        />
        <span className="sr-only" aria-live="polite">
          {statusAnnouncement(item, upload)}
        </span>

        {(canEditAlt || canReorder) && (
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-0.5">
            {canEditAlt && (
              <button
                ref={altToggleRef}
                type="button"
                aria-expanded={altOpen}
                aria-controls={altOpen ? altId : undefined}
                aria-label={`${hasAlt ? 'Edit' : 'Add'} alt text for ${name}`}
                onClick={() => setAltOpen((open) => !open)}
                className={cn(
                  tileButton,
                  '-ml-1.5',
                  hasAlt && 'text-emerald-700 dark:text-emerald-300',
                  altOpen && 'bg-slate-100 text-slate-900 dark:bg-white/5 dark:text-white',
                )}
              >
                {hasAlt ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {/* Narrow tiles (2 columns at 360 px, 4 in a desktop card) show "Alt". */}
                Alt<span className="hidden @[8.5rem]:inline">{' text'}</span>
              </button>
            )}
            {canReorder && (
              <div className="-mr-1 ml-auto flex items-center">
                <button
                  type="button"
                  data-media-action="move-earlier"
                  aria-label={`Move ${name} earlier`}
                  title="Move earlier"
                  disabled={index === 0}
                  onClick={() => onMove(item.id, index - 1, 'move-earlier')}
                  className={iconButton}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-media-action="move-later"
                  aria-label={`Move ${name} later`}
                  title="Move later"
                  disabled={index >= total - 1}
                  onClick={() => onMove(item.id, index + 1, 'move-later')}
                  className={iconButton}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}

        {canEditAlt && altOpen && (
          <AltTextEditor
            item={item}
            id={altId}
            onChange={(value) => onAltTextChange(item.id, value)}
            onDone={closeAltText}
          />
        )}
      </div>
    </li>
  );
}
