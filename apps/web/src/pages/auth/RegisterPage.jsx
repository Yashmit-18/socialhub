import { registerSchema } from '@socialhub/shared';
import { useId } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { PasswordChecklist } from '../../components/auth/PasswordChecklist.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormError, Input, PasswordInput } from '../../components/ui/Field.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { safeRedirect } from '../../lib/utils.js';

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const checklistId = useId();
  const { register, submit, errors, isSubmitting, formError, watch } = useApiForm(registerSchema, {
    defaultValues: { name: '', email: params.get('email') ?? '', password: '' },
  });
  const password = watch('password') ?? '';

  const onSubmit = submit(async (values) => {
    await signUp(values);
    navigate(redirect, { replace: true });
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up SocialHub for your team in a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={`/login${params.toString() ? `?${params}` : ''}`}
            className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          required
          inputClassName="h-11"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          inputClassName="h-11"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="space-y-2">
          <PasswordInput
            label="Password"
            autoComplete="new-password"
            required
            inputClassName="h-11"
            aria-describedby={checklistId}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordChecklist id={checklistId} value={password} />
        </div>
        <Button type="submit" size="lg" className="h-11 w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
