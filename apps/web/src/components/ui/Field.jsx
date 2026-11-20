import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState } from 'react';
import { cn } from '../../lib/utils.js';

const controlClass = (invalid) =>
  cn(
    'block w-full rounded-xl border bg-white px-3.5 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400',
    'focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
    'dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/50',
    invalid
      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/15 dark:border-rose-500/60'
      : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500/15 dark:border-white/10 dark:focus:border-brand-400',
  );

/** Label + control + hint/error wiring with accessible ids. `children(id, describedBy)` renders the control. */
export function Field({ label, hint, error, className, children, labelAction }) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className="block text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {label}
          </label>
          {labelAction}
        </div>
      )}
      {children(id, error || hint ? messageId : undefined)}
      {error ? (
        <p
          id={messageId}
          role="alert"
          className="text-xs font-medium text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { label, hint, error, className, inputClassName, labelAction, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} className={className} labelAction={labelAction}>
      {(id, describedBy) => (
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass(Boolean(error)), 'h-10', inputClassName)}
          {...props}
        />
      )}
    </Field>
  );
});

export const PasswordInput = forwardRef(function PasswordInput(
  { label, hint, error, className, labelAction, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} className={className} labelAction={labelAction}>
      {(id, describedBy) => (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(controlClass(Boolean(error)), 'h-10 pr-11')}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
  { label, hint, error, className, children, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass(Boolean(error)), 'h-10 pr-9')}
          {...props}
        >
          {children}
        </select>
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
