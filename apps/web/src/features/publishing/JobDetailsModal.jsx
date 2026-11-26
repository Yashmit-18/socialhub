import { PUBLISHING_MODES } from '@socialhub/shared';
import { CalendarClock, ExternalLink, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { buttonClass } from '../../components/ui/buttonClass.js';
import { Callout } from '../../components/ui/Callout.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { FormError, Textarea } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { timeAgo } from '../../lib/utils.js';
import { ShareInGroupsButton } from '../groups/ShareInGroupsButton.jsx';
import { CaptionPreview, ScheduledTime } from './JobList.jsx';
import {
  DestinationStateBadge,
  JobStatusBadge,
  PlatformIcon,
  SimulatedBadge,
} from './PublishingBadges.jsx';
import { RealPostConfirmation } from './RealPostConfirmation.jsx';
import { Notice } from './StatusBanner.jsx';
import {
  SIMULATED_NOTICE,
  SIMULATED_PENDING_NOTICE,
  attemptOutcomeLabel,
  dateWithRelative,
  formatDateTime,
  hiddenAccountsText,
  mediaCountText,
  platformLabel,
  safeExternalUrl,
  warningText,
} from './labels.js';
import {
  isActiveJob,
  useCancelDestination,
  useCancelJob,
  useDeletePublishedPost,
  useEditPublishedPost,
  usePublishJob,
  useRetryDestination,
} from './usePublishing.js';

/** The explicit "this changes the real post" checkbox of the edit and delete dialogs. */
function RealChangeConfirmation({ text, checked, disabled, onChange }) {
  return (
    <label className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{text}</span>
    </label>
  );
}

/** Change the text of a real, published Facebook post on Facebook. */
function EditPostDialog({ state, setState, mutation, onSave, onClose }) {
  const original = state?.destination?.postText ?? '';
  const text = state?.text ?? '';
  const unchanged = text.trim() === original.trim();
  const canSave = Boolean(state?.confirmed) && Boolean(text.trim()) && !unchanged;
  return (
    <Modal
      open={Boolean(state)}
      onClose={mutation.isPending ? undefined : onClose}
      size="lg"
      title="Edit the post on Facebook"
      description={state ? `${state.destination.accountName} · Facebook Page` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!canSave}
            onClick={canSave ? onSave : undefined}
          >
            Save on Facebook
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          label="New text"
          inputClassName="min-h-40"
          value={text}
          disabled={mutation.isPending}
          onChange={(event) => setState((current) => ({ ...current, text: event.target.value }))}
        />
        <p className="text-xs text-muted">
          Only the text changes. Images and videos stay as they are. Facebook may show that the post
          was edited.
        </p>
        <RealChangeConfirmation
          text="I understand that this changes the real public post on Facebook."
          checked={Boolean(state?.confirmed)}
          disabled={mutation.isPending}
          onChange={(confirmed) => setState((current) => ({ ...current, confirmed }))}
        />
        {mutation.error && <FormError message={mutation.error.message} />}
      </div>
    </Modal>
  );
}

/** One label and value of the facts list; the list's grid lines the values up. */
function Fact({ label, children }) {
  return (
    <div className="contents">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-800 dark:text-slate-100">
        {children}
      </dd>
    </div>
  );
}

function AttemptHistory({ attempts, simulated }) {
  if (!attempts?.length) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Attempt history</h4>
      <ol className="mt-1.5 space-y-1.5 text-xs text-muted">
        {attempts.map((attempt) => (
          <li key={attempt.number} className="break-words">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Attempt {attempt.number}: {attemptOutcomeLabel(attempt.outcome, simulated)}
            </span>
            {(attempt.finishedAt ?? attempt.startedAt) && (
              <> · {formatDateTime(attempt.finishedAt ?? attempt.startedAt)}</>
            )}
            {attempt.errorMessage && <span className="block">{attempt.errorMessage}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DestinationCard({
  destination,
  jobSimulated,
  canAct,
  busy,
  onRetry,
  onCancel,
  onEditPost,
  onDeletePost,
  timeZone,
}) {
  const simulated = jobSimulated || destination.simulated;
  const published = destination.state === 'PUBLISHED';
  const deleted = Boolean(destination.postDeletedAt);
  const postUrl = simulated || deleted ? null : safeExternalUrl(destination.externalUrl);
  const postId = simulated ? null : destination.externalPostId;
  const { error } = destination;
  const showRetry = canAct && destination.canRetry;
  const showCancel = canAct && destination.canCancel;
  const showEdit = canAct && destination.canEditPost;
  const showDelete = canAct && destination.canDeletePost;
  const hasActions = showRetry || showCancel || showEdit || showDelete;
  // "Attempt 1 of 4" on a post that went out first time reads like a problem: leave it out.
  const showTries = destination.attemptCount > 0 && (destination.attemptCount > 1 || !published);

  return (
    <li className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5">
            <PlatformIcon platform={destination.platform} />
          </span>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold text-slate-900 dark:text-white">
              {destination.accountName}
            </h3>
            <p className="text-xs text-muted">
              {platformLabel(destination.platform)}
              {destination.accountUsername && ` · @${destination.accountUsername}`}
            </p>
          </div>
        </div>
        <DestinationStateBadge state={destination.state} simulated={simulated} />
      </div>

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {showTries && (
          <Fact label="Tries:">
            Attempt {destination.attemptCount} of {destination.maxAttempts}
          </Fact>
        )}
        {destination.state === 'RETRY_SCHEDULED' && destination.nextAttemptAt && (
          <Fact label="Next try:">{dateWithRelative(destination.nextAttemptAt)}</Fact>
        )}
        {destination.scheduledAt && (
          <Fact label="Scheduled for:">
            <ScheduledTime value={destination.scheduledAt} timeZone={timeZone} />
          </Fact>
        )}
        {published && destination.completedAt && (
          <Fact label={simulated ? 'Simulated on:' : 'Published on:'}>
            {formatDateTime(destination.completedAt)}
          </Fact>
        )}
        {postId && <Fact label="Post ID:">{postId}</Fact>}
        {!simulated && destination.postEditedAt && (
          <Fact label="Text changed on Facebook:">{formatDateTime(destination.postEditedAt)}</Fact>
        )}
        {!simulated && deleted && (
          <Fact label="Deleted from Facebook:">{formatDateTime(destination.postDeletedAt)}</Fact>
        )}
      </dl>

      {simulated && published && (
        <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">
          {SIMULATED_NOTICE}
        </p>
      )}

      {error && (
        <Callout tone="danger" className="mt-3">
          <p className="break-words">{error.message}</p>
          {error.uncertain && (
            <p className="mt-1 text-xs">
              We could not confirm whether this post went out. Please check the account before
              trying again.
            </p>
          )}
          {error.code && <p className="mt-1 text-[11px] opacity-80">Code: {error.code}</p>}
        </Callout>
      )}

      {destination.warnings?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
          {destination.warnings.map((code) => (
            <li key={code}>Note: {warningText(code)}</li>
          ))}
        </ul>
      )}

      <AttemptHistory attempts={destination.attempts} simulated={simulated} />

      {(postUrl || hasActions) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* What people want right after publishing: a real button, still a link. */}
          {postUrl && (
            <a
              href={postUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              View post
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {showEdit && (
            <Button
              variant="secondary"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => onEditPost(destination)}
              aria-label={`Edit the post on ${destination.accountName}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit text
            </Button>
          )}
          {showDelete && (
            <Button
              variant="danger-outline"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => onDeletePost(destination)}
              aria-label={`Delete the post on ${destination.accountName} from Facebook`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete from Facebook
            </Button>
          )}
          {showRetry && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy === 'retry'}
              disabled={Boolean(busy)}
              onClick={() => onRetry(destination)}
              aria-label={`Retry for ${destination.accountName}`}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          )}
          {showCancel && (
            <Button
              variant="danger-outline"
              size="sm"
              loading={busy === 'cancel'}
              disabled={Boolean(busy)}
              onClick={() => onCancel(destination)}
              aria-label={`Cancel for ${destination.accountName}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Everything about one job: each account with its own result, and the actions the server says
 * are possible (`canRetry` / `canCancel`). `canAct` is false for members who cannot publish.
 */
export function JobDetailsModal({
  workspaceId,
  job: listed,
  onClose,
  canAct,
  onReschedule,
  timeZone,
  footerExtra,
}) {
  const jobId = listed?.id;
  const query = usePublishJob(workspaceId, jobId, { initial: listed });
  const job = query.data ?? listed;
  const [confirm, setConfirm] = useState(null);

  const retry = useRetryDestination(workspaceId);
  const cancelDestination = useCancelDestination(workspaceId);
  const cancelJob = useCancelJob(workspaceId);
  const editPost = useEditPublishedPost(workspaceId);
  const deletePost = useDeletePublishedPost(workspaceId);
  // Edit/delete of a published Facebook post: { destination, text?, confirmed }.
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const closePostDialogs = () => {
    setEditing(null);
    setDeleting(null);
    editPost.reset();
    deletePost.reset();
  };
  const onEditPost = (destination) => {
    editPost.reset();
    setEditing({ destination, text: destination.postText ?? '', confirmed: false });
  };
  const onDeletePost = (destination) => {
    deletePost.reset();
    setDeleting({ destination, confirmed: false });
  };
  const saveEdit = () =>
    editPost.mutate(
      {
        jobId,
        destinationId: editing.destination.id,
        message: editing.text.trim(),
        confirmRealPost: Boolean(editing.confirmed),
      },
      {
        onSuccess: () => {
          toast.success(`The post on ${editing.destination.accountName} was changed on Facebook`);
          closePostDialogs();
        },
      },
    );
  const confirmDelete = () =>
    deletePost.mutate(
      {
        jobId,
        destinationId: deleting.destination.id,
        confirmRealPost: Boolean(deleting.confirmed),
      },
      {
        onSuccess: () => {
          toast.success(
            `The post on ${deleting.destination.accountName} was deleted from Facebook`,
          );
          closePostDialogs();
        },
      },
    );

  const closeConfirm = () => {
    setConfirm(null);
    retry.reset();
    cancelJob.reset();
  };

  // A real post sent again is a real public post again: the person confirms it in a dialog.
  const realJob = job?.mode === PUBLISHING_MODES.LIVE || job?.simulated === false;

  const sendRetry = (destination, { acknowledgeDuplicateRisk = false, confirmRealPost } = {}) =>
    retry.mutate(
      { jobId, destinationId: destination.id, acknowledgeDuplicateRisk, confirmRealPost },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(`Trying ${destination.accountName} again`);
        },
        onError: (err) => {
          // The server knows best: it can ask for a confirmation the screen did not ask for yet.
          // The dialog then asks that question too (it keeps what was already confirmed).
          const duplicateRisk = err.status === 409 && err.details?.reason === 'DUPLICATE_RISK';
          const needsReal = err.code === 'REAL_POST_CONFIRMATION_REQUIRED';
          if ((duplicateRisk && !confirm?.uncertain) || (needsReal && !confirm?.real)) {
            retry.reset();
            setConfirm((current) => ({
              type: 'retry',
              destination,
              uncertain: Boolean(current?.uncertain) || duplicateRisk,
              real: Boolean(current?.real) || needsReal || realJob,
              confirmed: Boolean(current?.confirmed),
            }));
          } else if (!confirm) {
            toast.error(err.message);
          }
          // Otherwise the error is shown inside the confirmation dialog.
        },
      },
    );

  const onRetry = (destination) => {
    const uncertain = Boolean(destination.error?.uncertain);
    if (uncertain || realJob) {
      setConfirm({ type: 'retry', destination, uncertain, real: realJob, confirmed: false });
    } else {
      sendRetry(destination);
    }
  };
  const retryConfirmMissing = Boolean(confirm?.real && !confirm?.confirmed);

  const onCancelDestination = (destination) =>
    cancelDestination.mutate(
      { jobId, destinationId: destination.id },
      {
        onSuccess: () => toast.success(`Cancelled for ${destination.accountName}`),
        onError: (err) => toast.error(err.message),
      },
    );

  const onCancelJob = () =>
    cancelJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success('Everything that was still waiting has been cancelled');
        },
      },
    );

  const busyFor = (destination) => {
    if (retry.isPending && retry.variables?.destinationId === destination.id) return 'retry';
    if (
      cancelDestination.isPending &&
      cancelDestination.variables?.destinationId === destination.id
    )
      return 'cancel';
    return null;
  };

  const destinations = job?.destinations ?? [];

  return (
    <>
      <Modal
        open={Boolean(job) && !confirm && !editing && !deleting}
        onClose={onClose}
        size="lg"
        title="Post details"
        description={
          job
            ? `${job.createdBy?.name ? `Created by ${job.createdBy.name}` : 'Created'} ${timeAgo(job.createdAt)}`
            : undefined
        }
        footer={
          <>
            {footerExtra}
            {canAct && <ShareInGroupsButton job={job} />}
            {canAct && job?.canReschedule && onReschedule && (
              <Button variant="secondary" onClick={() => onReschedule(job)}>
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                Change time
              </Button>
            )}
            {canAct && job?.canCancel && (
              <Button variant="danger-outline" onClick={() => setConfirm({ type: 'cancelJob' })}>
                Cancel all waiting
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        {job && (
          <div className="space-y-4">
            {job.simulated && (
              <Notice
                tone="info"
                title="Simulated."
                text={isActiveJob(job) ? SIMULATED_PENDING_NOTICE : SIMULATED_NOTICE}
              />
            )}
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <JobStatusBadge status={job.status} simulated={job.simulated} />
                {job.simulated && <SimulatedBadge />}
                <span className="text-xs text-muted">
                  {mediaCountText(job.content?.mediaCount, job.content?.hasVideo)}
                </span>
              </div>
              <CaptionPreview text={job.content?.captionPreview} />
              {job.scheduledAt && (
                <p className="mt-1 text-xs text-muted">
                  {job.status === 'SCHEDULED' ? 'Goes out ' : 'Scheduled for '}
                  <ScheduledTime value={job.scheduledAt} timeZone={timeZone} />
                </p>
              )}
            </div>

            {query.error && (
              <FormError message="We could not refresh this post just now. The details below may be out of date." />
            )}

            <section aria-label="Accounts">
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                Accounts
              </h3>
              <ul className="space-y-3">
                {destinations.map((destination) => (
                  <DestinationCard
                    key={destination.id}
                    destination={destination}
                    jobSimulated={job.simulated}
                    canAct={canAct}
                    busy={busyFor(destination)}
                    onRetry={onRetry}
                    onCancel={onCancelDestination}
                    onEditPost={onEditPost}
                    onDeletePost={onDeletePost}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
              {job.hiddenDestinationCount > 0 && (
                <p className="mt-3 text-xs text-muted">
                  {hiddenAccountsText(job.hiddenDestinationCount)}
                </p>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm?.type === 'retry'}
        title={
          confirm?.uncertain ? 'This post may already be published' : 'Publish this post again?'
        }
        confirmLabel={confirm?.uncertain ? 'Retry anyway' : 'Retry'}
        loading={retry.isPending}
        error={retry.error}
        confirmDisabled={retryConfirmMissing}
        onConfirm={() =>
          sendRetry(confirm.destination, {
            acknowledgeDuplicateRisk: Boolean(confirm.uncertain),
            confirmRealPost: Boolean(confirm.real && confirm.confirmed),
          })
        }
        onClose={closeConfirm}
      >
        <div className="space-y-3">
          {confirm?.uncertain && (
            <p className="text-sm text-muted">
              We could not confirm what happened the last time we sent this post to{' '}
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {confirm?.destination?.accountName}
              </span>
              . It may already be on the account, so trying again could post it twice. Check the
              account first if you can.
            </p>
          )}
          {confirm?.real && (
            <RealPostConfirmation
              accountNames={[confirm.destination.accountName]}
              scheduled={false}
              checked={Boolean(confirm.confirmed)}
              disabled={retry.isPending}
              onChange={(confirmed) => setConfirm((current) => ({ ...current, confirmed }))}
            />
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.type === 'cancelJob'}
        title="Cancel everything that is still waiting?"
        confirmLabel="Yes, cancel them"
        loading={cancelJob.isPending}
        error={cancelJob.error}
        onConfirm={onCancelJob}
        onClose={closeConfirm}
      >
        <p className="text-sm text-muted">
          Accounts that are still waiting will not get this post. Anything already published or
          being sent right now is not affected.
        </p>
      </ConfirmDialog>

      <EditPostDialog
        state={editing}
        setState={setEditing}
        mutation={editPost}
        onSave={saveEdit}
        onClose={closePostDialogs}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this post from Facebook?"
        confirmLabel="Delete from Facebook"
        loading={deletePost.isPending}
        error={deletePost.error}
        confirmDisabled={!deleting?.confirmed}
        onConfirm={confirmDelete}
        onClose={closePostDialogs}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            The post on{' '}
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {deleting?.destination?.accountName}
            </span>{' '}
            is deleted from Facebook for everyone. This cannot be undone. SocialHub keeps this
            record, marked as deleted.
          </p>
          <RealChangeConfirmation
            text="I understand that this deletes the real public post from Facebook."
            checked={Boolean(deleting?.confirmed)}
            disabled={deletePost.isPending}
            onChange={(confirmed) => setDeleting((current) => ({ ...current, confirmed }))}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
