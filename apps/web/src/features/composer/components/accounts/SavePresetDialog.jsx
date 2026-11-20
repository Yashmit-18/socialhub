import { Monitor, TriangleAlert, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button.jsx';
import { Input } from '../../../../components/ui/Field.jsx';
import { Modal } from '../../../../components/ui/Modal.jsx';
import { cn } from '../../../../lib/utils.js';
import { PRESET_MESSAGES, PRESET_NAME_MAX, PRESET_STORAGE } from '../../hooks/useAccountPresets.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';

const accountsLabel = (n) => `${n} account${n === 1 ? '' : 's'}`;

const NOTES = {
  [PRESET_STORAGE.SERVER]: {
    icon: Users,
    tone: 'sky',
    text: 'Shared with this workspace. Everyone who composes here can apply it to the accounts they can access.',
  },
  [PRESET_STORAGE.DEVICE]: {
    icon: Monitor,
    tone: 'neutral',
    text: CAPABILITY_MESSAGES.serverPresets,
  },
  [PRESET_STORAGE.UNAVAILABLE]: {
    icon: TriangleAlert,
    tone: 'warning',
    text: PRESET_MESSAGES.storageUnavailable,
  },
};

const NOTE_TONES = {
  sky: 'border-sky-200/80 bg-sky-50/70 text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
};

function StorageNote({ storage }) {
  const note = NOTES[storage] ?? NOTES[PRESET_STORAGE.DEVICE];
  const Icon = note.icon;
  return (
    <p
      className={cn(
        'mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed',
        NOTE_TONES[note.tone],
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{note.text}</span>
    </p>
  );
}

/** Mounted only while the dialog is open, so every opening starts with an empty form. */
function SavePresetForm({ onClose, onSave, selectedCount, storage }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const canSubmit = selectedCount > 0 && storage !== PRESET_STORAGE.UNAVAILABLE;

  const submit = async (event) => {
    event.preventDefault();
    if (saving || !canSubmit) return;
    const clean = name.trim();
    if (!clean) {
      setError(PRESET_MESSAGES.nameRequired);
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave?.(clean);
    } catch (err) {
      setSaving(false);
      setError(err?.message || "The preset couldn't be saved. Try again.");
      inputRef.current?.focus();
      return;
    }
    setSaving(false);
    onClose?.();
  };

  return (
    <form onSubmit={submit}>
      <Input
        ref={inputRef}
        label="Preset name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
        }}
        maxLength={PRESET_NAME_MAX}
        placeholder="e.g. Spring campaign"
        autoComplete="off"
        readOnly={saving}
        error={error ?? undefined}
        labelAction={
          <span className="text-xs text-muted tabular-nums" aria-hidden="true">
            {name.length}/{PRESET_NAME_MAX}
          </span>
        }
      />
      <StorageNote storage={storage} />
      <div className="-mx-6 mt-6 -mb-5 flex flex-wrap justify-end gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 dark:border-white/5 dark:bg-white/[0.02]">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!canSubmit}>
          Save preset
        </Button>
      </div>
    </form>
  );
}

/**
 * Names the current selection and saves it as a custom preset.
 * `onSave(name)` must return a promise: the dialog shows a loading state while it is pending,
 * shows the rejection's message as the field error, and calls `onClose()` once it resolves.
 * `storage` ('server' | 'device' | 'unavailable') decides the note about where it is kept.
 */
export function SavePresetDialog({
  open,
  onClose,
  onSave,
  selectedCount = 0,
  storage = PRESET_STORAGE.DEVICE,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Save as preset"
      description={
        selectedCount > 0
          ? `Save the ${accountsLabel(selectedCount)} you selected so you can choose them again in one step.`
          : 'Select at least one account to save a preset.'
      }
    >
      <SavePresetForm
        onClose={onClose}
        onSave={onSave}
        selectedCount={selectedCount}
        storage={storage}
      />
    </Modal>
  );
}
