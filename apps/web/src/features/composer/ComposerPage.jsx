import {
  HASHTAG_PLACEMENTS,
  PERMISSIONS,
  PUBLISHING_MODES,
  ROLE_LABELS,
  composeCaption as composeSharedCaption,
} from '@socialhub/shared';
import {
  ChevronDown,
  Eye,
  FlaskConical,
  Hash,
  Lock,
  MessageCircle,
  PenLine,
  Search,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useSocialAccounts } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { ComposerPublishDialog } from '../publishing/ComposerPublishDialog.jsx';
import { JobDetailsModal } from '../publishing/JobDetailsModal.jsx';
import { usePublishingStatus } from '../publishing/usePublishing.js';
import { AccountSelector } from './components/accounts/AccountSelector.jsx';
import { ComposerActionBar } from './components/drafts/ComposerActionBar.jsx';
import { DraftRestoreBanner } from './components/drafts/DraftRestoreBanner.jsx';
import { DraftsPanel } from './components/drafts/DraftsPanel.jsx';
import { DraftStatus } from './components/drafts/DraftStatus.jsx';
import { FilesToReAdd } from './components/drafts/FilesToReAdd.jsx';
import { UnsavedChangesDialog } from './components/drafts/UnsavedChangesDialog.jsx';
import { MediaDropzone } from './components/media/MediaDropzone.jsx';
import { MediaGrid } from './components/media/MediaGrid.jsx';
import { MediaPreviewDialog } from './components/media/MediaPreviewDialog.jsx';
import { PublishingPreview } from './components/preview/PublishingPreview.jsx';
import { ReadinessPanel } from './components/preview/ReadinessPanel.jsx';
import { CaptionEditor } from './components/text/CaptionEditor.jsx';
import { FirstCommentField } from './components/text/FirstCommentField.jsx';
import { HashtagEditor } from './components/text/HashtagEditor.jsx';
import { KeywordEditor } from './components/text/KeywordEditor.jsx';
import { useAccountPresets } from './hooks/useAccountPresets.js';
import { useLocalAutosave } from './hooks/useLocalAutosave.js';
import { useMediaManager } from './hooks/useMediaManager.js';
import { useServerDraft } from './hooks/useServerDraft.js';
import { useUnsavedChangesGuard } from './hooks/useUnsavedChangesGuard.js';
import { normalizeAccounts } from './model/accounts.js';
import {
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  composerActions,
  composerReducer,
  createInitialComposerState,
  hasContent,
} from './model/composerState.js';
import { validateComposer } from './model/validation.js';
import { CAPABILITY_MESSAGES } from './services/capabilities.js';

/**
 * Universal Post Composer — /w/:slug/compose.
 *
 * Composes one post for many Facebook Pages and Instagram accounts: media, caption (shared or
 * per platform), hashtags, first comment and internal SEO keywords, with live previews and a
 * readiness check against Meta's documented limits.
 *
 * Publish saves the post as a team draft and hands it to the SocialHub publishing API
 * (docs/PUBLISHING_API.md), now or at a scheduled time. What the server does with it depends
 * on its PUBLISHING_MODE: in this release real posting to Meta is not switched on, so at most
 * the post is SIMULATED (the queue and worker run, nothing reaches Facebook or Instagram), and
 * the composer says so. Server drafts, media upload and shared presets use the API
 * (docs/COMPOSER_API_CONTRACT.md) behind capability flags; while a flag is off, drafts and
 * presets are kept in this browser and labelled so, and Publish (which needs a saved team
 * draft) is unavailable.
 */
export default function ComposerPage() {
  const { workspace, can, role } = useWorkspace();
  const { user } = useAuth();
  if (!can(PERMISSIONS.CONTENT_CREATE)) return <NoPermission role={role} />;
  // Keyed so switching workspace (or account) starts a fresh composer: state, selected
  // accounts, object URLs and the device-draft slot all belong to one person + workspace.
  return <Composer key={`${user?.id}:${workspace.id}`} />;
}

function NoPermission({ role }) {
  return (
    <>
      <PageHeader title="Create post" />
      <Card>
        <EmptyState
          icon={Lock}
          title="You can't create posts in this workspace"
          description={`Your role (${ROLE_LABELS[role] ?? role}) can view the workspace, its accounts and content, but not create posts. Ask a workspace owner or admin if you need editor access.`}
        />
      </Card>
    </>
  );
}

/** Delay between the last edit and the automatic save of an existing team draft. */
export const SERVER_AUTOSAVE_DELAY_MS = 3000;

const VIEWS = [
  { id: 'compose', label: 'Compose', icon: PenLine },
  { id: 'preview', label: 'Preview', icon: Eye },
];

/** Where each readiness issue `field` lives, so selecting an issue can jump to it. */
const FIELD_SECTIONS = {
  accounts: 'composer-accounts',
  media: 'composer-media',
  altText: 'composer-media',
  caption: 'composer-caption',
  platformCaption: 'composer-caption',
  hashtags: 'composer-hashtags',
  firstComment: 'composer-first-comment',
};

/** Fields kept under "More options" (opened when an issue there is selected). */
const MORE_OPTION_FIELDS = new Set(['hashtags', 'firstComment']);

/** Below xl, switch between the editor and the preview (side by side on xl screens). */
function ViewSwitch({ view, onChange, issueCount }) {
  const select = (event, id) => {
    onChange(id);
    event.currentTarget.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Composer view"
      className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-xs xl:hidden dark:border-white/10 dark:bg-slate-900/60"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = view === 'compose' ? 'preview' : 'compose';
        onChange(next);
        document.getElementById(`composer-tab-${next}`)?.focus();
      }}
    >
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`composer-tab-${id}`}
            aria-selected={active}
            aria-controls={`composer-panel-${id}`}
            tabIndex={active ? 0 : -1}
            onClick={(event) => select(event, id)}
            className={cn(
              'flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition',
              active
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
            {id === 'preview' && issueCount > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                {issueCount}
                <span className="sr-only"> {issueCount === 1 ? 'issue' : 'issues'}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Section({ id, icon, title, description, action, children }) {
  return (
    <Card id={id} tabIndex={-1} className="scroll-mt-24 focus:outline-none">
      <CardHeader icon={icon} title={title} description={description} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** A titled part inside a card (a jump target for the readiness check). */
function SubSection({ id, title, hint, children, className }) {
  return (
    <div id={id} tabIndex={-1} className={cn('scroll-mt-24 focus:outline-none', className)}>
      {title && (
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Hashtags, first comment and internal keywords: optional, so they sit behind one toggle.
 * Open by default when the post already uses any of them.
 */
function MoreOptions({ open, onToggle, summary, children }) {
  return (
    <Card id="composer-more" tabIndex={-1} className="scroll-mt-24 focus:outline-none">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="composer-more-panel"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-6"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-slate-900 dark:text-white">
            More options
          </span>
          <span className="block truncate text-sm text-muted">{summary}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id="composer-more-panel"
        hidden={!open}
        className="space-y-6 border-t border-slate-100 px-5 py-5 sm:px-6 dark:border-white/[0.06]"
      >
        {children}
      </div>
    </Card>
  );
}

function Composer() {
  const { workspace, can } = useWorkspace();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(composerReducer, undefined, createInitialComposerState);
  const [view, setView] = useState('compose');
  const [previewId, setPreviewId] = useState(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  /** Files a restored device draft had (browser drafts keep names, not contents). */
  const [filesToReAdd, setFilesToReAdd] = useState([]);
  /** Spoken confirmation after files are added (the grid announces moves and removals). */
  const [mediaAnnouncement, setMediaAnnouncement] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  /** "More options" (hashtags, first comment, keywords): null = follow the content. */
  const [moreChoice, setMoreChoice] = useState(null);
  /** The job created by the last Publish, shown with its live per-account status. */
  const [createdJob, setCreatedJob] = useState(null);

  const accountsQuery = useSocialAccounts(workspace.id);
  // A failed background refetch keeps the accounts already loaded: only "no data" is an error.
  const accountsStatus = accountsQuery.isPending
    ? 'loading'
    : accountsQuery.data === undefined && accountsQuery.error
      ? 'error'
      : 'ready';
  const accountsReady = accountsStatus === 'ready';
  const accounts = useMemo(() => normalizeAccounts(accountsQuery.data), [accountsQuery.data]);
  const availableAccountIds = useMemo(
    () => (accountsReady ? accounts.map((account) => account.id) : null),
    [accounts, accountsReady],
  );
  const validation = useMemo(
    () => validateComposer(state, accounts, undefined, { accountsReady }),
    [state, accounts, accountsReady],
  );

  const media = useMediaManager({ media: state.media, dispatch, workspaceId: workspace.id });
  const autosave = useLocalAutosave({ state, userId: user.id, workspaceId: workspace.id });
  const server = useServerDraft({
    workspaceId: workspace.id,
    state,
    dispatch,
    availableAccountIds,
  });
  const presets = useAccountPresets({ workspaceId: workspace.id, userId: user.id });
  const canPublishRole = can(PERMISSIONS.CONTENT_PUBLISH);
  const publishingStatus = usePublishingStatus(workspace.id, {
    enabled: canPublishRole && server.available,
  });

  const contentPresent = hasContent(state);
  const hasLocalFiles = state.media.some((m) => !m.upload.mediaId);
  // Attached files survive leaving the page only when a saved team draft references all of
  // them: browser drafts keep file names, never contents or server ids.
  const mediaAtRisk =
    state.media.length > 0 &&
    !(server.available && server.status === 'saved' && server.omittedMedia.length === 0);
  // `autosave.reason` stays set until a write succeeds, so the guard stays on while a retry
  // is pending after a failed write or after another tab replaced the browser draft.
  const unsaved =
    contentPresent &&
    (mediaAtRisk ||
      Boolean(autosave.reason) ||
      ['error', 'unavailable', 'paused'].includes(autosave.status));
  const guard = useUnsavedChangesGuard({ when: unsaved });
  const issueCount = validation.errors.length + validation.warnings.length;
  const conflicted = server.available && server.status === 'conflict';

  // Team-draft autosave: once a draft exists on the server, later edits are saved a few
  // seconds after the last change. It never creates a draft by itself (the first save is the
  // person's choice), and it stops after a conflict or an error until they save by hand, so a
  // failing request is not repeated forever. The browser draft keeps running underneath.
  const serverDraftId = server.draft?.id ?? null;
  const { dirty: serverDirty, status: serverStatus, save: saveToServer } = server;
  useEffect(() => {
    if (!serverDraftId || !serverDirty || serverStatus !== 'idle') return undefined;
    const timer = setTimeout(() => {
      // The outcome is shown by the draft status; a failure here must not raise an error toast
      // for something the person did not ask for.
      saveToServer().catch(() => {});
    }, SERVER_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serverDraftId, serverDirty, serverStatus, saveToServer, state]);

  // Keyboard focus must not end up hidden under the sticky header or the sticky action bar
  // (WCAG 2.4.11): reserve their height when the browser scrolls a focused control into view.
  useEffect(() => {
    const root = document.documentElement;
    const previous = { top: root.style.scrollPaddingTop, bottom: root.style.scrollPaddingBottom };
    root.style.scrollPaddingTop = '5rem';
    root.style.scrollPaddingBottom = '8rem';
    return () => {
      root.style.scrollPaddingTop = previous.top;
      root.style.scrollPaddingBottom = previous.bottom;
    };
  }, []);

  const changeView = useCallback((next) => {
    setView(next);
    // Textareas can't measure themselves while their panel is hidden: let them re-measure.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, []);

  const saveDraft = async () => {
    if (server.available) {
      try {
        // After a conflict the linked draft belongs to someone else's newer version: saving
        // again would conflict forever, so this version is kept as a new team draft instead.
        const { omittedMedia } = await server.save({ asNew: conflicted });
        const description = omittedMedia?.length
          ? `${omittedMedia.length} ${omittedMedia.length === 1 ? 'file isn’t' : 'files aren’t'} uploaded yet, so ${omittedMedia.length === 1 ? 'it isn’t' : 'they aren’t'} included.`
          : undefined;
        toast.success(
          conflicted ? 'Saved as a new team draft' : 'Draft saved to your team’s drafts',
          { description },
        );
      } catch (err) {
        // Show the API's field messages (422) when it sent them, not just the summary.
        const fields = Object.values(err?.fields ?? {}).filter(Boolean);
        toast.error(err?.message ?? 'The draft could not be saved.', {
          description: fields.length ? fields.slice(0, 3).join(' ') : undefined,
        });
      }
      return;
    }
    const result = autosave.flush();
    if (result?.ok) {
      toast.success('Draft saved in this browser', {
        description: hasLocalFiles
          ? 'Attached files aren’t kept in browser drafts. Add them again if you restore it.'
          : 'It stays in this browser until you discard it or sign out.',
      });
      return;
    }
    const messages = {
      paused: 'Restore or discard your earlier draft first, so it isn’t overwritten.',
      empty: 'There’s nothing to save yet.',
      unavailable: 'This browser blocks storage, so the draft can’t be saved here.',
      quota: 'This browser’s storage is full, so the draft couldn’t be saved.',
    };
    toast.error(messages[result?.reason] ?? 'The draft couldn’t be saved in this browser.');
  };

  const discard = () => {
    // useMediaManager releases object URLs and aborts uploads for items that leave the state.
    dispatch(composerActions.reset());
    media.clearRejections();
    setFilesToReAdd([]);
    if (server.available) server.reset();
    // While an earlier device draft is waiting to be restored, the device slot still holds
    // that draft (nothing newer was written), so it must not be deleted along with this post.
    if (!autosave.restorable) autosave.clear();
    toast.success('Post discarded');
    // The Discard button is disabled now, so focus would fall to <body>: move it to the start
    // of the composer once the confirmation dialog has closed.
    requestAnimationFrame(() => document.getElementById('composer-accounts')?.focus());
  };

  const restore = () => {
    const missing = autosave.restorable?.missingMedia ?? [];
    const restored = autosave.restore();
    if (!restored) return;
    dispatch(composerActions.load(restored));
    setFilesToReAdd(missing);
    if (server.available) server.reset();
  };

  /** Adds files; a file that a restored draft listed gets its saved alt text back. */
  const addFiles = (files) => {
    const result = media.addFiles(files);
    if (result.added.length > 0) {
      const total = state.media.length + result.added.length;
      setMediaAnnouncement(
        `Added ${result.added.length} ${result.added.length === 1 ? 'file' : 'files'}. ${total} of ${MEDIA_MAX_ITEMS} attached.`,
      );
    }
    if (filesToReAdd.length === 0 || result.added.length === 0) return result;
    const remaining = [...filesToReAdd];
    for (const item of result.added) {
      const index = remaining.findIndex(
        (file) => file.fileName === item.fileName && file.kind === item.kind,
      );
      if (index === -1) continue;
      const [match] = remaining.splice(index, 1);
      if (match.altText) dispatch(composerActions.setMediaAltText(item.id, match.altText));
    }
    if (remaining.length !== filesToReAdd.length) setFilesToReAdd(remaining);
    return result;
  };

  const showSection = useCallback(
    (field) => {
      const id = FIELD_SECTIONS[field];
      if (!id) return;
      if (MORE_OPTION_FIELDS.has(field)) setMoreChoice(true);
      changeView('compose');
      requestAnimationFrame(() => {
        const section = document.getElementById(id);
        section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        section?.focus({ preventScroll: true });
      });
    },
    [changeView],
  );

  const showIssues = useCallback(() => {
    changeView('preview');
    requestAnimationFrame(() => {
      const panel = document.getElementById('composer-readiness');
      panel?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      panel?.focus({ preventScroll: true });
    });
  }, [changeView]);

  // ------------------------------------------------------------------ publishing
  const simulatedMode = publishingStatus.data?.mode === PUBLISHING_MODES.SIMULATED;
  const liveMode = publishingStatus.data?.mode === PUBLISHING_MODES.LIVE;
  // [full explanation for the note above the composer, short label under the Publish button]
  const [publishUnavailable, publishShort] = (() => {
    if (!canPublishRole) {
      return ['Your role cannot publish posts in this workspace.', 'Your role cannot publish'];
    }
    if (!server.available) return [CAPABILITY_MESSAGES.publishing, 'Publishing needs team drafts'];
    if (publishingStatus.isPending) {
      return ['Checking whether publishing is available…', 'Checking publishing…'];
    }
    if (publishingStatus.error) {
      return ['We could not check whether publishing is available.', 'Could not check publishing'];
    }
    const status = publishingStatus.data;
    if (status.mode === PUBLISHING_MODES.DISABLED) {
      return ['Publishing is switched off on this server.', 'Publishing is switched off'];
    }
    if (!status.canPublish) {
      return [
        status.message ?? 'The publishing queue is not available right now.',
        'Publishing queue not available',
      ];
    }
    return [null, null];
  })();
  const publishMessage =
    publishShort ??
    (simulatedMode ? 'Simulation only: nothing is posted' : 'Posts go to Facebook and Instagram');
  const notUploaded = state.media.filter((m) => m.upload.status !== UPLOAD_STATUS.UPLOADED);
  const publishBlockers = [];
  if (notUploaded.length > 0) {
    publishBlockers.push(
      media.uploadAvailable
        ? `${notUploaded.length} ${notUploaded.length === 1 ? 'file has' : 'files have'} not finished uploading. Wait for the upload, or remove files that failed.`
        : 'Media upload is not switched on for this site, so attached files cannot be published. Remove them to publish the text only.',
    );
  }
  if (!accountsReady) publishBlockers.push('Your accounts are still loading.');

  /** Saves the draft so the server publishes exactly what is on screen; resolves to its id. */
  const preparePublish = async () => {
    if (server.status === 'saved' && server.draft && server.omittedMedia.length === 0) {
      return server.draft.id;
    }
    const { contentPackage, omittedMedia } = await server.save({ asNew: conflicted });
    if (omittedMedia?.length) {
      throw new Error('Some files are not uploaded yet, so the post cannot be published as it is.');
    }
    return contentPackage.id;
  };

  const openServerDraft = async (id) => {
    await server.open(id);
    setFilesToReAdd([]);
    setDraftsOpen(false);
  };

  const previewIndex = previewId ? state.media.findIndex((m) => m.id === previewId) : null;

  const usedOptions = [
    state.hashtags.length > 0 &&
      `${state.hashtags.length} ${state.hashtags.length === 1 ? 'hashtag' : 'hashtags'}`,
    state.firstComment.trim() && 'first comment',
    state.keywords.length > 0 &&
      `${state.keywords.length} ${state.keywords.length === 1 ? 'keyword' : 'keywords'}`,
  ].filter(Boolean);
  const moreOpen = moreChoice ?? usedOptions.length > 0;
  const moreSummary =
    usedOptions.length > 0
      ? usedOptions.join(' · ')
      : 'Hashtags, a first comment and internal keywords';

  return (
    <>
      <PageHeader
        title="Create post"
        description="Choose where it goes, write it once and check the preview."
      />

      {autosave.restorable && (
        <div className="mb-6">
          <DraftRestoreBanner
            savedAt={autosave.restorable.savedAt}
            missingMedia={autosave.restorable.missingMedia}
            hasCurrentContent={contentPresent}
            onRestore={restore}
            onDiscard={autosave.discardRestorable}
          />
        </div>
      )}

      {filesToReAdd.length > 0 && (
        <FilesToReAdd className="mb-6" files={filesToReAdd} onDismiss={() => setFilesToReAdd([])} />
      )}

      <PublishingNote
        simulated={simulatedMode && !publishUnavailable}
        live={liveMode && !publishUnavailable}
        unavailable={publishUnavailable}
        publishingHref={`/w/${workspace.slug}/publishing`}
      />

      <ViewSwitch view={view} onChange={changeView} issueCount={issueCount} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div
          id="composer-panel-compose"
          role="tabpanel"
          aria-labelledby="composer-tab-compose"
          className={cn('min-w-0 space-y-6', view !== 'compose' && 'hidden xl:block')}
        >
          <div id="composer-accounts" tabIndex={-1} className="scroll-mt-24 focus:outline-none">
            <AccountSelector
              accounts={accounts}
              selectedIds={state.selectedAccountIds}
              onToggle={(id) => dispatch(composerActions.toggleAccount(id))}
              onSelect={(ids) => dispatch(composerActions.selectAccounts(ids))}
              onDeselect={(ids) => dispatch(composerActions.deselectAccounts(ids))}
              onSetSelected={(ids) => dispatch(composerActions.setSelectedAccounts(ids))}
              status={accountsStatus}
              error={accountsQuery.error}
              onRetry={accountsQuery.refetch}
              canManageAccounts={can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)}
              accountsHref={`/w/${workspace.slug}/accounts`}
              presets={presets}
            />
          </div>

          <Section
            id="composer-post"
            icon={PenLine}
            title="Your post"
            description="One caption for every platform, or a different one for Facebook and Instagram."
          >
            <SubSection id="composer-caption">
              <CaptionEditor state={state} dispatch={dispatch} platforms={validation.platforms} />
            </SubSection>
            <SubSection
              id="composer-media"
              title="Photos and videos"
              hint="The first one is the cover"
              className="mt-6"
            >
              <div className="space-y-4">
                <MediaGrid
                  media={state.media}
                  onRemove={media.removeMedia}
                  onMove={(id, toIndex) => dispatch(composerActions.moveMedia(id, toIndex))}
                  onAltTextChange={(id, text) =>
                    dispatch(composerActions.setMediaAltText(id, text))
                  }
                  onPreview={setPreviewId}
                  onRetryUpload={media.retryUpload}
                  onCancelUpload={media.cancelUpload}
                  uploadAvailable={media.uploadAvailable}
                />
                <p role="status" aria-live="polite" className="sr-only">
                  {mediaAnnouncement}
                </p>
                <MediaDropzone
                  onFiles={addFiles}
                  count={state.media.length}
                  max={MEDIA_MAX_ITEMS}
                  uploadAvailable={media.uploadAvailable}
                  compact={state.media.length > 0}
                  rejections={media.rejections}
                  onDismissRejection={media.dismissRejection}
                  onClearRejections={media.clearRejections}
                />
              </div>
            </SubSection>
          </Section>

          <MoreOptions
            open={moreOpen}
            onToggle={() => setMoreChoice(!moreOpen)}
            summary={moreSummary}
          >
            <OptionGroup id="composer-hashtags" icon={Hash} title="Hashtags">
              <HashtagEditor state={state} dispatch={dispatch} platforms={validation.platforms} />
            </OptionGroup>
            <OptionGroup id="composer-first-comment" icon={MessageCircle} title="First comment">
              <FirstCommentField
                state={state}
                dispatch={dispatch}
                platforms={validation.platforms}
              />
            </OptionGroup>
            <OptionGroup
              id="composer-keywords"
              icon={Search}
              title="Internal SEO keywords"
              hint="For your team only, never published"
            >
              <KeywordEditor state={state} dispatch={dispatch} />
            </OptionGroup>
          </MoreOptions>
        </div>

        <div
          id="composer-panel-preview"
          role="tabpanel"
          aria-labelledby="composer-tab-preview"
          className={cn(
            'min-w-0 space-y-6 xl:sticky xl:top-24 xl:-m-1 xl:max-h-[calc(100vh-12.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:p-1',
            view !== 'preview' && 'hidden xl:block',
          )}
        >
          <PublishingPreview state={state} accounts={validation.selected} status={accountsStatus} />
          <div id="composer-readiness" tabIndex={-1} className="scroll-mt-24 focus:outline-none">
            <ReadinessPanel
              validation={validation}
              accounts={accounts}
              status={accountsStatus}
              error={accountsQuery.error}
              onRetry={accountsQuery.refetch}
              onIssueSelect={(issue) => showSection(issue.field)}
            />
          </div>
        </div>
      </div>

      <ComposerActionBar
        status={<DraftStatus local={autosave} server={server} />}
        issueSummary={
          accountsReady
            ? { errors: validation.errors.length, warnings: validation.warnings.length }
            : undefined
        }
        onShowIssues={showIssues}
        onSaveDraft={saveDraft}
        saving={server.status === 'saving'}
        canSave={contentPresent}
        saveLabel={
          conflicted
            ? 'Save as a new draft'
            : server.available
              ? 'Save draft'
              : 'Save draft in this browser'
        }
        onDiscard={discard}
        discardDisabled={!contentPresent}
        onOpenDrafts={server.available ? () => setDraftsOpen(true) : undefined}
        onPublish={() => setPublishOpen(true)}
        publishDisabled={Boolean(publishUnavailable)}
        publishSimulated={simulatedMode}
        publishingMessage={publishMessage}
      />

      {publishOpen && (
        <ComposerPublishDialog
          // A new workspace gets a new dialog: nothing (such as a real-post confirmation) carries over.
          key={workspace.id}
          workspaceId={workspace.id}
          workspaceTimeZone={workspace.timezone}
          accounts={validation.selected}
          errors={accountsReady ? validation.errors.map((issue) => issue.message) : []}
          warnings={accountsReady ? validation.warnings.map((issue) => issue.message) : []}
          blockers={publishBlockers}
          hasFirstComment={Boolean(state.firstComment.trim())}
          hashtagsInFirstComment={
            state.hashtagPlacement === HASHTAG_PLACEMENTS.FIRST_COMMENT && state.hashtags.length > 0
          }
          mediaCount={state.media.length}
          media={state.media}
          captions={[...new Set(validation.selected.map((account) => account.platform))].map(
            (platform) => ({
              platform,
              // The server's own function: exactly the text each platform will receive.
              text: composeSharedCaption(
                {
                  caption: state.caption,
                  platformCaptions: state.platformCaptions,
                  hashtags: state.hashtags,
                  hashtagPlacement: state.hashtagPlacement,
                },
                platform,
              ),
            }),
          )}
          prepare={preparePublish}
          onClose={() => setPublishOpen(false)}
          onCreated={(job) => {
            setPublishOpen(false);
            setCreatedJob(job);
          }}
        />
      )}
      {createdJob && (
        <JobDetailsModal
          key={createdJob.id}
          workspaceId={workspace.id}
          job={createdJob}
          canAct={canPublishRole}
          timeZone={workspace.timezone}
          onClose={() => setCreatedJob(null)}
          footerExtra={
            <Link
              to={`/w/${workspace.slug}/publishing`}
              className="mr-auto inline-flex h-10 items-center text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
            >
              Open Publishing
            </Link>
          }
        />
      )}

      <MediaPreviewDialog
        media={state.media}
        index={previewIndex}
        onClose={() => setPreviewId(null)}
        onNavigate={(i) => setPreviewId(state.media[i]?.id ?? null)}
      />

      <UnsavedChangesDialog
        blocker={guard.blocker}
        description={
          hasLocalFiles
            ? 'Attached files only exist in this tab and will be lost.'
            : 'Your latest changes have not been saved.'
        }
      />

      {server.available && (
        <DraftsPanel
          open={draftsOpen}
          onClose={() => setDraftsOpen(false)}
          workspaceId={workspace.id}
          currentDraftId={server.draft?.id ?? null}
          hasUnsavedChanges={server.dirty || server.omittedMedia.length > 0}
          onOpen={openServerDraft}
        />
      )}
    </>
  );
}

/** One optional field group inside "More options". */
function OptionGroup({ id, icon: Icon, title, hint, children }) {
  return (
    <section id={id} tabIndex={-1} aria-label={title} className="scroll-mt-24 focus:outline-none">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        {hint && <span className="text-xs text-muted">· {hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * What Publish will do in this workspace, above the composer: simulate, publish for real
 * (after the person confirms each post), or nothing at all and why.
 */
function PublishingNote({ simulated, live, unavailable, publishingHref }) {
  const Icon = simulated ? FlaskConical : Send;
  return (
    <div
      role="note"
      className={cn(
        'mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        simulated
          ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100'
          : live
            ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100'
            : 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        {simulated ? (
          <>
            <span className="font-semibold">Simulation mode.</span> Publish runs the whole
            publishing process (queue, worker, a result for each account), but nothing is posted to
            Facebook or Instagram. A workspace owner or admin can switch on real publishing in
            Settings when this server offers it.
          </>
        ) : live ? (
          <>
            <span className="font-semibold">Real publishing is on.</span> Publish sends a real post
            to the accounts you select, after you check the preview and confirm it.
          </>
        ) : (
          <>
            <span className="font-semibold">Publishing isn’t available right now.</span>{' '}
            {unavailable ?? 'Nothing is sent to Facebook or Instagram.'} You can compose, preview
            and save drafts.
          </>
        )}{' '}
        <Link
          to={publishingHref}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Publishing status
        </Link>
      </p>
    </div>
  );
}
