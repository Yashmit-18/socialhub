import { PUBLISHING_LIMITS } from '@socialhub/shared';
import { FileText } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { cn, timeAgo } from '../../lib/utils.js';
import { useNow } from '../composer/hooks/useNow.js';
import { CaptionPreview } from './JobList.jsx';
import { WhenPicker } from './ScheduleFields.jsx';
import { accountCountText, errorMessages, mediaCountText } from './labels.js';
import { defaultTimeZone, formatInZone, resolveSchedule, suggestedSchedule } from './schedule.js';
import { useIdempotencyKeys } from './useIdempotencyKeys.js';
import { useCreatePublishJob, usePublishableDrafts } from './usePublishing.js';

function DraftOption({ draft, checked, onSelect }) {
  const accounts = draft.targetAccountIds?.length ?? 0;
  const tooMany = accounts > PUBLISHING_LIMITS.DESTINATIONS_MAX;
  const disabled = accounts === 0 || tooMany;
  return (
    <li>
      <label
        className={cn(
          'flex items-start gap-3 rounded-xl border p-3 transition',
          disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
          checked
            ? 'border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10'
            : 'border-slate-200 dark:border-white/10',
        )}
      >
        <input
          type="radio"
          name="publish-draft"
          className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
          checked={checked}
          disabled={disabled}
          onChange={() => onSelect(draft)}
        />
        <span className="min-w-0 flex-1">
          <CaptionPreview text={draft.caption?.trim()} className="line-clamp-2" />
          <span className="mt-1 block text-xs text-muted">
            {mediaCountText(draft.media?.length)} ·{' '}
            {disabled ? (
              <span className="font-medium text-amber-700 dark:text-amber-300">
                {tooMany
                  ? `${accounts} accounts: a post can go to at most ${PUBLISHING_LIMITS.DESTINATIONS_MAX} at once`
                  : 'No accounts selected in this draft'}
              </span>
            ) : (
              accountCountText(accounts)
            )}
            {draft.updatedAt && <> · Saved {timeAgo(draft.updatedAt)}</>}
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * Pick a saved draft and send it to the accounts saved on it, now or at a scheduled time.
 * Mounted only while open, so every opening starts clean. One idempotency key per distinct
 * request (draft + time + republish), reused for every click and retry of that request, so
 * the server can never create two jobs for one decision.
 */
export function PublishDraftDialog({ workspaceId, onClose, simulatedMode, workspaceTimeZone }) {
  const drafts = usePublishableDrafts(workspaceId);
  const create = useCreatePublishJob(workspaceId);
  const [selection, setSelection] = useState(null); // { draftId }
  const [when, setWhen] = useState('now');
  const [schedule, setSchedule] = useState(() =>
    suggestedSchedule(defaultTimeZone(workspaceTimeZone)),
  );
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const now = useNow(30_000);
  const keyFor = useIdempotencyKeys();
  const sending = useRef(false);
  const resolved = when === 'schedule' ? resolveSchedule(schedule, new Date(now)) : null;

  const items = drafts.data?.items ?? [];
  const error = create.error;
  const alreadyPublished = error?.status === 409 && error.details?.reason === 'ALREADY_PUBLISHED';
  const conflictAccounts = error?.status === 409 ? (error.details?.accounts ?? []) : [];

  const select = (draft) => {
    if (selection?.draftId === draft.id || create.isPending) return;
    create.reset();
    setSelection({ draftId: draft.id });
  };

  const submit = (republish = false) => {
    // The ref closes the gap before React has disabled the button after the first click.
    if (!selection || sending.current) return;
    if (resolved?.error) {
      setScheduleTouched(true);
      return;
    }
    const scheduledAt = resolved?.instant.toISOString();
    const request = { contentPackageId: selection.draftId, scheduledAt, republish };
    sending.current = true;
    create.mutate(
      { ...request, idempotencyKey: keyFor(request) },
      {
        onSuccess: ({ publishJob, created }) => {
          const simulated = publishJob?.simulated ?? simulatedMode;
          if (created === false) toast.info('This post was already sent. Nothing new was created.');
          else if (scheduledAt) {
            toast.success(
              `${simulated ? 'Simulation scheduled' : 'Scheduled'} for ${formatInZone(scheduledAt, schedule.timeZone)}`,
              {
                description: simulated
                  ? 'Nothing will be posted to Facebook or Instagram.'
                  : undefined,
              },
            );
          } else if (simulated) toast.success('Simulation started');
          else toast.success('Sent to the publishing queue');
          onClose();
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const draftsUnavailable = drafts.error?.status === 404 || drafts.error?.status === 503;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Publish a draft"
      description={
        simulatedMode
          ? 'Simulation mode: nothing will be sent to Facebook or Instagram.'
          : 'Choose a saved draft. It will be sent to the accounts selected in the draft.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {alreadyPublished ? (
            <Button variant="danger" loading={create.isPending} onClick={() => submit(true)}>
              Publish again anyway
            </Button>
          ) : (
            <Button
              disabled={!selection || Boolean(scheduleTouched && resolved?.error)}
              loading={create.isPending}
              onClick={() => submit(false)}
            >
              {when === 'schedule'
                ? simulatedMode
                  ? 'Schedule simulation'
                  : 'Schedule'
                : simulatedMode
                  ? 'Start simulation'
                  : 'Publish'}
            </Button>
          )}
        </>
      }
    >
      {drafts.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading drafts" />
        </div>
      ) : drafts.error ? (
        <ErrorState
          title="Saved drafts are not available right now"
          error={
            draftsUnavailable ? { message: 'Please try again in a little while.' } : drafts.error
          }
          onRetry={() => drafts.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No saved drafts"
          description="Drafts are saved from the composer. Write a post there, choose its accounts and save it, then come back here to publish it."
          className="py-8"
        />
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="sr-only">Saved drafts</legend>
            <ul className="space-y-2">
              {items.map((draft) => (
                <DraftOption
                  key={draft.id}
                  draft={draft}
                  checked={selection?.draftId === draft.id}
                  onSelect={select}
                />
              ))}
            </ul>
          </fieldset>
          {drafts.data?.nextCursor && (
            <p className="text-xs text-muted">Showing your 50 most recent drafts.</p>
          )}
          <WhenPicker
            mode={when}
            onModeChange={(mode) => {
              setWhen(mode);
              create.reset();
            }}
            schedule={schedule}
            onScheduleChange={(next) => {
              setSchedule(next);
              create.reset();
            }}
            scheduleError={scheduleTouched ? resolved?.error : null}
            now={new Date(now)}
            workspaceTimeZone={workspaceTimeZone}
            simulated={simulatedMode}
          />
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              {errorMessages(error).map((message) => (
                <p key={message}>{message}</p>
              ))}
              {conflictAccounts.length > 0 && (
                <p className="mt-1 break-words">Accounts: {conflictAccounts.join(', ')}</p>
              )}
              {alreadyPublished && (
                <p className="mt-1">
                  If you publish again, these accounts will get the same post a second time.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
