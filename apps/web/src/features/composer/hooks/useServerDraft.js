import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { composerActions, hasContent } from '../model/composerState.js';
import { fromContentPackage, toContentPackageInput } from '../model/serialize.js';
import { CapabilityUnavailableError, getComposerCapabilities } from '../services/capabilities.js';
import { createDraft, deleteDraft, getDraft, updateDraft } from '../services/composerApi.js';

/**
 * Team drafts stored by the SocialHub content API (docs/COMPOSER_API_CONTRACT.md §4).
 *
 * The API does not exist yet. Unless `getComposerCapabilities().serverDrafts` is on, the hook
 * is inert: `available` is false, status is 'unavailable', and save / open / remove reject with
 * CapabilityUnavailableError without sending a request. When it is on, every "saved" state
 * comes from a real server response — nothing is assumed.
 *
 *  - save() creates the draft the first time and updates it (with its `version`) afterwards.
 *    A 409 means someone else saved a newer version: status becomes 'conflict'.
 *  - Media that is not uploaded yet cannot be part of a team draft; it is listed in
 *    `omittedMedia` instead of being dropped silently.
 *  - Operations run one at a time in call order, so a second save waits for the first one's
 *    new version. Content replaced by open() or reset() starts a new "lineage": a save that
 *    was requested for the earlier content is stored as a separate new draft and never
 *    overwrites the draft that is open now.
 *
 * status: 'idle' | 'saving' | 'saved' (the composer matches the server draft) | 'error' |
 *         'conflict' | 'unavailable'.
 */

export const SERVER_DRAFT_CONFLICT_MESSAGE =
  'Someone else saved this draft. Reload it to see their changes.';

/** React Query key of the workspace's draft list (DraftsPanel). Saves and deletes invalidate it. */
export function composerDraftsQueryKey(workspaceId) {
  return ['workspace', workspaceId, 'composer', 'drafts'];
}

const NO_MEDIA = Object.freeze([]);
/** Lineage of a save requested while a loaded draft has not been rendered yet. */
const STALE = -1;

const isConflict = (err) => err?.status === 409 || err?.code === 'CONFLICT';

function conflictError(cause) {
  const error = new Error(SERVER_DRAFT_CONFLICT_MESSAGE);
  error.name = 'DraftConflictError';
  error.code = 'CONFLICT';
  error.status = 409;
  error.cause = cause;
  return error;
}

/** The content package in a response, or an error: a draft is never assumed to be saved. */
function packageOf(response) {
  const contentPackage = response?.contentPackage;
  if (!contentPackage?.id) {
    throw new Error(
      'SocialHub did not return the saved draft, so it may not have been saved. Try again.',
    );
  }
  return contentPackage;
}

function linkTo(contentPackage, savedRevision, input) {
  return {
    draft: {
      id: contentPackage.id,
      version: contentPackage.version ?? null,
      savedAt: contentPackage.updatedAt ?? null,
      savedRevision,
    },
    key: JSON.stringify(input),
  };
}

export function useServerDraft({ workspaceId, state, dispatch, availableAccountIds = null }) {
  const [available] = useState(() => getComposerCapabilities().serverDrafts);
  const queryClient = useQueryClient();
  /** The server draft the composer content belongs to: { draft, key } | null. */
  const [link, setLink] = useState(null);
  /** 'idle' | 'saving' | 'error' | 'conflict' ('saved' is derived from link + content). */
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);

  const latest = useRef(state);
  /** Accounts the person can use now (null while unknown): others are left out of saves. */
  const accountsRef = useRef(availableAccountIds);
  const linkRef = useRef(null);
  const queue = useRef(Promise.resolve());
  /** Bumped whenever the composer content is replaced (open completed, reset). */
  const lineage = useRef(0);
  /** Bumped by every open() call: only the most recent one may load. */
  const openTicket = useRef(0);
  /** The state a loaded draft replaces, until the loaded state has rendered. */
  const pendingLoad = useRef(null);
  useLayoutEffect(() => {
    latest.current = state;
    accountsRef.current = availableAccountIds;
    if (pendingLoad.current !== null && pendingLoad.current !== state) pendingLoad.current = null;
  });

  const prepared = useMemo(
    () => (available ? toContentPackageInput(state, { availableAccountIds }) : null),
    [available, state, availableAccountIds],
  );
  const inputKey = useMemo(() => (prepared ? JSON.stringify(prepared.input) : ''), [prepared]);
  const dirty = available && (link ? inputKey !== link.key : hasContent(state));

  const enqueue = useCallback((task) => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => {});
    return run;
  }, []);

  const invalidateList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: composerDraftsQueryKey(workspaceId) }),
    [queryClient, workspaceId],
  );

  /**
   * Saves the composer content as it is now. Resolves with { contentPackage, omittedMedia }
   * once the server confirms; rejects with the error (also reflected in status / error).
   * `asNew: true` always creates a new draft (e.g. to keep your version after a conflict).
   */
  const save = useCallback(
    ({ asNew = false } = {}) => {
      if (!available) return Promise.reject(new CapabilityUnavailableError('serverDrafts'));
      const requestedIn = pendingLoad.current === null ? lineage.current : STALE;
      const snapshot = latest.current;
      return enqueue(async () => {
        const current = requestedIn === lineage.current;
        const target = asNew || !current ? null : (linkRef.current?.draft ?? null);
        const { input, omittedMedia } = toContentPackageInput(snapshot, {
          availableAccountIds: accountsRef.current,
        });
        if (current) {
          setPhase('saving');
          setError(null);
        }
        try {
          const response = target
            ? await updateDraft(workspaceId, target.id, input, target.version)
            : await createDraft(workspaceId, input);
          const contentPackage = packageOf(response);
          invalidateList();
          if (requestedIn === lineage.current) {
            const next = linkTo(contentPackage, snapshot.revision, input);
            linkRef.current = next;
            setLink(next);
            setPhase('idle');
          }
          return { contentPackage, omittedMedia };
        } catch (err) {
          const failure = isConflict(err) ? conflictError(err) : err;
          if (requestedIn === lineage.current) {
            setPhase(isConflict(err) ? 'conflict' : 'error');
            setError(failure);
          }
          throw failure;
        }
      });
    },
    [available, enqueue, invalidateList, workspaceId],
  );

  /**
   * Loads a server draft into the composer (dispatches composerActions.load). Resolves with
   * the content package; rejects on failure without touching the composer. A later open() or
   * reset() supersedes it.
   */
  const open = useCallback(
    (packageId) => {
      if (!available) return Promise.reject(new CapabilityUnavailableError('serverDrafts'));
      openTicket.current += 1;
      const ticket = openTicket.current;
      const requestedIn = lineage.current;
      return enqueue(async () => {
        const contentPackage = packageOf(await getDraft(workspaceId, packageId));
        if (ticket !== openTicket.current || requestedIn !== lineage.current) {
          return contentPackage;
        }
        const loaded = fromContentPackage(contentPackage);
        const next = linkTo(
          contentPackage,
          0,
          toContentPackageInput(loaded, { availableAccountIds: accountsRef.current }).input,
        );
        lineage.current += 1;
        pendingLoad.current = latest.current;
        linkRef.current = next;
        dispatch(composerActions.load(loaded));
        setLink(next);
        setPhase('idle');
        setError(null);
        return contentPackage;
      });
    },
    [available, dispatch, enqueue, workspaceId],
  );

  /** Deletes the linked server draft (the composer content stays). Resolves once deleted. */
  const remove = useCallback(() => {
    if (!available) return Promise.reject(new CapabilityUnavailableError('serverDrafts'));
    const requestedIn = lineage.current;
    return enqueue(async () => {
      const target = requestedIn === lineage.current ? linkRef.current?.draft : null;
      if (!target) return null;
      await deleteDraft(workspaceId, target.id);
      invalidateList();
      if (requestedIn === lineage.current) {
        linkRef.current = null;
        setLink(null);
        setPhase('idle');
        setError(null);
      }
      return null;
    });
  }, [available, enqueue, invalidateList, workspaceId]);

  /**
   * Forgets the linked draft without a request, so the next save creates a new one. Call it
   * whenever the composer content is replaced by something else (Discard, restoring a device
   * draft); otherwise the next save would overwrite the previous team draft.
   */
  const reset = useCallback(() => {
    lineage.current += 1;
    linkRef.current = null;
    setLink(null);
    setPhase('idle');
    setError(null);
  }, []);

  let status;
  if (!available) status = 'unavailable';
  else if (phase !== 'idle') status = phase;
  else status = link && !dirty ? 'saved' : 'idle';

  return {
    available,
    status,
    draft: link?.draft ?? null,
    error,
    dirty,
    omittedMedia: prepared?.omittedMedia ?? NO_MEDIA,
    save,
    open,
    remove,
    reset,
  };
}
