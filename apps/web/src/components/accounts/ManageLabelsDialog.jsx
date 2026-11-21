/**
 * Create, rename, recolour and delete the workspace's account labels (for members who manage
 * logins). Every change is saved on the server at once and reported with what it answered.
 */
import { ACCOUNT_LABEL_LIMITS, LABEL_COLORS, accountLabelNameSchema } from '@socialhub/shared';
import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { LabelChip, LabelDot } from './AccountLabels.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState, ErrorState, Skeleton } from '../ui/Feedback.jsx';
import { FormError } from '../ui/Field.jsx';
import { Modal } from '../ui/Modal.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from '../../hooks/useAccountActions.js';
import { LABEL_COLOR_NAMES, labelColorClasses } from '../../lib/accountOrganization.js';
import { useAccountLabels } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';

const inputClass =
  'h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100';

const accountsText = (n) => (n === 1 ? '1 account' : `${n} accounts`);

/** Radio group of colour swatches. */
export function ColorPicker({ value, onChange, label = 'Label colour' }) {
  const name = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{label}</legend>
      {LABEL_COLORS.map((color) => (
        <label
          key={color}
          title={LABEL_COLOR_NAMES[color]}
          className={cn(
            'relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-2 ring-offset-1 ring-offset-white transition dark:ring-offset-slate-900',
            value === color
              ? 'ring-brand-500'
              : 'ring-transparent hover:ring-slate-300 dark:hover:ring-white/20',
          )}
        >
          <input
            type="radio"
            name={name}
            value={color}
            checked={value === color}
            onChange={() => onChange(color)}
            className="sr-only"
            aria-label={LABEL_COLOR_NAMES[color]}
          />
          <span className={cn('h-4 w-4 rounded-full', labelColorClasses(color).dot)} />
        </label>
      ))}
    </fieldset>
  );
}

const nameError = (name) => {
  const parsed = accountLabelNameSchema.safeParse(name);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

function CreateLabelForm({ workspaceId, atLimit }) {
  const create = useCreateLabel(workspaceId);
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [touched, setTouched] = useState(false);
  const error = touched ? nameError(name) : null;

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (nameError(name)) return;
    create.mutate(
      { name: name.trim(), color },
      {
        onSuccess: ({ label }) => {
          toast.success(`Label “${label.name}” created`);
          setName('');
          setTouched(false);
          create.reset();
        },
      },
    );
  };

  const serverError = create.error?.fields?.name ?? create.error?.message;
  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-2.5 rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.03]"
    >
      <label
        className="block text-sm font-medium text-slate-700 dark:text-slate-200"
        htmlFor="new-label-name"
      >
        New label
      </label>
      <div className="flex gap-2">
        <input
          id="new-label-name"
          className={inputClass}
          value={name}
          maxLength={ACCOUNT_LABEL_LIMITS.NAME_MAX}
          placeholder="For example: Client A, Retail, North region"
          onChange={(e) => {
            setName(e.target.value);
            if (create.error) create.reset();
          }}
          aria-invalid={error || serverError ? true : undefined}
          disabled={atLimit}
        />
        <Button
          type="submit"
          size="sm"
          className="h-9"
          loading={create.isPending}
          disabled={atLimit}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </Button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      {(error || serverError) && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error ?? serverError}
        </p>
      )}
      {atLimit && (
        <p className="text-xs text-muted">
          This workspace has {ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX} labels, the most it can have.
          Delete one you no longer use to add another.
        </p>
      )}
    </form>
  );
}

function LabelRow({ label, workspaceId }) {
  const update = useUpdateLabel(workspaceId);
  const remove = useDeleteLabel(workspaceId);
  const [mode, setMode] = useState('view'); // view | edit | delete
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const error = nameError(name);

  const startEdit = () => {
    setName(label.name);
    setColor(label.color);
    update.reset();
    setMode('edit');
  };

  const save = (e) => {
    e.preventDefault();
    if (error) return;
    const patch = {};
    if (name.trim() !== label.name) patch.name = name.trim();
    if (color !== label.color) patch.color = color;
    if (Object.keys(patch).length === 0) {
      setMode('view');
      return;
    }
    update.mutate(
      { labelId: label.id, ...patch },
      {
        onSuccess: () => {
          toast.success('Label saved');
          setMode('view');
        },
      },
    );
  };

  const confirmDelete = () =>
    remove.mutate(label.id, {
      onSuccess: ({ removedFromAccounts }) => {
        toast.success(
          removedFromAccounts > 0
            ? `Label “${label.name}” deleted and removed from ${accountsText(removedFromAccounts)}`
            : `Label “${label.name}” deleted`,
        );
      },
    });

  if (mode === 'edit') {
    const serverError = update.error?.fields?.name ?? update.error?.message;
    return (
      <li className="py-3">
        <form onSubmit={save} noValidate className="space-y-2">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`label-${label.id}`}>
              Label name
            </label>
            <input
              id={`label-${label.id}`}
              className={inputClass}
              value={name}
              maxLength={ACCOUNT_LABEL_LIMITS.NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                if (update.error) update.reset();
              }}
              aria-invalid={error || serverError ? true : undefined}
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9"
              loading={update.isPending}
              aria-label="Save label"
            >
              {!update.isPending && <Check className="h-4 w-4" aria-hidden="true" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setMode('view')}
              aria-label="Cancel editing"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <ColorPicker value={color} onChange={setColor} />
          {(error || serverError) && (
            <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {error ?? serverError}
            </p>
          )}
        </form>
      </li>
    );
  }

  if (mode === 'delete') {
    return (
      <li className="space-y-2 py-3">
        <p className="text-sm">
          Delete <strong>{label.name}</strong>?{' '}
          {label.accountCount > 0
            ? `It is removed from ${accountsText(label.accountCount)} you can see (and any others carrying it). The accounts themselves are not affected.`
            : 'No account you can see carries it.'}
        </p>
        <FormError message={remove.error?.message} />
        <div className="flex gap-2">
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={confirmDelete}>
            Delete label
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <LabelChip label={label} />
      <span className="flex-1 text-xs text-muted">{accountsText(label.accountCount ?? 0)}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={startEdit}
        aria-label={`Edit ${label.name}`}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-rose-600 hover:text-rose-700 dark:text-rose-400"
        onClick={() => {
          remove.reset();
          setMode('delete');
        }}
        aria-label={`Delete ${label.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

/** The label manager dialog. */
export function ManageLabelsDialog({ open, onClose }) {
  const { workspace } = useWorkspace();
  const labels = useAccountLabels(workspace.id, { enabled: open });
  const items = labels.data?.items ?? [];
  const atLimit = items.length >= ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Account labels"
      description="Group Pages and Instagram accounts by client, brand, region or anything else. Labels are visible to everyone in the workspace and are never sent to Meta."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <CreateLabelForm workspaceId={workspace.id} atLimit={atLimit} />
        {labels.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : labels.error ? (
          <ErrorState
            title="Could not load the labels"
            error={labels.error}
            onRetry={() => labels.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="No labels yet"
            description="Create your first label above, then select accounts and choose “Labels” to apply it."
          />
        ) : (
          <ul aria-label="Labels" className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((label) => (
              <LabelRow key={label.id} label={label} workspaceId={workspace.id} />
            ))}
          </ul>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <LabelDot color="slate" />
          {items.length} of {ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX} labels used
        </p>
      </div>
    </Modal>
  );
}
