import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { Eye, Info } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '../../../../components/ui/Badge.jsx';
import { Card, CardHeader } from '../../../../components/ui/Card.jsx';
import { EmptyState, Skeleton } from '../../../../components/ui/Feedback.jsx';
import { PreviewArt } from '../../../../components/ui/illustrations.jsx';
import { segmentItem, segmentTrack } from '../../../../components/ui/segmented.js';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES, platformLabel } from '../../constants/platformRules.js';
import { accountBlocker } from '../../model/accounts.js';
import { COMPOSER_PLATFORMS, MEDIA_KINDS } from '../../model/composerState.js';
import { aspectRatio, describeAspectRatio } from '../../model/media.js';
import { platformOutput } from '../../model/validation.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';
import { PlatformGlyph } from '../shared/PlatformIcon.jsx';
import { FacebookPostPreview } from './FacebookPostPreview.jsx';
import { InstagramPostPreview } from './InstagramPostPreview.jsx';

const FACEBOOK = SOCIAL_PLATFORMS.FACEBOOK_PAGE;
const INSTAGRAM = SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;

const HAS_LINK = /\b(?:https?:\/\/|www\.)\S/i;

/** Platform behaviour worth knowing while looking at the preview (facts, not claims). */
function previewNotes(platform, caption, media) {
  const notes = [];
  const hasLink = HAS_LINK.test(caption);
  if (platform === FACEBOOK) {
    if (hasLink && media.length === 0) {
      notes.push("Facebook may show a preview card for the first link. It isn't shown here.");
    }
    return notes;
  }
  if (hasLink) notes.push("Instagram doesn't make links in captions clickable.");
  if (media.length === 1 && media[0].kind === MEDIA_KINDS.VIDEO) {
    notes.push('On Instagram, a single video is shared as a Reel.');
  }
  const rules = PLATFORM_RULES[INSTAGRAM].media;
  if (media.length > 1 && rules.carouselCropsToFirst) {
    const ratio = aspectRatio(media[0].width, media[0].height) ?? 1;
    const shown = Math.min(rules.image.maxAspectRatio, Math.max(rules.image.minAspectRatio, ratio));
    notes.push(
      `Instagram crops every slide to the shape of the first one (${describeAspectRatio(shown, 1)}).`,
    );
  }
  return notes;
}

function AccountSwitcher({ accounts, value, onChange }) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="mb-2 text-xs font-medium text-muted">
        Preview for
      </p>
      {/* Chips wrap (no sideways scroller inside the card); past three rows the list scrolls. */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="-m-1 flex max-h-[9.5rem] flex-wrap gap-2 overflow-y-auto p-1"
      >
        {accounts.map((account) => {
          const pressed = account.id === value;
          const attention = Boolean(accountBlocker(account));
          return (
            <button
              key={account.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(account.id)}
              title={account.name}
              className={cn(
                // relative: keeps the sr-only text inside the scrolling list (absolute children
                // of an unpositioned button would escape its clipping and grow the page).
                'relative inline-flex max-w-full shrink-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition sm:max-w-[14rem]',
                pressed
                  ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-xs dark:border-brand-400/60 dark:bg-brand-500/15 dark:text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-white/20',
              )}
            >
              <AccountAvatar account={account} size="sm" />
              <span className="min-w-0 truncate font-medium">{account.name}</span>
              <span className="sr-only">
                {`, ${platformLabel(account.platform)}${attention ? ', needs attention' : ''}`}
              </span>
              {attention && (
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SamplePlatformToggle({ value, onChange, failed }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label="Preview platform" className={segmentTrack}>
        {COMPOSER_PLATFORMS.map((platform) => {
          const pressed = platform === value;
          return (
            <button
              key={platform}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(platform)}
              className={cn(segmentItem(pressed, 'lg'), 'gap-2 text-sm')}
            >
              <PlatformGlyph platform={platform} className="h-3.5 w-3.5" />
              {platformLabel(platform)}
            </button>
          );
        })}
      </div>
      <p className="min-w-0 flex-1 basis-48 text-xs text-muted">
        {failed
          ? "Your accounts couldn't be loaded, so a sample account is shown."
          : 'A sample account is shown. Choose accounts to preview each one.'}
      </p>
    </div>
  );
}

/** The grey "feed" behind the post; it runs edge to edge on phones to give the post room. */
const STAGE_CLASS =
  '-mx-5 bg-slate-100/80 px-3 py-4 sm:mx-0 sm:rounded-2xl sm:p-5 dark:bg-black/30';

function PreviewSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex gap-2">
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className={STAGE_CLASS}>
        <div className="mx-auto w-full max-w-[470px] space-y-3 rounded-xl bg-white p-4 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full">
              <Skeleton className="h-full w-full" />
            </span>
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="aspect-video w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Shows how the post could look for one destination at a time. `state` is the composer state;
 * `accounts` are the normalized SELECTED accounts in selection order (`validation.selected`).
 * `status` ('ready' | 'loading' | 'error') reflects the account list: while it loads a skeleton
 * is shown, and on error the preview falls back to a sample account.
 *
 * It is labelled "Not published" and makes no requests: nothing here is sent anywhere.
 */
export function PublishingPreview({ state, accounts, status = 'ready', className }) {
  const titleId = useId();
  const [chosenId, setChosenId] = useState(null);
  const [samplePlatform, setSamplePlatform] = useState(FACEBOOK);

  const destinations = (accounts ?? []).filter((a) => COMPOSER_PLATFORMS.includes(a.platform));
  // The choice stays valid as the selection changes: an unselected account falls back to the first.
  const chosen = destinations.find((a) => a.id === chosenId) ?? destinations[0] ?? null;
  const platform = chosen?.platform ?? samplePlatform;
  const output = platformOutput(state, platform);
  const media = state.media ?? [];
  const loading = status === 'loading';
  const isEmpty = !output.caption && media.length === 0;
  const notes = loading || isEmpty ? [] : previewNotes(platform, output.caption, media);
  const previewProps = {
    account: chosen ?? undefined,
    caption: output.caption,
    firstComment: output.firstComment,
    media,
  };

  let body;
  if (loading) {
    body = (
      <>
        <p className="sr-only" role="status">
          Loading accounts…
        </p>
        <PreviewSkeleton />
      </>
    );
  } else {
    body = (
      <>
        {destinations.length > 0 ? (
          <AccountSwitcher accounts={destinations} value={chosen.id} onChange={setChosenId} />
        ) : (
          <SamplePlatformToggle
            value={samplePlatform}
            onChange={setSamplePlatform}
            failed={status === 'error'}
          />
        )}
        <div className={STAGE_CLASS}>
          {isEmpty ? (
            <EmptyState
              art={PreviewArt}
              className="py-8"
              title="Your preview appears here"
              description="Write a caption or add a photo or video to see how this post could look."
            />
          ) : (
            // Sized by the column, never by its content (a long link can't widen the layout).
            <div className="mx-auto w-full max-w-[470px] [contain:inline-size]">
              {platform === INSTAGRAM ? (
                <InstagramPostPreview {...previewProps} />
              ) : (
                <FacebookPostPreview {...previewProps} />
              )}
            </div>
          )}
        </div>
        {notes.length > 0 && (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li key={note} className="flex items-start gap-2 text-xs text-muted">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {note}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <Card aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <CardHeader
        icon={Eye}
        tone="from-sky-500 to-blue-600"
        title={
          // The badge sits with the title so the note below keeps the full width on phones.
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span id={titleId}>Preview</span>
            <Badge tone="neutral" dot>
              Not published
            </Badge>
          </span>
        }
        description="Approximate. Facebook and Instagram may display it differently."
      />
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">{body}</div>
    </Card>
  );
}
