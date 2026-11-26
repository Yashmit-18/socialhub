import {
  FACEBOOK_GROUP_STATUS,
  GROUP_LIMITS,
  PERMISSIONS,
  parseFacebookGroupUrl,
} from '@socialhub/shared';
import {
  Archive,
  ArchiveRestore,
  FolderTree,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  StickyNote,
  SearchX,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FilterSelect, SearchBox } from '../../components/accounts/AccountFilters.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { FormError } from '../../components/ui/Field.jsx';
import { GroupsArt } from '../../components/ui/illustrations.jsx';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { formatDate, timeAgo } from '../../lib/utils.js';
import {
  useBulkAddGroups,
  useFacebookPages,
  useCreateCategory,
  useCreateGroup,
  useDeleteCategory,
  useDeleteGroup,
  useFacebookGroups,
  useGroupCategories,
  useRenameCategory,
  useUpdateGroup,
} from './api.js';
import { inputClass, selectClass } from './helpers.js';
import { PagePicker } from './PagePicker.jsx';
import { ExternalAnchor } from './TasksPage.jsx';

const PAGE_SIZE = 25;
const NUMBER = new Intl.NumberFormat();
const SORTS = [
  ['name', 'Name (A–Z)'],
  ['-name', 'Name (Z–A)'],
  ['lastSharedAt', 'Least recently shared'],
  ['-lastSharedAt', 'Most recently shared'],
  ['-memberCount', 'Most members'],
  ['-createdAt', 'Newest first'],
];
function TextField({ id, label, hint, error, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const toNumberOrNull = (text) => (text.trim() === '' ? null : Number(text));

/** Add or edit one group of the directory. */
export function GroupFormDialog({ group, categories, onClose }) {
  const { workspace } = useWorkspace();
  const create = useCreateGroup(workspace.id);
  const update = useUpdateGroup(workspace.id);
  const mutation = group ? update : create;
  const [form, setForm] = useState({
    name: group?.name ?? '',
    url: group?.url ?? '',
    categoryId: group?.category?.id ?? '',
    tags: (group?.tags ?? []).join(', '),
    memberCount: group?.memberCount ?? '',
    minDaysBetweenShares: group?.minDaysBetweenShares ?? '',
    notes: group?.notes ?? '',
  });
  const [pageIds, setPageIds] = useState(() => (group?.pages ?? []).map((page) => page.id));
  const [touched, setTouched] = useState(false);
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (mutation.error) mutation.reset();
  };

  const errors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!parseFacebookGroupUrl(form.url)) {
    errors.url = 'Enter a Facebook Group link, like https://www.facebook.com/groups/your-group';
  }
  const tags = form.tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.length > GROUP_LIMITS.TAGS_MAX)
    errors.tags = `Use at most ${GROUP_LIMITS.TAGS_MAX} tags`;
  const cooldown = toNumberOrNull(String(form.minDaysBetweenShares));
  if (cooldown !== null && !(Number.isInteger(cooldown) && cooldown >= 1 && cooldown <= 365)) {
    errors.minDaysBetweenShares = 'Use a whole number of days from 1 to 365, or leave it empty';
  }
  const members = toNumberOrNull(String(form.memberCount));
  if (members !== null && !(Number.isInteger(members) && members >= 0)) {
    errors.memberCount = 'Use a whole number, or leave it empty';
  }
  const server = mutation.error?.fields ?? {};
  const shown = (key) => (touched ? errors[key] : null) ?? server[key];

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const body = {
      name: form.name.trim(),
      url: form.url.trim(),
      categoryId: form.categoryId || null,
      tags,
      memberCount: members,
      minDaysBetweenShares: cooldown,
      notes: form.notes.trim(),
      pageIds,
    };
    mutation.mutate(group ? { groupId: group.id, ...body } : body, {
      onSuccess: ({ group: saved }) => {
        toast.success(group ? 'Group saved' : `${saved.name} added to the directory`);
        onClose();
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : 'Add a Facebook Group'}
      description="Paste the group’s address from Facebook. SocialHub only stores what you enter here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="group-form" loading={mutation.isPending}>
            {group ? 'Save group' : 'Add group'}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField id="group-name" label="Name" error={shown('name')}>
          <input
            id="group-name"
            className={inputClass}
            maxLength={GROUP_LIMITS.NAME_MAX}
            value={form.name}
            onChange={set('name')}
          />
        </TextField>
        <TextField id="group-url" label="Group link" error={shown('url')}>
          <input
            id="group-url"
            className={inputClass}
            inputMode="url"
            placeholder="https://www.facebook.com/groups/…"
            value={form.url}
            onChange={set('url')}
          />
        </TextField>
        <PagePicker
          id="group-pages"
          value={pageIds}
          onChange={(next) => {
            setPageIds(next);
            if (mutation.error) mutation.reset();
          }}
        />
        {server.pageIds && <FormError message={server.pageIds} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="group-category" label="Category">
            <select
              id="group-category"
              className={selectClass}
              value={form.categoryId}
              onChange={set('categoryId')}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </TextField>
          <TextField id="group-members" label="Members (approximate)" error={shown('memberCount')}>
            <input
              id="group-members"
              className={inputClass}
              inputMode="numeric"
              value={form.memberCount}
              onChange={set('memberCount')}
            />
          </TextField>
        </div>
        <TextField
          id="group-tags"
          label="Relevance tags"
          hint="Comma separated, for example: vegan, london, events. Posts are shared here automatically only when one of these is in the post’s hashtags or keywords; with no tags, every post is."
          error={shown('tags')}
        >
          <input id="group-tags" className={inputClass} value={form.tags} onChange={set('tags')} />
        </TextField>
        <TextField
          id="group-cooldown"
          label="Days between shares"
          hint="If the group limits how often you may post, SocialHub will not create a new task before then."
          error={shown('minDaysBetweenShares')}
        >
          <input
            id="group-cooldown"
            className={inputClass}
            inputMode="numeric"
            placeholder="No limit"
            value={form.minDaysBetweenShares}
            onChange={set('minDaysBetweenShares')}
          />
        </TextField>
        <TextField id="group-notes" label="Group rules and notes">
          <textarea
            id="group-notes"
            rows={3}
            maxLength={GROUP_LIMITS.NOTES_MAX}
            className={inputClass}
            placeholder="For example: promotions only on Fridays, no links in the first line"
            value={form.notes}
            onChange={set('notes')}
          />
        </TextField>
        {mutation.error && !Object.keys(server).length && (
          <FormError message={mutation.error.message} />
        )}
        {mutation.error?.details?.fields?.url && <FormError message={mutation.error.message} />}
      </form>
    </Modal>
  );
}

/** Adds many groups at once from pasted links, one per line, named after their links. */
export function BulkAddDialog({ categories, onClose }) {
  const { workspace } = useWorkspace();
  const bulk = useBulkAddGroups(workspace.id);
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pageIds, setPageIds] = useState([]);
  const [result, setResult] = useState(null);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const valid = lines.filter((line) => parseFacebookGroupUrl(line));
  const tooMany = lines.length > GROUP_LIMITS.BULK_GROUPS_MAX;

  const submit = (e) => {
    e.preventDefault();
    if (valid.length === 0 || tooMany) return;
    bulk.mutate(
      { urls: lines, categoryId: categoryId || null, pageIds },
      {
        onSuccess: (data) => {
          setResult(data);
          if (data.added.length) {
            toast.success(
              `${data.added.length} ${data.added.length === 1 ? 'group' : 'groups'} added`,
            );
          }
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add many groups"
      description="Paste Facebook Group links, one per line. Each group is named after its link; you can rename it later."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="bulk-group-form"
              loading={bulk.isPending}
              disabled={valid.length === 0 || tooMany}
            >
              {valid.length > 0
                ? `Add ${valid.length} ${valid.length === 1 ? 'group' : 'groups'}`
                : 'Add groups'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm" role="status">
          <p>
            <span className="font-semibold">{result.added.length}</span> added
            {result.existing.length > 0 && (
              <>
                , <span className="font-semibold">{result.existing.length}</span> already in your
                list{pageIds.length > 0 && ' (your Pages were added to them)'}
              </>
            )}
            .
          </p>
          {result.invalid.length > 0 && (
            <Callout tone="warning">
              <p className="font-medium">These lines are not Facebook Group links:</p>
              <ul className="mt-1 list-disc pl-5 text-xs break-all">
                {result.invalid.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Callout>
          )}
        </div>
      ) : (
        <form id="bulk-group-form" onSubmit={submit} noValidate className="space-y-4">
          <TextField
            id="bulk-links"
            label="Group links"
            hint={
              lines.length === 0
                ? `Up to ${GROUP_LIMITS.BULK_GROUPS_MAX} links.`
                : `${valid.length} of ${lines.length} ${lines.length === 1 ? 'line is a group link' : 'lines are group links'}.`
            }
            error={tooMany ? `Paste at most ${GROUP_LIMITS.BULK_GROUPS_MAX} links at a time` : null}
          >
            <textarea
              id="bulk-links"
              rows={6}
              className={inputClass}
              placeholder={
                'https://www.facebook.com/groups/first-group\nhttps://www.facebook.com/groups/second-group'
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (bulk.error) bulk.reset();
              }}
            />
          </TextField>
          <PagePicker id="bulk-pages" value={pageIds} onChange={setPageIds} />
          <TextField id="bulk-category" label="Category">
            <select
              id="bulk-category"
              className={selectClass}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </TextField>
          <FormError message={bulk.error?.message} />
        </form>
      )}
    </Modal>
  );
}

function CategoriesDialog({ categories, onClose }) {
  const { workspace } = useWorkspace();
  const create = useCreateCategory(workspace.id);
  const rename = useRenameCategory(workspace.id);
  const remove = useDeleteCategory(workspace.id);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);

  return (
    <Modal
      open
      onClose={onClose}
      title="Group categories"
      description="Sort your directory into categories such as local, interests or clients."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate(name.trim(), {
            onSuccess: () => {
              setName('');
              toast.success('Category added');
            },
          });
        }}
      >
        <label htmlFor="new-category" className="sr-only">
          New category
        </label>
        <input
          id="new-category"
          className={inputClass}
          placeholder="New category"
          maxLength={GROUP_LIMITS.CATEGORY_NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (create.error) create.reset();
          }}
        />
        <Button type="submit" size="sm" className="h-10" loading={create.isPending}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </Button>
      </form>
      <FormError message={create.error?.fields?.name ?? create.error?.message} />
      {categories.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No categories yet.</p>
      ) : (
        <ul aria-label="Categories" className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center gap-2 py-2">
              {editing?.id === category.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate(
                      { categoryId: category.id, name: editing.name.trim() },
                      {
                        onSuccess: () => setEditing(null),
                        onError: (err) => toast.error(err.message),
                      },
                    );
                  }}
                >
                  <label htmlFor={`category-${category.id}`} className="sr-only">
                    Category name
                  </label>
                  <input
                    id={`category-${category.id}`}
                    className={inputClass}
                    value={editing.name}
                    maxLength={GROUP_LIMITS.CATEGORY_NAME_MAX}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                  <Button type="submit" size="sm" className="h-10" loading={rename.isPending}>
                    Save
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{category.name}</span>
                  <span className="text-xs text-muted">
                    {category.groupCount} group{category.groupCount === 1 ? '' : 's'}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Rename ${category.name}`}
                    onClick={() => setEditing({ id: category.id, name: category.name })}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-600 dark:text-rose-400"
                    aria-label={`Delete ${category.name}`}
                    onClick={() =>
                      remove.mutate(category.id, {
                        onSuccess: ({ groupsUncategorized }) =>
                          toast.success(
                            groupsUncategorized
                              ? `Category deleted; ${groupsUncategorized} group${groupsUncategorized === 1 ? ' has' : 's have'} no category now`
                              : 'Category deleted',
                          ),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function LastShared({ group }) {
  if (!group.lastSharedAt) return <span className="text-xs text-muted">Never</span>;
  return (
    <span className="text-xs">
      <time
        dateTime={group.lastSharedAt}
        title={formatDate(group.lastSharedAt, { dateStyle: 'medium', timeStyle: 'short' })}
      >
        {timeAgo(group.lastSharedAt)}
      </time>
      {group.nextShareAllowedAt && (
        <span className="block text-amber-700 dark:text-amber-400">
          Next share from {formatDate(group.nextShareAllowedAt, { dateStyle: 'medium' })}
        </span>
      )}
    </span>
  );
}

/** First load: rows in the shape of the groups table. */
function GroupsSkeleton() {
  return (
    <div role="status" className="border-t border-slate-100 dark:border-white/5">
      <span className="sr-only">Loading groups…</span>
      <ul aria-hidden="true" className="divide-y divide-slate-100 dark:divide-white/5">
        {[0, 1, 2, 3].map((n) => (
          <li key={n} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
            <Skeleton className="h-4 w-20" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The workspace's Facebook Group directory. */
export default function DirectoryPage() {
  const { workspace, can } = useWorkspace();
  const canManage = can(PERMISSIONS.GROUPS_MANAGE);
  const [filters, setFilters] = useState({
    q: '',
    category: '',
    tag: '',
    pageId: '',
    status: 'ACTIVE',
    sort: 'name',
    page: 1,
  });
  const update = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const filtersActive =
    Boolean(filters.q || filters.category || filters.tag || filters.pageId) ||
    filters.status !== 'ACTIVE';
  // The sort is a view choice, not a filter: it stays.
  const clearFilters = () => update({ q: '', category: '', tag: '', pageId: '', status: 'ACTIVE' });
  const groups = useFacebookGroups(workspace.id, { ...filters, limit: PAGE_SIZE });
  const categories = useGroupCategories(workspace.id);
  const updateGroup = useUpdateGroup(workspace.id);
  const deleteGroup = useDeleteGroup(workspace.id);
  const [editing, setEditing] = useState(null); // null | 'new' | group
  const [bulkOpen, setBulkOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const { pages: facebookPages } = useFacebookPages();
  const [deleting, setDeleting] = useState(null);
  const data = groups.data;
  const facets = data?.facets;
  const categoryList = categories.data ?? [];

  const setStatus = (group, status) =>
    updateGroup.mutate(
      { groupId: group.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === FACEBOOK_GROUP_STATUS.ARCHIVED
              ? `${group.name} archived`
              : `${group.name} restored`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <div className="space-y-4">
      <Card>
        {/* Row one: find, then what you do to the list. Row two: filters only. */}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              value={filters.q}
              onSearch={(q) => update({ q })}
              placeholder="Search name, tag, notes or link"
              label="Search groups"
              className="basis-full sm:max-w-sm sm:basis-0"
            />
            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <FilterSelect
                label="Sort groups"
                value={filters.sort}
                highlight={false}
                onChange={(sort) => update({ sort })}
                options={SORTS}
              />
              {canManage && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => setCategoriesOpen(true)}
                  >
                    <FolderTree className="h-3.5 w-3.5" aria-hidden="true" /> Categories
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => setBulkOpen(true)}
                  >
                    <ListPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add many
                  </Button>
                  <Button size="sm" className="h-9" onClick={() => setEditing('new')}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add group
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Filter by status"
              value={filters.status}
              highlight={filters.status !== 'ACTIVE'}
              onChange={(status) => update({ status })}
              options={[
                ['ACTIVE', `Active${facets ? ` (${facets.status.ACTIVE ?? 0})` : ''}`],
                ['ARCHIVED', `Archived${facets ? ` (${facets.status.ARCHIVED ?? 0})` : ''}`],
                ['ALL', 'All groups'],
              ]}
            />
            <FilterSelect
              label="Filter by category"
              value={filters.category}
              onChange={(category) => update({ category })}
              options={[
                ['', 'All categories'],
                ...categoryList.map((c) => [
                  c.id,
                  `${c.name}${facets ? ` (${facets.categories[c.id] ?? 0})` : ''}`,
                ]),
                ['none', `No category${facets ? ` (${facets.categories.none ?? 0})` : ''}`],
              ]}
            />
            {facebookPages.length > 0 && (
              <FilterSelect
                label="Filter by Page"
                value={filters.pageId}
                onChange={(pageId) => update({ pageId })}
                options={[
                  ['', 'All Pages'],
                  ...facebookPages.map((page) => [
                    page.id,
                    `${page.name}${facets?.pages ? ` (${facets.pages[page.id] ?? 0})` : ''}`,
                  ]),
                ]}
              />
            )}
            {facets?.tags?.length > 0 && (
              <FilterSelect
                label="Filter by tag"
                value={filters.tag}
                onChange={(tag) => update({ tag })}
                options={[
                  ['', 'All tags'],
                  ...facets.tags.map((t) => [t.tag, `${t.tag} (${t.count})`]),
                ]}
              />
            )}
          </div>
        </div>

        {groups.isPending ? (
          <GroupsSkeleton />
        ) : groups.error ? (
          <ErrorState
            title="Could not load the groups"
            error={groups.error}
            onRetry={() => groups.refetch()}
          />
        ) : data.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={SearchX}
              title="No groups match these filters"
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              art={GroupsArt}
              title="No groups yet"
              description={
                canManage
                  ? 'Add the Facebook Groups your Pages are in. Posts to those Pages then get a sharing task for each group.'
                  : 'Owners and admins add the groups your team shares in.'
              }
              action={
                canManage ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add group
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <>
            <Table caption="Facebook Groups" fetching={groups.isPlaceholderData}>
              <THead>
                <Th>Group</Th>
                <Th hide="md">Your Pages</Th>
                <Th hide="xl">Category</Th>
                <Th hide="lg">Tags</Th>
                <Th hide="sm" align="right">
                  Members
                </Th>
                <Th>Last shared</Th>
                {canManage && (
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </THead>
              <TBody>
                {data.items.map((group) => (
                  <Tr key={group.id}>
                    <Td className="max-w-[18rem]">
                      <ExternalAnchor
                        href={group.url}
                        className="text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                      >
                        {group.name}
                      </ExternalAnchor>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        {group.status === FACEBOOK_GROUP_STATUS.ARCHIVED && <Badge>Archived</Badge>}
                        {group.minDaysBetweenShares && (
                          <span>Every {group.minDaysBetweenShares} days at most</span>
                        )}
                        {group.notes && (
                          <span className="inline-flex items-center gap-1" title={group.notes}>
                            <StickyNote className="h-3 w-3" aria-hidden="true" /> Rules
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td hide="md">
                      {group.pages?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {group.pages.map((page) => (
                            <span
                              key={page.id}
                              className="rounded-full bg-[#1877F2]/10 px-2 py-0.5 text-[11px] font-medium text-[#1464d8] dark:bg-[#1877F2]/20 dark:text-[#8ab8ff]"
                            >
                              {page.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">No Pages</span>
                        </span>
                      )}
                    </Td>
                    <Td hide="xl" className="text-xs">
                      {group.category?.name ?? <span className="text-muted">—</span>}
                    </Td>
                    <Td hide="lg">
                      <span className="flex flex-wrap gap-1">
                        {group.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => update({ tag })}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20"
                          >
                            {tag}
                          </button>
                        ))}
                      </span>
                    </Td>
                    <Td hide="sm" numeric className="text-xs">
                      {typeof group.memberCount === 'number' ? (
                        NUMBER.format(group.memberCount)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      <LastShared group={group} />
                    </Td>
                    {canManage && (
                      <Td align="right">
                        <Menu
                          portal
                          trigger={({ toggle, props }) => (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={toggle}
                              {...props}
                              aria-label={`Actions for ${group.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem
                                icon={Pencil}
                                onClick={() => {
                                  close();
                                  setEditing(group);
                                }}
                              >
                                Edit
                              </MenuItem>
                              {group.status === FACEBOOK_GROUP_STATUS.ACTIVE ? (
                                <MenuItem
                                  icon={Archive}
                                  onClick={() => {
                                    close();
                                    setStatus(group, FACEBOOK_GROUP_STATUS.ARCHIVED);
                                  }}
                                >
                                  Archive
                                </MenuItem>
                              ) : (
                                <MenuItem
                                  icon={ArchiveRestore}
                                  onClick={() => {
                                    close();
                                    setStatus(group, FACEBOOK_GROUP_STATUS.ACTIVE);
                                  }}
                                >
                                  Restore
                                </MenuItem>
                              )}
                              <MenuSeparator />
                              <MenuItem
                                icon={Trash2}
                                danger
                                onClick={() => {
                                  close();
                                  deleteGroup.reset();
                                  setDeleting(group);
                                }}
                              >
                                Delete
                              </MenuItem>
                            </>
                          )}
                        </Menu>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {/* Outside the table's scroller, so it stays put while the table scrolls sideways. */}
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={data.limit}
              noun={data.total === 1 ? 'group' : 'groups'}
              onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            />
          </>
        )}
      </Card>

      {editing && (
        <GroupFormDialog
          group={editing === 'new' ? null : editing}
          categories={categoryList}
          onClose={() => setEditing(null)}
        />
      )}
      {bulkOpen && <BulkAddDialog categories={categoryList} onClose={() => setBulkOpen(false)} />}
      {categoriesOpen && (
        <CategoriesDialog categories={categoryList} onClose={() => setCategoriesOpen(false)} />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'this group'}?`}
        description="It is removed from the directory with its open and skipped tasks. Groups with completed shares can only be archived, so their history is kept."
        confirmLabel="Delete group"
        loading={deleteGroup.isPending}
        error={deleteGroup.error}
        onConfirm={() =>
          deleteGroup.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted`);
              setDeleting(null);
            },
          })
        }
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
