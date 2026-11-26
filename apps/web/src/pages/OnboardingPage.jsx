import { createWorkspaceSchema, isPlatformAdmin } from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../components/ui/Button.jsx';
import { CenteredShell } from '../components/ui/CenteredShell.jsx';
import { PageLoader } from '../components/ui/Feedback.jsx';
import { FormError, Input, Select } from '../components/ui/Field.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { clearLocalDraftsForUser } from '../features/composer/services/localStore.js';
import { useApiForm } from '../hooks/useApiForm.js';
import { api } from '../lib/api.js';
import { keys, useWorkspaces } from '../lib/queries.js';
import { browserTimeZone, cn, firstName, slugPreview, timeZones } from '../lib/utils.js';

// What follows a first workspace, in the words the Overview checklist uses. A preview, not links.
const NEXT_STEPS = [
  'Create a workspace',
  'Connect your Facebook Pages and Instagram accounts',
  'Invite your team',
];

export default function OnboardingPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspaces = [], isPending } = useWorkspaces();
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

  const signOutHere = async () => {
    const userId = user?.id;
    await signOut();
    // As in the account menu: composer drafts are plain text in this browser.
    clearLocalDraftsForUser(userId);
    navigate('/login', { replace: true });
  };

  // Until the workspaces are known the heading and the Back link would flicker.
  if (isPending) return <PageLoader fullScreen />;

  const isFirst = workspaces.length === 0;
  // A platform admin without a workspace came from the console: "/" takes them back there.
  const canGoBack = !isFirst || isPlatformAdmin(user);

  return (
    <CenteredShell
      width="lg"
      action={
        canGoBack && (
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </Link>
        )
      }
      footer={
        user && (
          <p className="break-words">
            Signed in as <span className="font-medium">{user.email}</span>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              onClick={signOutHere}
              className="rounded font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
            >
              Sign out
            </button>
          </p>
        )
      }
    >
      <div className="auth-form">
        <div className="flex h-12 w-12 animate-pop-in items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/30 ring-1 ring-white/25 ring-inset">
          <Building2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {isFirst ? `Welcome, ${firstName(user?.name)}` : 'Create a workspace'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          A workspace holds one brand or client: its team, its social accounts and its content. You
          can create more later.
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

        {isFirst && (
          <ol
            aria-label="Setup steps"
            className="mt-7 space-y-2.5 border-t border-slate-100 pt-5 dark:border-white/[0.06]"
          >
            {NEXT_STEPS.map((label, index) => (
              <li
                key={label}
                aria-current={index === 0 ? 'step' : undefined}
                className="flex items-center gap-3 text-sm"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    index === 0
                      ? 'bg-brand-600 text-white'
                      : 'border border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400',
                  )}
                >
                  {index + 1}
                </span>
                <span
                  className={
                    index === 0 ? 'font-medium text-slate-900 dark:text-white' : 'text-muted'
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </CenteredShell>
  );
}
