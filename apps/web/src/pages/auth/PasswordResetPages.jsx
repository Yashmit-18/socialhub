import { forgotPasswordSchema, passwordSchema } from '@socialhub/shared';
import { MailCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormError, Input, PasswordInput } from '../../components/ui/Field.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { request } from '../../lib/api.js';

function Notice({ icon: Icon, title, children }) {
  return (
    <div className="surface p-6 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-semibold">{title}</h2>
      <div className="mt-1.5 text-sm text-muted">{children}</div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState(null);
  const { register, submit, errors, isSubmitting, formError } = useApiForm(forgotPasswordSchema, {
    defaultValues: { email: '' },
  });

  const onSubmit = submit(async (values) => {
    await request('/auth/forgot-password', { auth: false, method: 'POST', body: values });
    setSentTo(values.email);
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={
        <Link
          to="/login"
          className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
        >
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <Notice icon={MailCheck} title="Check your inbox">
          If an account exists for{' '}
          <strong className="text-slate-700 dark:text-slate-200">{sentTo}</strong>, a reset link is
          on its way. It can be used once and expires shortly.
        </Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <FormError message={formError} />
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { error: 'Passwords do not match', path: ['confirm'] });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const { register, submit, errors, isSubmitting, formError } = useApiForm(resetFormSchema, {
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = submit(async ({ password }) => {
    await request('/auth/reset-password', {
      auth: false,
      method: 'POST',
      body: { token, password },
    });
    setDone(true);
  });

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="For your security, this signs you out on every device."
    >
      {!token ? (
        <FormError message="This reset link is incomplete. Request a new one from the sign-in page." />
      ) : done ? (
        <Notice icon={ShieldCheck} title="Password updated">
          <p>You can now sign in with your new password.</p>
          <Link
            to="/login"
            className="mt-4 inline-block font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
          >
            Go to sign in
          </Link>
        </Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <FormError message={formError} />
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            hint="At least 8 characters with a letter and a number."
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordInput
            label="Confirm password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
