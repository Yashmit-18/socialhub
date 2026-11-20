import { GripVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../../lib/utils.js';
import { MediaTile } from './MediaTile.jsx';

/** Data type for the composer's own tile drags, so they never look like file drops. */
const TILE_DRAG_TYPE = 'application/x-socialhub-media';
const IDLE = Object.freeze({ id: null, overId: null });

/**
 * Attached media as a responsive grid (2 → 3 → 4 columns). Reorder by dragging a tile onto
 * another, or with each tile's "Move … earlier / later" buttons (keyboard and touch). The
 * first item is the cover. Moves and removals are announced in a polite live region, and
 * focus is kept on a sensible control after each move or removal.
 *
 * Purely presentational: every change goes through the callbacks
 * (`onMove(id, toIndex)`, `onRemove(id)`, …), normally wired to the composer reducer and
 * `useMediaManager`.
 */
export function MediaGrid({
  media = [],
  onRemove,
  onMove,
  onAltTextChange,
  onPreview,
  onRetryUpload,
  onCancelUpload,
  uploadAvailable = false,
  className,
}) {
  const listRef = useRef(null);
  /** Focus to restore after the next media change: { id, action, index?, removedId? }. */
  const focusRequestRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState(IDLE);
  const total = media.length;
  const reorderable = Boolean(onMove) && total > 1;

  useEffect(() => {
    const request = focusRequestRef.current;
    if (!request) return;
    focusRequestRef.current = null;
    // Ignore the request if the change it was waiting for didn't happen.
    if (request.removedId && media.some((m) => m.id === request.removedId)) return;
    if (
      request.index !== undefined &&
      media.findIndex((m) => m.id === request.id) !== request.index
    )
      return;
    const tile = Array.from(listRef.current?.querySelectorAll('[data-media-id]') ?? []).find(
      (element) => element.getAttribute('data-media-id') === request.id,
    );
    // Fall back to the tile's first control (e.g. tiles rendered without a preview button).
    const target =
      tile?.querySelector(`[data-media-action="${request.action}"]:not(:disabled)`) ??
      tile?.querySelector('[data-media-action]:not(:disabled)');
    if (target && document.activeElement !== target) target.focus();
  }, [media]);

  const move = (id, toIndex, via) => {
    const from = media.findIndex((m) => m.id === id);
    if (from === -1 || !onMove) return;
    const to = Math.min(total - 1, Math.max(0, Math.trunc(toIndex)));
    if (Number.isNaN(to) || to === from) return;
    if (via) {
      // A move button that becomes disabled at either end hands focus to its sibling.
      let action = via;
      if (via === 'move-earlier' && to === 0) action = 'move-later';
      if (via === 'move-later' && to === total - 1) action = 'move-earlier';
      focusRequestRef.current = { id, action, index: to };
    }
    onMove(id, to);
    setAnnouncement(`Moved ${media[from].fileName} to position ${to + 1} of ${total}`);
  };

  const remove = (id) => {
    const index = media.findIndex((m) => m.id === id);
    if (index === -1 || !onRemove) return;
    const neighbour = media[index + 1] ?? media[index - 1];
    if (neighbour) focusRequestRef.current = { id: neighbour.id, action: 'preview', removedId: id };
    onRemove(id);
    setAnnouncement(`Removed ${media[index].fileName}`);
  };

  const dragPropsFor = (item, index) => {
    if (!reorderable) return undefined;
    return {
      draggable: true,
      onDragStart: (event) => {
        // Only drags of the tile itself; a text selection dragged out of the alt text field
        // also bubbles a dragstart here and must stay a text drag.
        if (event.target !== event.currentTarget) return;
        const transfer = event.dataTransfer;
        if (transfer) {
          try {
            transfer.effectAllowed = 'move';
            transfer.setData(TILE_DRAG_TYPE, item.id);
          } catch {
            /* some browsers restrict dataTransfer; the drag still works through state */
          }
        }
        setDrag({ id: item.id, overId: null });
      },
      onDragEnter: (event) => {
        if (drag.id) event.preventDefault();
      },
      onDragOver: (event) => {
        if (!drag.id) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        if (drag.overId !== item.id) setDrag((current) => ({ ...current, overId: item.id }));
      },
      onDrop: (event) => {
        if (!drag.id) return;
        event.preventDefault();
        const draggedId = drag.id;
        setDrag(IDLE);
        if (draggedId !== item.id) move(draggedId, index);
      },
      onDragEnd: () => setDrag(IDLE),
    };
  };

  const fromIndex = drag.id ? media.findIndex((m) => m.id === drag.id) : -1;
  const dropPositionFor = (item, index) => {
    if (fromIndex === -1 || drag.overId !== item.id || drag.id === item.id) return null;
    return fromIndex < index ? 'after' : 'before';
  };

  return (
    <div className={cn('min-w-0', className)}>
      {total > 0 && (
        <ul
          ref={listRef}
          role="list"
          aria-label="Attached media"
          onDragLeave={(event) => {
            if (!drag.id || event.currentTarget.contains(event.relatedTarget)) return;
            setDrag((current) => (current.overId ? { ...current, overId: null } : current));
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {media.map((item, index) => (
            <MediaTile
              key={item.id}
              item={item}
              index={index}
              total={total}
              uploadAvailable={uploadAvailable}
              onRemove={onRemove ? remove : undefined}
              onMove={reorderable ? move : undefined}
              onAltTextChange={onAltTextChange}
              onPreview={onPreview}
              onRetryUpload={onRetryUpload}
              onCancelUpload={onCancelUpload}
              dragging={drag.id === item.id}
              dropPosition={dropPositionFor(item, index)}
              dragProps={dragPropsFor(item, index)}
            />
          ))}
        </ul>
      )}
      {reorderable && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
          <GripVertical className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          The first file is the cover. Drag files to reorder them, or use the arrow buttons.
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
