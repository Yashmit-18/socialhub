import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createInitialComposerState, hasContent } from '../model/composerState.js';
import { fromLocalDraft, toLocalDraft } from '../model/serialize.js';
import {
  clearLocalDraft,
  isLocalStorageAvailable,
  readLocalDraft,
  writeLocalDraft,
} from '../services/localStore.js';

/**
 * Device autosave for the composer (localStorage through services/localStore.js).
 *
 * This is real storage, but only in this browser on this device: it is not shared with the
 * team and the UI always says so ("Saved in this browser"). Media files are never stored —
 * only their names, so a restored draft can list the files to add again.
 *
 *  - On mount the device draft is read once. If it holds content it is offered as
 *    `restorable` and autosave is `paused`: nothing is written until the person restores or
 *    discards it, so an earlier draft is never overwritten silently.
 *  - Otherwise each content change is written `delayMs` after the last one (debounced). When
 *    the composer is emptied, the device draft is removed.
 *  - Whether something is waiting to be written is derived during render by comparing the
 *    device-draft form of the state (toLocalDraft) with the last one written. Upload-progress
 *    ticks and file-inspection results don't change it, so they never cause writes or restart
 *    the debounce, and loading a draft (which resets `revision` to 0) is still noticed.
 *  - Waiting changes are written at once when the page is hidden or closed (pagehide /
 *    visibilitychange) and when the hook unmounts (in-app navigation), so leaving inside the
 *    debounce window loses nothing.
 *
 * The draft slot (user + workspace) is chosen once per mount: remount (key) the composer when
 * either changes.
 *
 * status:
 *   'idle'        nothing is saved in this browser yet (or the composer is empty)
 *   'pending'     a change is waiting for the debounce
 *   'saved'       the current content is saved in this browser at `savedAt`
 *   'paused'      an earlier device draft waits for restore() / discardRestorable()
 *   'error'       the last write failed (`reason` 'quota' | 'error'); retried on the next change
 *   'unavailable' this browser blocks storage (`reason` 'unavailable')
 */

export const LOCAL_AUTOSAVE_DELAY_MS = 800;

const serializeDraft = (state) => JSON.stringify(toLocalDraft(state));
const EMPTY_DRAFT_KEY = serializeDraft(createInitialComposerState());
const NOTHING_WRITTEN = Object.freeze({ key: EMPTY_DRAFT_KEY, savedAt: null, reason: null });

function readRestorable(userId, workspaceId) {
  const stored = readLocalDraft(userId, workspaceId);
  if (!stored) return null;
  const { state, missingMedia } = fromLocalDraft(stored.data);
  if (!hasContent(state) && missingMedia.length === 0) return null;
  return { savedAt: stored.savedAt, data: stored.data, state, missingMedia };
}

function setUp(userId, workspaceId) {
  const scope = userId && workspaceId ? { userId, workspaceId } : null;
  const available = Boolean(scope) && isLocalStorageAvailable();
  return { scope, available, restorable: available ? readRestorable(userId, workspaceId) : null };
}

export function useLocalAutosave({
  state,
  userId,
  workspaceId,
  delayMs = LOCAL_AUTOSAVE_DELAY_MS,
}) {
  const [setup] = useState(() => setUp(userId, workspaceId));
  const { scope, available } = setup;
  const [restorable, setRestorable] = useState(setup.restorable);
  /** The last write (or removal): { key, savedAt, reason }. */
  const [record, setRecord] = useState(NOTHING_WRITTEN);

  const key = useMemo(() => serializeDraft(state), [state]);
  const contentful = hasContent(state);
  const paused = restorable !== null;
  const active = available && !paused;
  const changed = key !== record.key;

  // Latest committed values for timers, page-hide listeners and unmount (read outside render).
  const latest = useRef(null);
  useLayoutEffect(() => {
    latest.current = { state, key, writtenKey: record.key, active };
  });

  const write = useCallback(
    (snapshot, snapshotKey) => {
      if (!scope) return { ok: false, reason: 'error' };
      if (!hasContent(snapshot)) {
        clearLocalDraft(scope.userId, scope.workspaceId);
        setRecord({ key: snapshotKey, savedAt: null, reason: null });
        return { ok: false, reason: 'empty' };
      }
      const result = writeLocalDraft(scope.userId, scope.workspaceId, toLocalDraft(snapshot));
      setRecord((previous) =>
        result.ok
          ? { key: snapshotKey, savedAt: result.savedAt, reason: null }
          : { key: snapshotKey, savedAt: previous.savedAt, reason: result.reason },
      );
      return result;
    },
    [scope],
  );

  /** Writes the latest content if it differs from what was last written. */
  const writeIfChanged = useCallback(() => {
    const current = latest.current;
    if (!current || !current.active || current.key === current.writtenKey) return;
    write(current.state, current.key);
  }, [write]);

  // Debounce: every content change restarts the countdown (`key` is a dependency).
  useEffect(() => {
    if (!active || !changed) return undefined;
    const timer = setTimeout(writeIfChanged, delayMs);
    return () => clearTimeout(timer);
  }, [active, changed, key, delayMs, writeIfChanged]);

  // Don't lose the debounce window when the page is hidden, closed or navigated away from.
  useEffect(() => {
    const onPageHide = () => writeIfChanged();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') writeIfChanged();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      writeIfChanged();
    };
  }, [writeIfChanged]);

  /**
   * Saves the current content now ("Save draft"). Returns { ok: true, savedAt } or
   * { ok: false, reason: 'unavailable' | 'quota' | 'error' | 'paused' | 'empty' }.
   * 'paused': an earlier device draft is waiting to be restored or discarded and is not
   * overwritten. 'empty': nothing to save (the device draft is removed).
   */
  const flush = useCallback(() => {
    if (!scope) return { ok: false, reason: 'error' };
    if (!available) return { ok: false, reason: 'unavailable' };
    if (paused) return { ok: false, reason: 'paused' };
    const current = latest.current;
    if (!current) return { ok: false, reason: 'error' };
    return write(current.state, current.key);
  }, [scope, available, paused, write]);

  /**
   * Returns the restorable composer state (for composerActions.load) and resumes autosave,
   * treating it as saved at its original time. Returns null when there is nothing to restore.
   */
  const restore = useCallback(() => {
    if (!restorable) return null;
    setRestorable(null);
    setRecord({
      key: serializeDraft(restorable.state),
      savedAt: restorable.savedAt,
      reason: null,
    });
    return restorable.state;
  }, [restorable]);

  /** Deletes the earlier device draft and resumes autosave for the current content. */
  const discardRestorable = useCallback(() => {
    if (!restorable) return;
    if (scope) clearLocalDraft(scope.userId, scope.workspaceId);
    setRestorable(null);
    setRecord(NOTHING_WRITTEN);
  }, [restorable, scope]);

  /** Removes the device draft (Discard). Pair it with composerActions.reset(). */
  const clear = useCallback(() => {
    if (scope) clearLocalDraft(scope.userId, scope.workspaceId);
    // If the composer unmounts before rendering again (discard, then navigate away), the
    // unmount flush must not write the discarded content back.
    if (latest.current) latest.current = { ...latest.current, active: false };
    setRestorable(null);
    setRecord(NOTHING_WRITTEN);
  }, [scope]);

  let status;
  if (!scope) status = 'idle';
  else if (!available || record.reason === 'unavailable') status = 'unavailable';
  else if (paused) status = 'paused';
  else if (changed) status = contentful ? 'pending' : 'idle';
  else if (record.reason) status = 'error';
  else status = record.savedAt ? 'saved' : 'idle';

  return {
    status,
    savedAt: record.savedAt,
    reason: scope && !available ? 'unavailable' : record.reason,
    available,
    restorable,
    restore,
    discardRestorable,
    clear,
    flush,
  };
}
