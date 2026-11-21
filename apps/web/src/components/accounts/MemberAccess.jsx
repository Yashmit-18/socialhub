import {
  ACCOUNT_ACCESS_MODES,
  ERROR_CODES,
  ROLE_LABELS,
  hasFullAccountAccess,
} from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { usePatchMemberAccess, useReplaceMemberAccess } from '../../hooks/useAccountActions.js';
import {
  accessChanges,
  describeAccess,
  memberName,
  savedIds,
  savedMode,
} from '../../lib/memberAccess.js';
import { keys, useSocialAccounts } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/Button.jsx';
import { Modal } from '../ui/Modal.jsx';
import { AccountAccessEditor } from './AccountAccessEditor.jsx';

const CONFLICT_MESSAGE = 'Access was changed by someone else. Reload and try again.';

function saveErrorMessage(error) {
  if (error?.code === ERROR_CODES.CONFLICT) return CONFLICT_MESSAGE;
  const fieldMessage = Object.values(error?.fields ?? {})[0];
  return fieldMessage ?? error?.message ?? 'Access could not be saved. Please try again.';
}

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
 * Edits one member's social account access. `member` is a GET /members item — nothing renders
 * while it is null.
 *
 * Saving sends only what changed: within "Selected accounts only" the accounts added and
 * removed (PATCH, so two admins editing different accounts of the same member never overwrite
 * each other, and a conflicting change answers 409); switching between "All accounts" and
 * selected accounts replaces the grant (PUT).
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
  const patch = usePatchMemberAccess(workspace.id);
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
  const pending = replace.isPending || patch.isPending;
  const error = replace.error ?? patch.error;

  const save = () => {
    const done = {
      onSuccess: () => {
        toast.success(`Account access updated for ${name}`);
        onClose();
      },
    };
    replace.reset();
    patch.reset();
    const stillSelecting = selecting && savedMode(member) === ACCOUNT_ACCESS_MODES.SELECTED;
    if (stillSelecting) {
      const { add, remove } = accessChanges(savedOnList, chosen);
      if (add.length === 0 && remove.length === 0) {
        onClose();
        return;
      }
      patch.mutate({ memberId: member.id, add, remove }, done);
    } else {
      replace.mutate(
        { memberId: member.id, mode, socialAccountIds: selecting ? chosen : [] },
        done,
      );
    }
  };

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
    patch.reset();
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
            <Button loading={pending} disabled={!canSave} onClick={save}>
              Save access
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p role="alert" className="min-w-0 flex-1 text-sm text-rose-700 dark:text-rose-300">
              {saveErrorMessage(error)}
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
