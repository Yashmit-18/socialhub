import { loginSchema } from '@socialhub/shared';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormError, Input, PasswordInput } from '../../components/ui/Field.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { safeRedirect } from '../../lib/utils.js';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const { register, submit, errors, isSubmitting, formError } = useApiForm(loginSchema, {
    defaultValues: { email: params.get('email') ?? '', password: '' },
  });

  const onSubmit = submit(async (values) => {
    await signIn(values);
    navigate(redirect, { replace: true });
  });

  const registerHref = `/register${params.toString() ? `?${params}` : ''}`;

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your workspaces."
      pageTitle="Sign in"
      footer={
        <>
          New to SocialHub?{' '}
          <Link
            to={registerHref}
            className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormError message={formError} />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          inputClassName="h-11"
          error={errors.email?.message}
          {...register('email')}
        />
        {/* The link stays in the label row but comes after the field in the tab order. */}
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          inputClassName="h-11"
          error={errors.password?.message}
          labelActionLast
          labelAction={
            <Link
              to="/forgot-password"
              className="rounded text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
            >
              Forgot password?
            </Link>
          }
          {...register('password')}
        />
        <Button type="submit" size="lg" className="h-11 w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
