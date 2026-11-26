import { useRef } from 'react';
import { cn } from '../../lib/utils.js';
import { segmentItem, segmentTrack } from './segmented.js';

const MODELS = {
  // Toggle buttons (filters, view switches): every button is a tab stop.
  pressed: { group: 'group', item: undefined, state: 'aria-pressed', roving: false },
  // Tabs over panels the page shows below (pass `controls` ids on the options).
  tabs: { group: 'tablist', item: 'tab', state: 'aria-selected', roving: true },
  // One choice of several, like radio buttons.
  radio: { group: 'radiogroup', item: 'radio', state: 'aria-checked', roving: true },
};

const normalise = (option) =>
  Array.isArray(option) ? { value: option[0], label: option[1] } : option;

/**
 * A row of mutually exclusive buttons on a grey track. `options` are `[value, label]` pairs or
 * `{ value, label, icon, count, disabled, controls, ariaLabel }`. `model` picks the ARIA
 * pattern the place already uses: 'pressed' (role group + aria-pressed, the default), 'tabs'
 * (tablist) or 'radio' (radiogroup); the last two move with the arrow keys and keep one tab
 * stop. `onChange` runs only when the choice changes.
 */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  size = 'md',
  model = 'pressed',
  className,
}) {
  const spec = MODELS[model] ?? MODELS.pressed;
  const items = options.map(normalise);
  const refs = useRef([]);
  const enabled = items.map((item, i) => (item.disabled ? null : i)).filter((i) => i !== null);
  const activeIndex = items.findIndex((item) => item.value === value);

  const choose = (item) => {
    if (!item.disabled && item.value !== value) onChange(item.value);
  };

  const onKeyDown = (event, index) => {
    if (!spec.roving) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = { Home: 0, End: enabled.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const at = enabled.indexOf(index);
    const nextAt =
      edge !== undefined ? edge : (at + step + enabled.length) % Math.max(1, enabled.length);
    const next = enabled[nextAt];
    if (next === undefined) return;
    refs.current[next]?.focus();
    choose(items[next]);
  };

  return (
    <div role={spec.group} aria-label={label} className={cn(segmentTrack, className)}>
      {items.map((item, index) => {
        const active = item.value === value;
        const Icon = item.icon;
        const tabStop = activeIndex === -1 ? index === enabled[0] : active;
        return (
          <button
            key={String(item.value)}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role={spec.item}
            {...{ [spec.state]: active }}
            aria-controls={item.controls}
            aria-label={item.ariaLabel}
            tabIndex={spec.roving ? (tabStop ? 0 : -1) : undefined}
            disabled={item.disabled}
            onClick={() => choose(item)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={segmentItem(active, size)}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <span className="font-semibold tabular-nums">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
