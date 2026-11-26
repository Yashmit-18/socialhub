import { PUBLISHING_LIMITS, PUBLISHING_MODES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { CircleX, Film, FlaskConical, TriangleAlert, UsersRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useNow } from '../composer/hooks/useNow.js';
import { useAutoShare, useGroupCountsByPage } from '../groups/api.js';
import { autoShareMessage } from '../groups/helpers.js';
import { PostPreview } from './PostPreview.jsx';
import { PlatformIcon } from './PublishingBadges.jsx';
import { RealPostConfirmation } from './RealPostConfirmation.jsx';
import { WhenPicker } from './ScheduleFields.jsx';
import { Notice, StatusBanner } from './StatusBanner.jsx';
import {
  createdMessage,
  errorMessages,
  platformLabel,
  postsCreatedMessage,
  statusNotices,
} from './labels.js';
import { defaultTimeZone, resolveSchedule, suggestedSchedule } from './schedule.js';
import { useIdempotencyKeys } from './useIdempotencyKeys.js';
import { useCreatePublishJob, usePublishingStatus } from './usePublishing.js';
import { separateVideoPosts } from './videoPosts.js';

/** Answers to creating one of several posts that mean that very post is already on its way. */
const ALREADY_ON_ITS_WAY = new Set(['IN_PROGRESS', 'ALREADY_PUBLISHED']);

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
 * "Also share in Facebook Groups": for a real post to Facebook Pages that are members of
 * groups. Facebook does not let apps post in groups, so this only prepares one sharing task per
 * group, created as each Page's post goes live; people post in the groups themselves.
 */
function GroupSharingOption({ pageCount, groupCount, checked, disabled, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-sm has-[:disabled]:cursor-not-allowed dark:border-white/10">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
          <UsersRound className="h-4 w-4 text-[#1877F2]" aria-hidden="true" />
          Also share in Facebook Groups
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {pageCount === 1 ? 'This Page is' : 'These Pages are'} in {groupCount}{' '}
          {groupCount === 1 ? 'group' : 'groups'}. Once the post is live, each matching group gets a
          ready-to-share task under Group sharing: a group matches when one of its tags is in the
          post’s hashtags or keywords, or when it has no tags. Facebook doesn’t let apps post in
          groups, so you post each one yourself.
        </span>
      </span>
    </label>
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
 *  - `videoPosts`: the composer's one-post-per-video helper (composer/hooks/useVideoPosts.js).
 *    With several videos for a Facebook Page (videoPosts.js), each video is published as its
 *    own post: one job per video, created one after the other. A stop part-way through says
 *    how many were created, and publishing again carries on with the rest.
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
  videoPosts = null,
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
  // One post per video (several videos for a Facebook Page): how many, and how many are left.
  const postCount = videoPosts ? separateVideoPosts(accounts, media) : 0;
  const splitting = postCount > 1;
  const postsLeft = splitting && videoPosts.pending > 0 ? videoPosts.pending : postCount;
  const [progress, setProgress] = useState(null); // { done, total } while creating them
  const [stopped, setStopped] = useState(null); // { created, total, label } after a refusal
  const [allSent, setAllSent] = useState(false); // every one was already sent from here

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
  // Group sharing is offered for real posts to Pages that are listed as members of groups.
  const facebookPages = accounts.filter(
    (account) => account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  );
  const groupCounts = useGroupCountsByPage(workspaceId, {
    enabled: live && facebookPages.length > 0,
  });
  // A group several of these Pages are in is counted once per Page here (it gets one task).
  const groupCount = facebookPages.reduce(
    (total, page) => total + (groupCounts.data?.[page.id] ?? 0),
    0,
  );
  const offerGroups = live && groupCount > 0;
  const [shareInGroups, setShareInGroups] = useState(true);
  const autoShare = useAutoShare(workspaceId);
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
  const alreadyPublished = conflict?.details?.reason === 'ALREADY_PUBLISHED' || allSent;
  const conflictAccounts = conflict?.details?.accounts ?? [];
  const canSubmit =
    !status.isPending &&
    !serverBlocks &&
    blocking.length === 0 &&
    step === 'idle' &&
    (!live || confirmedLive);

  /**
   * Sharing tasks for the real Facebook posts just created, when asked for. Not awaited: the
   * posts are on their way whatever happens here. The promise (unlike mutate callbacks) still
   * settles after this dialog has closed.
   */
  const setUpGroupSharing = (jobs) => {
    const real = jobs.filter((job) => job?.id && job.simulated === false);
    if (!offerGroups || !shareInGroups || real.length === 0) return;
    Promise.all(real.map((job) => autoShare.mutateAsync(job.id)))
      .then((results) => {
        const groups = autoShareMessage({
          tasksCreated: results.reduce((sum, result) => sum + (result?.tasksCreated ?? 0), 0),
          pagesWaiting: results.reduce((sum, result) => sum + (result?.pagesWaiting ?? 0), 0),
        });
        toast.success(groups.title, { description: groups.description });
      })
      .catch((err) =>
        toast.error('Group sharing could not be set up', {
          description: `${err?.message ?? 'Please try again.'} You can set it up later from the post’s details.`,
        }),
      );
  };

  /** The post as it is: one job for the draft. */
  const sendPost = async (republish) => {
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
      setUpGroupSharing([publishJob]);
      onCreated?.(publishJob);
    } catch {
      // Shown in the dialog from create.error.
    }
  };

  /**
   * One post per video: one job for each video's draft copy, one after the other. Posts already
   * sent from this composer are skipped (unless `republish`), so after a refusal, publishing
   * again carries on with the rest.
   */
  const sendVideoPosts = async (republish) => {
    setStep('saving');
    let posts;
    try {
      // The team draft keeps every video, as on screen; each post gets a one-video copy.
      await prepare();
      posts = await videoPosts.prepare({ again: republish });
    } catch (err) {
      setPrepareError(err);
      return;
    }
    if (posts.length === 0) {
      setAllSent(true);
      return;
    }
    setStep('sending');
    const scheduledAt = resolved?.instant.toISOString();
    const socialAccountIds = accounts.map((account) => account.id);
    const jobs = [];
    for (const [index, post] of posts.entries()) {
      setProgress({ done: index, total: posts.length });
      const request = {
        contentPackageId: post.contentPackageId,
        socialAccountIds,
        scheduledAt,
        republish,
      };
      try {
        const { publishJob } = await create.mutateAsync({
          ...request,
          idempotencyKey: keyFor(request),
          confirmRealPost: confirmedLive,
        });
        if (publishJob) jobs.push(publishJob);
        videoPosts.markSent(post.key);
      } catch (err) {
        // This very post is already on its way (an earlier answer did not arrive).
        if (err?.status === 409 && ALREADY_ON_ITS_WAY.has(err?.details?.reason)) {
          videoPosts.markSent(post.key);
          create.reset();
          continue;
        }
        // The rest are not sent: the person sees why first (shown from create.error).
        setStopped({ created: index, total: posts.length, label: post.label });
        return;
      }
    }
    const message = postsCreatedMessage({
      simulated: jobs[0]?.simulated ?? simulated,
      scheduledAt,
      timeZone: schedule.timeZone,
      count: posts.length,
    });
    toast.success(message.title, { description: message.description });
    setUpGroupSharing(jobs);
    // Several jobs: the Publishing page lists them; there is no single post to show.
    onCreated?.(null);
  };

  const submit = async (republish = false) => {
    if (busy.current || !canSubmit) return;
    if (resolved?.error) {
      setScheduleTouched(true);
      return;
    }
    busy.current = true;
    setPrepareError(null);
    setStopped(null);
    setAllSent(false);
    create.reset();
    try {
      await (splitting ? sendVideoPosts(republish) : sendPost(republish));
    } finally {
      busy.current = false;
      setStep('idle');
      setProgress(null);
    }
  };

  const postsLabel = `${postsLeft} ${postsLeft === 1 ? 'post' : 'posts'}`;
  const confirmLabel = splitting
    ? when === 'schedule'
      ? simulated
        ? `Schedule ${postsLeft === 1 ? '1 simulation' : `${postsLeft} simulations`}`
        : `Schedule ${postsLabel}`
      : simulated
        ? `Simulate ${postsLabel}`
        : `Publish ${postsLabel}`
    : when === 'schedule'
      ? simulated
        ? 'Schedule simulation'
        : 'Schedule post'
      : simulated
        ? 'Start simulation'
        : 'Publish now';
  const sendingLabel = progress ? `Sending ${progress.done + 1} of ${progress.total}…` : 'Sending…';

  return (
    <Modal
      open
      onClose={step === 'idle' ? onClose : undefined}
      dismissible={step === 'idle'}
      size="lg"
      title={simulated ? 'Publish (simulation)' : 'Publish post'}
      description={`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} selected${
        splitting ? ` · ${postCount} posts, one per video` : ''
      }`}
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
              {step === 'saving'
                ? 'Saving draft…'
                : step === 'sending'
                  ? sendingLabel
                  : confirmLabel}
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

        {splitting && (
          <Notice
            tone="info"
            icon={Film}
            title={`${postCount} videos, so ${postCount} posts.`}
            text="Facebook takes one video per post, so each video is published as its own post, with the same text, on every account below."
          />
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
            setAllSent(false);
          }}
          schedule={schedule}
          onScheduleChange={(next) => {
            setSchedule(next);
            create.reset();
            setAllSent(false);
          }}
          scheduleError={scheduleTouched ? resolved?.error : null}
          now={new Date(now)}
          disabled={step !== 'idle'}
          workspaceTimeZone={workspaceTimeZone}
          simulated={simulated}
        />

        {offerGroups && (
          <GroupSharingOption
            pageCount={facebookPages.length}
            groupCount={groupCount}
            checked={shareInGroups}
            disabled={step !== 'idle'}
            onChange={setShareInGroups}
          />
        )}

        {live && accounts.length > 0 && (
          <RealPostConfirmation
            accountNames={accounts.map((account) => account.name)}
            scheduled={when === 'schedule'}
            postCount={splitting ? postsLeft : 1}
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
        {allSent && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <p>These videos were already sent from here, one post each.</p>
            <p className="mt-1">
              If you publish again, these accounts will get the same posts a second time.
            </p>
          </div>
        )}
        {create.error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            {stopped && (
              <p className="mb-1 font-semibold">
                {stopped.created} of {stopped.total} posts {stopped.created === 1 ? 'was' : 'were'}{' '}
                created. The post for “{stopped.label}” was not, and the rest were not sent:
              </p>
            )}
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
