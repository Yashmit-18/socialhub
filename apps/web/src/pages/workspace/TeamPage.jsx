import {
  ACCOUNT_ACCESS_MODES,
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  canAssignRole,
  canManageMember,
  createInvitationSchema,
  hasFullAccountAccess,
} from '@socialhub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AccountAccessEditor } from '../../components/accounts/AccountAccessEditor.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Badge, RoleBadge } from '../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Card, CardHeader } from '../../components/ui/Card.jsx';
import { ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { FormError, Input, Select } from '../../components/ui/Field.jsx';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useApiForm } from '../../hooks/useApiForm.js';
import { api } from '../../lib/api.js';
import { keys, useInvitations, useMembers, useSocialAccounts } from '../../lib/queries.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';
import { AccessSummary, MemberAccessDialog } from './accounts/AccessPage.jsx';

const ROLE_ORDER = { OWNER: 0, ADMIN: 1, EDITOR: 2, VIEWER: 3 };

function useInvalidateTeam(workspaceId) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.invitations(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.activity(workspaceId) }),
    ]);
}

/**
 * The API reports a rejected `accountAccess` (e.g. an account removed meanwhile) as a field
 * error, but the form has no such field: surface the message itself as the form error.
 */
function invitationError(err) {
  const fields = err?.fields ?? {};
  if ('email' in fields || 'role' in fields) return err;
  const message = Object.entries(fields).find(
    ([key]) => key.split('.')[0] === 'accountAccess',
  )?.[1];
  return message ? new Error(message) : err;
}

/* -------------------------------------------------------------- invite link */

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy failed — select the link and copy it manually.');
    }
  };
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs dark:border-white/10 dark:bg-white/5"
        aria-label="Invitation link"
      />
      <Button variant="secondary" onClick={copy}>
        {copied ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function InviteLinkModal({ result, onClose }) {
  return (
    <Modal
      open={Boolean(result)}
      onClose={onClose}
      title="Invitation ready"
      description={result ? `Share this link with ${result.invitation.email}.` : undefined}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {result && (
        <div className="space-y-4">
          <CopyField value={result.inviteUrl} />
          <p
            className={cn(
              'flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm',
              result.emailDelivered
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
            )}
          >
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {result.emailDelivered
              ? 'We also emailed this invitation.'
              : 'Email delivery is not configured on this server, so no email was sent. Share the link above directly.'}
          </p>
          <p className="text-xs text-muted">
            The link works once, only for {result.invitation.email}, and expires{' '}
            {formatDate(result.invitation.expiresAt)}. For security it is shown only now — resending
            creates a new link.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------- invite modal */

function InviteModal({ open, onClose, onInvited }) {
  // The dialog unmounts when closed, so every invitation starts with a clean form and no
  // accounts selected.
  return open ? <InviteDialog onClose={onClose} onInvited={onInvited} /> : null;
}

function InviteDialog({ onClose, onInvited }) {
  const { workspace, role } = useWorkspace();
  const accessHeadingId = useId();
  const roles = ASSIGNABLE_ROLES.filter((r) => canAssignRole(role, r));
  const { register, submit, errors, isSubmitting, formError, watch } = useApiForm(
    createInvitationSchema,
    {
      defaultValues: { email: '', role: roles.includes(ROLES.EDITOR) ? ROLES.EDITOR : roles[0] },
    },
  );
  const selectedRole = watch('role');
  const accounts = useSocialAccounts(workspace.id);
  // Least privilege: invited editors and viewers get no accounts unless some are chosen here.
  const [accessMode, setAccessMode] = useState(ACCOUNT_ACCESS_MODES.SELECTED);
  const [accessIds, setAccessIds] = useState(() => new Set());
  const restricted = Boolean(selectedRole) && !hasFullAccountAccess(selectedRole);

  const onSubmit = submit(async (values) => {
    // Admins always use every account, so their invitations carry no account access.
    const body = !hasFullAccountAccess(values.role)
      ? {
          ...values,
          accountAccess: {
            mode: accessMode,
            socialAccountIds:
              accessMode === ACCOUNT_ACCESS_MODES.SELECTED
                ? (accounts.data ?? []).filter((a) => accessIds.has(a.id)).map((a) => a.id)
                : [],
          },
        }
      : values;
    let result;
    try {
      result = await api.post(`/workspaces/${workspace.id}/invitations`, body);
    } catch (err) {
      throw invitationError(err);
    }
    onInvited(result);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a teammate"
      description={`They'll join ${workspace.name} with the role you choose.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            Send invitation
          </Button>
        </>
      }
    >
      {/* Scrolls inside the dialog so the footer stays reachable on short screens. */}
      <div className="-m-1 max-h-[calc(100dvh-16rem)] space-y-5 overflow-y-auto p-1">
        <form id="invite-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Input
            label="Email address"
            type="email"
            placeholder="teammate@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Select label="Role" error={errors.role?.message} {...register('role')}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          {selectedRole && (
            <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-muted dark:bg-white/[0.03]">
              {ROLE_DESCRIPTIONS[selectedRole]}
            </p>
          )}
        </form>
        {/* Outside the <form>: pressing Enter in the account search must not send the invitation. */}
        {selectedRole && (
          <section
            aria-labelledby={accessHeadingId}
            className="space-y-3 border-t border-slate-100 pt-4 dark:border-white/5"
          >
            <div>
              <h3
                id={accessHeadingId}
                className="text-sm font-semibold text-slate-900 dark:text-white"
              >
                Account access
              </h3>
              {restricted && (
                <p className="mt-0.5 text-xs text-muted">
                  The Facebook Pages and Instagram accounts they can see and use after joining. You
                  can change this at any time.
                </p>
              )}
            </div>
            {restricted ? (
              <AccountAccessEditor
                mode={accessMode}
                onModeChange={setAccessMode}
                selectedIds={accessIds}
                onSelectedIdsChange={setAccessIds}
                accounts={accounts.data ?? []}
                loading={accounts.isPending}
                error={accounts.data ? null : accounts.error}
                subject="they"
              />
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Admins can use every social account in the workspace.
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- member row */

function MemberRow({ member, isSelf, onEditAccess, onRemove }) {
  const { workspace, role: myRole } = useWorkspace();
  const invalidate = useInvalidateTeam(workspace.id);
  const manageable = !isSelf && canManageMember(myRole, member.role);
  const assignable = ASSIGNABLE_ROLES.filter((r) => canAssignRole(myRole, r));

  const changeRole = useMutation({
    mutationFn: (role) => api.patch(`/workspaces/${workspace.id}/members/${member.id}`, { role }),
    onSuccess: async (data) => {
      await invalidate();
      toast.success(`${member.user.name} is now ${ROLE_LABELS[data.member.role]}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
      <Avatar name={member.user.name} seed={member.user.id} size="md" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-semibold">
          {member.user.name}
          {isSelf && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted">{member.user.email}</p>
      </div>
      <div className="hidden w-32 text-xs text-muted md:block">
        <AccessSummary role={member.role} accountAccess={member.accountAccess} />
      </div>
      <div className="hidden w-28 text-xs text-muted sm:block" title={formatDate(member.joinedAt)}>
        Joined {timeAgo(member.joinedAt)}
      </div>
      <div className="w-32">
        {manageable && assignable.length > 1 ? (
          <select
            aria-label={`Role for ${member.user.name}`}
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(e) => changeRole.mutate(e.target.value)}
            className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium dark:border-white/10 dark:bg-slate-900"
          >
            {[...new Set([member.role, ...assignable])].map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </div>
      <div className="w-9">
        {manageable && (
          <Menu
            trigger={({ toggle, props }) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                {...props}
                aria-label={`Actions for ${member.user.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          >
            {(close) => (
              <>
                {!hasFullAccountAccess(member.role) && (
                  <>
                    <MenuItem
                      icon={KeyRound}
                      onClick={() => {
                        close();
                        onEditAccess(member);
                      }}
                    >
                      Edit account access
                    </MenuItem>
                    <MenuSeparator />
                  </>
                )}
                <MenuItem
                  icon={UserMinus}
                  danger
                  onClick={() => {
                    close();
                    onRemove(member);
                  }}
                >
                  Remove from workspace
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
    </li>
  );
}

/* --------------------------------------------------------- invitations card */

function PendingInvitations({ onLink }) {
  const { workspace, role } = useWorkspace();
  const { data = [], isPending } = useInvitations(workspace.id);
  const invalidate = useInvalidateTeam(workspace.id);

  const resend = useMutation({
    mutationFn: (id) => api.post(`/workspaces/${workspace.id}/invitations/${id}/resend`),
    onSuccess: async (result) => {
      await invalidate();
      onLink(result);
    },
    onError: (err) => toast.error(err.message),
  });
  const revoke = useMutation({
    mutationFn: (id) => api.delete(`/workspaces/${workspace.id}/invitations/${id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('Invitation revoked');
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending || data.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader
        icon={Mail}
        title="Pending invitations"
        description={`${data.length} waiting to be accepted`}
      />
      <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
        {data.map((inv) => {
          const manageable = canAssignRole(role, inv.role);
          const expired = inv.status === 'EXPIRED';
          return (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-slate-200 text-slate-400 dark:border-white/10">
                <Mail className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">{inv.email}</p>
                <p className="text-xs text-muted">
                  Invited by {inv.invitedBy?.name ?? 'a former member'} ·{' '}
                  {expired ? 'expired' : `expires ${timeAgo(inv.expiresAt)}`}
                </p>
                {/* What they will be able to use once they accept. */}
                <AccessSummary role={inv.role} accountAccess={inv.accountAccess} className="mt-1" />
              </div>
              {expired ? <Badge tone="warning">Expired</Badge> : <RoleBadge role={inv.role} />}
              {manageable && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={resend.isPending && resend.variables === inv.id}
                    onClick={() => resend.mutate(inv.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                    {expired ? 'Renew' : 'Resend'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    loading={revoke.isPending && revoke.variables === inv.id}
                    onClick={() => revoke.mutate(inv.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Revoke
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* --------------------------------------------------------------------- page */

export default function TeamPage() {
  const { user } = useAuth();
  const { workspace, role, can } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTeam(workspace.id);
  const [params, setParams] = useSearchParams();
  const { data: members, isPending, error, refetch } = useMembers(workspace.id);

  const [inviteOpen, setInviteOpen] = useState(
    params.get('invite') === '1' && can(PERMISSIONS.MEMBERS_INVITE),
  );
  const [linkResult, setLinkResult] = useState(null);
  const [accessMember, setAccessMember] = useState(null);
  const [removeMember, setRemoveMember] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Stable, because dialogs restart their focus handling when `onClose` changes.
  const closeInvite = useCallback(() => setInviteOpen(false), []);
  const closeLink = useCallback(() => setLinkResult(null), []);
  const closeAccess = useCallback(() => setAccessMember(null), []);

  useEffect(() => {
    if (params.has('invite')) setParams({}, { replace: true });
  }, [params, setParams]);

  const remove = useMutation({
    mutationFn: (m) => api.delete(`/workspaces/${workspace.id}/members/${m.id}`),
    onSuccess: async (_d, m) => {
      await invalidate();
      toast.success(`${m.user.name} was removed`);
      setRemoveMember(null);
    },
  });

  const leave = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspace.id}/leave`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.workspaces });
      toast.success(`You left ${workspace.name}`);
      navigate('/', { replace: true });
    },
  });

  if (isPending) return <PageLoader />;

  const sorted = [...(members ?? [])].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.name.localeCompare(b.user.name),
  );

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage who can access this workspace, what they can do, and which social accounts they can use."
        actions={
          <>
            {role !== ROLES.OWNER && (
              <Button variant="secondary" onClick={() => setLeaveOpen(true)}>
                <LogOut className="h-4 w-4" aria-hidden="true" /> Leave
              </Button>
            )}
            {can(PERMISSIONS.MEMBERS_INVITE) && (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite teammate
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : (
        <Card>
          <CardHeader
            icon={Users}
            title="Members"
            description={`${sorted.length} ${sorted.length === 1 ? 'person' : 'people'} in ${workspace.name}`}
            action={
              can(PERMISSIONS.MEMBERS_MANAGE) && (
                <ButtonLink
                  to={`/w/${workspace.slug}/accounts/access`}
                  variant="secondary"
                  size="sm"
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Account access
                </ButtonLink>
              )
            }
          />
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
            {sorted.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isSelf={m.user.id === user.id}
                onEditAccess={setAccessMember}
                onRemove={setRemoveMember}
              />
            ))}
          </ul>
        </Card>
      )}

      {can(PERMISSIONS.MEMBERS_INVITE) && <PendingInvitations onLink={setLinkResult} />}

      <InviteModal
        open={inviteOpen}
        onClose={closeInvite}
        onInvited={async (result) => {
          setInviteOpen(false);
          await invalidate();
          setLinkResult(result);
        }}
      />
      <InviteLinkModal result={linkResult} onClose={closeLink} />
      <MemberAccessDialog member={accessMember} onClose={closeAccess} />
      <ConfirmDialog
        open={Boolean(removeMember)}
        title={`Remove ${removeMember?.user.name ?? 'member'}?`}
        description="They will immediately lose access to this workspace and its social accounts."
        confirmLabel="Remove member"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(removeMember)}
        onClose={() => {
          remove.reset();
          setRemoveMember(null);
        }}
      />
      <ConfirmDialog
        open={leaveOpen}
        title={`Leave ${workspace.name}?`}
        description="You will lose access until someone invites you again."
        confirmLabel="Leave workspace"
        loading={leave.isPending}
        error={leave.error}
        onConfirm={() => leave.mutate()}
        onClose={() => {
          leave.reset();
          setLeaveOpen(false);
        }}
      />
    </>
  );
}
