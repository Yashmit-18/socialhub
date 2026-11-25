import { PUBLISHING_LIMITS, PUBLISHING_MODES } from '@socialhub/shared';
import { CircleX, FlaskConical, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useNow } from '../composer/hooks/useNow.js';
import { PostPreview } from './PostPreview.jsx';
import { PlatformIcon } from './PublishingBadges.jsx';
import { RealPostConfirmation } from './RealPostConfirmation.jsx';
import { WhenPicker } from './ScheduleFields.jsx';
import { Notice, StatusBanner } from './StatusBanner.jsx';
import { createdMessage, errorMessages, platformLabel, statusNotices } from './labels.js';
import { defaultTimeZone, resolveSchedule, suggestedSchedule } from './schedule.js';
import { useIdempotencyKeys } from './useIdempotencyKeys.js';
import { useCreatePublishJob, usePublishingStatus } from './usePublishing.js';

function ProblemList({ title, items, tone }) {
  if (!items.length) return null;
  const Icon = tone === 'danger' ? CircleX : TriangleAlert;
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={
        tone === 'danger'
          ? 'rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
          : 'rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100'
      }
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The composer's "Publish" step: who gets the post, when, and what stands in the way.
 *
 *  - `accounts`: the selected accounts (normalized), sent as `socialAccountIds`.
 *  - `errors` / `warnings`: readiness messages from the composer's validation (Meta's rules
 *    for each platform). Errors block; the server checks the same rules again.
 *  - `blockers`: other reasons the post cannot go yet (files still uploading, …).
 *  - `mediaCount`: attached files. In real (LIVE) mode Meta must download them over public
 *    HTTPS, which local storage cannot offer, so they block; the server refuses them too.
 *  - `prepare()`: saves the draft so the server publishes exactly what is on screen, and
 *    resolves to its id.
 *
 * Mounted only while open. Nothing is shown as sent before the server has answered, and a
 * simulated job is never described as published.
 */
export function ComposerPublishDialog({
  workspaceId,
  workspaceTimeZone,
  accounts,
  errors = [],
  warnings = [],
  blockers = [],
  hasFirstComment = false,
  hashtagsInFirstComment = false,
  mediaCount = 0,
  media = [],
  captions = [],
  prepare,
  onClose,
  onCreated,
}) {
  const status = usePublishingStatus(workspaceId);
  const create = useCreatePublishJob(workspaceId);
  const keyFor = useIdempotencyKeys();
  const now = useNow(30_000);
  const [when, setWhen] = useState('now');
  const [schedule, setSchedule] = useState(() =>
    suggestedSchedule(defaultTimeZone(workspaceTimeZone)),
  );
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [step, setStep] = useState('idle'); // idle | saving | sending
  const [prepareError, setPrepareError] = useState(null);
  const busy = useRef(false);

  const mode = status.data?.mode;
  const simulated = mode === PUBLISHING_MODES.SIMULATED;
  // Real publishing needs one more deliberate step: the person confirms, in this dialog, that a
  // real public post is created on the accounts listed. The confirmation belongs to what it was
  // given for: the workspace, the mode, the accounts, the files and the captions. It is cleared
  // when any of them changes (also when the mode goes to simulation and back), and the dialog
  // starts unconfirmed on every opening.
  const live = mode === PUBLISHING_MODES.LIVE;
  const subject = JSON.stringify([
    accounts.map((account) => account.id),
    media.map((item) => item.id),
    captions.map((caption) => [caption.platform, caption.text]),
  ]);
  const [confirmation, setConfirmation] = useState({
    confirmed: false,
    workspaceId,
    mode,
    subject,
  });
  const stale =
    confirmation.workspaceId !== workspaceId ||
    confirmation.mode !== mode ||
    confirmation.subject !== subject;
  if (stale) setConfirmation({ confirmed: false, workspaceId, mode, subject });
  const confirmedLive = live && confirmation.confirmed && !stale;
  const resolved = when === 'schedule' ? resolveSchedule(schedule, new Date(now)) : null;
  const notReady = accounts.filter((account) => !account.publishable);
  const serverBlocks = !status.data?.canPublish;
  // Real publishing needs files Meta can download over HTTPS.
  const needsPublicMedia =
    mode === PUBLISHING_MODES.LIVE && mediaCount > 0 && status.data?.storage?.publicUrls === false;
  const blocking = [
    ...(accounts.length === 0 ? ['Choose at least one account.'] : []),
    // The server refuses more; checked here so nothing is saved or sent first.
    ...(accounts.length > PUBLISHING_LIMITS.DESTINATIONS_MAX
      ? [
          `A post can go to at most ${PUBLISHING_LIMITS.DESTINATIONS_MAX} accounts at once. ${accounts.length} are selected.`,
        ]
      : []),
    ...errors,
    ...blockers,
    ...(needsPublicMedia
      ? [
          'The files are stored where Facebook and Instagram cannot fetch them. Real publishing needs media storage that is reachable from the internet over HTTPS.',
        ]
      : []),
  ];
  const conflict = create.error?.status === 409 ? create.error : null;
  const alreadyPublished = conflict?.details?.reason === 'ALREADY_PUBLISHED';
  const conflictAccounts = conflict?.details?.accounts ?? [];
  const canSubmit =
    !status.isPending &&
    !serverBlocks &&
    blocking.length === 0 &&
    step === 'idle' &&
    (!live || confirmedLive);

  const submit = async (republish = false) => {
    if (busy.current || !canSubmit) return;
    if (resolved?.error) {
      setScheduleTouched(true);
      return;
    }
    busy.current = true;
    setPrepareError(null);
    create.reset();
    try {
      setStep('saving');
      let contentPackageId;
      try {
        contentPackageId = await prepare();
      } catch (err) {
        setPrepareError(err);
        return;
      }
      setStep('sending');
      const scheduledAt = resolved?.instant.toISOString();
      const request = {
        contentPackageId,
        socialAccountIds: accounts.map((account) => account.id),
        scheduledAt,
        republish,
      };
      try {
        const { publishJob, created } = await create.mutateAsync({
          ...request,
          // Outside `request`: the key stays the same whether or not the post is confirmed.
          idempotencyKey: keyFor(request),
          // Only when the person ticked "This creates a REAL public post". The server refuses
          // a real post without it, also when this screen still believed it was simulated.
          confirmRealPost: confirmedLive,
        });
        const message = createdMessage({
          simulated: publishJob?.simulated ?? simulated,
          scheduledAt,
          timeZone: schedule.timeZone,
          created,
        });
        if (created === false) toast.info(message.title);
        else toast.success(message.title, { description: message.description });
        onCreated?.(publishJob);
      } catch {
        // Shown in the dialog from create.error.
      }
    } finally {
      busy.current = false;
      setStep('idle');
    }
  };

  const confirmLabel =
    when === 'schedule'
      ? simulated
        ? 'Schedule simulation'
        : 'Schedule post'
      : simulated
        ? 'Start simulation'
        : 'Publish now';

  return (
    <Modal
      open
      onClose={step === 'idle' ? onClose : undefined}
      dismissible={step === 'idle'}
      size="lg"
      title={simulated ? 'Publish (simulation)' : 'Publish post'}
      description={`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} selected`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={step !== 'idle'}>
            Close
          </Button>
          {alreadyPublished ? (
            <Button
              variant="danger"
              loading={step !== 'idle'}
              disabled={!canSubmit}
              onClick={() => submit(true)}
            >
              Publish again anyway
            </Button>
          ) : (
            <Button
              loading={step !== 'idle'}
              disabled={!canSubmit || Boolean(scheduleTouched && resolved?.error)}
              onClick={() => submit(false)}
            >
              {step === 'saving' ? 'Saving draft…' : step === 'sending' ? 'Sending…' : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {status.isPending ? (
          <div className="flex justify-center py-2">
            <Spinner label="Checking whether publishing is available" />
          </div>
        ) : status.error ? (
          <Notice
            tone="warning"
            title="We could not check whether publishing is available."
            text="Try again in a moment."
          />
        ) : (
          <>
            {simulated && (
              <Notice
                tone="info"
                icon={FlaskConical}
                title="Simulation mode: nothing will be posted to Facebook or Instagram."
                text="The post goes through the real queue and worker, and each account gets a simulated result. No post is created on Meta and no post ID is shown."
              />
            )}
            <StatusBanner
              notices={statusNotices(status.data).filter((notice) => notice.key !== 'simulated')}
            />
          </>
        )}

        <PostPreview media={media} captions={captions} />

        <section aria-label="Accounts">
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Sending to</h3>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts selected.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
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
                  {!account.publishable && (
                    <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Needs attention
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notReady.length > 0 && (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Accounts that need attention cannot receive posts until they are reconnected or fixed
              on the Social accounts page.
            </p>
          )}
        </section>

        <WhenPicker
          mode={when}
          onModeChange={(next) => {
            setWhen(next);
            create.reset();
          }}
          schedule={schedule}
          onScheduleChange={(next) => {
            setSchedule(next);
            create.reset();
          }}
          scheduleError={scheduleTouched ? resolved?.error : null}
          now={new Date(now)}
          disabled={step !== 'idle'}
          workspaceTimeZone={workspaceTimeZone}
          simulated={simulated}
        />

        {live && accounts.length > 0 && (
          <RealPostConfirmation
            accountNames={accounts.map((account) => account.name)}
            scheduled={when === 'schedule'}
            checked={confirmedLive}
            disabled={step !== 'idle'}
            onChange={(confirmed) => setConfirmation({ confirmed, workspaceId, mode, subject })}
          />
        )}

        <ProblemList title="Fix these before publishing" items={blocking} tone="danger" />
        <ProblemList
          title="Worth checking"
          items={[
            ...warnings,
            ...(hasFirstComment
              ? ['The first comment is saved with the draft but is not sent with the post yet.']
              : []),
            // Even without comment text: the hashtags would go in that (unsent) comment.
            ...(hashtagsInFirstComment
              ? [
                  'The hashtags are set to go in the first comment, which is not sent yet, so they will not be posted. Put them in the caption to include them.',
                ]
              : []),
          ]}
          tone="warning"
        />

        {prepareError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <p className="font-semibold">The draft could not be saved, so nothing was sent.</p>
            <p className="mt-0.5 break-words">{prepareError.message}</p>
          </div>
        )}
        {create.error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            {errorMessages(create.error).map((message) => (
              <p key={message} className="break-words">
                {message}
              </p>
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
    </Modal>
  );
}
