/**
 * Add or remove labels on one or several accounts. Each label shows whether all, some or none
 * of the accounts carry it; only the labels the person changes are sent, so labels the
 * accounts already have are left as they are. A new label can be created on the spot.
 */
import { ACCOUNT_LABEL_LIMITS, accountLabelNameSchema } from '@socialhub/shared';
import { Plus, Settings2, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LabelChip } from './AccountLabels.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState, ErrorState, Skeleton } from '../ui/Feedback.jsx';
import { FormError } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useAssignLabels, useCreateLabel } from '../../hooks/useAccountActions.js';
import { initialLabelStates, labelChanges } from '../../lib/accountOrganization.js';
import { useAccountLabels } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';

const inputClass =
  'h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100';

function LabelOption({ label, state, onToggle }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 accent-brand-600"
          checked={state === 'all'}
          ref={(el) => {
            if (el) el.indeterminate = state === 'some';
          }}
          onChange={onToggle}
          aria-label={label.name}
        />
        <LabelChip label={label} />
        {state === 'some' && <span className="text-xs text-muted">on some of them</span>}
      </label>
    </li>
  );
}

function useApplyLabelsForm({ accounts, onClose, onDone, onManage }) {
  const { workspace } = useWorkspace();
  const labelsQuery = useAccountLabels(workspace.id);
  const assign = useAssignLabels(workspace.id);
  const create = useCreateLabel(workspace.id);
  const labels = useMemo(() => labelsQuery.data?.items ?? [], [labelsQuery.data]);
  const initial = useMemo(() => initialLabelStates(accounts, labels), [accounts, labels]);
  const [chosen, setChosen] = useState({});
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');

  const stateOf = (id) => chosen[id] ?? initial[id] ?? 'none';
  const toggle = (id) =>
    setChosen((prev) => ({ ...prev, [id]: stateOf(id) === 'all' ? 'none' : 'all' }));

  const { add, remove } = labelChanges(initial, { ...initial, ...chosen });
  const changed = add.length + remove.length > 0;
  const tooMany = add.length > ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX;

  const needle = filter.trim().toLowerCase();
  const shown = needle ? labels.filter((l) => l.name.toLowerCase().includes(needle)) : labels;
  const nameCheck = accountLabelNameSchema.safeParse(newName);
  const exists = labels.some((l) => l.name.toLowerCase() === newName.trim().toLowerCase());

  const createAndSelect = (e) => {
    e.preventDefault();
    if (!nameCheck.success || exists) return;
    create.mutate(
      { name: newName.trim(), color: 'sky' },
      {
        onSuccess: ({ label }) => {
          setChosen((prev) => ({ ...prev, [label.id]: 'all' }));
          setNewName('');
          create.reset();
        },
      },
    );
  };

  const apply = () => {
    const accountIds = accounts.map((a) => a.id);
    assign.mutate(
      { accountIds, add, remove },
      {
        onSuccess: ({ updated }) => {
          toast.success(
            updated === 0
              ? 'The labels were already set that way'
              : `Labels updated on ${updated === 1 ? '1 account' : `${updated} accounts`}`,
          );
          onDone?.();
          onClose();
        },
      },
    );
  };

  return {
    body: (
      <div className="space-y-4">
        {labelsQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-6 w-36" />
          </div>
        ) : labelsQuery.error ? (
          <ErrorState
            title="Could not load the labels"
            error={labelsQuery.error}
            onRetry={() => labelsQuery.refetch()}
          />
        ) : (
          <>
            {labels.length > 8 && (
              <input
                type="search"
                className={inputClass}
                placeholder="Find a label"
                aria-label="Find a label"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            {labels.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No labels yet"
                description="Create one below, for example the client or brand these accounts belong to."
              />
            ) : (
              <ul aria-label="Labels" className="max-h-72 space-y-0.5 overflow-y-auto">
                {shown.map((label) => (
                  <LabelOption
                    key={label.id}
                    label={label}
                    state={stateOf(label.id)}
                    onToggle={() => toggle(label.id)}
                  />
                ))}
                {shown.length === 0 && (
                  <li className="px-2 py-2 text-sm text-muted">No label matches “{filter}”.</li>
                )}
              </ul>
            )}
            <form onSubmit={createAndSelect} noValidate className="flex gap-2">
              <label htmlFor="apply-new-label" className="sr-only">
                New label name
              </label>
              <input
                id="apply-new-label"
                className={inputClass}
                placeholder="New label"
                maxLength={ACCOUNT_LABEL_LIMITS.NAME_MAX}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (create.error) create.reset();
                }}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="h-9"
                loading={create.isPending}
                disabled={!nameCheck.success || exists}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create
              </Button>
            </form>
            {exists && newName.trim() && (
              <p className="text-xs text-muted">
                A label with this name already exists: tick it above.
              </p>
            )}
            <FormError message={create.error?.fields?.name ?? create.error?.message} />
          </>
        )}
        {tooMany && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            An account can carry at most {ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX} labels.
          </p>
        )}
        <FormError
          message={
            assign.error?.fields?.add ?? assign.error?.fields?.labels ?? assign.error?.message
          }
        />
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Rename, recolour or delete
            labels
          </button>
        )}
      </div>
    ),
    footer: (
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={assign.isPending} disabled={!changed || tooMany} onClick={apply}>
          {changed
            ? `Apply${add.length ? ` +${add.length}` : ''}${remove.length ? ` −${remove.length}` : ''}`
            : 'Apply'}
        </Button>
      </>
    ),
  };
}

function ApplyLabelsContent({ accounts, onClose, onDone, onManage, title, description }) {
  const { body, footer } = useApplyLabelsForm({ accounts, onClose, onDone, onManage });
  return (
    <Modal open onClose={onClose} title={title} description={description} footer={footer}>
      {body}
    </Modal>
  );
}

/**
 * `accounts` are the selected account rows (with their `labels`). The dialog's state starts
 * fresh every time it opens.
 */
export function ApplyLabelsDialog({ open, accounts, onClose, onDone, onManage }) {
  if (!open) return null;
  const n = accounts.length;
  return (
    <ApplyLabelsContent
      accounts={accounts}
      onClose={onClose}
      onDone={onDone}
      onManage={onManage}
      title={n === 1 ? `Labels for ${accounts[0].name}` : `Labels for ${n} accounts`}
      description={cn(
        'Tick a label to add it, untick it to remove it.',
        n > 1 && 'A dash means only some of the selected accounts carry it.',
      )}
    />
  );
}
