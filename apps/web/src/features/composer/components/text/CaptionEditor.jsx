import { CircleAlert, Layers, Link2, PenLine, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/Button.jsx';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_RULES, platformLabel } from '../../constants/platformRules.js';
import { useAutosizeTextarea } from '../../hooks/useAutosizeTextarea.js';
import {
  COMPOSER_PLATFORMS,
  captionForPlatform,
  composerActions,
  isPlatformCustomized,
} from '../../model/composerState.js';
import { HASHTAG_PLACEMENTS, composeCaption, countChars } from '../../model/text.js';
import { platformOutput } from '../../model/validation.js';
import { CharacterCount, InlinePlatformGlyph, PlatformCounts } from './CharacterCount.jsx';
import { isSoftLimit, overHardLimit } from './limits.js';

const ALL = 'ALL';
const LABEL_CLASS = 'text-sm font-medium text-slate-700 dark:text-slate-200';

/**
 * The composer's writing surface: an autosizing textarea in a framed editor with a footer row
 * for counters and notes. The footer is part of the textarea's accessible description, so
 * screen readers hear the limits when the field is focused.
 *
 * Props: id (required), value, onChange(value: string), placeholder, invalid, minRows,
 * maxRows, footer (node), describedBy (extra ids), className.
 */
export function ComposerTextarea({
  id,
  value,
  onChange,
  placeholder,
  invalid = false,
  minRows = 4,
  maxRows = 14,
  footer,
  describedBy,
  className,
}) {
  const ref = useRef(null);
  const footerId = `${id}-footer`;
  useAutosizeTextarea(ref, value, { minRows, maxRows });
  const description = [footer ? footerId : null, describedBy].filter(Boolean).join(' ');

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white shadow-xs transition focus-within:ring-4 dark:bg-slate-900/60',
        invalid
          ? 'border-rose-300 focus-within:border-rose-500 focus-within:ring-rose-500/15 dark:border-rose-500/50'
          : 'border-slate-200 focus-within:border-brand-500 focus-within:ring-brand-500/15 dark:border-white/10 dark:focus-within:border-brand-400',
        className,
      )}
    >
      <textarea
        ref={ref}
        id={id}
        rows={minRows}
        dir="auto"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={description || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="block w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      {footer && (
        <div
          id={footerId}
          className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-white/5 dark:bg-white/[0.02]"
        >
          {footer}
        </div>
      )}
    </div>
  );
}

/** Counter items for a platform's caption, from PLATFORM_RULES (never hard-coded limits). */
function captionCounts(output, platform, idBase) {
  const platformRules = PLATFORM_RULES[platform];
  const rules = platformRules?.caption ?? {};
  const items = [
    {
      id: `${idBase}-${platform}-characters`,
      unit: 'character',
      count: output.captionLength,
      max: rules.maxChars ?? null,
      soft: isSoftLimit(platformRules, 'caption.maxChars'),
    },
  ];
  if (rules.maxHashtags) {
    items.push({
      id: `${idBase}-${platform}-hashtags`,
      unit: 'hashtag',
      count: output.captionHashtags,
      max: rules.maxHashtags,
      soft: isSoftLimit(platformRules, 'caption.maxHashtags'),
    });
  }
  if (rules.maxMentions) {
    items.push({
      id: `${idBase}-${platform}-mentions`,
      unit: 'mention',
      count: output.captionMentions,
      max: rules.maxMentions,
      soft: isSoftLimit(platformRules, 'caption.maxMentions'),
    });
  }
  return items;
}

// Only limits that Meta documents make the caption invalid; unverified ones just warn.
const overLimit = overHardLimit;

const hashtagsInCaption = (state) =>
  state.hashtags.length > 0 && state.hashtagPlacement === HASHTAG_PLACEMENTS.CAPTION;

function IncludesHashtags() {
  return <span className="ml-auto text-xs text-muted">Includes hashtags</span>;
}

function SharedCaptionPanel({
  state,
  dispatch,
  editorId,
  sharedPlatforms,
  selectedPlatforms,
  customizedPlatforms,
  counts,
  invalid,
  onShowPlatform,
}) {
  const noAccounts = selectedPlatforms.length === 0;
  const unused = !noAccounts && sharedPlatforms.length === 0;
  const genericLength = countChars(
    composeCaption({
      caption: state.caption,
      hashtags: state.hashtags,
      hashtagPlacement: state.hashtagPlacement,
    }),
  );

  return (
    <div className="space-y-2.5">
      <ComposerTextarea
        id={editorId}
        value={state.caption}
        onChange={(value) => dispatch(composerActions.setCaption(value))}
        placeholder="What would you like to share?"
        invalid={invalid}
        minRows={4}
        maxRows={16}
        footer={
          <>
            {sharedPlatforms.map((platform) => (
              <PlatformCounts key={platform} platform={platform} items={counts[platform]} />
            ))}
            {noAccounts && (
              <>
                <CharacterCount count={genericLength} srLabel="Caption" />
                <span className="text-xs text-muted">
                  Choose accounts to see each platform's limits
                </span>
              </>
            )}
            {unused && (
              <span className="text-xs text-muted">
                Every selected platform has its own caption, so this one isn't used right now.
              </span>
            )}
            {hashtagsInCaption(state) && !unused && <IncludesHashtags />}
          </>
        }
      />
      {customizedPlatforms.length > 0 && (
        <ul className="space-y-1">
          {customizedPlatforms.map((platform) => {
            const label = platformLabel(platform);
            return (
              <li
                key={platform}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted"
              >
                <InlinePlatformGlyph platform={platform} />
                <span>{label} uses its own caption, so changes here don't apply to it.</span>
                <button
                  type="button"
                  onClick={() => onShowPlatform(platform)}
                  className="rounded font-medium text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400 dark:hover:text-brand-300"
                >
                  Edit {label} caption
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InheritedCaptionPanel({ platform, state, output, items, customizeId, onCustomize }) {
  const label = platformLabel(platform);
  // composeCaption returns the trimmed caption, then (maybe) a blank line and the hashtags.
  const body = captionForPlatform(state, platform).trim();
  const appended = output.caption.slice(body.length).trim();

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            Uses the shared caption
          </p>
          {body || appended ? (
            <p
              dir="auto"
              className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap text-slate-700 dark:text-slate-200"
            >
              {body}
              {body && appended ? '\n\n' : null}
              {appended && <span className="text-brand-700 dark:text-brand-300">{appended}</span>}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">The shared caption is empty.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-dashed border-slate-300/80 px-3 py-2 dark:border-white/10">
          <PlatformCounts platform={platform} items={items} />
          {appended && <IncludesHashtags />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-48 text-xs text-muted">
          Write a different caption that only {label} accounts use.
        </p>
        <Button id={customizeId} variant="secondary" size="sm" onClick={onCustomize}>
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          Customize for {label}
        </Button>
      </div>
    </div>
  );
}

function CustomCaptionPanel({ platform, state, dispatch, editorId, items, isSelected, onReset }) {
  const label = platformLabel(platform);
  return (
    <div className="space-y-2.5">
      <ComposerTextarea
        id={editorId}
        value={state.platformCaptions[platform] ?? ''}
        onChange={(value) => dispatch(composerActions.setPlatformCaption(platform, value))}
        placeholder={`Write a caption for ${label}`}
        invalid={overLimit(items)}
        minRows={4}
        maxRows={16}
        footer={
          <>
            <PlatformCounts platform={platform} items={items} />
            {hashtagsInCaption(state) && <IncludesHashtags />}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-48 text-xs text-muted">
          {isSelected
            ? `${label} accounts use this caption instead of the shared one.`
            : `No ${label} accounts are selected, so this caption isn't used right now.`}
        </p>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Use the shared caption
        </Button>
      </div>
    </div>
  );
}

/**
 * Caption editor with per-platform customization.
 *
 * Tabs: "All platforms" (the shared caption) and one tab per platform in `platforms` (the
 * platforms that have selected accounts — `validation.platforms`). A platform whose caption was
 * customized keeps its tab even when none of its accounts are selected, so the custom text is
 * never hidden. Counters use `platformOutput()` (the exact composed text, including hashtags
 * appended to the caption) against PLATFORM_RULES limits.
 *
 * Props: state, dispatch (composer reducer), platforms: string[], id (root element id),
 * className.
 */
export function CaptionEditor({ state, dispatch, platforms = [], id, className }) {
  const baseId = useId();
  const [selectedTab, setSelectedTab] = useState(ALL);
  /** Element id to focus once the next render has committed (set only by handlers). */
  const focusAfterRender = useRef(null);

  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    document.getElementById(target)?.focus();
  });

  const selectedPlatforms = COMPOSER_PLATFORMS.filter((p) => platforms.includes(p));
  const platformTabs = COMPOSER_PLATFORMS.filter(
    (p) => selectedPlatforms.includes(p) || isPlatformCustomized(state, p),
  );
  const tabs = [ALL, ...platformTabs];
  const active = tabs.includes(selectedTab) ? selectedTab : ALL;
  const activeCustomized = active !== ALL && isPlatformCustomized(state, active);

  const outputs = {};
  const counts = {};
  for (const platform of platformTabs) {
    outputs[platform] = platformOutput(state, platform);
    counts[platform] = captionCounts(outputs[platform], platform, `${baseId}-count`);
  }
  const sharedPlatforms = selectedPlatforms.filter((p) => !isPlatformCustomized(state, p));
  const customizedPlatforms = platformTabs.filter((p) => isPlatformCustomized(state, p));
  const over = { [ALL]: sharedPlatforms.some((p) => overLimit(counts[p])) };
  for (const platform of platformTabs) over[platform] = overLimit(counts[platform]);

  const tabId = (key) => `${baseId}-tab-${key}`;
  const panelId = `${baseId}-panel`;
  const editorId = (key) => `${baseId}-editor-${key}`;
  const customizeId = (platform) => `${baseId}-customize-${platform}`;

  function selectTab(key) {
    focusAfterRender.current = null;
    setSelectedTab(key);
  }

  function handleTabKeyDown(event) {
    const index = tabs.indexOf(active);
    const last = tabs.length - 1;
    const targets = {
      ArrowRight: index >= last ? 0 : index + 1,
      ArrowLeft: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]);
    document.getElementById(tabId(tabs[next]))?.focus();
  }

  function showPlatform(platform) {
    setSelectedTab(platform);
    focusAfterRender.current = isPlatformCustomized(state, platform)
      ? editorId(platform)
      : customizeId(platform);
  }

  function customize(platform) {
    dispatch(composerActions.customizePlatformCaption(platform));
    focusAfterRender.current = editorId(platform);
  }

  function resetToShared(platform) {
    const previous = state.platformCaptions[platform];
    const label = platformLabel(platform);
    dispatch(composerActions.resetPlatformCaption(platform));
    if (selectedPlatforms.includes(platform)) {
      focusAfterRender.current = customizeId(platform);
    } else {
      // Its tab disappears with the customization.
      setSelectedTab(ALL);
      focusAfterRender.current = tabId(ALL);
    }
    toast(`${label} uses the shared caption again`, {
      action: {
        label: 'Undo',
        onClick: () => dispatch(composerActions.setPlatformCaption(platform, previous ?? '')),
      },
    });
  }

  const heading = active === ALL ? 'Caption' : `${platformLabel(active)} caption`;
  const overMessage = selectedPlatforms
    .filter((platform) => over[platform])
    .map((platform) => `The ${platformLabel(platform)} caption is over the limit.`)
    .join(' ');

  return (
    <div id={id} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {active === ALL || activeCustomized ? (
          <label htmlFor={editorId(active)} className={LABEL_CLASS}>
            {heading}
          </label>
        ) : (
          <p className={LABEL_CLASS}>{heading}</p>
        )}
        <div
          role="tablist"
          aria-label="Caption versions"
          onKeyDown={handleTabKeyDown}
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-white/[0.06]"
        >
          {tabs.map((key) => {
            const isActive = key === active;
            const isCustom = key !== ALL && isPlatformCustomized(state, key);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={tabId(key)}
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(key)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition',
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5 dark:bg-slate-800 dark:text-white dark:ring-white/10'
                    : 'text-slate-500 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                {key === ALL ? (
                  <>
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span aria-hidden="true" className="sm:hidden">
                      All
                    </span>
                    <span className="sr-only sm:not-sr-only">All platforms</span>
                  </>
                ) : (
                  <>
                    <InlinePlatformGlyph platform={key} />
                    <span>{platformLabel(key)}</span>
                  </>
                )}
                {isCustom && (
                  <>
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400"
                      aria-hidden="true"
                    />
                    <span className="sr-only">, customized</span>
                  </>
                )}
                {over[key] && (
                  <>
                    <CircleAlert className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                    <span className="sr-only">, over the limit</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(active)}
        // The read-only preview starts with text, so the panel itself takes focus (WAI-ARIA tabs).
        tabIndex={active === ALL || activeCustomized ? undefined : 0}
        className="rounded-2xl"
      >
        {active === ALL ? (
          <SharedCaptionPanel
            state={state}
            dispatch={dispatch}
            editorId={editorId(ALL)}
            sharedPlatforms={sharedPlatforms}
            selectedPlatforms={selectedPlatforms}
            customizedPlatforms={customizedPlatforms}
            counts={counts}
            invalid={over[ALL]}
            onShowPlatform={showPlatform}
          />
        ) : activeCustomized ? (
          <CustomCaptionPanel
            key={`custom-${active}`}
            platform={active}
            state={state}
            dispatch={dispatch}
            editorId={editorId(active)}
            items={counts[active]}
            isSelected={selectedPlatforms.includes(active)}
            onReset={() => resetToShared(active)}
          />
        ) : (
          <InheritedCaptionPanel
            key={`inherited-${active}`}
            platform={active}
            state={state}
            output={outputs[active]}
            items={counts[active]}
            customizeId={customizeId(active)}
            onCustomize={() => customize(active)}
          />
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {overMessage}
      </p>
    </div>
  );
}
