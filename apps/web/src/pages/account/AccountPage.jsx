import { changePasswordSchema, updateProfileSchema } from '@socialhub/shared';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, MonitorSmartphone, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '../../components/layout/AppShell.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card.jsx';
import { FormError, Input, PasswordInput } from '../../components/ui/Field.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { api } from '../../lib/api.js';
import { useWorkspaces } from '../../lib/queries.js';
import { storage } from '../../lib/utils.js';
import { LAST_WORKSPACE_KEY } from '../../components/layout/WorkspaceLayout.jsx';

function ProfileCard() {
  const { user, updateUser } = useAuth();
  const { register, submit, errors, isSubmitting, formError, formState, reset } = useApiForm(
    updateProfileSchema,
    { defaultValues: { name: user.name } },
  );

  const onSubmit = submit(async (values) => {
    const { user: updated } = await api.patch('/users/me', values);
    updateUser(updated);
    reset({ name: updated.name });
    toast.success('Profile updated');
  });

  return (
    <Card>
      <CardHeader icon={UserRound} title="Profile" description="How you appear to teammates." />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-5">
          <FormError message={formError} />
          <div className="flex items-center gap-4">
            <Avatar name={user.name} seed={user.id} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="truncate text-sm text-muted">{user.email}</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label="Full name"
              autoComplete="name"
              error={errors.name?.message}
              {...register('name')}
            />
            <Input
              label="Email"
              value={user.email}
              disabled
              readOnly
              hint="Email changes are not supported yet."
            />
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" loading={isSubmitting} disabled={!formState.isDirty}>
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { register, submit, errors, isSubmitting, formError, reset } = useApiForm(
    changePasswordSchema,
    { defaultValues: { currentPassword: '', newPassword: '' } },
  );

  const onSubmit = submit(async (values) => {
    await api.post('/users/me/password', values);
    reset();
    toast.success('Password changed. Other devices were signed out.');
  });

  return (
    <Card>
      <CardHeader
        icon={KeyRound}
        title="Password"
        description="Changing it signs you out on every other device."
      />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-5">
          <FormError message={formError} />
          <div className="grid gap-5 sm:grid-cols-2">
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register('currentPassword')}
            />
            <PasswordInput
              label="New password"
              autoComplete="new-password"
              hint="8+ characters with a letter and a number."
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { forgetSession } = useAuth();
  const navigate = useNavigate();
  const signOutEverywhere = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => {
      forgetSession();
      navigate('/login', { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader
        icon={MonitorSmartphone}
        title="Sessions"
        description="Signed in on a shared or lost device?"
      />
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Sign out of SocialHub on every browser and device, including this one.
        </p>
        <Button
          variant="danger-outline"
          loading={signOutEverywhere.isPending}
          onClick={() => signOutEverywhere.mutate()}
        >
          Sign out everywhere
        </Button>
      </CardBody>
    </Card>
  );
}

export default function AccountPage() {
  const { data: workspaces = [] } = useWorkspaces();
  const last = storage.get(LAST_WORKSPACE_KEY);
  const workspace = workspaces.find((w) => w.slug === last) ?? workspaces[0] ?? null;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        title="Account settings"
        description="Your personal profile and security settings, shared across all workspaces."
      />
      <div className="space-y-6">
        <ProfileCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </AppShell>
  );
}
