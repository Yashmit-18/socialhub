import { GROUP_LIMITS, PERMISSIONS, SHARING_TASK_STATUS } from '@socialhub/shared';
import { ArrowLeft, Copy, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { copyText } from '../../lib/accountOrganization.js';
import { formatDate, timeAgo } from '../../lib/utils.js';
import {
  useAddShareGroups,
  useDeleteShare,
  useGroupShare,
  useUpdateShare,
  useUpdateTask,
} from './api.js';
import { inputClass, shareText, useAssignableMembers } from './helpers.js';
import { GroupPicker, Progress, SkippedList } from './SharesPage.jsx';
import { ExternalAnchor, TaskStatusBadge } from './TasksPage.jsx';

function EditShareDialog({ share, onClose }) {
  const { workspace } = useWorkspace();
  const update = useUpdateShare(workspace.id);
  const [form, setForm] = useState({
    title: share.title,
    message: share.message,
    link: share.link,
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const invalid = !form.title.trim() || !form.message.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit share"
      description="Open tasks show the new text at once. Posts already made in groups are not changed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={update.isPending}
            disabled={invalid}
            onClick={() =>
              update.mutate(
                {
                  shareId: share.id,
                  title: form.title.trim(),
                  message: form.message.trim(),
                  link: form.link.trim(),
                },
                {
                  onSuccess: () => {
                    toast.success('Share saved');
                    onClose();
                  },
                },
              )
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="edit-title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="edit-title"
            className={inputClass}
            maxLength={GROUP_LIMITS.SHARE_TITLE_MAX}
            value={form.title}
            onChange={set('title')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="edit-message" className="block text-sm font-medium">
            Text to post
          </label>
          <textarea
            id="edit-message"
            rows={6}
            className={inputClass}
            maxLength={GROUP_LIMITS.MESSAGE_MAX}
            value={form.message}
            onChange={set('message')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="edit-link" className="block text-sm font-medium">
            Link
          </label>
          <input
            id="edit-link"
            className={inputClass}
            inputMode="url"
            value={form.link}
            onChange={set('link')}
          />
        </div>
        <FormError message={update.error?.fields?.link ?? update.error?.message} />
      </div>
    </Modal>
  );
}

function AddGroupsDialog({ share, existing, onClose }) {
  const { workspace } = useWorkspace();
  const add = useAddShareGroups(workspace.id);
  const [selected, setSelected] = useState(() => new Map());
  const [result, setResult] = useState(null);
  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Groups added"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p className="mb-3 text-sm">
          {result.created} new task{result.created === 1 ? '' : 's'}.
        </p>
        <SkippedList skipped={result.skipped} />
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Add groups to “${share.title}”`}
      description="Groups that already have this share are not listed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={add.isPending}
            disabled={selected.size === 0}
            onClick={() =>
              add.mutate(
                { shareId: share.id, groupIds: [...selected.keys()] },
                {
                  onSuccess: (data) => {
                    if (data.skipped.length) setResult(data);
                    else {
                      toast.success(`${data.created} task${data.created === 1 ? '' : 's'} added`);
                      onClose();
                    }
                  },
                },
              )
            }
          >
            Add {selected.size || ''} group{selected.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <GroupPicker selected={selected} onChange={setSelected} exclude={existing} />
      <FormError message={add.error?.message} />
    </Modal>
  );
}

function AssigneeSelect({ task, members }) {
  const { workspace } = useWorkspace();
  const update = useUpdateTask(workspace.id);
  return (
    <select
      aria-label={`Who posts in ${task.group?.name ?? 'this group'}`}
      className="h-8 max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-white/10 dark:bg-slate-900/60"
      value={task.assignee?.id ?? ''}
      disabled={update.isPending}
      onChange={(e) =>
        update.mutate(
          { taskId: task.id, assigneeId: e.target.value || null },
          { onError: (err) => toast.error(err.message) },
        )
      }
    >
      <option value="">Anyone</option>
      {members.map((m) => (
        <option key={m.user.id} value={m.user.id}>
          {m.user.name}
        </option>
      ))}
    </select>
  );
}

/** One share: its text, progress and the task of every group. */
export default function ShareDetailPage() {
  const { shareId } = useParams();
  const { workspace, can } = useWorkspace();
  const navigate = useNavigate();
  const canManage = can(PERMISSIONS.GROUPS_MANAGE);
  const detail = useGroupShare(workspace.id, shareId);
  const remove = useDeleteShare(workspace.id);
  const members = useAssignableMembers(workspace.id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const back = `/w/${workspace.slug}/groups/shares`;

  if (detail.isPending) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (detail.error) {
    return (
      <Card>
        {detail.error.status === 404 ? (
          <EmptyState
            icon={SearchX}
            title="Share not found"
            description="It may have been deleted."
            action={
              <ButtonLink to={back} variant="secondary">
                Back to shares
              </ButtonLink>
            }
          />
        ) : (
          <ErrorState
            title="Could not load this share"
            error={detail.error}
            onRetry={() => detail.refetch()}
          />
        )}
      </Card>
    );
  }
  const { share, tasks } = detail.data;
  const posted = share.counts.done > 0;

  return (
    <div className="space-y-6">
      <Link
        to={back}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Shares
      </Link>

      <Card>
        <CardHeader
          title={share.title}
          description={`Created by ${share.createdBy?.name ?? 'a former member'} ${timeAgo(share.createdAt)}`}
          action={
            canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add groups
                </Button>
                {!posted && (
                  <Button
                    variant="danger-outline"
                    size="sm"
                    onClick={() => {
                      remove.reset();
                      setDeleting(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                  </Button>
                )}
              </div>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-sm whitespace-pre-wrap break-words">{share.message}</p>
            {share.link && (
              <p className="mt-2 text-sm break-all">
                <ExternalAnchor href={share.link}>{share.link}</ExternalAnchor>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Progress counts={share.counts} />
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (await copyText(shareText(share))) toast.success('Text copied');
                else toast.error('Copying was blocked by the browser. Select the text instead.');
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy text
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Groups"
          description="One task per group. Each is posted by hand on Facebook."
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Tasks of this share</caption>
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/60 text-[11px] tracking-wider text-slate-500 uppercase dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
                <th scope="col" className="py-2.5 pr-4 pl-5 font-semibold sm:pl-6">
                  Group
                </th>
                <th scope="col" className="py-2.5 pr-4 font-semibold">
                  Status
                </th>
                <th scope="col" className="hidden py-2.5 pr-4 font-semibold md:table-cell">
                  Who posts it
                </th>
                <th scope="col" className="py-2.5 pr-5 font-semibold sm:pr-6">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {tasks.map((task) => (
                <tr key={task.id} className="align-middle">
                  <td className="py-3 pr-4 pl-5 sm:pl-6">
                    {task.group ? (
                      <ExternalAnchor
                        href={task.group.url}
                        className="text-slate-900 dark:text-white"
                      >
                        {task.group.name}
                      </ExternalAnchor>
                    ) : (
                      'Removed group'
                    )}
                    {task.dueAt && task.status === SHARING_TASK_STATUS.OPEN && (
                      <span className="block text-xs text-muted">
                        Due {formatDate(task.dueAt, { dateStyle: 'medium' })}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <TaskStatusBadge status={task.status} />
                  </td>
                  <td className="hidden py-3 pr-4 text-xs md:table-cell">
                    {canManage && task.status === SHARING_TASK_STATUS.OPEN ? (
                      <AssigneeSelect task={task} members={members} />
                    ) : (
                      (task.assignee?.name ?? 'Anyone')
                    )}
                  </td>
                  <td className="py-3 pr-5 text-xs sm:pr-6">
                    {task.status === SHARING_TASK_STATUS.OPEN ? (
                      <span className="text-muted">Not posted yet</span>
                    ) : (
                      <span>
                        {task.completedBy?.name ?? 'A former member'} ·{' '}
                        {task.completedAt ? timeAgo(task.completedAt) : ''}
                        {task.postUrl && (
                          <ExternalAnchor href={task.postUrl} className="ml-2">
                            View post
                          </ExternalAnchor>
                        )}
                        {task.note && <span className="block text-muted">“{task.note}”</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && <EditShareDialog share={share} onClose={() => setEditing(false)} />}
      {adding && (
        <AddGroupsDialog
          share={share}
          existing={new Set(tasks.map((t) => t.group?.id).filter(Boolean))}
          onClose={() => setAdding(false)}
        />
      )}
      <ConfirmDialog
        open={deleting}
        title={`Delete “${share.title}”?`}
        description="Its tasks are deleted too. Shares already posted in a group are kept and cannot be deleted."
        confirmLabel="Delete share"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(share.id, {
            onSuccess: () => {
              toast.success('Share deleted');
              navigate(back);
            },
          })
        }
        onClose={() => setDeleting(false)}
      />
    </div>
  );
}
