import { GROUP_LIMITS, PERMISSIONS, SHARING_TASK_STATUS } from '@socialhub/shared';
import { Copy, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BackLink } from '../../components/ui/BackLink.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { copyText } from '../../lib/accountOrganization.js';
import { formatDate, timeAgo } from '../../lib/utils.js';
import {
  useAddShareGroups,
  useDeleteShare,
  skipReasonText,
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
      className="select-chevron h-8 max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 pr-7 text-xs dark:border-white/10 dark:bg-slate-900/60"
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

/** First load: the share card and the groups card, in their shape. */
function ShareSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-5 w-24" />
      <div aria-hidden="true" className="surface space-y-4 p-5 sm:p-6">
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="h-3 w-80 max-w-full" />
        <Skeleton className="h-2 w-full max-w-sm rounded-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div aria-hidden="true" className="surface p-5 sm:p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="mt-4 h-9 w-full" />
      </div>
    </div>
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

  if (detail.isPending) return <ShareSkeleton />;
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
      <BackLink to={back}>All posts</BackLink>

      <Card>
        <CardHeader
          // On a phone the buttons go under the title instead of squeezing it.
          className="flex-col sm:flex-row"
          title={share.title}
          description={`${share.auto ? 'Shared automatically from a published post' : 'Created'} by ${share.createdBy?.name ?? 'a former member'} ${timeAgo(share.createdAt)}`}
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
        <CardBody className="space-y-5">
          <Progress counts={share.counts} size="lg" />
          {/* "Copy text" sits on the text it copies. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 py-1.5 pr-2 pl-3.5 dark:border-white/10">
              <p className="text-xs font-medium text-muted">Text to post</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (await copyText(shareText(share))) toast.success('Text copied');
                  else toast.error('Copying was blocked by the browser. Select the text instead.');
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy text
              </Button>
            </div>
            <div className="p-3.5">
              <p className="text-sm whitespace-pre-wrap break-words">{share.message}</p>
              {share.link && (
                <p className="mt-2 text-sm break-all">
                  <ExternalAnchor href={share.link}>{share.link}</ExternalAnchor>
                </p>
              )}
            </div>
          </div>
          {share.auto && Array.isArray(share.topics) && (
            <p className="text-xs text-muted">
              {share.topics.length > 0
                ? `Matched to groups by: ${share.topics.map((topic) => `#${topic}`).join(' ')}, plus groups without tags.`
                : 'This post has no hashtags or keywords, so only groups without tags got it.'}
            </p>
          )}
          {share.skipped?.length > 0 && (
            <Callout tone="warning">
              <p className="font-medium">Not added to these groups:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {share.skipped.map((skip) => (
                  <li key={skip.groupId}>
                    {skip.name}: {skipReasonText(skip)}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Groups"
          description="One task per group. Each is posted by hand on Facebook."
        />
        <Table caption="Tasks of this share" className="mt-4">
          <THead>
            <Th>Group</Th>
            <Th>Status</Th>
            <Th hide="md">Who posts it</Th>
            <Th>Result</Th>
          </THead>
          <TBody>
            {tasks.map((task) => {
              const open = task.status === SHARING_TASK_STATUS.OPEN;
              // Late is flagged as on the Tasks tab: rose "Overdue", not a grey date.
              const overdue = open && task.dueAt && new Date(task.dueAt) < new Date();
              return (
                <Tr key={task.id}>
                  <Td>
                    {task.group ? (
                      <ExternalAnchor
                        href={task.group.url}
                        className="text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                      >
                        {task.group.name}
                      </ExternalAnchor>
                    ) : (
                      'Removed group'
                    )}
                    {task.dueAt && open && (
                      <span
                        className={
                          overdue
                            ? 'block text-xs font-medium text-rose-600 dark:text-rose-400'
                            : 'block text-xs text-muted'
                        }
                      >
                        {overdue ? 'Overdue · ' : 'Due '}
                        {formatDate(task.dueAt, { dateStyle: 'medium' })}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <TaskStatusBadge status={task.status} />
                  </Td>
                  <Td hide="md" className="text-xs">
                    {canManage && open ? (
                      <AssigneeSelect task={task} members={members} />
                    ) : (
                      (task.assignee?.name ?? 'Anyone')
                    )}
                  </Td>
                  <Td className="text-xs">
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
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
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
