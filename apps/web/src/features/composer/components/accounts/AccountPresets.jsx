import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import {
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  Loader2,
  Monitor,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog.jsx';
import { Menu, MenuSeparator } from '../../../../components/ui/Menu.jsx';
import { cn } from '../../../../lib/utils.js';
import { PRESET_MESSAGES, PRESET_STORAGE } from '../../hooks/useAccountPresets.js';
import { BUILT_IN_PRESETS, existingIds } from '../../model/accounts.js';
import { PlatformGlyph } from '../shared/PlatformIcon.jsx';
import { SavePresetDialog } from './SavePresetDialog.jsx';

const accountsLabel = (n) => `${n} account${n === 1 ? '' : 's'}`;
const unique = (ids) => [...new Set(ids ?? [])];

/** True when `ids` is exactly the (non-empty) current selection, in any order. */
function isSameSelection(ids, selectedSet) {
  return (
    ids.length > 0 && ids.length === selectedSet.size && ids.every((id) => selectedSet.has(id))
  );
}

function FacebookMark({ className }) {
  return <PlatformGlyph platform={SOCIAL_PLATFORMS.FACEBOOK_PAGE} className={className} />;
}

function InstagramMark({ className }) {
  return <PlatformGlyph platform={SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT} className={className} />;
}

const BUILT_IN_ICONS = {
  'builtin:all': Users,
  'builtin:facebook': FacebookMark,
  'builtin:instagram': InstagramMark,
  'builtin:publishable': ShieldCheck,
};

const STORAGE_CAPTIONS = {
  [PRESET_STORAGE.SERVER]: { icon: Users, text: 'Shared with this workspace' },
  [PRESET_STORAGE.DEVICE]: { icon: Monitor, text: 'Saved in this browser' },
  [PRESET_STORAGE.UNAVAILABLE]: { icon: TriangleAlert, text: "Can't be saved in this browser" },
};

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const MENU_CLASS =
  'w-[min(20rem,calc(100vw-3rem))] max-h-[min(32rem,70vh)] overflow-y-auto overscroll-contain';

const SECTION_LABEL =
  'text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500';

const ITEM_CLASS = cn(
  'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
  'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5 dark:focus-visible:bg-white/5',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent',
);

function CountPill({ id, count, current }) {
  return (
    <span
      id={id}
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        current
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
      )}
    >
      {count}{' '}
      <span className="sr-only">
        {count === 1 ? 'account' : 'accounts'}
        {current ? ', current selection' : ''}
      </span>
    </span>
  );
}

function BuiltInItem({ preset, ids, current, onApply }) {
  const id = useId();
  const Icon = BUILT_IN_ICONS[preset.id] ?? Bookmark;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={ids.length === 0}
      onClick={() => onApply(ids)}
      aria-labelledby={`${id}-name ${id}-count`}
      aria-describedby={`${id}-description`}
      className={ITEM_CLASS}
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span id={`${id}-name`} className="block truncate font-medium">
          {preset.name}
        </span>
        <span id={`${id}-description`} className="block truncate text-xs text-muted">
          {preset.description}
        </span>
      </span>
      {current && (
        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
      )}
      <CountPill id={`${id}-count`} count={ids.length} current={current} />
    </button>
  );
}

function CustomItem({ preset, accounts, selectedSet, onApply, onDelete }) {
  const id = useId();
  const saved = unique(preset.socialAccountIds);
  const available = existingIds(saved, accounts);
  const missing = saved.length - available.length;
  const current = isSameSelection(available, selectedSet);
  const detail = [
    missing > 0
      ? `${available.length} of ${saved.length} accounts available to you`
      : accountsLabel(saved.length),
    preset.createdBy?.name ? `by ${preset.createdBy.name}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        role="menuitem"
        disabled={available.length === 0}
        onClick={() => onApply(available, preset, missing)}
        aria-labelledby={`${id}-name ${id}-count`}
        aria-describedby={`${id}-detail`}
        className={cn(ITEM_CLASS, 'flex-1')}
      >
        <Bookmark
          className={cn(
            'h-4 w-4 shrink-0',
            current ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span id={`${id}-name`} className="block truncate font-medium" title={preset.name}>
            {preset.name}
          </span>
          <span
            id={`${id}-detail`}
            className={cn(
              'block truncate text-xs',
              missing > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted',
            )}
          >
            {available.length === 0 ? 'None of its accounts are available to you' : detail}
          </span>
        </span>
        {current && (
          <Check
            className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
            aria-hidden="true"
          />
        )}
        <CountPill id={`${id}-count`} count={available.length} current={current} />
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onDelete(preset)}
        aria-label={`Delete preset ${preset.name}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:bg-rose-50 focus-visible:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 dark:focus-visible:bg-rose-500/10 dark:focus-visible:text-rose-400"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function CustomPresetList({ presets, accounts, selectedSet, onApply, onDelete, onRetry }) {
  if (presets.storage === PRESET_STORAGE.UNAVAILABLE) {
    return (
      <p className="px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
        {PRESET_MESSAGES.storageUnavailable}
      </p>
    );
  }
  if (presets.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading presets…
      </p>
    );
  }
  if (presets.status === 'error' && presets.presets.length === 0) {
    return (
      <div>
        <p role="alert" className="px-2.5 pt-1 pb-1 text-xs text-rose-600 dark:text-rose-400">
          {presets.error?.message || "Presets couldn't be loaded."}
        </p>
        <button type="button" role="menuitem" onClick={onRetry} className={ITEM_CLASS}>
          <RotateCcw className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  if (presets.presets.length === 0) {
    return (
      <p className="px-2.5 py-2 text-xs leading-relaxed text-muted">
        No saved presets yet. Select accounts, then save them here to reuse them.
      </p>
    );
  }
  return presets.presets.map((preset) => (
    <CustomItem
      key={preset.id}
      preset={preset}
      accounts={accounts}
      selectedSet={selectedSet}
      onApply={onApply}
      onDelete={onDelete}
    />
  ));
}

function PresetMenuContent({
  accounts,
  selectedExisting,
  presets,
  triggerRef,
  close,
  onApply,
  onDelete,
  onSave,
}) {
  const rootRef = useRef(null);
  const quickId = useId();
  const customId = useId();
  const storageId = useId();
  const saveHintId = useId();
  const selectedSet = new Set(selectedExisting);
  const storage = presets?.storage ?? PRESET_STORAGE.DEVICE;
  const caption = STORAGE_CAPTIONS[storage] ?? STORAGE_CAPTIONS[PRESET_STORAGE.DEVICE];
  const CaptionIcon = caption.icon;
  const unavailable = storage === PRESET_STORAGE.UNAVAILABLE;
  const canSave = selectedExisting.length > 0 && !unavailable;

  // Menu-button pattern: opening the menu moves focus to its first available item.
  useEffect(() => {
    rootRef.current?.querySelector(ITEM_SELECTOR)?.focus();
  }, []);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      // The Menu closes itself on Escape; keep focus on its trigger instead of losing it.
      triggerRef.current?.focus();
      return;
    }
    const items = [...event.currentTarget.querySelectorAll(ITEM_SELECTOR)];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = items[index + 1] ?? items[0];
    else if (event.key === 'ArrowUp') next = index <= 0 ? items.at(-1) : items[index - 1];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  // Tabbing out of the menu closes it (clicks outside are handled by Menu itself).
  const onBlur = (event) => {
    const target = event.relatedTarget;
    if (target && !event.currentTarget.contains(target) && target !== triggerRef.current) close();
  };

  const retry = () => {
    rootRef.current?.querySelector(ITEM_SELECTOR)?.focus();
    presets?.retry?.();
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <div role="group" aria-labelledby={quickId}>
        <p id={quickId} className={cn(SECTION_LABEL, 'px-2.5 pt-1.5 pb-1')}>
          Quick select
        </p>
        {BUILT_IN_PRESETS.map((preset) => {
          const ids = existingIds(preset.resolve(accounts), accounts);
          return (
            <BuiltInItem
              key={preset.id}
              preset={preset}
              ids={ids}
              current={isSameSelection(ids, selectedSet)}
              onApply={onApply}
            />
          );
        })}
      </div>

      {presets && (
        <>
          <MenuSeparator />
          <div role="group" aria-labelledby={customId} aria-describedby={storageId}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2.5 pt-1.5 pb-1">
              <p id={customId} className={SECTION_LABEL}>
                Your presets
              </p>
              <p
                id={storageId}
                className={cn(
                  'inline-flex items-center gap-1 text-[11px]',
                  unavailable ? 'text-amber-700 dark:text-amber-400' : 'text-muted',
                )}
              >
                <CaptionIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {caption.text}
              </p>
            </div>
            <CustomPresetList
              presets={presets}
              accounts={accounts}
              selectedSet={selectedSet}
              onApply={onApply}
              onDelete={onDelete}
              onRetry={retry}
            />
          </div>
          <MenuSeparator />
          <button
            type="button"
            role="menuitem"
            disabled={!canSave}
            onClick={onSave}
            aria-describedby={canSave ? undefined : unavailable ? storageId : saveHintId}
            className={ITEM_CLASS}
          >
            <BookmarkPlus
              className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
              aria-hidden="true"
            />
            Save current selection…
          </button>
          {!canSave && !unavailable && (
            <p id={saveHintId} className="px-2.5 pb-1.5 text-xs text-muted">
              Select accounts first to save them as a preset.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Presets" menu: built-in presets computed from the account list, the person's custom presets
 * (`presets` = useAccountPresets() result; omit it to offer built-ins only) and "Save current
 * selection…". Applying a preset REPLACES the selection: `onApply(ids)` receives only ids that
 * exist in `accounts`.
 */
export function AccountPresets({
  accounts = [],
  selectedIds = [],
  onApply,
  presets,
  disabled = false,
  className,
}) {
  const triggerRef = useRef(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const selectedExisting = existingIds(unique(selectedIds), accounts);
  const storage = presets?.storage ?? PRESET_STORAGE.DEVICE;
  const shared = storage === PRESET_STORAGE.SERVER;

  // Focus goes back to the trigger before the menu closes, so dialogs opened from the menu
  // restore focus there and keyboard users never land on <body>.
  const leaveMenu = (close) => {
    triggerRef.current?.focus();
    close();
  };

  const apply = (close, ids, preset, missing = 0) => {
    leaveMenu(close);
    onApply?.(ids);
    toast.success(
      `Selected ${accountsLabel(ids.length)}`,
      preset && missing > 0
        ? {
            description: `${accountsLabel(missing)} in “${preset.name}” ${
              missing === 1 ? 'is' : 'are'
            } no longer available to you.`,
          }
        : undefined,
    );
  };

  const save = async (name) => {
    if (!presets) throw new Error(PRESET_MESSAGES.storageError);
    const preset = await presets.createPreset(name, selectedExisting);
    const savedName = preset?.name ?? name;
    toast.success(
      shared ? `Saved “${savedName}” for this workspace` : `Saved “${savedName}” in this browser`,
    );
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting || !presets) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await presets.deletePreset(pendingDelete.id);
    } catch (err) {
      setDeleting(false);
      setDeleteError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    toast.success(
      shared
        ? `Deleted “${pendingDelete.name}”`
        : `Deleted “${pendingDelete.name}” from this browser`,
    );
    setDeleting(false);
    setPendingDelete(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  };

  return (
    <div className={cn('shrink-0', className)}>
      <Menu
        align="right"
        className={MENU_CLASS}
        trigger={({ open, toggle, props }) => (
          <Button
            ref={triggerRef}
            variant="secondary"
            onClick={toggle}
            disabled={disabled}
            {...props}
          >
            <Bookmark className="h-4 w-4" aria-hidden="true" />
            Presets
            <ChevronDown
              className={cn(
                'h-4 w-4 text-slate-400 transition-transform duration-150',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </Button>
        )}
      >
        {(close) => (
          <PresetMenuContent
            accounts={accounts}
            selectedExisting={selectedExisting}
            presets={presets}
            triggerRef={triggerRef}
            close={close}
            onApply={(ids, preset, missing) => apply(close, ids, preset, missing)}
            onDelete={(preset) => {
              leaveMenu(close);
              setDeleteError(null);
              setPendingDelete(preset);
            }}
            onSave={() => {
              leaveMenu(close);
              setSaveOpen(true);
            }}
          />
        )}
      </Menu>

      <SavePresetDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={save}
        selectedCount={selectedExisting.length}
        storage={storage}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : ''}
        description={
          shared
            ? "It's removed for everyone in this workspace. The accounts in it aren't affected."
            : "It's removed from this browser. The accounts in it aren't affected."
        }
        confirmLabel="Delete preset"
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={closeDelete}
      />
    </div>
  );
}
