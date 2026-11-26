import { PERMISSIONS, SHARING_TASK_STATUS, isFacebookUrl } from '@socialhub/shared';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  ExternalLink,
  Hand,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { buttonClass } from '../../components/ui/buttonClass.js';
import { FilterSelect } from '../../components/accounts/AccountFilters.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError, Input, Textarea } from '../../components/ui/Field.jsx';
import { TasksArt } from '../../components/ui/illustrations.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { copyText } from '../../lib/accountOrganization.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { useSharingTasks, useUpdateTask } from './api.js';
import { taskText } from './helpers.js';

const PAGE_SIZE = 20;
const { OPEN, DONE, SKIPPED } = SHARING_TASK_STATUS;

const STATUS_TABS = [
  [OPEN, 'To share', 'open'],
  [DONE, 'Shared', 'done'],
  [SKIPPED, 'Skipped', 'skipped'],
];
const ASSIGNEE_OPTIONS = [
  ['available', 'Mine and unassigned'],
  ['me', 'Assigned to me'],
  ['unassigned', 'Unassigned'],
  ['any', 'Everyone'],
];

// On a phone the card's buttons sit two to a row, and an odd last one takes the full width.
const PHONE_PAIR = 'max-sm:grow max-sm:basis-[calc(50%-0.25rem)]';

export function TaskStatusBadge({ status }) {
  if (status === DONE)
    return (
      <Badge tone="success" dot>
        Shared
      </Badge>
    );
  if (status === SKIPPED)
    return (
      <Badge tone="neutral" dot>
        Skipped
      </Badge>
    );
  return (
    <Badge tone="brand" dot>
      To share
    </Badge>
  );
}

export function ExternalAnchor({ href, children, className }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200',
        className,
      )}
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function FinishDialog({ task, mode, onClose }) {
  const { workspace } = useWorkspace();
  const update = useUpdateTask(workspace.id);
  const [postUrl, setPostUrl] = useState('');
  const [note, setNote] = useState('');
  const done = mode === DONE;
  const urlError =
    postUrl.trim() && !isFacebookUrl(postUrl.trim())
      ? 'Paste the https:// link of the post on Facebook, or leave it empty'
      : null;

  const submit = (e) => {
    e.preventDefault();
    if (urlError) return;
    const body = { taskId: task.id, status: mode };
    if (done && postUrl.trim()) body.postUrl = postUrl.trim();
    if (note.trim()) body.note = note.trim();
    update.mutate(body, {
      onSuccess: () => {
        toast.success(done ? `Marked as shared in ${task.group?.name}` : 'Task skipped');
        onClose();
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={done ? `Shared in ${task.group?.name ?? 'the group'}?` : 'Skip this group?'}
      description={
        done
          ? 'Mark this task as done once the post is live in the group.'
          : 'Skipped tasks stay in the record with your note, and can be reopened.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`finish-${task.id}`} loading={update.isPending}>
            {done ? 'Mark as shared' : 'Skip'}
          </Button>
        </>
      }
    >
      <form id={`finish-${task.id}`} onSubmit={submit} noValidate className="space-y-4">
        {done && (
          <Input
            label={
              <>
                Link to the post <span className="font-normal text-muted">(optional)</span>
              </>
            }
            type="url"
            inputMode="url"
            placeholder="https://www.facebook.com/groups/…/posts/…"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            error={urlError}
          />
        )}
        <Textarea
          label={
            <>
              Note <span className="font-normal text-muted">(optional)</span>
            </>
          }
          rows={3}
          maxLength={500}
          placeholder={done ? 'For example: waiting for admin approval' : 'Why it was skipped'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <FormError message={update.error?.fields?.postUrl ?? update.error?.message} />
      </form>
    </Modal>
  );
}

function TaskCard({ task, me, canComplete, canManage }) {
  const { workspace } = useWorkspace();
  const update = useUpdateTask(workspace.id);
  const [finishing, setFinishing] = useState(null);
  const share = task.share ?? { title: 'Deleted share', message: '', link: '' };
  const group = task.group;
  const mine = task.assignee?.id === me;
  const free = !task.assignee;
  const canWork = canComplete && (canManage || free || mine);
  const canReopen = canComplete && (canManage || task.completedBy?.id === me);
  const overdue = task.status === OPEN && task.dueAt && new Date(task.dueAt) < new Date();

  const run = (body, message) =>
    update.mutate(
      { taskId: task.id, ...body },
      {
        onSuccess: () => toast.success(message),
        onError: (error) => toast.error(error?.message ?? 'The task could not be updated.'),
      },
    );

  const postUrl = task.pagePost?.url ?? null;

  return (
    <li>
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1877F2]/10 text-[#1877F2] dark:bg-[#1877F2]/20 dark:text-[#6ea8ff]"
            >
              <UsersRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
                {group ? (
                  <ExternalAnchor
                    href={group.url}
                    className="text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                  >
                    {group.name}
                  </ExternalAnchor>
                ) : (
                  'Removed group'
                )}
              </h3>
              {/* Stacked on a phone, so the separator never dangles at the end of a line. */}
              <p className="mt-0.5 flex flex-col gap-x-1.5 text-xs text-muted sm:flex-row sm:flex-wrap sm:items-center">
                {task.page && (
                  <>
                    <span>
                      Post as{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {task.page.name}
                      </span>
                    </span>
                    <span aria-hidden="true" className="hidden sm:inline">
                      ·
                    </span>
                  </>
                )}
                <span className="min-w-0 truncate">{share.title}</span>
              </p>
            </div>
          </div>
          {/* No status badge: the list shows one status at a time and the tab names it. */}
          {task.dueAt && task.status === OPEN && (
            <Badge tone={overdue ? 'danger' : 'neutral'}>
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {overdue ? 'Overdue · ' : 'Due '}
              {formatDate(task.dueAt, { dateStyle: 'medium' })}
            </Badge>
          )}
        </div>

        {group?.notes && (
          <Callout
            tone="warning"
            size="sm"
            icon={ShieldAlert}
            title="Group rules:"
            className="mt-4"
          >
            {group.notes}
          </Callout>
        )}

        {task.status === OPEN && (share.message || share.link || postUrl) && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
            {share.message && (
              <p className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">
                {share.message}
              </p>
            )}
            {share.link && (
              <p className="mt-2 text-sm break-all">
                <ExternalAnchor href={share.link}>{share.link}</ExternalAnchor>
              </p>
            )}
            {postUrl && (
              <p className="mt-2 text-xs text-muted">
                <ExternalAnchor href={postUrl} className="text-xs">
                  View the Page post on Facebook
                </ExternalAnchor>{' '}
                · its link is included when you copy the text
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {task.status === OPEN
              ? task.assignee
                ? `Assigned to ${mine ? 'you' : task.assignee.name}`
                : 'Anyone on the team can share this'
              : `${task.status === DONE ? 'Shared' : 'Skipped'} by ${task.completedBy?.name ?? 'a former member'} ${task.completedAt ? timeAgo(task.completedAt) : ''}`}
            {task.note && task.status !== OPEN && <> · “{task.note}”</>}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {task.status === DONE && task.postUrl && (
              <ExternalAnchor href={task.postUrl} className="text-xs">
                View post
              </ExternalAnchor>
            )}
            {task.status === OPEN && (
              <Button
                variant="secondary"
                size="sm"
                className={PHONE_PAIR}
                onClick={async () => {
                  if (await copyText(taskText(task))) toast.success('Text copied');
                  else toast.error('Copying was blocked by the browser. Select the text instead.');
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy text
              </Button>
            )}
            {task.status === OPEN && group && (
              <a
                href={group.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'secondary', size: 'sm', className: PHONE_PAIR })}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open group
                <span className="sr-only">(opens Facebook in a new tab)</span>
              </a>
            )}
            {task.status === OPEN && canComplete && free && !canManage && (
              <Button
                variant="secondary"
                size="sm"
                className={PHONE_PAIR}
                loading={update.isPending}
                onClick={() => run({ assigneeId: me }, 'The task is yours')}
              >
                <Hand className="h-3.5 w-3.5" aria-hidden="true" /> Take it
              </Button>
            )}
            {task.status === OPEN && canWork && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className={PHONE_PAIR}
                  onClick={() => setFinishing(SKIPPED)}
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden="true" /> Skip
                </Button>
                {/* Tonal, not the gradient: every card has one, and a page gets one gradient. */}
                <Button
                  variant="tonal"
                  size="sm"
                  className={PHONE_PAIR}
                  onClick={() => setFinishing(DONE)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Mark as shared
                </Button>
              </>
            )}
            {task.status !== OPEN && canReopen && (
              <Button
                variant="ghost"
                size="sm"
                loading={update.isPending}
                onClick={() => run({ status: OPEN }, 'Task reopened')}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
              </Button>
            )}
          </div>
        </div>
      </Card>
      {finishing && (
        <FinishDialog task={task} mode={finishing} onClose={() => setFinishing(null)} />
      )}
    </li>
  );
}

/** First load: two cards shaped like tasks. */
function TasksSkeleton() {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Loading tasks…</span>
      {[0, 1].map((n) => (
        <div key={n} aria-hidden="true" className="surface p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="mt-4 h-16 w-full" />
          <div className="mt-4 flex justify-end gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The sharing queue: open tasks to post by hand, and the record of shared and skipped ones. */
export default function TasksPage() {
  const { workspace, can } = useWorkspace();
  const { user } = useAuth();
  const canComplete = can(PERMISSIONS.SHARING_TASKS_COMPLETE);
  const canManage = can(PERMISSIONS.GROUPS_MANAGE);
  const [status, setStatus] = useState(OPEN);
  const [assignee, setAssignee] = useState(canComplete && !canManage ? 'available' : 'any');
  const [page, setPage] = useState(1);
  const tasks = useSharingTasks(workspace.id, { status, assignee, page, limit: PAGE_SIZE });
  const data = tasks.data;
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Task status"
          model="tabs"
          size="sm"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={STATUS_TABS.map(([value, label, key]) => ({
            value,
            label,
            count: counts ? counts[key] : undefined,
          }))}
        />
        <FilterSelect
          label="Whose tasks"
          value={assignee}
          highlight={false}
          options={ASSIGNEE_OPTIONS}
          onChange={(value) => {
            setAssignee(value);
            setPage(1);
          }}
        />
      </div>

      {tasks.isPending ? (
        <TasksSkeleton />
      ) : tasks.error ? (
        <Card>
          <ErrorState
            title="Could not load the sharing tasks"
            error={tasks.error}
            onRetry={() => tasks.refetch()}
          />
        </Card>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            art={TasksArt}
            title={
              status === OPEN
                ? 'Nothing to share right now'
                : status === DONE
                  ? 'Nothing shared yet'
                  : 'No skipped tasks'
            }
            description={
              status === OPEN
                ? 'When a post goes live on a Facebook Page, each group that Page is in shows up here. Mark which Pages are in which groups on the Groups tab.'
                : 'Finished tasks are listed here with who shared them and when.'
            }
            action={
              status === OPEN && canManage ? (
                <Link
                  to={`/w/${workspace.slug}/groups/directory`}
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  Manage groups
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <ul
            className={cn('space-y-3 transition-opacity', tasks.isPlaceholderData && 'opacity-60')}
          >
            {data.items.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                me={user?.id}
                canComplete={canComplete}
                canManage={canManage}
              />
            ))}
          </ul>
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            limit={data.limit}
            noun={data.total === 1 ? 'task' : 'tasks'}
            onPageChange={setPage}
            className="border-t-0 px-1 py-0 sm:px-1"
          />
        </>
      )}
    </div>
  );
}
