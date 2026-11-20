import { ACCOUNT_ACCESS_MODES, canManageMember, hasFullAccountAccess } from '@socialhub/shared';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { usePatchMemberAccess } from '../../hooks/useAccountActions.js';
import { useMembers } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Badge, RoleBadge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { ErrorState, Skeleton } from '../ui/Feedback.jsx';
import { FormError } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a member can use of the selection today, from their stored grant (not a permission check). */
function accessSummary(member, accountIds) {
  if (member.accountAccess?.mode === ACCOUNT_ACCESS_MODES.ALL) {
    return 'Can use every account in this workspace';
  }
  const granted = new Set(member.accountAccess?.socialAccountIds ?? []);
  const has = accountIds.filter((id) => granted.has(id)).length;
  const one = accountIds.length === 1;
  if (has === 0)
    return one ? 'No access to the selected account' : 'No access to the selected accounts';
  if (has === accountIds.length) {
    return one ? 'Has access to the selected account' : 'Has access to all selected accounts';
  }
  return `Has access to ${has} of ${accountIds.length} selected accounts`;
}

/** Why a member cannot be picked: owners/admins always see everything; the rest outrank you. */
function lockedNote({ full, isSelf }) {
  if (full) return 'Owners and admins always have access to every account';
  if (isSelf) return 'You cannot change your own access';
  return 'Only someone with a higher role can change this member’s access';
}

function MemberOption({ member, isSelf, describedById, checked, disabled, onToggle, badge, note }) {
  const name = member.user?.name ?? 'Unknown member';
  return (
    <li>
      <label
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 text-sm',
          disabled
            ? 'cursor-not-allowed opacity-75'
            : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]',
        )}
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={name}
          aria-describedby={describedById}
        />
        <Avatar name={name} seed={member.user?.id ?? member.id} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-medium text-slate-900 dark:text-white">
              {name}
              {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
            </span>
            {badge}
          </span>
          <span id={describedById} className="mt-0.5 block text-xs text-muted">
            {note}
          </span>
        </span>
      </label>
    </li>
  );
}

function MemberListSkeleton() {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-white/5" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BulkAccessDialogBody({ onClose, onDone, accountIds }) {
  const { workspace, membership, role } = useWorkspace();
  const baseId = useId();
  const members = useMembers(workspace.id);
  const patch = usePatchMemberAccess(workspace.id);
  const [chosen, setChosen] = useState(() => new Set());
  const [running, setRunning] = useState(null);
  const [progress, setProgress] = useState(null);
  const [failures, setFailures] = useState([]);

  // Modal re-runs its focus handling whenever `onClose` changes, so it gets one stable function.
  // Closing is ignored while changes are being applied.
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => {
    if (!busyRef.current) onCloseRef.current?.();
  }, []);

  const rows = (members.data ?? []).map((member) => {
    const isSelf = member.id === membership.id;
    const full = hasFullAccountAccess(member.role);
    return {
      member,
      isSelf,
      full,
      manageable: !isSelf && !full && canManageMember(role, member.role),
    };
  });
  const selectable = rows.filter((r) => r.manageable).map((r) => r.member);
  const locked = rows.filter((r) => !r.manageable);
  const targets = selectable.filter((m) => chosen.has(m.id));
  const allChosen = selectable.length > 0 && targets.length === selectable.length;
  const idCount = accountIds.length;

  const toggle = (memberId) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  const toggleAll = () => setChosen(allChosen ? new Set() : new Set(selectable.map((m) => m.id)));

  const apply = async (kind) => {
    const people = targets;
    if (people.length === 0 || idCount === 0 || busyRef.current) return;
    busyRef.current = true;
    setRunning(kind);
    setFailures([]);
    const failed = [];
    // One member at a time: every request is independent, so one failure never stops the rest.
    for (const [index, member] of people.entries()) {
      setProgress({ done: index, total: people.length });
      try {
        await patch.mutateAsync(
          kind === 'grant'
            ? { memberId: member.id, add: accountIds }
            : { memberId: member.id, remove: accountIds },
        );
      } catch (err) {
        failed.push({
          id: member.id,
          name: member.user?.name ?? 'A member',
          message: err?.message ?? 'The change could not be saved.',
        });
      }
    }
    busyRef.current = false;
    setRunning(null);
    setProgress(null);

    const succeeded = people.length - failed.length;
    const verb = kind === 'grant' ? 'granted to' : 'revoked for';
    if (failed.length === 0) {
      toast.success(`Access ${verb} ${plural(succeeded, 'member')}`);
      onDone?.({ kind, members: succeeded });
      onCloseRef.current?.();
      return;
    }
    if (succeeded > 0) {
      toast.warning(
        `Access ${verb} ${succeeded} of ${plural(people.length, 'member')} — see the errors`,
      );
    } else {
      toast.error(`Access could not be changed for ${plural(failed.length, 'member')}`);
    }
    setFailures(failed);
    // Keep only the members that failed selected, so trying again targets just them.
    setChosen(new Set(failed.map((f) => f.id)));
  };

  const busy = Boolean(running);
  const canApply = targets.length > 0 && idCount > 0 && !busy;

  return (
    <Modal
      open
      onClose={close}
      title="Manage account access"
      description={`Grant or revoke access to ${idCount === 1 ? 'the selected account' : `the ${idCount} selected accounts`} for the members you choose. Their access to other accounts does not change.`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger-outline"
            loading={running === 'revoke'}
            disabled={!canApply}
            onClick={() => apply('revoke')}
          >
            Revoke access
          </Button>
          <Button loading={running === 'grant'} disabled={!canApply} onClick={() => apply('grant')}>
            Grant access
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {failures.length > 0 && (
          <FormError
            message={
              <>
                <span className="font-medium">
                  Access could not be changed for {plural(failures.length, 'member')}:
                </span>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {failures.map((f) => (
                    <li key={f.id}>
                      <span className="font-medium">{f.name}</span> — {f.message}
                    </li>
                  ))}
                </ul>
              </>
            }
          />
        )}

        {members.isPending ? (
          <div className="rounded-xl border border-slate-200 dark:border-white/10">
            <p className="sr-only" role="status">
              Loading members…
            </p>
            <MemberListSkeleton />
          </div>
        ) : members.isError && !members.data ? (
          <ErrorState
            title="Members could not be loaded"
            error={members.error}
            onRetry={() => members.refetch()}
          />
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 dark:border-white/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Editors and viewers
              </p>
              {selectable.length > 1 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={busy}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
                >
                  {allChosen ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {selectable.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted">
                  There are no editors or viewers whose access you can change. Owners and admins
                  always have access to every account —{' '}
                  <Link
                    to={`/w/${workspace.slug}/team`}
                    className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-300"
                  >
                    invite teammates
                  </Link>{' '}
                  as editors or viewers to share accounts with them.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {selectable.map((member) => (
                    <MemberOption
                      key={member.id}
                      member={member}
                      describedById={`${baseId}-${member.id}`}
                      checked={chosen.has(member.id)}
                      disabled={busy}
                      onToggle={() => toggle(member.id)}
                      badge={<RoleBadge role={member.role} />}
                      note={accessSummary(member, accountIds)}
                    />
                  ))}
                </ul>
              )}
              {locked.length > 0 && (
                <div role="group" aria-label="Members whose access cannot be changed here">
                  <p className="sticky top-0 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-white/5 dark:bg-slate-900/95 dark:text-slate-400">
                    Not changed here
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {locked.map(({ member, full, isSelf }) => (
                      <MemberOption
                        key={member.id}
                        member={member}
                        isSelf={isSelf}
                        describedById={`${baseId}-${member.id}`}
                        checked={false}
                        disabled
                        onToggle={() => {}}
                        badge={
                          full ? (
                            <Badge tone="violet">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Full access
                            </Badge>
                          ) : (
                            <RoleBadge role={member.role} />
                          )
                        }
                        note={lockedNote({ full, isSelf })}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted" role="status" aria-live="polite">
          {progress
            ? `Updating access… ${progress.done} of ${plural(progress.total, 'member')} done`
            : targets.length > 0
              ? `${plural(targets.length, 'member')} selected`
              : ''}
        </p>
      </div>
    </Modal>
  );
}

/**
 * Grants or revokes several destinations (`accountIds`) for several members at once, one member
 * at a time through PATCH /members/:id/account-access (an incremental change, so nothing else in
 * a member's grant is touched). Only editors/viewers the actor outranks can be picked; owners and
 * admins are listed as "Full access". Failures are listed per member without stopping the others;
 * the dialog closes (and `onDone` runs) only when every change succeeded. The API enforces the
 * same rules on every request.
 */
export function BulkAccessDialog({ open, onClose, accountIds, onDone }) {
  // Mounted only while open, so every opening starts with a clean selection.
  if (!open) return null;
  return <BulkAccessDialogBody onClose={onClose} onDone={onDone} accountIds={accountIds ?? []} />;
}
