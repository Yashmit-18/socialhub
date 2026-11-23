import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useNow } from '../composer/hooks/useNow.js';
import { ScheduleFields } from './ScheduleFields.jsx';
import { errorMessages } from './labels.js';
import { defaultTimeZone, formatInZone, instantToZoned, resolveSchedule } from './schedule.js';
import { useRescheduleJob } from './usePublishing.js';

/**
 * Changes the time of a scheduled post. Only accounts still waiting for their time move;
 * the server refuses (409) if none are left, e.g. because the post went out meanwhile.
 * Mounted only while open, so it always starts from the job's current time.
 */
export function RescheduleDialog({ workspaceId, job, workspaceTimeZone, onClose, onDone }) {
  const timeZone = defaultTimeZone(workspaceTimeZone);
  const [value, setValue] = useState(() => ({
    ...instantToZoned(job.scheduledAt, timeZone),
    timeZone,
  }));
  const now = useNow(30_000);
  const reschedule = useRescheduleJob(workspaceId);
  const resolved = resolveSchedule(value, new Date(now));
  const unchanged =
    !resolved.error && resolved.instant.getTime() === new Date(job.scheduledAt).getTime();

  const submit = () => {
    if (resolved.error || unchanged || reschedule.isPending) return;
    reschedule.mutate(
      { jobId: job.id, scheduledAt: resolved.instant.toISOString() },
      {
        onSuccess: ({ publishJob }) => {
          toast.success(`Now scheduled for ${formatInZone(resolved.instant, value.timeZone)}`, {
            description: job.simulated ? 'Simulation: nothing will be posted.' : undefined,
          });
          onDone?.(publishJob);
          onClose();
        },
      },
    );
  };

  const serverError = reschedule.error;
  return (
    <Modal
      open
      onClose={onClose}
      title="Change scheduled time"
      description={`Currently ${formatInZone(job.scheduledAt, timeZone)}. Accounts that are still waiting move to the new time.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={reschedule.isPending}
            disabled={unchanged || Boolean(resolved.error)}
            onClick={submit}
          >
            Save new time
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ScheduleFields
          value={value}
          onChange={(next) => {
            setValue(next);
            reschedule.reset();
          }}
          now={new Date(now)}
          workspaceTimeZone={workspaceTimeZone}
        />
        {serverError && (
          <FormError
            message={
              serverError.details?.reason === 'NOT_RESCHEDULABLE'
                ? 'This post is no longer waiting for its scheduled time (it may have just started), so its time cannot change.'
                : errorMessages(serverError).join(' ')
            }
          />
        )}
      </div>
    </Modal>
  );
}
