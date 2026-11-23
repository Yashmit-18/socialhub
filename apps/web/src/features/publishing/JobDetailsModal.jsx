import { CalendarClock, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { timeAgo } from '../../lib/utils.js';
import { CaptionPreview, ScheduledTime } from './JobList.jsx';
import {
  DestinationStateBadge,
  JobStatusBadge,
  PlatformIcon,
  SimulatedBadge,
} from './PublishingBadges.jsx';
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
  usePublishJob,
  useRetryDestination,
} from './usePublishing.js';

function Fact({ label, children }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
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

function DestinationCard({ destination, jobSimulated, canAct, busy, onRetry, onCancel, timeZone }) {
  const simulated = jobSimulated || destination.simulated;
  const published = destination.state === 'PUBLISHED';
  const postUrl = simulated ? null : safeExternalUrl(destination.externalUrl);
  const postId = simulated ? null : destination.externalPostId;
  const { error } = destination;
  const showRetry = canAct && destination.canRetry;
  const showCancel = canAct && destination.canCancel;

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

      <dl className="mt-3 space-y-1 text-xs">
        {destination.attemptCount > 0 && (
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
      </dl>

      {simulated && published && (
        <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">
          {SIMULATED_NOTICE}
        </p>
      )}

      {postUrl && (
        <a
          href={postUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
        >
          View post <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
          <p className="break-words">{error.message}</p>
          {error.uncertain && (
            <p className="mt-1 text-xs">
              We could not confirm whether this post went out. Please check the account before
              trying again.
            </p>
          )}
          {error.code && <p className="mt-1 text-[11px] text-muted">Code: {error.code}</p>}
        </div>
      )}

      {destination.warnings?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
          {destination.warnings.map((code) => (
            <li key={code}>Note: {warningText(code)}</li>
          ))}
        </ul>
      )}

      <AttemptHistory attempts={destination.attempts} simulated={simulated} />

      {(showRetry || showCancel) && (
        <div className="mt-3 flex flex-wrap gap-2">
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

  const closeConfirm = () => {
    setConfirm(null);
    retry.reset();
    cancelJob.reset();
  };

  const sendRetry = (destination, acknowledgeDuplicateRisk) =>
    retry.mutate(
      { jobId, destinationId: destination.id, acknowledgeDuplicateRisk },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(`Trying ${destination.accountName} again`);
        },
        onError: (err) => {
          if (acknowledgeDuplicateRisk) return; // shown inside the confirmation dialog
          // The server knows best: it can ask for the confirmation even if the list did not.
          if (err.status === 409 && err.details?.reason === 'DUPLICATE_RISK') {
            retry.reset();
            setConfirm({ type: 'retry', destination });
          } else {
            toast.error(err.message);
          }
        },
      },
    );

  const onRetry = (destination) => {
    if (destination.error?.uncertain) setConfirm({ type: 'retry', destination });
    else sendRetry(destination, false);
  };

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
        open={Boolean(job) && !confirm}
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
        title="This post may already be published"
        confirmLabel="Retry anyway"
        loading={retry.isPending}
        error={retry.error}
        onConfirm={() => sendRetry(confirm.destination, true)}
        onClose={closeConfirm}
      >
        <p className="text-sm text-muted">
          We could not confirm what happened the last time we sent this post to{' '}
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {confirm?.destination?.accountName}
          </span>
          . It may already be on the account, so trying again could post it twice. Check the account
          first if you can.
        </p>
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
    </>
  );
}
