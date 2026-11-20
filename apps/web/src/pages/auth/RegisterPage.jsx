import { registerSchema } from '@socialhub/shared';
import { Check } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FormError, Input, PasswordInput } from '../../components/ui/Field.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { cn, safeRedirect } from '../../lib/utils.js';

const RULES = [
  { label: '8+ characters', test: (v) => v.length >= 8 },
  { label: 'A letter', test: (v) => /[A-Za-z]/.test(v) },
  { label: 'A number', test: (v) => /\d/.test(v) },
];

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
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
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormError message={formError} />
        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="space-y-2">
          <PasswordInput
            label="Password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Password requirements">
            {RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li
                  key={rule.label}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs',
                    ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted',
                  )}
                >
                  <Check
                    className={cn('h-3.5 w-3.5', ok ? 'opacity-100' : 'opacity-30')}
                    aria-hidden="true"
                  />
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
