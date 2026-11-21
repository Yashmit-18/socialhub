import { AlignLeft, Eraser, MessageCircle } from 'lucide-react';
import { useId } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/Button.jsx';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES, platformLabel } from '../../constants/platformRules.js';
import { COMPOSER_PLATFORMS, composerActions } from '../../model/composerState.js';
import { HASHTAG_PLACEMENTS, TEXT_LIMITS, parseHashtagInput } from '../../model/text.js';
import { platformOutput } from '../../model/validation.js';
import { InlinePlatformGlyph } from './CharacterCount.jsx';
import { SOFT_LIMIT_NOTE, isSoftLimit } from './limits.js';
import { TagInput } from './TagInput.jsx';

const COMMIT_KEYS = ['Enter', ',', ' '];
const NEAR_LIMIT = 0.9;

function parseHashtags(text) {
  const { tags, errors } = parseHashtagInput(text);
  return { values: tags, errors };
}

const PLACEMENTS = [
  {
    value: HASHTAG_PLACEMENTS.CAPTION,
    label: 'Add to the end of the caption',
    description: 'Hashtags go after a blank line at the end of each caption.',
    icon: AlignLeft,
  },
  {
    value: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    label: 'Add to the first comment',
    description: 'Keeps captions clean. Hashtags go at the end of the first comment instead.',
    icon: MessageCircle,
  },
];

/**
 * Hashtag counts per platform that limits them, for where the hashtags end up. Hashtags typed
 * inside the caption count too (`platformOutput` counts the composed text).
 */
function hashtagUsage(state, platforms) {
  const rows = [];
  for (const platform of platforms) {
    const rules = PLATFORM_RULES[platform];
    if (!rules) continue;
    const output = platformOutput(state, platform);
    if (rules.caption.maxHashtags) {
      rows.push({
        key: `${platform}:caption`,
        platform,
        where: 'caption',
        count: output.captionHashtags,
        max: rules.caption.maxHashtags,
        soft: isSoftLimit(rules, 'caption.maxHashtags'),
        advisoryMax: rules.caption.advisoryMaxHashtags ?? null,
        advisoryNote: rules.caption.advisoryNote ?? null,
      });
    }
    if (
      state.hashtagPlacement === HASHTAG_PLACEMENTS.FIRST_COMMENT &&
      rules.firstComment?.maxHashtags
    ) {
      rows.push({
        key: `${platform}:firstComment`,
        platform,
        where: 'first comment',
        count: output.firstCommentHashtags,
        max: rules.firstComment.maxHashtags,
        soft: isSoftLimit(rules, 'firstComment.maxHashtags'),
        advisoryMax: null,
        advisoryNote: null,
      });
    }
  }
  return rows;
}

function HashtagUsageRow({ platform, where, count, max, soft, advisoryMax, advisoryNote }) {
  const label = platformLabel(platform);
  // A limit that Meta's docs do not confirm only warns: it is never shown as a hard error.
  const softOver = Boolean(soft) && count > max;
  const over = !soft && count > max;
  const advised = !over && !softOver && advisoryMax !== null && count > advisoryMax;
  const near = softOver || (!over && (advised || count >= max * NEAR_LIMIT));
  return (
    <li
      className="space-y-1.5"
      data-state={over ? 'over' : softOver ? 'over-soft' : near ? 'near' : 'ok'}
    >
      <p
        className={cn(
          'flex items-start gap-1.5 text-xs',
          over
            ? 'font-medium text-rose-600 dark:text-rose-400'
            : near
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-slate-600 dark:text-slate-300',
        )}
      >
        <InlinePlatformGlyph platform={platform} className="mt-px" />
        <span className="min-w-0">
          <span>{`${label}: ${count} of ${max} hashtags in the ${where}`}</span>
          {over && <span className="font-semibold"> · over the limit</span>}
          {softOver && (
            <span className="font-semibold">{` · over the usual limit (${SOFT_LIMIT_NOTE})`}</span>
          )}
        </span>
      </p>
      <div
        className="h-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10"
        aria-hidden="true"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            over ? 'bg-rose-500' : near ? 'bg-amber-500' : 'bg-brand-500',
          )}
          style={{ width: `${Math.min(100, (count / max) * 100)}%` }}
        />
      </div>
      {advised && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {`${label} now says posts can use up to ${advisoryMax} hashtags${
            advisoryNote ? ` (${advisoryNote})` : ''
          }, so some may not work.`}
        </p>
      )}
    </li>
  );
}

/**
 * Hashtag chips, where they go (end of the caption or the first comment) and, for platforms
 * that limit hashtags (Instagram), how many the composed caption / first comment contains.
 *
 * Props: state, dispatch, platforms (platforms with selected accounts), id, className.
 */
export function HashtagEditor({ state, dispatch, platforms = [], id, className }) {
  const baseId = useId();
  const placementLabelId = `${baseId}-placement`;
  const selectedPlatforms = COMPOSER_PLATFORMS.filter((p) => platforms.includes(p));
  const usage = hashtagUsage(state, selectedPlatforms);

  function clearAll() {
    const previous = state.hashtags;
    dispatch(composerActions.clearHashtags());
    toast(`Removed ${previous.length} ${previous.length === 1 ? 'hashtag' : 'hashtags'}`, {
      action: { label: 'Undo', onClick: () => dispatch(composerActions.addHashtags(previous)) },
    });
  }

  return (
    <div id={id} className={cn('space-y-5', className)}>
      <TagInput
        label="Hashtags"
        values={state.hashtags}
        onAdd={(tags) => dispatch(composerActions.addHashtags(tags))}
        onRemove={(tag) => dispatch(composerActions.removeHashtag(tag))}
        parse={parseHashtags}
        commitKeys={COMMIT_KEYS}
        placeholder={state.hashtags.length ? 'Add another hashtag' : '#summer #newarrivals'}
        max={TEXT_LIMITS.HASHTAGS_MAX}
        prefix="#"
        noun="hashtags"
        chipTone="brand"
        hint="Press Enter, space or comma after each hashtag. Paste a list to add them all at once."
        action={
          state.hashtags.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              Clear all
            </Button>
          )
        }
      />

      <div role="radiogroup" aria-labelledby={placementLabelId} className="space-y-2">
        <p id={placementLabelId} className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Hashtag placement
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLACEMENTS.map(({ value, label, description, icon: Icon }) => {
            const checked = state.hashtagPlacement === value;
            const titleId = `${baseId}-${value}-title`;
            const descriptionId = `${baseId}-${value}-description`;
            return (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                  checked
                    ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20',
                )}
              >
                <input
                  type="radio"
                  name={`${baseId}-placement`}
                  value={value}
                  checked={checked}
                  onChange={() => dispatch(composerActions.setHashtagPlacement(value))}
                  aria-labelledby={titleId}
                  aria-describedby={descriptionId}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className="min-w-0">
                  <span
                    id={titleId}
                    className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white"
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        checked ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400',
                      )}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                  <span
                    id={descriptionId}
                    className="mt-0.5 block text-xs leading-relaxed text-muted"
                  >
                    {description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {usage.length > 0 && (
        <ul
          aria-label="Hashtag limits"
          className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-white/10 dark:bg-white/[0.02]"
        >
          {usage.map(({ key, ...row }) => (
            <HashtagUsageRow key={key} {...row} />
          ))}
        </ul>
      )}
    </div>
  );
}
