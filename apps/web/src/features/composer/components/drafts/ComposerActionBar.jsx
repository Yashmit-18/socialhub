import {
  CircleCheck,
  CircleX,
  FolderOpen,
  Lock,
  Save,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog.jsx';
import { cn } from '../../../../lib/utils.js';

export const DEFAULT_PUBLISHING_MESSAGE = "Publishing isn't available yet";
export const DISCARD_POST_DESCRIPTION =
  'Its caption, settings and attached files are removed from the composer and this browser.';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CHIP_TONES = {
  danger:
    'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  warning:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  success:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
};

const CHIP_HOVER = {
  danger: 'hover:bg-rose-100 dark:hover:bg-rose-500/20',
  warning: 'hover:bg-amber-100 dark:hover:bg-amber-500/20',
  success: 'hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
};

/**
 * Readiness summary ("2 errors · 1 warning"; "3 issues" on small screens, where the full
 * wording stays available to screen readers). A button when `onShowIssues` is given.
 */
function IssueChip({ summary, onShowIssues }) {
  if (!summary) return null;
  const errors = Math.max(0, Number(summary.errors) || 0);
  const warnings = Math.max(0, Number(summary.warnings) || 0);
  const total = errors + warnings;
  const tone = errors ? 'danger' : warnings ? 'warning' : 'success';
  const Icon = errors ? CircleX : warnings ? TriangleAlert : CircleCheck;
  const label = total
    ? [errors && plural(errors, 'error'), warnings && plural(warnings, 'warning')]
        .filter(Boolean)
        .join(' · ')
    : 'No problems found';
  const className = cn(
    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
    CHIP_TONES[tone],
  );
  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Readiness check:</span>{' '}
      {total ? (
        <>
          <span className="sm:hidden" aria-hidden="true">
            {plural(total, 'issue')}
          </span>
          <span className="max-sm:sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </>
  );
  if (!onShowIssues) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onShowIssues}
      className={cn(className, 'transition-colors', CHIP_HOVER[tone])}
    >
      {content}
    </button>
  );
}

/**
 * Sticky bottom bar of the composer: save status + readiness summary on the left, Discard /
 * Drafts / Save draft / Publish on the right.
 *
 * Publish is always disabled: the publishing engine does not exist. Its visible explanation
 * (`publishingMessage`) is linked with aria-describedby. Discard asks for confirmation first.
 * Ctrl+S / ⌘S runs `onSaveDraft` (when `canSave` and not `saving`).
 *
 * Place it as the last element of the page content: it spans the main column padding and
 * cancels its bottom padding (AppShell `main` uses px-4 sm:px-6 lg:px-8 py-8).
 */
export function ComposerActionBar({
  status,
  issueSummary,
  onSaveDraft,
  saving = false,
  canSave = true,
  saveLabel = 'Save draft',
  onDiscard,
  discardDisabled = false,
  onOpenDrafts,
  publishingMessage = DEFAULT_PUBLISHING_MESSAGE,
  onShowIssues,
  className,
}) {
  const noteId = useId();
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState(null);

  // Keyboard shortcut. The latest handler lives in a ref so the listener is added once.
  const shortcut = useRef(null);
  useLayoutEffect(() => {
    shortcut.current = onSaveDraft ? { save: onSaveDraft, enabled: canSave && !saving } : null;
  });
  useEffect(() => {
    const onKeyDown = (event) => {
      const current = shortcut.current;
      if (!current || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (String(event.key).toLowerCase() !== 's') return;
      event.preventDefault();
      if (!event.repeat && current.enabled) current.save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeConfirm = useCallback(() => {
    if (discarding) return;
    setConfirming(false);
    setDiscardError(null);
  }, [discarding]);

  const confirmDiscard = async () => {
    setDiscardError(null);
    try {
      const result = onDiscard?.();
      if (result && typeof result.then === 'function') {
        setDiscarding(true);
        await result;
      }
      setConfirming(false);
    } catch (err) {
      setDiscardError(err instanceof Error ? err : new Error('The post could not be discarded.'));
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <section
      aria-label="Post actions"
      className={cn(
        'sticky bottom-0 z-20 -mx-4 mt-8 -mb-8 border-t border-slate-200/80 bg-white/85 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-20px_rgb(15_23_42/0.35)] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-white/10 dark:bg-slate-950/85 dark:shadow-none',
        className,
      )}
    >
      {/* One row when both halves fit; otherwise the actions wrap under the status. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5">
          {status && <div className="flex min-w-0 max-w-full">{status}</div>}
          <IssueChip summary={issueSummary} onShowIssues={onShowIssues} />
        </div>

        <div className="flex w-full max-w-full flex-col gap-1 sm:ml-auto sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <div className="flex items-center gap-1 sm:gap-2">
              {onDiscard && (
                <Button
                  variant="ghost"
                  disabled={discardDisabled}
                  onClick={() => setConfirming(true)}
                  className="max-sm:h-9 max-sm:w-9 max-sm:px-0"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Discard</span>
                </Button>
              )}
              {onOpenDrafts && (
                <Button variant="ghost" onClick={onOpenDrafts} className="max-sm:h-9 max-sm:px-3">
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  Drafts
                </Button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2 sm:ml-0">
              {onSaveDraft && (
                <Button
                  variant="secondary"
                  loading={saving}
                  disabled={!canSave}
                  onClick={() => onSaveDraft()}
                  aria-keyshortcuts="Control+S Meta+S"
                  title="Keyboard shortcut: Ctrl+S (⌘S on Mac)"
                  className="max-sm:h-9 max-sm:px-3"
                >
                  {!saving && <Save className="h-4 w-4" aria-hidden="true" />}
                  <span className="sm:hidden" aria-hidden="true">
                    Save
                  </span>
                  <span className="sr-only sm:not-sr-only">{saveLabel}</span>
                </Button>
              )}
              <Button disabled aria-describedby={noteId} className="max-sm:h-9 max-sm:px-3">
                <Send className="h-4 w-4" aria-hidden="true" />
                Publish
              </Button>
            </div>
          </div>
          <p id={noteId} className="flex items-center justify-end gap-1.5 text-xs text-muted">
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {publishingMessage}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Discard this post?"
        description={DISCARD_POST_DESCRIPTION}
        confirmLabel="Discard post"
        loading={discarding}
        error={discardError}
        onConfirm={confirmDiscard}
        onClose={closeConfirm}
      >
        <p className="text-sm text-muted">This can&apos;t be undone.</p>
      </ConfirmDialog>
    </section>
  );
}
