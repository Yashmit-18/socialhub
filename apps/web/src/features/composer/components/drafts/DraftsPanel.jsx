import { useInfiniteQuery } from '@tanstack/react-query';
import { CloudOff, FileText, FolderOpen, TriangleAlert } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../../../components/ui/Badge.jsx';
import { Button } from '../../../../components/ui/Button.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/ui/Feedback.jsx';
import { FormError } from '../../../../components/ui/Field.jsx';
import { Modal } from '../../../../components/ui/Modal.jsx';
import { resolveApiLink } from '../../../../lib/api.js';
import { relativeTime, useNow } from '../../hooks/useNow.js';
import { composerDraftsQueryKey } from '../../hooks/useServerDraft.js';
import { summarize } from '../../model/text.js';
import { CAPABILITY_MESSAGES, getComposerCapabilities } from '../../services/capabilities.js';
import { listDrafts } from '../../services/composerApi.js';

const PAGE_SIZE = 20;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A displayable thumbnail URL for a draft list item, if the API sent one. */
function thumbnailOf(item) {
  const first = Array.isArray(item?.media) ? item.media[0] : null;
  const asset = first?.media ?? first;
  const url = asset?.thumbnailUrl ?? (asset?.kind === 'VIDEO' ? null : asset?.url);
  return typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(url)
    ? resolveApiLink(url)
    : null;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function DraftThumb({ item }) {
  const url = thumbnailOf(item);
  const [failedUrl, setFailedUrl] = useState(null);
  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-slate-200/80 dark:ring-white/10"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500"
    >
      <FileText className="h-5 w-5" />
    </span>
  );
}

function DraftRow({ item, now, isCurrent, opening, busy, onOpen }) {
  const title = summarize(item.caption) || 'Untitled draft';
  const accounts = Array.isArray(item.targetAccountIds) ? item.targetAccountIds.length : 0;
  const files = Array.isArray(item.media) ? item.media.length : 0;
  const when = relativeTime(item.updatedAt, now);
  const meta = [
    item.updatedBy?.name ? `Edited by ${item.updatedBy.name}` : null,
    when,
    accounts ? plural(accounts, 'account') : 'No accounts',
    files ? plural(files, 'file') : null,
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-3 py-3">
      <DraftThumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-slate-900 dark:text-white">
            {title}
          </p>
          {isCurrent && (
            <Badge tone="brand" className="shrink-0">
              In composer
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted">
          {meta.map((part, index) => (
            <span key={`${index}:${part}`}>
              {index > 0 && (
                <span aria-hidden="true" className="mr-1.5">
                  ·
                </span>
              )}
              {part}
            </span>
          ))}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        loading={opening}
        disabled={busy && !opening}
        onClick={() => onOpen(item.id)}
      >
        {isCurrent ? 'Reload' : 'Open'} <span className="sr-only">{title}</span>
      </Button>
    </li>
  );
}

function DraftsList({ workspaceId, onOpen, currentDraftId, hasUnsavedChanges }) {
  const now = useNow();
  const query = useInfiniteQuery({
    queryKey: composerDraftsQueryKey(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      listDrafts(workspaceId, { cursor: pageParam, limit: PAGE_SIZE, signal }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
  });
  const [openingId, setOpeningId] = useState(null);
  const [openError, setOpenError] = useState(null);

  const items = useMemo(
    () => uniqueById((query.data?.pages ?? []).flatMap((page) => page?.items ?? [])),
    [query.data],
  );

  const handleOpen = async (id) => {
    setOpeningId(id);
    setOpenError(null);
    try {
      await onOpen?.(id);
    } catch (err) {
      setOpenError(err instanceof Error ? err : new Error('The draft could not be opened.'));
    } finally {
      setOpeningId(null);
    }
  };

  if (query.isPending) {
    return (
      <div>
        <span role="status" className="sr-only">
          Loading drafts…
        </span>
        <ul className="divide-y divide-slate-100 dark:divide-white/5" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <li key={n} className="flex items-center gap-3 py-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-16" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (query.isError && !query.data) {
    return (
      <ErrorState
        title="Couldn't load drafts"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No drafts yet"
        description="Drafts saved to this workspace appear here. Use Save draft in the composer to add one."
        className="py-8"
      />
    );
  }

  return (
    <div className="space-y-3">
      {hasUnsavedChanges && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Opening a draft replaces what&apos;s in the composer. Save your changes first if you want
          to keep them.
        </p>
      )}
      <FormError message={openError?.message} />
      <ul
        aria-label="Saved drafts"
        className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto dark:divide-white/5"
      >
        {items.map((item) => (
          <DraftRow
            key={item.id}
            item={item}
            now={now}
            isCurrent={item.id === currentDraftId}
            opening={openingId === item.id}
            busy={openingId !== null}
            onOpen={handleOpen}
          />
        ))}
      </ul>
      {query.isFetchNextPageError && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          Couldn&apos;t load more drafts. {query.error?.message}
        </p>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center pt-1">
          <Button
            variant="secondary"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchNextPageError ? 'Try again' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Lists the workspace's team drafts (GET /workspaces/:id/content-packages?status=DRAFT) in a
 * dialog. Mount it only while server drafts are available; if they aren't, it shows the
 * honest "not available yet" message and makes no request. The list is only fetched while the
 * dialog is open.
 *
 * `onOpen(id)` may return a promise: the row shows a loading state until it settles, and a
 * rejection is shown in the dialog. The dialog does not close itself — close it from onOpen.
 */
export function DraftsPanel({
  open,
  onClose,
  workspaceId,
  onOpen,
  currentDraftId = null,
  hasUnsavedChanges = false,
}) {
  const [available] = useState(() => getComposerCapabilities().serverDrafts);
  // A stable close handler, so parents can pass inline functions without re-running the
  // dialog's focus handling on every render.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current?.(), []);

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Team drafts"
      description="Drafts saved to this workspace."
    >
      {available ? (
        <DraftsList
          workspaceId={workspaceId}
          onOpen={onOpen}
          currentDraftId={currentDraftId}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-muted dark:border-white/10">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{CAPABILITY_MESSAGES.serverDrafts}</p>
        </div>
      )}
    </Modal>
  );
}
