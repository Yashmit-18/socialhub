import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils.js';

/** Space kept free between the trigger and the popover, and from the viewport edges. */
const GAP = 8;

/**
 * Lightweight popover menu. `trigger({ open, toggle, props })` renders the button;
 * `children(close)` renders the items. Closes on outside click and Escape.
 *
 * `portal` renders the popover in document.body with fixed positioning, for menus inside a
 * scrolling container (a table) that would otherwise clip it. A portal menu moves focus to
 * its first item when it opens, returns focus to the trigger when it closes, and closes when
 * the page scrolls or resizes, or when focus tabs out of it.
 */
export function Menu({
  trigger,
  children,
  align = 'right',
  side = 'bottom',
  className,
  portal = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onViewportChange = (e) => {
      // Scrolling inside the menu itself is fine; anything else moves the trigger.
      if (e?.type === 'scroll' && popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    if (portal) {
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('scroll', onViewportChange, true);
    }
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, portal]);

  // Portal menus are far from their trigger in the DOM, so keyboard focus is moved explicitly.
  useEffect(() => {
    if (!open || !portal) return undefined;
    const root = rootRef.current;
    const trigger = root?.querySelector('button, [href], [tabindex]');
    popoverRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      if (root?.contains(document.activeElement) || document.activeElement === document.body) {
        trigger?.focus?.();
      }
    };
  }, [open, portal]);

  const close = () => setOpen(false);

  // Portal menus are positioned next to their trigger before the browser paints; below it
  // when it fits, otherwise above it.
  useLayoutEffect(() => {
    if (!open || !portal) return;
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!root || !popover) return;
    const rect = root.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    const above =
      side === 'top' || (roomBelow < popover.offsetHeight + GAP && rect.top > roomBelow);
    const px = (value) => `${value}px`;
    Object.assign(popover.style, {
      top: above ? '' : px(rect.bottom + GAP),
      bottom: above ? px(window.innerHeight - rect.top + GAP) : '',
      left: align === 'left' ? px(Math.max(GAP, rect.left)) : '',
      right: align === 'right' ? px(Math.max(GAP, window.innerWidth - rect.right)) : '',
    });
  }, [open, portal, align, side]);

  const toggle = () => setOpen((v) => !v);

  const popoverClass = cn(
    'min-w-52 animate-scale-in rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-pop dark:border-white/10 dark:bg-slate-900',
    className,
  );

  const popover = portal ? (
    <div
      ref={popoverRef}
      role="menu"
      className={cn(
        popoverClass,
        'fixed z-50 max-h-[min(24rem,calc(100dvh-1rem))] overflow-y-auto',
      )}
      onKeyDown={(e) => {
        if (e.key === 'Tab') setOpen(false);
      }}
    >
      {children(close)}
    </div>
  ) : (
    <div
      ref={popoverRef}
      role="menu"
      className={cn(
        popoverClass,
        'absolute z-40',
        align === 'right' ? 'right-0' : 'left-0',
        side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
      )}
    >
      {children(close)}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        open,
        toggle,
        props: { 'aria-haspopup': 'menu', 'aria-expanded': open },
      })}
      {open && (portal ? createPortal(popover, document.body) : popover)}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger = false,
  disabled = false,
  className,
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5',
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1.5 h-px bg-slate-100 dark:bg-white/5" role="separator" />;
}
