import { PERMISSIONS, ROLE_LABELS } from '@socialhub/shared';
import { Eye, Hash, ImagePlus, Lock, MessageCircle, PenLine, Search, Send } from 'lucide-react';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useSocialAccounts } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { AccountSelector } from './components/accounts/AccountSelector.jsx';
import { ComposerActionBar } from './components/drafts/ComposerActionBar.jsx';
import { DraftRestoreBanner } from './components/drafts/DraftRestoreBanner.jsx';
import { DraftsPanel } from './components/drafts/DraftsPanel.jsx';
import { DraftStatus } from './components/drafts/DraftStatus.jsx';
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
  composerActions,
  composerReducer,
  createInitialComposerState,
  hasContent,
} from './model/composerState.js';
import { validateComposer } from './model/validation.js';

/**
 * Universal Post Composer — /w/:slug/compose.
 *
 * Composes one post for many Facebook Pages and Instagram accounts: media, caption (shared or
 * per platform), hashtags, first comment and internal SEO keywords, with live previews and a
 * readiness check against Meta's documented limits.
 *
 * Publishing is NOT available: the publishing engine does not exist, so nothing is ever sent
 * to Facebook or Instagram. Server drafts, media upload and shared presets are wired to the
 * proposed API (docs/COMPOSER_API_CONTRACT.md) behind capability flags that are off until the
 * backend ships them; until then drafts and presets are kept in this browser and labelled so.
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

function Composer() {
  const { workspace, can } = useWorkspace();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(composerReducer, undefined, createInitialComposerState);
  const [view, setView] = useState('compose');
  const [previewId, setPreviewId] = useState(null);
  const [draftsOpen, setDraftsOpen] = useState(false);

  const accountsQuery = useSocialAccounts(workspace.id);
  const accountsStatus = accountsQuery.isPending
    ? 'loading'
    : accountsQuery.error
      ? 'error'
      : 'ready';
  const accounts = useMemo(() => normalizeAccounts(accountsQuery.data), [accountsQuery.data]);
  const validation = useMemo(
    () =>
      validateComposer(state, accounts, undefined, { accountsReady: accountsStatus === 'ready' }),
    [state, accounts, accountsStatus],
  );

  const media = useMediaManager({ media: state.media, dispatch, workspaceId: workspace.id });
  const autosave = useLocalAutosave({ state, userId: user.id, workspaceId: workspace.id });
  const server = useServerDraft({ workspaceId: workspace.id, state, dispatch });
  const presets = useAccountPresets({ workspaceId: workspace.id, userId: user.id });

  const contentPresent = hasContent(state);
  // Files that only exist in this tab (no server copy) are lost on leaving: device drafts
  // can't keep file contents.
  const hasLocalFiles = state.media.some((m) => !m.upload.mediaId);
  const unsaved =
    contentPresent &&
    (hasLocalFiles || ['error', 'unavailable', 'paused'].includes(autosave.status));
  const guard = useUnsavedChangesGuard({ when: unsaved });
  const issueCount = validation.errors.length + validation.warnings.length;

  const saveDraft = async () => {
    if (server.available) {
      try {
        const { omittedMedia } = await server.save();
        toast.success('Draft saved to your team’s drafts', {
          description: omittedMedia?.length
            ? `${omittedMedia.length} ${omittedMedia.length === 1 ? 'file isn’t' : 'files aren’t'} uploaded yet, so ${omittedMedia.length === 1 ? 'it isn’t' : 'they aren’t'} included.`
            : undefined,
        });
      } catch (err) {
        toast.error(err?.message ?? 'The draft could not be saved.');
      }
      return;
    }
    const result = autosave.flush();
    if (result?.ok) {
      toast.success('Draft saved in this browser', {
        description: hasLocalFiles
          ? 'Attached files aren’t kept in browser drafts. Add them again if you restore it.'
          : 'Only you can see it, on this device.',
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
    if (server.available) server.reset();
    // While an earlier device draft is waiting to be restored, the device slot still holds
    // that draft (nothing newer was written), so it must not be deleted along with this post.
    if (!autosave.restorable) autosave.clear();
    toast.success('Post discarded');
  };

  const restore = () => {
    const restored = autosave.restore();
    if (!restored) return;
    dispatch(composerActions.load(restored));
    if (server.available) server.reset();
  };

  const showSection = useCallback((field) => {
    const id = FIELD_SECTIONS[field];
    if (!id) return;
    setView('compose');
    requestAnimationFrame(() => {
      const section = document.getElementById(id);
      section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      section?.focus({ preventScroll: true });
    });
  }, []);

  const showIssues = useCallback(() => {
    setView('preview');
    requestAnimationFrame(() =>
      document
        .getElementById('composer-readiness')
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
    );
  }, []);

  const openServerDraft = async (id) => {
    await server.open(id);
    setDraftsOpen(false);
  };

  const previewIndex = previewId ? state.media.findIndex((m) => m.id === previewId) : null;

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Create post"
        description="Write once, tailor it for each platform and preview it before it goes anywhere."
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

      <div
        role="note"
        className="mb-6 flex items-start gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-100"
      >
        <Send className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Publishing isn’t available yet.</span> The SocialHub
          publishing engine hasn’t been built, so nothing is sent to Facebook or Instagram. You can
          compose, preview and save drafts.
        </p>
      </div>

      <ViewSwitch view={view} onChange={setView} issueCount={issueCount} />

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
            id="composer-media"
            icon={ImagePlus}
            title="Media"
            description="Photos and videos, in the order they will appear. The first one is the cover."
          >
            <div className="space-y-4">
              <MediaGrid
                media={state.media}
                onRemove={media.removeMedia}
                onMove={(id, toIndex) => dispatch(composerActions.moveMedia(id, toIndex))}
                onAltTextChange={(id, text) => dispatch(composerActions.setMediaAltText(id, text))}
                onPreview={setPreviewId}
                onRetryUpload={media.retryUpload}
                onCancelUpload={media.cancelUpload}
                uploadAvailable={media.uploadAvailable}
              />
              <MediaDropzone
                onFiles={media.addFiles}
                count={state.media.length}
                max={MEDIA_MAX_ITEMS}
                uploadAvailable={media.uploadAvailable}
                compact={state.media.length > 0}
                rejections={media.rejections}
                onDismissRejection={media.dismissRejection}
                onClearRejections={media.clearRejections}
              />
            </div>
          </Section>

          <Section
            id="composer-caption"
            icon={PenLine}
            title="Caption"
            description="One caption for every platform, or customize it for Facebook and Instagram."
          >
            <CaptionEditor state={state} dispatch={dispatch} platforms={validation.platforms} />
          </Section>

          <Section
            id="composer-hashtags"
            icon={Hash}
            title="Hashtags"
            description="Added to the caption or the first comment when the post is composed."
          >
            <HashtagEditor state={state} dispatch={dispatch} platforms={validation.platforms} />
          </Section>

          <Section
            id="composer-first-comment"
            icon={MessageCircle}
            title="First comment"
            description="Posted from the same account right after the post, once publishing is available."
          >
            <FirstCommentField state={state} dispatch={dispatch} platforms={validation.platforms} />
          </Section>

          <Section
            id="composer-keywords"
            icon={Search}
            title="Internal SEO keywords"
            description="For search and reporting inside SocialHub. Never published."
          >
            <KeywordEditor state={state} dispatch={dispatch} />
          </Section>
        </div>

        <div
          id="composer-panel-preview"
          role="tabpanel"
          aria-labelledby="composer-tab-preview"
          className={cn(
            'min-w-0 space-y-6 xl:sticky xl:top-24',
            view !== 'preview' && 'hidden xl:block',
          )}
        >
          <PublishingPreview state={state} accounts={validation.selected} status={accountsStatus} />
          <div id="composer-readiness" className="scroll-mt-24">
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
        issueSummary={{ errors: validation.errors.length, warnings: validation.warnings.length }}
        onShowIssues={showIssues}
        onSaveDraft={saveDraft}
        saving={server.status === 'saving'}
        canSave={contentPresent}
        saveLabel={server.available ? 'Save draft' : 'Save draft in this browser'}
        onDiscard={discard}
        discardDisabled={!contentPresent}
        onOpenDrafts={server.available ? () => setDraftsOpen(true) : undefined}
        publishingMessage="Publishing isn’t available yet"
      />

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
          hasUnsavedChanges={server.dirty}
          onOpen={openServerDraft}
        />
      )}
    </>
  );
}
