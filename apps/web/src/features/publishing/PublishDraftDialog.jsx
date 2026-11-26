import { PUBLISHING_LIMITS, composeCaption } from '@socialhub/shared';
import { FileText } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useSocialAccounts } from '../../lib/queries.js';
import { cn, timeAgo } from '../../lib/utils.js';
import { useNow } from '../composer/hooks/useNow.js';
import { CaptionPreview } from './JobList.jsx';
import { PostPreview } from './PostPreview.jsx';
import { PlatformIcon } from './PublishingBadges.jsx';
import { RealPostConfirmation } from './RealPostConfirmation.jsx';
import { WhenPicker } from './ScheduleFields.jsx';
import { accountCountText, errorMessages, mediaCountText, platformLabel } from './labels.js';
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

/** The selected draft's files, in the shape PostPreview shows. */
const previewMedia = (draft) =>
  (draft?.media ?? []).map((entry, index) => ({
    id: entry.mediaId ?? entry.id ?? String(index),
    kind: entry.media?.kind ?? 'IMAGE',
    previewUrl: entry.media?.thumbnailUrl ?? entry.media?.url ?? null,
    posterUrl: null,
    altText: entry.altText,
    fileName: entry.media?.fileName,
  }));

/** Who gets the selected draft: its saved accounts, with names once they are loaded. */
function DraftAccounts({ accounts, missing, loading, failed, onRetry }) {
  return (
    <section aria-label="Accounts">
      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Sending to</h3>
      {loading ? (
        <Spinner label="Loading the accounts" />
      ) : failed ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          The accounts of this draft could not be loaded.{' '}
          <button type="button" className="font-medium underline" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-white/10"
            >
              <PlatformIcon platform={account.platform} className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                {account.name}
              </span>
              <span className="hidden shrink-0 text-xs text-muted sm:inline">
                {platformLabel(account.platform)}
              </span>
            </li>
          ))}
          {missing > 0 && (
            <li className="text-xs text-amber-800 dark:text-amber-200">
              {missing === 1 ? '1 account' : `${missing} accounts`} of this draft could not be
              found.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * Pick a saved draft and send it to the accounts saved on it, now or at a scheduled time.
 * Mounted only while open, so every opening starts clean. One idempotency key per distinct
 * request (draft + time + republish), reused for every click and retry of that request, so
 * the server can never create two jobs for one decision.
 *
 * Unless the workspace is known to be in simulation, the post would be REAL: the dialog then
 * shows the selected draft's accounts, files and exact caption, and the person must tick
 * "This creates a REAL public post" for that draft before anything is sent. The request then
 * carries `confirmRealPost: true`; the server refuses a real post without it.
 */
export function PublishDraftDialog({ workspaceId, onClose, simulatedMode, workspaceTimeZone }) {
  const drafts = usePublishableDrafts(workspaceId);
  const create = useCreatePublishJob(workspaceId);
  const accountsQuery = useSocialAccounts(workspaceId);
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

  // Real unless the workspace is known to be in simulation (also while its mode is unknown).
  const real = !simulatedMode;
  const selected = items.find((draft) => draft.id === selection?.draftId) ?? null;
  const byId = new Map((accountsQuery.data ?? []).map((account) => [account.id, account]));
  const targetIds = selected?.targetAccountIds ?? [];
  const targets = targetIds.map((id) => byId.get(id)).filter(Boolean);
  const accountsLoaded = Boolean(accountsQuery.data);
  const missingTargets = accountsLoaded ? targetIds.length - targets.length : 0;
  // The exact text each platform receives, computed by the server's own function.
  const captions = selected
    ? [...new Set(targets.map((account) => account.platform))].map((platform) => ({
        platform,
        text: composeCaption(selected, platform),
      }))
    : [];
  // A real post is only confirmed once everything it goes to is on screen.
  const previewComplete =
    Boolean(selected) && accountsLoaded && targets.length > 0 && missingTargets === 0;

  // The confirmation belongs to one draft, workspace and mode: it is cleared when any of them
  // changes, and every opening of the dialog starts without it.
  const confirmationFor = { draftId: selection?.draftId ?? null, workspaceId, real };
  const [confirmation, setConfirmation] = useState({ confirmed: false, ...confirmationFor });
  if (
    confirmation.draftId !== confirmationFor.draftId ||
    confirmation.workspaceId !== workspaceId ||
    confirmation.real !== real
  ) {
    setConfirmation({ confirmed: false, ...confirmationFor });
  }
  const confirmedReal =
    real &&
    confirmation.confirmed &&
    confirmation.draftId === confirmationFor.draftId &&
    confirmation.workspaceId === workspaceId;
  const confirmationMissing = real && (!confirmedReal || !previewComplete);

  const select = (draft) => {
    if (selection?.draftId === draft.id || create.isPending) return;
    create.reset();
    setSelection({ draftId: draft.id });
  };

  const submit = (republish = false) => {
    // The ref closes the gap before React has disabled the button after the first click.
    if (!selection || sending.current) return;
    // No one-click real post: the person has to confirm it for this draft first.
    if (confirmationMissing) return;
    if (resolved?.error) {
      setScheduleTouched(true);
      return;
    }
    const scheduledAt = resolved?.instant.toISOString();
    const request = { contentPackageId: selection.draftId, scheduledAt, republish };
    sending.current = true;
    create.mutate(
      // The confirmation stays outside `request`, so the idempotency key does not depend on it.
      { ...request, idempotencyKey: keyFor(request), confirmRealPost: confirmedReal },
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
          : 'Real publishing: the draft you choose will be published to the real Facebook Pages and Instagram accounts selected in it.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {alreadyPublished ? (
            <Button
              variant="danger"
              loading={create.isPending}
              disabled={confirmationMissing}
              onClick={() => submit(true)}
            >
              Publish again anyway
            </Button>
          ) : (
            <Button
              disabled={
                !selection || confirmationMissing || Boolean(scheduleTouched && resolved?.error)
              }
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
          {selected && (
            <>
              <DraftAccounts
                accounts={targets}
                missing={missingTargets}
                loading={accountsQuery.isPending}
                failed={!accountsLoaded && Boolean(accountsQuery.error)}
                onRetry={() => accountsQuery.refetch()}
              />
              <PostPreview
                media={previewMedia(selected)}
                captions={
                  captions.length
                    ? captions
                    : [{ platform: 'ALL', text: composeCaption(selected, null) }]
                }
              />
            </>
          )}
          {selected && real && previewComplete && (
            <RealPostConfirmation
              accountNames={targets.map((account) => account.name)}
              scheduled={when === 'schedule'}
              checked={confirmedReal}
              disabled={create.isPending}
              onChange={(confirmed) => setConfirmation({ confirmed, ...confirmationFor })}
            />
          )}
          {selected && real && !previewComplete && !accountsQuery.isPending && (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              This draft cannot be published for real until all of its accounts are shown above.
            </p>
          )}
          {error && (
            <Callout tone="danger" role="alert">
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
            </Callout>
          )}
        </div>
      )}
    </Modal>
  );
}
