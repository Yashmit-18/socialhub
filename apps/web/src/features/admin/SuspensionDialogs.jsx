import { adminReactivateUserSchema, adminSuspendUserSchema } from '@socialhub/shared';
import { useId } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError, PasswordInput, Textarea } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { ImpactList } from './AdminUi.jsx';
import { conflictMessage, plural, reactivateImpact, suspendImpact } from './adminFormat.js';
import { useAdminUser, useReactivateUser, useSuspendUser } from './api.js';

/** A numbered step of a dialog; the section is named by its heading. */
function Step({ number, title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3
        id={id}
        className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white"
      >
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white tabular-nums dark:bg-white/15"
        >
          {number}
        </span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The impact preview: what the action will do, read again when the dialog opened. */
function Impact({ detail, build }) {
  if (!detail.data) {
    return (
      <div className="space-y-2.5 rounded-xl border border-slate-200 p-4 dark:border-white/10">
        <p role="status" className="sr-only">
          Counting sessions, workspaces and posts…
        </p>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  const { lines, deliveries } = build(detail.data);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <ImpactList lines={lines} />
      {deliveries && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-muted dark:border-white/10">
          A delivery is one post going to one Facebook Page or Instagram account.
        </p>
      )}
    </div>
  );
}

/**
 * Runs the action and turns a refused one (409) into a sentence for the top of the form; the
 * page behind is refreshed by the hook. Field errors (a wrong password) pass through to
 * useApiForm, which puts them under their field.
 */
async function confirm(action) {
  try {
    return await action();
  } catch (error) {
    const conflict = conflictMessage(error);
    if (conflict) throw new Error(conflict, { cause: error });
    throw error;
  }
}

/** Suspend an account: the impact, a reason for the audit log, and the admin's own password. */
export function SuspendUserDialog({ userId, onClose }) {
  const detail = useAdminUser(userId, { fresh: true });
  const suspend = useSuspendUser();
  const { register, submit, errors, formError, isSubmitting } = useApiForm(adminSuspendUserSchema, {
    defaultValues: { reason: '', password: '' },
  });
  const name = detail.data?.user.name ?? 'this account';
  // Confirm only against numbers read just now, and only while suspending is still possible.
  const ready = Boolean(detail.data?.actions.canSuspend) && !detail.isFetching;

  const onSubmit = submit(async (values) => {
    const { result } = await confirm(() => suspend.mutateAsync({ userId, ...values }));
    toast.success('Account suspended', {
      description: [
        `${plural(result.sessionsEnded, 'session', 'sessions')} ended`,
        result.resetLinkCleared && 'the password reset link stopped working',
      ]
        .filter(Boolean)
        .join(', '),
    });
    onClose();
  });

  return (
    <Modal
      open
      size="md"
      title={`Suspend ${name}?`}
      description="This takes effect immediately."
      onClose={onClose}
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="suspend-user-form"
            loading={isSubmitting}
            disabled={!ready}
          >
            Suspend account
          </Button>
        </>
      }
    >
      <form id="suspend-user-form" onSubmit={onSubmit} noValidate className="space-y-6">
        <FormError message={formError} />
        <Step number={1} title="What will happen">
          <Impact detail={detail} build={suspendImpact} />
        </Step>
        <Step number={2} title="Why">
          <Textarea
            label="Reason"
            hint="Kept in the audit log. The person and their team never see it."
            error={errors.reason?.message}
            rows={3}
            maxLength={500}
            placeholder="For example: posted the same link to 40 Pages within an hour"
            {...register('reason')}
          />
        </Step>
        <Step number={3} title="Confirm it is you">
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </Step>
      </form>
    </Modal>
  );
}

/** Reactivate a suspended account: what it restores and what it does not, then the password. */
export function ReactivateUserDialog({ userId, onClose }) {
  const detail = useAdminUser(userId, { fresh: true });
  const reactivate = useReactivateUser();
  const { register, submit, errors, formError, isSubmitting } = useApiForm(
    adminReactivateUserSchema,
    { defaultValues: { note: '', password: '' } },
  );
  const name = detail.data?.user.name ?? 'this account';
  const ready = Boolean(detail.data?.actions.canReactivate) && !detail.isFetching;

  const onSubmit = submit(async (values) => {
    await confirm(() => reactivate.mutateAsync({ userId, ...values }));
    toast.success('Account reactivated', { description: 'They can sign in again.' });
    onClose();
  });

  return (
    <Modal
      open
      size="md"
      title={`Reactivate ${name}?`}
      description="They will be able to sign in again."
      onClose={onClose}
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="reactivate-user-form"
            loading={isSubmitting}
            disabled={!ready}
          >
            Reactivate account
          </Button>
        </>
      }
    >
      <form id="reactivate-user-form" onSubmit={onSubmit} noValidate className="space-y-6">
        <FormError message={formError} />
        <Step number={1} title="What will happen">
          <Impact detail={detail} build={reactivateImpact} />
        </Step>
        <Step number={2} title="Note (optional)">
          <Textarea
            label="Note"
            hint="Kept in the audit log."
            error={errors.note?.message}
            rows={2}
            maxLength={500}
            {...register('note')}
          />
        </Step>
        <Step number={3} title="Confirm it is you">
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </Step>
      </form>
    </Modal>
  );
}
