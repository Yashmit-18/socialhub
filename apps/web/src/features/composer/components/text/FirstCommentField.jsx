import { Hash, Info } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES, platformLabel } from '../../constants/platformRules.js';
import { COMPOSER_PLATFORMS, composerActions } from '../../model/composerState.js';
import { HASHTAG_PLACEMENTS, composeFirstComment, countChars } from '../../model/text.js';
import { platformOutput } from '../../model/validation.js';
import { ComposerTextarea } from './CaptionEditor.jsx';
import { CharacterCount, InlinePlatformGlyph, PlatformCounts } from './CharacterCount.jsx';
import { isSoftLimit, overHardLimit } from './limits.js';

const GENERIC_NOTE =
  'Publishing is not available yet. Once it is, the first comment is posted from the same account right after the post.';

/** Counter items for a platform's first comment, from PLATFORM_RULES. */
function commentCounts(output, platform, idBase) {
  const platformRules = PLATFORM_RULES[platform];
  const rules = platformRules?.firstComment ?? {};
  const items = [
    {
      id: `${idBase}-${platform}-characters`,
      unit: 'character',
      count: output.firstCommentLength,
      max: rules.maxChars ?? null,
      soft: isSoftLimit(platformRules, 'firstComment.maxChars'),
    },
  ];
  if (rules.maxHashtags) {
    items.push({
      id: `${idBase}-${platform}-hashtags`,
      unit: 'hashtag',
      count: output.firstCommentHashtags,
      max: rules.maxHashtags,
      soft: isSoftLimit(platformRules, 'firstComment.maxHashtags'),
    });
  }
  if (rules.maxMentions) {
    items.push({
      id: `${idBase}-${platform}-mentions`,
      unit: 'mention',
      count: output.firstCommentMentions,
      max: rules.maxMentions,
      soft: isSoftLimit(platformRules, 'firstComment.maxMentions'),
    });
  }
  return items;
}

// Only limits that Meta documents make the comment invalid; unverified ones just warn.
const overLimit = overHardLimit;

/**
 * Optional first comment. Counters show the composed comment (including hashtags when they are
 * placed in the first comment) against each selected platform's limits, and notes from
 * PLATFORM_RULES explain how the comment would be posted once publishing exists.
 *
 * Props: state, dispatch, platforms (platforms with selected accounts), id, className.
 */
export function FirstCommentField({ state, dispatch, platforms = [], id, className }) {
  const baseId = useId();
  const fieldId = `${baseId}-first-comment`;
  const previewTitleId = `${baseId}-preview-title`;
  const selectedPlatforms = COMPOSER_PLATFORMS.filter((p) => platforms.includes(p));
  const counts = selectedPlatforms.map((platform) => ({
    platform,
    items: commentCounts(platformOutput(state, platform), platform, `${baseId}-count`),
  }));
  const composed = composeFirstComment({
    firstComment: state.firstComment,
    hashtags: state.hashtags,
    hashtagPlacement: state.hashtagPlacement,
  });
  const appendsHashtags =
    state.hashtagPlacement === HASHTAG_PLACEMENTS.FIRST_COMMENT &&
    state.hashtags.length > 0 &&
    composed !== state.firstComment.trim();
  const notes = selectedPlatforms
    .map((platform) => ({ platform, note: PLATFORM_RULES[platform]?.firstComment?.note }))
    .filter(({ note }) => Boolean(note));
  const overMessage = counts
    .filter(({ items }) => overLimit(items))
    .map(({ platform }) => `The ${platformLabel(platform)} first comment is over the limit.`)
    .join(' ');

  return (
    <div id={id} className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={fieldId} className="text-sm font-medium text-slate-700 dark:text-slate-200">
          First comment
        </label>
        <span className="text-xs text-muted">Optional</span>
      </div>

      <ComposerTextarea
        id={fieldId}
        value={state.firstComment}
        onChange={(value) => dispatch(composerActions.setFirstComment(value))}
        placeholder="Add more details, a link or a question for your audience"
        invalid={counts.some(({ items }) => overLimit(items))}
        minRows={2}
        maxRows={10}
        footer={
          <>
            {counts.map(({ platform, items }) => (
              <PlatformCounts key={platform} platform={platform} items={items} />
            ))}
            {counts.length === 0 && (
              <>
                <CharacterCount count={countChars(composed)} srLabel="First comment" />
                <span className="text-xs text-muted">
                  Choose accounts to see each platform's limits
                </span>
              </>
            )}
            {appendsHashtags && (
              <span className="ml-auto text-xs text-muted">Includes hashtags</span>
            )}
          </>
        }
      />

      {appendsHashtags && (
        <figure
          aria-labelledby={previewTitleId}
          className="rounded-xl border border-brand-200/70 bg-brand-50/50 px-3.5 py-3 dark:border-brand-400/20 dark:bg-brand-500/[0.06]"
        >
          <figcaption
            id={previewTitleId}
            className="flex items-center gap-1.5 text-xs font-medium text-brand-700 dark:text-brand-300"
          >
            <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Hashtags will be added to this comment
          </figcaption>
          <p
            dir="auto"
            className="mt-1.5 text-sm leading-6 break-words whitespace-pre-wrap text-slate-700 dark:text-slate-200"
          >
            {composed}
          </p>
        </figure>
      )}

      <div className="rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-white/[0.03]">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
          <Info className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
          About the first comment
        </p>
        {notes.length > 0 ? (
          <ul className="mt-1.5 space-y-1.5">
            {notes.map(({ platform, note }) => (
              <li key={platform} className="flex gap-2 text-xs leading-relaxed text-muted">
                <InlinePlatformGlyph platform={platform} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {platformLabel(platform)}:
                  </span>{' '}
                  {note}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{GENERIC_NOTE}</p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {overMessage}
      </p>
    </div>
  );
}
