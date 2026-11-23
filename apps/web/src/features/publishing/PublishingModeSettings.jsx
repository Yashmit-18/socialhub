import {
  PERMISSIONS,
  PUBLISHING_MODES,
  WORKSPACE_PUBLISHING_MODES,
  updatePublishingModeSchema,
} from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { FormError, PasswordInput } from '../../components/ui/Field.jsx';
import { Spinner } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { api } from '../../lib/api.js';
import { publishingKeys, usePublishingStatus } from './usePublishing.js';

const W = WORKSPACE_PUBLISHING_MODES;

/** What the current state means, in one or two sentences. */
function describe(status) {
  if (status.mode === PUBLISHING_MODES.DISABLED) {
    return 'Publishing is switched off on this server, so no posts can be sent or simulated.';
  }
  if (status.mode === PUBLISHING_MODES.LIVE) {
    return 'Posts from this workspace are published to the real Facebook Pages and Instagram accounts.';
  }
  if (status.workspaceMode === W.LIVE) {
    return 'Real publishing is switched on for this workspace, but this server does not offer it right now, so posts are simulated: nothing is sent to Facebook or Instagram.';
  }
  return status.liveAvailable
    ? 'Posts are simulated: they go through the whole process, but nothing is sent to Facebook or Instagram. You can switch on real publishing.'
    : 'Posts are simulated: nothing is sent to Facebook or Instagram. This server only offers simulation; real publishing needs the server operator to set PUBLISHING_MODE=live first.';
}

/**
 * Settings card: the workspace's publishing mode. Simulation is the default. Switching on real
 * publishing takes an owner or admin, their password and an explicit acknowledgement, and
 * only works when the server offers it. Switching back is always possible.
 */
export function PublishingModeSettings() {
  const { workspace, can } = useWorkspace();
  const editable = can(PERMISSIONS.WORKSPACE_UPDATE);
  const queryClient = useQueryClient();
  const status = usePublishingStatus(workspace.id);
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState(null);
  const { register, submit, errors, isSubmitting, formError, reset } = useApiForm(
    updatePublishingModeSchema,
    { defaultValues: { mode: W.LIVE, password: '', acknowledgeRealPublishing: false } },
  );

  const url = `/workspaces/${workspace.id}/publishing/mode`;
  // Every publishing screen labels posts by this status, so refresh all of them.
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: publishingKeys.all(workspace.id) });

  const enable = submit(async (values) => {
    await api.put(url, values);
    await refresh();
    setEnableOpen(false);
    toast.success('Real publishing is on for this workspace');
  });

  const disable = async () => {
    setDisabling(true);
    setDisableError(null);
    try {
      await api.put(url, { mode: W.SIMULATED });
      await refresh();
      setDisableOpen(false);
      toast.success('Publishing is back to simulation');
    } catch (err) {
      setDisableError(err);
    } finally {
      setDisabling(false);
    }
  };

  const data = status.data;
  const workspaceLive = data?.workspaceMode === W.LIVE;
  const effectiveLive = data?.mode === PUBLISHING_MODES.LIVE;

  return (
    <Card>
      <CardHeader
        icon={effectiveLive ? Send : FlaskConical}
        title="Publishing mode"
        description="Whether posts from this workspace are simulated or published to the real accounts."
        action={
          data ? (
            <Badge tone={effectiveLive ? 'danger' : 'neutral'} dot>
              {effectiveLive ? 'Real publishing' : 'Simulation'}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {status.isPending ? (
          <Spinner label="Loading the publishing mode" />
        ) : status.error ? (
          <p className="text-sm text-muted">The publishing mode could not be loaded.</p>
        ) : (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-300">{describe(data)}</p>
            <p className="text-sm text-muted">
              Posts keep the mode they were created in. Real posts still waiting are not sent after
              switching back to simulation.
            </p>
            {editable &&
              (workspaceLive ? (
                <Button variant="secondary" onClick={() => setDisableOpen(true)}>
                  <FlaskConical className="h-4 w-4" aria-hidden="true" /> Switch back to simulation
                </Button>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <Button
                    variant="danger"
                    disabled={!data.liveAvailable}
                    onClick={() => {
                      reset({ mode: W.LIVE, password: '', acknowledgeRealPublishing: false });
                      setEnableOpen(true);
                    }}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" /> Switch on real publishing
                  </Button>
                  {!data.liveAvailable && (
                    <p className="text-xs text-muted">Not available on this server.</p>
                  )}
                </div>
              ))}
          </>
        )}
      </CardBody>

      <Modal
        open={enableOpen}
        onClose={() => setEnableOpen(false)}
        title="Switch on real publishing?"
        description="New posts from this workspace will be published to the real Facebook Pages and Instagram accounts."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="publishing-mode-form"
              loading={isSubmitting}
            >
              Switch on real publishing
            </Button>
          </>
        }
      >
        <form id="publishing-mode-form" onSubmit={enable} className="space-y-4" noValidate>
          <FormError message={formError} />
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
            <li>Every member who can publish will post to the real accounts they can use.</li>
            <li>Posts already created, including scheduled ones, stay simulated.</li>
            <li>
              Meta&apos;s rules and limits apply. While the Meta app is in development mode, only
              people with a role on the app can publish through it.
            </li>
          </ul>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              {...register('acknowledgeRealPublishing')}
            />
            <span>
              I understand that posts will be published to the real Facebook and Instagram accounts.
              {errors.acknowledgeRealPublishing && (
                <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">
                  {errors.acknowledgeRealPublishing.message}
                </span>
              )}
            </span>
          </label>
          <PasswordInput
            label="Confirm with your password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Switch back to simulation?"
        description="New posts will be simulated. Real posts that are still waiting will not be sent."
        confirmLabel="Switch to simulation"
        onConfirm={disable}
        loading={disabling}
        error={disableError}
      />
    </Card>
  );
}
