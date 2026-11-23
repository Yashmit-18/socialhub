import { GROUP_LIMITS, PERMISSIONS } from '@socialhub/shared';
import { Megaphone, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import {
  skipReasonText,
  useCreateShare,
  useFacebookGroups,
  useGroupCategories,
  useGroupShares,
} from './api.js';
import { dueFromDate, inputClass, useAssignableMembers } from './helpers.js';

const PAGE_SIZE = 20;

/**
 * Checkbox list of active groups with search and category filter. `selected` is a Map of
 * id → group kept across searches. Groups whose rules do not allow a share yet are marked:
 * they will be skipped.
 */
export function GroupPicker({ selected, onChange, exclude }) {
  const { workspace } = useWorkspace();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const categories = useGroupCategories(workspace.id);
  const groups = useFacebookGroups(workspace.id, { q, category, status: 'ACTIVE', limit: 100 });
  const items = (groups.data?.items ?? []).filter((g) => !exclude?.has(g.id));
  const allShown = items.length > 0 && items.every((g) => selected.has(g.id));

  const toggle = (group) => {
    const next = new Map(selected);
    if (next.has(group.id)) next.delete(group.id);
    else next.set(group.id, group);
    onChange(next);
  };
  const toggleAll = () => {
    const next = new Map(selected);
    for (const g of items) {
      if (allShown) next.delete(g.id);
      else next.set(g.id, g);
    }
    onChange(next);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Groups <span className="font-normal text-muted">({selected.size} selected)</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search groups"
            placeholder="Search groups"
            className={cn(inputClass, 'pl-9')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="Category"
          className={cn(inputClass, 'w-auto')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">No category</option>
        </select>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
        {groups.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-40" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-3 text-sm text-muted">
            {groups.data?.total === 0 && !q && !category
              ? 'The directory has no active groups yet. Add them on the Group directory tab.'
              : 'No groups match.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            <li className="flex items-center justify-between bg-slate-50/70 px-3 py-1.5 text-xs dark:bg-white/[0.02]">
              <span className="text-muted">{items.length} shown</span>
              <button
                type="button"
                onClick={toggleAll}
                className="font-medium text-brand-600 dark:text-brand-300"
              >
                {allShown ? 'Deselect shown' : 'Select all shown'}
              </button>
            </li>
            {items.map((group) => (
              <li key={group.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
                    checked={selected.has(group.id)}
                    onChange={() => toggle(group)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{group.name}</span>
                    <span className="block text-xs text-muted">
                      {[group.category?.name, group.tags.slice(0, 3).join(', ')]
                        .filter(Boolean)
                        .join(' · ') || 'No category'}
                    </span>
                    {group.nextShareAllowedAt && (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">
                        Its rules allow the next share on{' '}
                        {formatDate(group.nextShareAllowedAt, { dateStyle: 'medium' })}: it will be
                        skipped
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

export function SkippedList({ skipped }) {
  if (!skipped?.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="font-semibold">
        {skipped.length === 1
          ? '1 group did not get a task:'
          : `${skipped.length} groups did not get a task:`}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {skipped.map((s) => (
          <li key={s.groupId}>
            {s.name}: {skipReasonText(s)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewShareDialog({ onClose }) {
  const { workspace } = useWorkspace();
  const create = useCreateShare(workspace.id);
  const assignable = useAssignableMembers(workspace.id);
  const [form, setForm] = useState({ title: '', message: '', link: '', assigneeId: '', due: '' });
  const [selected, setSelected] = useState(() => new Map());
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const errors = {};
  if (!form.title.trim()) errors.title = 'Give the share a title';
  if (!form.message.trim()) errors.message = 'Write the text to post';
  if (form.link.trim() && !/^https:\/\/\S+$/i.test(form.link.trim()))
    errors.link = 'Enter a full https:// link';
  if (selected.size === 0) errors.groupIds = 'Choose at least one group';
  if (selected.size > GROUP_LIMITS.GROUPS_PER_SHARE_MAX) {
    errors.groupIds = `Choose at most ${GROUP_LIMITS.GROUPS_PER_SHARE_MAX} groups at a time`;
  }
  const shown = (key) => (touched ? errors[key] : null) ?? create.error?.fields?.[key];

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const body = {
      title: form.title.trim(),
      message: form.message.trim(),
      groupIds: [...selected.keys()],
    };
    if (form.link.trim()) body.link = form.link.trim();
    if (form.assigneeId) body.assigneeId = form.assigneeId;
    if (form.due) body.dueAt = dueFromDate(form.due);
    create.mutate(body, {
      onSuccess: (data) => {
        toast.success(`${data.created} sharing task${data.created === 1 ? '' : 's'} created`);
        if (data.skipped.length) setResult(data);
        else onClose();
      },
    });
  };

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Share created"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p className="mb-3 text-sm">
          {result.created} task{result.created === 1 ? '' : 's'} created for “{result.share.title}”.
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
      title="New share"
      description="Write the post once and choose the groups. Each group gets a task that someone on the team posts by hand."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-share" loading={create.isPending}>
            Create {selected.size || ''} task{selected.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <form id="new-share" onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="share-title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="share-title"
            className={inputClass}
            maxLength={GROUP_LIMITS.SHARE_TITLE_MAX}
            placeholder="For example: Autumn menu launch"
            value={form.title}
            onChange={set('title')}
          />
          {shown('title') && (
            <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {shown('title')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="share-message" className="block text-sm font-medium">
            Text to post
          </label>
          <textarea
            id="share-message"
            rows={5}
            className={inputClass}
            maxLength={GROUP_LIMITS.MESSAGE_MAX}
            value={form.message}
            onChange={set('message')}
          />
          <p className="flex justify-between text-xs text-muted">
            <span>
              {shown('message') ? (
                <span role="alert" className="font-medium text-rose-600 dark:text-rose-400">
                  {shown('message')}
                </span>
              ) : (
                'Posted exactly as written.'
              )}
            </span>
            <span className="tabular-nums">
              {form.message.length.toLocaleString()} / {GROUP_LIMITS.MESSAGE_MAX.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="share-link" className="block text-sm font-medium">
            Link <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="share-link"
            className={inputClass}
            inputMode="url"
            placeholder="https://…"
            value={form.link}
            onChange={set('link')}
          />
          {shown('link') && (
            <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {shown('link')}
            </p>
          )}
        </div>
        <GroupPicker selected={selected} onChange={setSelected} />
        {shown('groupIds') && (
          <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
            {shown('groupIds')}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="share-assignee" className="block text-sm font-medium">
              Who posts it
            </label>
            <select
              id="share-assignee"
              className={inputClass}
              value={form.assigneeId}
              onChange={set('assigneeId')}
            >
              <option value="">Anyone on the team</option>
              {assignable.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="share-due" className="block text-sm font-medium">
              Due <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="share-due"
              type="date"
              className={inputClass}
              value={form.due}
              onChange={set('due')}
            />
          </div>
        </div>
        {create.error?.details?.skipped ? (
          <>
            <FormError message={create.error.message} />
            <SkippedList skipped={create.error.details.skipped} />
          </>
        ) : (
          !Object.keys(create.error?.fields ?? {}).length && (
            <FormError message={create.error?.message} />
          )
        )}
      </form>
    </Modal>
  );
}

export function Progress({ counts }) {
  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;
  const skipped = counts?.skipped ?? 0;
  return (
    <div className="min-w-[8rem]">
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
        role="img"
        aria-label={`${done} of ${total} shared, ${skipped} skipped`}
      >
        <span
          className="bg-emerald-500"
          style={{ width: total ? `${(done / total) * 100}%` : 0 }}
        />
        <span
          className="bg-slate-400"
          style={{ width: total ? `${(skipped / total) * 100}%` : 0 }}
        />
      </div>
      <p className="mt-1 text-xs text-muted tabular-nums">
        {done} of {total} shared{skipped ? ` · ${skipped} skipped` : ''}
      </p>
    </div>
  );
}

/** Every share of the workspace with its progress. */
export default function SharesPage() {
  const { workspace, can } = useWorkspace();
  const canManage = can(PERMISSIONS.GROUPS_MANAGE);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const shares = useGroupShares(workspace.id, { page, limit: PAGE_SIZE });
  const data = shares.data;
  const base = `/w/${workspace.slug}/groups/shares`;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New share
          </Button>
        </div>
      )}
      <Card>
        {shares.isPending ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : shares.error ? (
          <ErrorState
            title="Could not load the shares"
            error={shares.error}
            onRetry={() => shares.refetch()}
          />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No shares yet"
            description={
              canManage
                ? 'A share is a post you want in several Facebook Groups. Create one to give your team a task per group.'
                : 'Owners and admins create shares; their tasks appear on the Sharing tasks tab.'
            }
            action={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> New share
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {data.items.map((share) => (
                <li
                  key={share.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`${base}/${share.id}`}
                      className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                    >
                      {share.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{share.message}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      By {share.createdBy?.name ?? 'a former member'} · {timeAgo(share.createdAt)}
                    </p>
                  </div>
                  <Progress counts={share.counts} />
                </li>
              ))}
            </ul>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={data.limit}
              noun={data.total === 1 ? 'share' : 'shares'}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
      {creating && <NewShareDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
