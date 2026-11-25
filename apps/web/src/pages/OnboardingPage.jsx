import { createWorkspaceSchema } from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../components/ui/Brand.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormError, Input, Select } from '../components/ui/Field.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useApiForm } from '../hooks/useApiForm.js';
import { api } from '../lib/api.js';
import { keys, useWorkspaces } from '../lib/queries.js';
import { browserTimeZone, firstName, slugPreview, timeZones } from '../lib/utils.js';

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspaces = [] } = useWorkspaces();
  const zones = timeZones();
  const detected = browserTimeZone();

  const { register, submit, errors, isSubmitting, formError, watch } = useApiForm(
    createWorkspaceSchema,
    {
      defaultValues: { name: '', timezone: zones.includes(detected) ? detected : 'UTC' },
    },
  );
  const name = watch('name') ?? '';

  const onSubmit = submit(async (values) => {
    const { workspace } = await api.post('/workspaces', values);
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    navigate(`/w/${workspace.slug}`, { replace: true });
  });

  const isFirst = workspaces.length === 0;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div
        className="absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 animate-drift rounded-full bg-brand-500/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          {!isFirst && (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-slate-900 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Link>
          )}
        </div>
        <div className="surface auth-form animate-scale-in p-7 sm:p-9">
          <div className="flex h-12 w-12 animate-pop-in items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/30 ring-1 ring-white/25 ring-inset">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {isFirst ? `Welcome, ${firstName(user?.name)}` : 'Create a workspace'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            A workspace holds one brand or client: its team, its social accounts and its content.
            You can create more later.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
            <FormError message={formError} />
            <Input
              label="Workspace name"
              placeholder="Acme Social"
              autoFocus
              error={errors.name?.message}
              hint={
                name.trim().length >= 2
                  ? `Your URL will look like /w/${slugPreview(name) || 'workspace'}`
                  : 'Usually your company, brand or client name.'
              }
              {...register('name')}
            />
            <Select
              label="Time zone"
              hint="Used for scheduling and reports."
              error={errors.timezone?.message}
              {...register('timezone')}
            >
              {zones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              Create workspace
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
