import {
  PERMISSIONS,
  ROLES,
  deleteWorkspaceSchema,
  transferOwnershipSchema,
  updateWorkspaceSchema,
} from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Building2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card.jsx';
import { FormError, Input, PasswordInput, Select } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { api } from '../../lib/api.js';
import { keys, useMembers } from '../../lib/queries.js';
import { timeZones } from '../../lib/utils.js';

function GeneralSettings() {
  const { workspace, can } = useWorkspace();
  const editable = can(PERMISSIONS.WORKSPACE_UPDATE);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const defaults = { name: workspace.name, slug: workspace.slug, timezone: workspace.timezone };
  const { register, submit, errors, isSubmitting, formError, reset, formState } = useApiForm(
    updateWorkspaceSchema,
    { defaultValues: defaults },
  );

  useEffect(() => {
    reset({ name: workspace.name, slug: workspace.slug, timezone: workspace.timezone });
  }, [workspace.name, workspace.slug, workspace.timezone, reset]);

  const onSubmit = submit(async (values) => {
    const changed = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== workspace[k]),
    );
    if (Object.keys(changed).length === 0) return;
    const { workspace: updated } = await api.patch(`/workspaces/${workspace.id}`, changed);
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    toast.success('Workspace settings saved');
    if (updated.slug !== workspace.slug) navigate(`/w/${updated.slug}/settings`, { replace: true });
  });

  const zones = timeZones();

  return (
    <Card>
      <CardHeader
        icon={Building2}
        title="General"
        description="Basic details for this workspace."
      />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-5">
          <FormError message={formError} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label="Workspace name"
              disabled={!editable}
              error={errors.name?.message}
              {...register('name')}
            />
            <Input
              label="Workspace URL"
              disabled={!editable}
              hint={`Links look like /w/${workspace.slug}`}
              error={errors.slug?.message}
              {...register('slug')}
            />
          </div>
          <Select
            label="Time zone"
            disabled={!editable}
            error={errors.timezone?.message}
            {...register('timezone')}
          >
            {[...new Set([workspace.timezone, ...zones])].map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </CardBody>
        {editable && (
          <CardFooter>
            <Button type="submit" loading={isSubmitting} disabled={!formState.isDirty}>
              Save changes
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}

function TransferOwnership() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { data: members = [] } = useMembers(workspace.id);
  const candidates = members.filter((m) => m.role !== ROLES.OWNER);
  const [open, setOpen] = useState(false);
  const { register, submit, errors, isSubmitting, formError, reset } = useApiForm(
    transferOwnershipSchema,
    { defaultValues: { memberId: '', password: '' } },
  );

  const onSubmit = submit(async (values) => {
    await api.post(`/workspaces/${workspace.id}/transfer-ownership`, values);
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    await queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] });
    toast.success('Ownership transferred. You are now an admin.');
    setOpen(false);
  });

  return (
    <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Transfer ownership</p>
        <p className="mt-0.5 text-sm text-muted">
          Make another member the owner. You will become an admin.
        </p>
      </div>
      <Button
        variant="danger-outline"
        disabled={candidates.length === 0}
        title={candidates.length === 0 ? 'Invite another member first' : undefined}
        onClick={() => {
          reset({ memberId: candidates[0]?.id ?? '', password: '' });
          setOpen(true);
        }}
      >
        <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Transfer
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Transfer ownership"
        description="The new owner gets full control, including deleting the workspace."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" form="transfer-form" loading={isSubmitting}>
              Transfer ownership
            </Button>
          </>
        }
      >
        <form id="transfer-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Select label="New owner" error={errors.memberId?.message} {...register('memberId')}>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.name} ({m.user.email})
              </option>
            ))}
          </Select>
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </form>
      </Modal>
    </div>
  );
}

function DeleteWorkspace() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { register, submit, errors, isSubmitting, formError, reset, watch } = useApiForm(
    deleteWorkspaceSchema,
    { defaultValues: { confirmation: '', password: '' } },
  );
  const matches = watch('confirmation') === workspace.name;

  const onSubmit = submit(async (values) => {
    await api.delete(`/workspaces/${workspace.id}`, values);
    queryClient.removeQueries({ queryKey: ['workspace', workspace.id] });
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    toast.success(`${workspace.name} was deleted`);
    navigate('/', { replace: true });
  });

  return (
    <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Delete workspace</p>
        <p className="mt-0.5 text-sm text-muted">
          Permanently remove the workspace, its members, invitations, activity and account
          connections.
        </p>
      </div>
      <Button
        variant="danger"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${workspace.name}?`}
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="delete-form"
              loading={isSubmitting}
              disabled={!matches}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <form id="delete-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input
            label={
              <>
                Type <strong>{workspace.name}</strong> to confirm
              </>
            }
            autoComplete="off"
            error={errors.confirmation?.message}
            {...register('confirmation')}
          />
          <PasswordInput
            label="Your password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </form>
      </Modal>
    </div>
  );
}

export default function SettingsPage() {
  const { role, can } = useWorkspace();
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Manage how this workspace is named, addressed and owned."
      />
      <div className="space-y-6">
        <GeneralSettings />
        {role === ROLES.OWNER && (
          <Card className="border-rose-200/80 dark:border-rose-500/20">
            <CardHeader
              icon={AlertTriangle}
              title="Danger zone"
              description="Owner-only actions. Each one asks for your password."
            />
            <CardBody className="divide-y divide-slate-100 py-0 dark:divide-white/5">
              {can(PERMISSIONS.WORKSPACE_TRANSFER_OWNERSHIP) && <TransferOwnership />}
              {can(PERMISSIONS.WORKSPACE_DELETE) && <DeleteWorkspace />}
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
