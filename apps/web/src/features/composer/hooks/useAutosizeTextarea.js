import { useEffect, useLayoutEffect } from 'react';

/**
 * Grows a textarea with its content, between `minRows` and `maxRows` lines. Past `maxRows` the
 * textarea scrolls instead of growing.
 *
 *   const ref = useRef(null);
 *   useAutosizeTextarea(ref, value, { minRows: 3, maxRows: 12 });
 *   return <textarea ref={ref} rows={3} value={value} … />;
 *
 * Give the textarea `rows={minRows}` (so the first paint already has the right height) and
 * `resize-none`. It re-measures when `value` changes, when the window is resized (line wrapping
 * changes) and once web fonts have loaded.
 *
 * Safe without layout (jsdom, server rendering, `display: none`): the height falls back to
 * `minRows` lines.
 */
export function useAutosizeTextarea(ref, value, { minRows = 3, maxRows = 12 } = {}) {
  useLayoutEffect(() => {
    fitTextarea(ref.current, { minRows, maxRows });
  }, [ref, value, minRows, maxRows]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let active = true;
    const refit = () => {
      if (active) fitTextarea(ref.current, { minRows, maxRows });
    };
    window.addEventListener('resize', refit);
    document.fonts?.ready?.then(refit).catch(() => {});
    return () => {
      active = false;
      window.removeEventListener('resize', refit);
    };
  }, [ref, minRows, maxRows]);
}

const FALLBACK_FONT_SIZE = 14;

function px(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Shrinking a textarea to measure it can briefly shorten the page, which makes the browser clamp
 * the scroll position of its scrolling ancestors. Remember them and put them back afterwards.
 */
function rememberScroll(el) {
  const saved = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollTop) saved.push([node, node.scrollTop]);
  }
  return () => {
    for (const [node, top] of saved) {
      if (node.scrollTop !== top) node.scrollTop = top;
    }
  };
}

/** Sets `el`'s height to fit its content, clamped to `minRows`…`maxRows` lines. */
export function fitTextarea(el, { minRows = 1, maxRows = Infinity } = {}) {
  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return;
  }
  const style = window.getComputedStyle(el);
  const fontSize = px(style.fontSize) || FALLBACK_FONT_SIZE;
  const lineHeight = px(style.lineHeight) || Math.round(fontSize * 1.5);
  const padding = px(style.paddingTop) + px(style.paddingBottom);
  const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const borderBox = style.boxSizing === 'border-box';
  const boxHeight = (lines) => lines * lineHeight + (borderBox ? padding + border : 0);

  const min = boxHeight(Math.max(1, minRows));
  const max =
    Number.isFinite(maxRows) && maxRows > 0 ? Math.max(min, boxHeight(maxRows)) : Infinity;

  const restoreScroll = rememberScroll(el);
  el.style.height = 'auto';
  // scrollHeight covers the content and the padding, never the border.
  const natural = borderBox ? el.scrollHeight + border : el.scrollHeight - padding;
  el.style.height = `${Math.min(max, Math.max(min, natural))}px`;
  el.style.overflowY = natural > max ? 'auto' : 'hidden';
  restoreScroll();
}
