import { X } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils.js';

const WIDTHS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

/**
 * Accessible dialog: portal, Escape to close, focus moved in and restored on close, scroll
 * lock. Tall content scrolls inside the dialog while its title and footer stay visible.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  // Read the latest onClose without re-running the effect: parents usually pass an inline
  // function, and re-running would move focus back to the first control on every render.
  const close = useEffectEvent(() => onClose?.());

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = panelRef.current?.querySelector(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])',
    );
    (focusable ?? panelRef.current)?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) close();
      if (e.key === 'Tab' && panelRef.current) {
        const nodes = [
          ...panelRef.current.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full animate-scale-in flex-col rounded-2xl border border-slate-200/80 bg-white shadow-pop focus:outline-none dark:border-white/10 dark:bg-slate-900',
          WIDTHS[size],
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white"
            >
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              data-modal-close
              onClick={onClose}
              className="-mr-2 -mt-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 dark:border-white/5 dark:bg-white/[0.02]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
