import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../../../lib/utils.js';
import { mergeUnique } from '../../model/text.js';

const CHIP_TONES = {
  brand: {
    chip: 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-400/25',
    remove:
      'text-brand-500 hover:bg-brand-100 hover:text-brand-800 dark:text-brand-300 dark:hover:bg-brand-500/20 dark:hover:text-white',
  },
  neutral: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10',
    remove:
      'text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white',
  },
  violet: {
    chip: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/25',
    remove:
      'text-violet-500 hover:bg-violet-100 hover:text-violet-800 dark:text-violet-300 dark:hover:bg-violet-500/20 dark:hover:text-white',
  },
};

const DEFAULT_COMMIT_KEYS = ['Enter', ','];
const MAX_ERRORS_SHOWN = 3;

const uniqueMessages = (messages) => [...new Set(messages.filter(Boolean))];
const countSeparators = (text, separators) =>
  [...text].filter((char) => separators.includes(char)).length;

/**
 * Chips with an inline text input, for hashtags and keywords.
 *
 * Text is committed (parsed into chips) when a key in `commitKeys` is pressed, when the input
 * loses focus, and on paste (the whole clipboard text is parsed, so a pasted list becomes many
 * chips). Separator characters typed on virtual keyboards that do not report keys are handled
 * too. Backspace in the empty input removes the last chip; ArrowLeft moves into the chips, where
 * ArrowLeft/ArrowRight/Home/End move between them and Backspace/Delete remove one. The chips
 * share one Tab stop (roving tabindex), so a long list never floods the Tab order.
 *
 * Case-insensitive duplicates are ignored silently. Invalid entries and the `max` limit are
 * reported in a `role="alert"` line; text that could not be added stays in the input to fix.
 *
 * Props:
 *  - label: visible label of the input (required)
 *  - values: string[] (without prefix)
 *  - onAdd(values: string[]): new, de-duplicated values that fit under `max`
 *  - onRemove(value: string)
 *  - parse(text) → { values: string[], errors: string[] }
 *  - commitKeys: KeyboardEvent.key values that commit (default ['Enter', ','])
 *  - placeholder, hint (below the input), description (above the input), disabled
 *  - max: number — shows "{n}/{max}" and blocks additions past it
 *  - prefix: shown before each value ('#' for hashtags)
 *  - noun: plural noun for messages ("You can add up to 60 hashtags.") — default 'items'
 *  - chipTone: 'brand' | 'neutral' | 'violet'
 *  - badge: node after the label; action: node at the end of the label row
 *  - id: id for the text input (defaults to a generated one)
 */
export function TagInput({
  label,
  values = [],
  onAdd,
  onRemove,
  parse,
  commitKeys = DEFAULT_COMMIT_KEYS,
  placeholder,
  max,
  prefix = '',
  hint,
  description,
  disabled = false,
  chipTone = 'brand',
  noun = 'items',
  badge,
  action,
  id,
  className,
}) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const labelId = `${inputId}-label`;
  const descriptionId = `${inputId}-description`;
  const hintId = `${inputId}-hint`;
  const countId = `${inputId}-count`;
  const errorId = `${inputId}-error`;

  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  /** Index of the chip that was focused last; the chips share a single Tab stop. */
  const [activeChip, setActiveChip] = useState(null);
  const inputRef = useRef(null);
  const chipsRef = useRef(null);
  /** Where focus goes once a removal has re-rendered: a chip index or 'input'. */
  const focusAfterRender = useRef(null);

  useEffect(() => {
    const target = focusAfterRender.current;
    if (target === null) return;
    focusAfterRender.current = null;
    const buttons = chipsRef.current?.querySelectorAll('[data-tag-remove]') ?? [];
    const chip = typeof target === 'number' ? buttons[Math.min(target, buttons.length - 1)] : null;
    (chip ?? inputRef.current)?.focus();
  });

  const limit = Number.isFinite(max) && max > 0 ? max : null;
  const atLimit = limit !== null && values.length >= limit;
  const tone = CHIP_TONES[chipTone] ?? CHIP_TONES.brand;
  const separators = commitKeys.filter((key) => key.length === 1);
  const display = (value) => `${prefix}${value}`;
  const invalid = errors.length > 0;
  // Roving tabindex: one chip is in the Tab order (the last one by default, next to the input).
  const tabbableChip =
    activeChip !== null && activeChip < values.length ? activeChip : values.length - 1;

  function commit(text) {
    const result = parse(text) ?? {};
    const parsed = result.values ?? [];
    const parseErrors = result.errors ?? [];
    const fresh = mergeUnique(values, parsed).slice(values.length);
    const room = limit === null ? fresh.length : Math.max(0, limit - values.length);
    const added = fresh.slice(0, room);
    const nextErrors = [...parseErrors];
    if (fresh.length > added.length) nextErrors.push(`You can add up to ${limit} ${noun}.`);

    if (added.length > 0) {
      onAdd(added);
      setAnnouncement(`Added ${added.map(display).join(', ')}`);
    }
    setErrors(uniqueMessages(nextErrors));
    // Keep text that could not be added at all, so it can be corrected.
    const keep = added.length === 0 && nextErrors.length > 0;
    setDraft(keep ? text.replace(/[\s,]+$/u, '') : '');
  }

  function focusChip(index) {
    chipsRef.current?.querySelectorAll('[data-tag-remove]')[index]?.focus();
  }

  function removeAt(index, nextFocus) {
    const value = values[index];
    if (value === undefined || disabled) return;
    onRemove(value);
    setErrors([]);
    setAnnouncement(`Removed ${display(value)}`);
    focusAfterRender.current = nextFocus;
  }

  function handleChange(event) {
    const next = event.target.value;
    if (errors.length > 0) setErrors([]);
    const composing = event.nativeEvent?.isComposing;
    // A separator that arrived without a usable keydown (virtual keyboards, autocorrect). Only an
    // edit that adds one commits, so kept text with errors can still be corrected freely.
    if (!composing && countSeparators(next, separators) > countSeparators(draft, separators)) {
      commit(next);
      return;
    }
    setDraft(next);
  }

  function handleKeyDown(event) {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    const { key } = event;
    if (commitKeys.includes(key)) {
      if (draft.trim()) {
        event.preventDefault();
        commit(draft);
      } else if (key.length === 1) {
        event.preventDefault(); // no stray separators in an empty input
      }
      return;
    }
    if (key === 'Backspace' && draft === '' && values.length > 0) {
      event.preventDefault();
      removeAt(values.length - 1, 'input');
      return;
    }
    if (key === 'ArrowLeft' && draft === '' && values.length > 0) {
      event.preventDefault();
      focusChip(values.length - 1);
    }
  }

  function handleBlur() {
    if (draft.trim()) commit(draft);
  }

  function handlePaste(event) {
    const data = event.clipboardData;
    const text = data?.getData('text/plain') || data?.getData('text') || '';
    if (!text) return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    commit(`${draft.slice(0, start)}${text}${draft.slice(end)}`);
  }

  function handleChipKeyDown(event, index) {
    switch (event.key) {
      case 'Backspace':
        event.preventDefault();
        removeAt(index, Math.max(0, index - 1));
        break;
      case 'Delete':
        event.preventDefault();
        removeAt(index, index);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (index > 0) focusChip(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (index < values.length - 1) focusChip(index + 1);
        else inputRef.current?.focus();
        break;
      case 'Home':
        event.preventDefault();
        focusChip(0);
        break;
      case 'End':
        event.preventDefault();
        focusChip(values.length - 1);
        break;
      default:
    }
  }

  function focusInputFromFrame(event) {
    if (event.target === event.currentTarget) inputRef.current?.focus();
  }

  const describedBy = [
    description && descriptionId,
    hint && hintId,
    limit !== null && countId,
    invalid && errorId,
  ]
    .filter(Boolean)
    .join(' ');
  const shownErrors = errors.slice(0, MAX_ERRORS_SHOWN);
  const hiddenErrors = errors.length - shownErrors.length;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label
            id={labelId}
            htmlFor={inputId}
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {label}
          </label>
          {badge}
        </div>
        <div className="flex items-center gap-1.5">
          {limit !== null && (
            <span
              id={countId}
              className={cn(
                'text-xs tabular-nums',
                atLimit ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted',
              )}
            >
              <span aria-hidden="true">
                {values.length}/{limit}
              </span>
              <span className="sr-only">{`${values.length} of ${limit} ${noun}`}</span>
            </span>
          )}
          {action}
        </div>
      </div>

      {description && (
        <div id={descriptionId} className="text-xs leading-relaxed text-muted">
          {description}
        </div>
      )}

      <div
        onClick={focusInputFromFrame}
        className={cn(
          'flex min-h-11 w-full cursor-text flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 shadow-xs transition focus-within:ring-4 dark:bg-slate-900/60',
          invalid
            ? 'border-rose-400 focus-within:border-rose-500 focus-within:ring-rose-500/15 dark:border-rose-500/60'
            : 'border-slate-200 focus-within:border-brand-500 focus-within:ring-brand-500/15 dark:border-white/10 dark:focus-within:border-brand-400',
          disabled && 'cursor-not-allowed bg-slate-50 opacity-70 dark:bg-slate-800/50',
        )}
      >
        {values.length > 0 && (
          <ul ref={chipsRef} role="list" aria-labelledby={labelId} className="contents">
            {values.map((value, index) => (
              <li
                key={value}
                role="listitem"
                className={cn(
                  'inline-flex h-7 max-w-full animate-scale-in items-center gap-0.5 rounded-lg pr-0.5 pl-2.5 text-[13px] font-medium ring-1 ring-inset',
                  tone.chip,
                )}
              >
                <span className="min-w-0 truncate" title={display(value)}>
                  {display(value)}
                </span>
                <button
                  type="button"
                  data-tag-remove=""
                  disabled={disabled}
                  aria-label={`Remove ${display(value)}`}
                  tabIndex={index === tabbableChip ? 0 : -1}
                  onFocus={() => setActiveChip(index)}
                  onClick={() => removeAt(index, index)}
                  onKeyDown={(event) => handleChipKeyDown(event, index)}
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed',
                    tone.remove,
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={atLimit ? `Limit of ${limit} reached` : placeholder}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          className="h-7 min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>

      {invalid && (
        <div
          id={errorId}
          role="alert"
          className="space-y-0.5 text-xs font-medium text-rose-600 dark:text-rose-400"
        >
          {shownErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {hiddenErrors > 0 && (
            <p>
              …and {hiddenErrors} more {hiddenErrors === 1 ? 'problem' : 'problems'}.
            </p>
          )}
        </div>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
