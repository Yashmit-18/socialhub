import {
  ACCOUNT_ACCESS_MODES,
  ERROR_CODES,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  canManageMember,
  hasFullAccountAccess,
} from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Server,
  Share2,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AccountAccessEditor } from '../../../components/accounts/AccountAccessEditor.jsx';
import { AccountPicture } from '../../../components/accounts/AccountBadges.jsx';
import { Avatar } from '../../../components/ui/Avatar.jsx';
import { Badge, RoleBadge } from '../../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../../components/ui/Button.jsx';
import { Card, CardHeader } from '../../../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/Feedback.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { Pagination } from '../../../components/ui/Pagination.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useReplaceMemberAccess } from '../../../hooks/useAccountActions.js';
import { PLATFORM_LABELS } from '../../../lib/meta.js';
import { keys, useMembers, useSocialAccounts } from '../../../lib/queries.js';
import { cn } from '../../../lib/utils.js';

/*
 * Team access (MODULE 6): which Facebook Pages and Instagram accounts each member may use.
 * Owners and admins always use every account; editors and viewers use only what is assigned
 * to them. Everything here is derived from GET /members and GET /social-accounts, and the API
 * enforces the same rules on every request — the page only hides what the API would reject.
 *
 * `AccessSummary` and `MemberAccessDialog` are shared with the Team page.
 */

const ROLE_ORDER = { [ROLES.OWNER]: 0, [ROLES.ADMIN]: 1, [ROLES.EDITOR]: 2, [ROLES.VIEWER]: 3 };
const COVERAGE_PAGE_SIZE = 20;
const MAX_AVATARS = 4;
const CONFLICT_MESSAGE = 'Access was changed by someone else. Reload and try again.';
const nameList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const memberName = (member) => member.user?.name ?? 'Former member';
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const savedMode = (member) => member.accountAccess?.mode ?? ACCOUNT_ACCESS_MODES.SELECTED;
const savedIds = (member) => new Set(member.accountAccess?.socialAccountIds ?? []);

function byRoleThenName(a, b) {
  return (
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
    memberName(a).localeCompare(memberName(b))
  );
}

/** What a member (or an invitation, which has the same `role` + `accountAccess` shape) can use. */
function describeAccess(role, accountAccess) {
  if (hasFullAccountAccess(role)) {
    return {
      kind: 'full',
      label: 'Full access',
      hint: 'Owners and admins always use every social account in this workspace.',
    };
  }
  if (accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) {
    return {
      kind: 'all',
      label: 'All accounts',
      hint: 'Every current and future social account in this workspace.',
    };
  }
  const count = accountAccess?.socialAccountIds?.length ?? 0;
  if (count === 0) {
    return { kind: 'none', label: 'No accounts', hint: 'No social accounts are assigned yet.' };
  }
  return {
    kind: 'some',
    label: plural(count, 'account'),
    hint: `Only the ${plural(count, 'assigned social account')}.`,
  };
}

function saveErrorMessage(error) {
  if (error?.code === ERROR_CODES.CONFLICT) return CONFLICT_MESSAGE;
  const fieldMessage = Object.values(error?.fields ?? {})[0];
  return fieldMessage ?? error?.message ?? 'Access could not be saved. Please try again.';
}

function matchesAccount(account, needle) {
  if (!needle) return true;
  return [account.name, account.username, account.externalId].some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
  );
}

/**
 * For every destination: the members who can use it (full-access roles, members with ALL, and
 * members whose selection includes it), plus how many of them are editors or viewers.
 */
function computeCoverage(accounts, members) {
  const grants = [...members].sort(byRoleThenName).map((member) => ({
    member,
    full: hasFullAccountAccess(member.role),
    all: member.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL,
    ids: savedIds(member),
  }));
  return accounts.map((account) => {
    const users = grants.filter((g) => g.full || g.all || g.ids.has(account.id));
    const team = users.filter((g) => !g.full);
    return {
      account,
      members: users.map((g) => g.member),
      editors: team.filter((g) => g.member.role === ROLES.EDITOR).length,
      viewers: team.filter((g) => g.member.role === ROLES.VIEWER).length,
      teamCount: team.length,
    };
  });
}

function teamLabel(editors, viewers) {
  return [editors > 0 && plural(editors, 'editor'), viewers > 0 && plural(viewers, 'viewer')]
    .filter(Boolean)
    .join(' · ');
}

/* ------------------------------------------------------------- shared pieces */

/** "Full access" / "All accounts" / "No accounts" / "N accounts" for a member or invitation. */
export function AccessSummary({ role, accountAccess, className }) {
  const access = describeAccess(role, accountAccess);
  return (
    <span
      title={access.hint}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs whitespace-nowrap',
        access.kind === 'none' ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted',
        className,
      )}
    >
      {access.kind === 'full' ? (
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      {access.label}
    </span>
  );
}

/**
 * Edits one member's social account access; saving replaces the whole grant
 * (PUT /members/:id/account-access). `member` is a GET /members item — nothing renders while it
 * is null. Pass a stable `onClose`: the dialog's focus handling restarts when it changes.
 */
export function MemberAccessDialog({ member, onClose }) {
  // Keyed by member so every opening starts from that member's saved access.
  return member ? <MemberAccessForm key={member.id} member={member} onClose={onClose} /> : null;
}

function MemberAccessForm({ member: openedMember, onClose }) {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const accounts = useSocialAccounts(workspace.id);
  const replace = useReplaceMemberAccess(workspace.id);
  // The member as last loaded; "Reload" after a failed save refreshes it and resets the draft.
  const [member, setMember] = useState(openedMember);
  const [mode, setMode] = useState(() => savedMode(openedMember));
  const [selectedIds, setSelectedIds] = useState(() => savedIds(openedMember));
  const [reloading, setReloading] = useState(false);

  const name = memberName(member);
  const fullAccess = hasFullAccountAccess(member.role);
  const list = accounts.data ?? [];
  const selecting = mode === ACCOUNT_ACCESS_MODES.SELECTED;
  // Ids go out in list order and only for accounts that still exist in the workspace.
  const chosen = list.filter((a) => selectedIds.has(a.id)).map((a) => a.id);
  const saved = savedIds(member);
  const savedOnList = list.filter((a) => saved.has(a.id)).map((a) => a.id);
  const changed = mode !== savedMode(member) || (selecting && chosen.join() !== savedOnList.join());
  // A selection can only be saved once the accounts it refers to are on screen.
  const canSave = !fullAccess && changed && (!selecting || accounts.isSuccess);

  const save = () =>
    replace.mutate(
      { memberId: member.id, mode, socialAccountIds: selecting ? chosen : [] },
      {
        onSuccess: () => {
          toast.success(`Account access updated for ${name}`);
          onClose();
        },
      },
    );

  const reload = async () => {
    setReloading(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: keys.members(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: keys.socialAccounts(workspace.id) }),
      ]);
    } finally {
      setReloading(false);
    }
    const fresh = queryClient
      .getQueryData(keys.members(workspace.id))
      ?.find((m) => m.id === member.id);
    if (!fresh) {
      toast.error(`${name} is no longer a member of ${workspace.name}.`);
      onClose();
      return;
    }
    replace.reset();
    setMember(fresh);
    setMode(savedMode(fresh));
    setSelectedIds(savedIds(fresh));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Social account access"
      description={`Choose which social accounts ${name} can see and use in ${workspace.name}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {fullAccess ? 'Close' : 'Cancel'}
          </Button>
          {!fullAccess && (
            <Button loading={replace.isPending} disabled={!canSave} onClick={save}>
              Save access
            </Button>
          )}
        </>
      }
    >
      {/* Scrolls inside the dialog so the footer stays reachable on short screens. */}
      <div className="-m-1 max-h-[calc(100dvh-16rem)] space-y-4 overflow-y-auto p-1">
        {replace.error && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p role="alert" className="min-w-0 flex-1 text-sm text-rose-700 dark:text-rose-300">
              {saveErrorMessage(replace.error)}
            </p>
            <Button variant="secondary" size="sm" loading={reloading} onClick={reload}>
              {!reloading && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Reload
            </Button>
          </div>
        )}
        {fullAccess ? (
          <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {name} has the {ROLE_LABELS[member.role] ?? member.role} role, which always includes
            every social account in this workspace.
          </p>
        ) : (
          <>
            <AccountAccessEditor
              mode={mode}
              onModeChange={setMode}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              accounts={list}
              loading={accounts.isPending}
              error={accounts.data ? null : accounts.error}
              subject={name}
            />
            {accounts.error && !accounts.data && (
              <Button variant="secondary" size="sm" onClick={() => accounts.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry loading accounts
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ helpers */

function SearchField({ label, placeholder, value, onChange }) {
  const id = useId();
  return (
    <div className="relative w-full sm:max-w-xs">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400"
      />
    </div>
  );
}

function ListSkeleton({ label, rows = 3 }) {
  return (
    <div className="mt-4 border-t border-slate-100 dark:border-white/5">
      <p role="status" className="sr-only">
        {label}
      </p>
      <ul className="divide-y divide-slate-100 dark:divide-white/5" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40 max-w-full" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-28 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoMatches({ message, onClear, clearLabel }) {
  return (
    <div className="mt-4 border-t border-slate-100 px-5 py-8 text-center sm:px-6 dark:border-white/5">
      <p className="text-sm text-muted">{message}</p>
      <Button variant="ghost" size="sm" className="mt-2" onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------- rules */

const RULES = [
  {
    icon: ShieldCheck,
    title: 'Owners and Admins always use every account',
    body: 'Their role includes every current and future Facebook Page and Instagram account in this workspace. It cannot be narrowed.',
  },
  {
    icon: KeyRound,
    title: 'Editors and Viewers only see and use the accounts assigned to them',
    body: 'Give them all accounts, or only the Pages and Instagram accounts they work on.',
  },
  {
    icon: UserPlus,
    title: 'New members and invitations start with no accounts',
    body: 'Until access is granted — when you invite them, or here — new teammates see no social accounts.',
  },
  {
    icon: Server,
    title: 'The server enforces this on every request',
    body: 'Accounts a member may not use are left out of every list and answer “not found”, whichever screen or tool asks.',
  },
];

function AccessRules() {
  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="How account access works"
        description="Decide which Facebook Pages and Instagram accounts each teammate can see and use."
      />
      <ul className="grid gap-3 px-5 pb-5 pt-4 sm:grid-cols-2 sm:px-6">
        {RULES.map((rule) => (
          <li
            key={rule.title}
            className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-white/5 dark:bg-white/[0.02]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-xs ring-1 ring-slate-200/80 dark:bg-white/5 dark:text-brand-300 dark:ring-white/10">
              <rule.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{rule.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{rule.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ members */

function MemberAccessRow({ member, self, editable, onEdit }) {
  const name = memberName(member);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
      <Avatar name={name} seed={member.user?.id ?? member.id} size="md" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {name}
          {self && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted">{member.user?.email}</p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 md:w-auto md:flex-nowrap">
        <div className="md:w-16">
          <RoleBadge role={member.role} />
        </div>
        <AccessSummary
          role={member.role}
          accountAccess={member.accountAccess}
          className="md:w-28"
        />
        <div className="ml-auto flex md:ml-0 md:w-32 md:justify-end">
          {editable && (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Edit access for ${name}`}
              onClick={() => onEdit(member)}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Edit access
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function MembersCard({ members, isSelf, canEdit, onEdit, inviteTo }) {
  const [query, setQuery] = useState('');
  const all = [...(members.data ?? [])].sort(byRoleThenName);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? all.filter((m) =>
        [m.user?.name, m.user?.email].some((v) => v?.toLowerCase().includes(needle)),
      )
    : all;
  const withoutAccounts = all.filter(
    (m) => describeAccess(m.role, m.accountAccess).kind === 'none',
  ).length;

  let body;
  if (members.error && !members.data) {
    body = (
      <ErrorState
        title="Members could not be loaded"
        error={members.error}
        onRetry={() => members.refetch()}
      />
    );
  } else if (members.isPending) {
    body = <ListSkeleton label="Loading members…" />;
  } else if (all.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title="No members yet"
        description="Invite teammates, then choose which social accounts each of them can use."
      />
    );
  } else {
    body = (
      <>
        <div className="px-5 pt-4 sm:px-6">
          <SearchField
            label="Search members"
            placeholder="Search by name or email"
            value={query}
            onChange={setQuery}
          />
        </div>
        {shown.length === 0 ? (
          <NoMatches
            message={`No members match “${query.trim()}”.`}
            clearLabel="Clear search"
            onClear={() => setQuery('')}
          />
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
            {shown.map((m) => (
              <MemberAccessRow
                key={m.id}
                member={m}
                self={isSelf(m)}
                editable={canEdit(m)}
                onEdit={onEdit}
              />
            ))}
          </ul>
        )}
        <p className="sr-only" aria-live="polite">
          {needle ? `${shown.length} of ${plural(all.length, 'member')} shown` : ''}
        </p>
      </>
    );
  }

  return (
    <Card className="pb-1">
      <CardHeader
        icon={Users}
        title="Members"
        description={
          members.data
            ? `${plural(all.length, 'member')}${withoutAccounts ? ` · ${withoutAccounts} without any accounts` : ''}`
            : 'Everyone in this workspace and the social accounts they can use.'
        }
        action={
          inviteTo && (
            <ButtonLink to={inviteTo} variant="secondary" size="sm">
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Invite
            </ButtonLink>
          )
        }
      />
      {body}
    </Card>
  );
}

/* ----------------------------------------------------------------- coverage */

function CoverageRow({ row, to }) {
  const { account, members, editors, viewers, teamCount } = row;
  const shown = members.slice(0, MAX_AVATARS);
  const more = members.length - shown.length;
  const names = members.map(memberName);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
      <AccountPicture account={account} />
      <div className="min-w-0 flex-1 basis-40">
        <Link
          to={to}
          className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-600 hover:underline dark:text-white dark:hover:text-brand-300"
        >
          {account.name}
        </Link>
        <p className="truncate text-xs text-muted">
          {PLATFORM_LABELS[account.platform] ?? 'Social account'}
          {account.username ? ` · @${account.username}` : ''}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-14 md:w-auto md:flex-nowrap md:justify-end md:pl-0">
        <div className="flex items-center gap-2 md:w-48" title={names.join(', ')}>
          <span className="flex -space-x-1.5" aria-hidden="true">
            {shown.map((m) => (
              <Avatar key={m.id} name={memberName(m)} seed={m.user?.id ?? m.id} size="xs" />
            ))}
            {more > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-900">
                +{more}
              </span>
            )}
          </span>
          <span className="text-xs text-muted">{plural(members.length, 'member')}</span>
          {names.length > 0 && <span className="sr-only">: {nameList.format(names)}</span>}
        </div>
        <div className="md:w-44 md:text-right">
          {teamCount === 0 ? (
            <span className="inline-flex" title="Only owners and admins can use this account">
              <Badge tone="warning" dot>
                No editors or viewers
              </Badge>
            </span>
          ) : (
            <span className="text-xs text-muted">{teamLabel(editors, viewers)}</span>
          )}
        </div>
      </div>
    </li>
  );
}

function CoverageCard({ accounts, members }) {
  const { workspace } = useWorkspace();
  const filterId = useId();
  const [query, setQuery] = useState('');
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [page, setPage] = useState(1);

  const failure = (!accounts.data && accounts.error) || (!members.data && members.error);
  const ready = Boolean(accounts.data && members.data);
  const rows = ready ? computeCoverage(accounts.data, members.data) : [];
  const uncovered = rows.filter((r) => r.teamCount === 0).length;
  const hasTeam = ready && members.data.some((m) => !hasFullAccountAccess(m.role));
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => (!uncoveredOnly || r.teamCount === 0) && matchesAccount(r.account, needle),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / COVERAGE_PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * COVERAGE_PAGE_SIZE, current * COVERAGE_PAGE_SIZE);

  const retry = () => {
    if (accounts.error) accounts.refetch();
    if (members.error) members.refetch();
  };
  const clearFilters = () => {
    setQuery('');
    setUncoveredOnly(false);
    setPage(1);
  };

  let body;
  if (failure) {
    body = <ErrorState title="Coverage could not be loaded" error={failure} onRetry={retry} />;
  } else if (!ready) {
    body = <ListSkeleton label="Loading account coverage…" />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Share2}
        title="No social accounts yet"
        description="Once Facebook Pages or Instagram accounts are added to this workspace, you can choose here who can use each one."
      />
    );
  } else {
    body = (
      <>
        {uncovered > 0 && (
          <p className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 sm:mx-6 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {hasTeam
              ? `${plural(uncovered, 'account')} can only be used by owners and admins — no editor or viewer has access.`
              : 'This workspace has no editors or viewers yet, so only owners and admins can use its accounts.'}
          </p>
        )}
        <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <SearchField
            label="Search account coverage"
            placeholder="Search accounts"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <label
            htmlFor={filterId}
            className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <input
              id={filterId}
              type="checkbox"
              checked={uncoveredOnly}
              onChange={(e) => {
                setUncoveredOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            Only accounts without editors or viewers ({uncovered})
          </label>
        </div>
        {filtered.length === 0 ? (
          <NoMatches
            message={
              needle
                ? `No accounts match “${query.trim()}”.`
                : 'Every account can be used by at least one editor or viewer.'
            }
            clearLabel="Clear filters"
            onClear={clearFilters}
          />
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
            {visible.map((row) => (
              <CoverageRow
                key={row.account.id}
                row={row}
                to={`/w/${workspace.slug}/accounts/a/${row.account.id}`}
              />
            ))}
          </ul>
        )}
        <Pagination
          page={current}
          pages={pages}
          total={filtered.length}
          limit={COVERAGE_PAGE_SIZE}
          onPageChange={setPage}
          noun={filtered.length === 1 ? 'account' : 'accounts'}
        />
      </>
    );
  }

  return (
    <Card className="pb-1">
      <CardHeader
        icon={Share2}
        title="Account coverage"
        description="Who can use each Facebook Page and Instagram account. Open an account to change who can use it."
      />
      {body}
    </Card>
  );
}

/* --------------------------------------------------------------------- page */

function AccessRestricted() {
  const { workspace } = useWorkspace();
  return (
    <Card>
      <EmptyState
        icon={Lock}
        title="Only owners and admins can manage team access"
        description="Owners and admins choose which Facebook Pages and Instagram accounts each editor and viewer can use. Ask one of them if you need access to another account."
        action={
          <ButtonLink variant="secondary" to={`/w/${workspace.slug}/accounts`}>
            View your accounts
          </ButtonLink>
        }
      />
    </Card>
  );
}

function TeamAccess() {
  const { user } = useAuth();
  const { workspace, membership, role, can } = useWorkspace();
  const members = useMembers(workspace.id);
  const accounts = useSocialAccounts(workspace.id);
  const [editing, setEditing] = useState(null);
  const closeEditor = useCallback(() => setEditing(null), []);

  const isSelf = (m) => m.id === membership?.id || (Boolean(user?.id) && m.user?.id === user.id);
  const canEdit = (m) =>
    !isSelf(m) && !hasFullAccountAccess(m.role) && canManageMember(role, m.role);

  return (
    <div className="space-y-6">
      <AccessRules />
      <MembersCard
        members={members}
        isSelf={isSelf}
        canEdit={canEdit}
        onEdit={setEditing}
        inviteTo={can(PERMISSIONS.MEMBERS_INVITE) ? `/w/${workspace.slug}/team?invite=1` : null}
      />
      <CoverageCard accounts={accounts} members={members} />
      <MemberAccessDialog member={editing} onClose={closeEditor} />
    </div>
  );
}

/** "Team access" tab of the Social accounts section (members:manage). */
export default function AccessPage() {
  const { can } = useWorkspace();
  // Other roles cannot change access (the API answers 403), so nothing is requested for them.
  return can(PERMISSIONS.MEMBERS_MANAGE) ? <TeamAccess /> : <AccessRestricted />;
}
