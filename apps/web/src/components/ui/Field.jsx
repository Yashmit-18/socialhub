import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState } from 'react';
import { cn } from '../../lib/utils.js';

// 16 px text below `sm` so phones do not zoom into a field on focus.
const controlClass = (invalid) =>
  cn(
    'block w-full rounded-xl border bg-white px-3.5 text-base text-slate-900 shadow-[0_1px_2px_rgb(24_20_51/0.05)] transition-[border-color,box-shadow,background-color] duration-200 ease-out placeholder:text-slate-400 sm:text-sm',
    'focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
    'dark:bg-white/[0.03] dark:text-slate-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.03)] dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/50',
    invalid
      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/15 dark:border-rose-500/60'
      : 'border-slate-200 hover:border-slate-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-white/10 dark:hover:border-white/20 dark:focus:border-brand-400 dark:focus:bg-white/[0.05] dark:focus:ring-brand-400/20',
  );

/** The field's own message id joined with ids the caller passes (a checklist, a note). */
const joinIds = (...ids) => ids.filter(Boolean).join(' ') || undefined;

/**
 * Label + control + hint/error wiring with accessible ids. `children(id, describedBy)` renders
 * the control. `labelAction` sits at the right of the label row (e.g. "Forgot password?");
 * with `labelActionLast` it comes after the control in the tab order while staying in the
 * label row on screen.
 */
export function Field({ label, hint, error, className, children, labelAction, labelActionLast }) {
  const id = useId();
  const messageId = `${id}-message`;
  const labelEl = label && (
    <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
      {label}
    </label>
  );
  const message = error ? (
    <p id={messageId} role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
      {error}
    </p>
  ) : hint ? (
    <p id={messageId} className="text-xs text-muted">
      {hint}
    </p>
  ) : null;
  const control = children(id, error || hint ? messageId : undefined);

  if (labelAction && labelActionLast) {
    return (
      <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1.5', className)}>
        <div className="col-start-1 row-start-1 min-w-0">{labelEl}</div>
        <div className="col-span-2 row-start-2">{control}</div>
        <div className="col-start-2 row-start-1">{labelAction}</div>
        {message && <div className="col-span-2 row-start-3">{message}</div>}
      </div>
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-3">
          {labelEl}
          {labelAction}
        </div>
      )}
      {control}
      {message}
    </div>
  );
}

export const Input = forwardRef(function Input(
  {
    label,
    hint,
    error,
    className,
    inputClassName,
    labelAction,
    labelActionLast,
    'aria-describedby': describedByExtra,
    ...props
  },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      className={className}
      labelAction={labelAction}
      labelActionLast={labelActionLast}
    >
      {(id, describedBy) => (
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={joinIds(describedBy, describedByExtra)}
          className={cn(controlClass(Boolean(error)), 'h-10', inputClassName)}
          {...props}
        />
      )}
    </Field>
  );
});

export const PasswordInput = forwardRef(function PasswordInput(
  {
    label,
    hint,
    error,
    className,
    inputClassName,
    labelAction,
    labelActionLast,
    'aria-describedby': describedByExtra,
    ...props
  },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      className={className}
      labelAction={labelAction}
      labelActionLast={labelActionLast}
    >
      {(id, describedBy) => (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            aria-invalid={error ? true : undefined}
            aria-describedby={joinIds(describedBy, describedByExtra)}
            className={cn(controlClass(Boolean(error)), 'h-10 pr-11', inputClassName)}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-slate-400 transition-colors hover:text-slate-600 focus-visible:-outline-offset-2 dark:hover:text-slate-200"
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      )}
    </Field>
  );
});

export const Select = forwardRef(function Select(
  {
    label,
    hint,
    error,
    className,
    inputClassName,
    labelAction,
    children,
    'aria-describedby': describedByExtra,
    ...props
  },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} className={className} labelAction={labelAction}>
      {(id, describedBy) => (
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={joinIds(describedBy, describedByExtra)}
          className={cn(controlClass(Boolean(error)), 'select-chevron h-10 pr-9', inputClassName)}
          {...props}
        >
          {children}
        </select>
      )}
    </Field>
  );
});

/** A multi-line text field with the same label, hint and error wiring as Input. */
export const Textarea = forwardRef(function Textarea(
  {
    label,
    hint,
    error,
    className,
    inputClassName,
    labelAction,
    rows = 4,
    'aria-describedby': describedByExtra,
    ...props
  },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} className={className} labelAction={labelAction}>
      {(id, describedBy) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={joinIds(describedBy, describedByExtra)}
          className={cn(
            controlClass(Boolean(error)),
            'min-h-20 resize-y py-2.5 leading-relaxed',
            inputClassName,
          )}
          {...props}
        />
      )}
    </Field>
  );
});

export function FormError({ message }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
    >
      {message}
    </div>
  );
}
