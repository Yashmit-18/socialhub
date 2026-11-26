import { Building2, CornerDownLeft, Moon, Plus, Search, Sun, UserRound } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useWorkspaces } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';

function matches(command, words) {
  const haystack = `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * "Jump to" palette (Ctrl/⌘ K): the pages the sidebar lists (`sections`, the same data), the
 * user's other workspaces and a few account actions. Type to filter, arrows to move, Enter to
 * open, Escape to close. Mounted only while open, so every opening starts fresh.
 */
export function CommandPalette({ sections, workspace, isDark, onToggleTheme, onClose }) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const titleId = useId();

  const commands = useMemo(() => {
    const pages = sections
      .flatMap((section) => section.items)
      .map((item) => ({
        id: `page:${item.to}`,
        group: 'Pages',
        label: item.label,
        hint: item.hint,
        icon: item.icon,
        run: () => navigate(item.to),
      }));
    const switchTo = workspaces
      .filter((ws) => ws.id !== workspace?.id)
      .map((ws) => ({
        id: `ws:${ws.id}`,
        group: 'Workspaces',
        label: ws.name,
        hint: 'Switch workspace',
        avatar: ws,
        run: () => navigate(`/w/${ws.slug}`),
      }));
    const actions = [
      {
        id: 'action:theme',
        group: 'Actions',
        label: isDark ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Appearance',
        icon: isDark ? Sun : Moon,
        run: () => onToggleTheme(),
      },
      {
        id: 'action:account',
        group: 'Actions',
        label: 'Account settings',
        hint: 'Your name, email and password',
        icon: UserRound,
        run: () => navigate('/account'),
      },
      {
        id: 'action:new-workspace',
        group: 'Actions',
        label: 'Create workspace',
        hint: 'A new brand or client',
        icon: Plus,
        run: () => navigate('/onboarding'),
      },
    ];
    return [...pages, ...switchTo, ...actions];
  }, [sections, workspace, workspaces, isDark, navigate, onToggleTheme]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length ? commands.filter((c) => matches(c, words)) : commands;
  const current = Math.min(active, Math.max(0, results.length - 1));

  // Focus the search field on open and give focus back to where it was on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const run = (command) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActive((current + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[current]);
    } else if (event.key === 'Tab') {
      // The search field is the only stop: keep focus inside the palette.
      event.preventDefault();
    }
  };

  let lastGroup = null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-[6px] dark:bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-pop backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_30px_80px_-20px_rgb(0_0_0/0.8)]"
      >
        <h2 id={titleId} className="sr-only">
          Search and jump to
        </h2>
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-white/[0.06]">
          <Search className="h-4.5 w-4.5 shrink-0 text-brand-500" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${listId}-${current}` : undefined}
            aria-label="Search pages, workspaces and actions"
            placeholder="Search pages, workspaces and actions…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[min(24rem,60vh)] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-10 text-center text-sm text-muted" role="presentation">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </li>
          )}
          {results.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const Icon = command.icon ?? Building2;
            const selected = index === current;
            return (
              <li key={command.id} role="presentation">
                {heading && (
                  <p
                    className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase first:pt-1"
                    aria-hidden="true"
                  >
                    {heading}
                  </p>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseMove={() => current !== index && setActive(index)}
                  onClick={() => run(command)}
                  className={cn(
                    'relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150',
                    selected
                      ? 'bg-gradient-to-r from-brand-500/10 via-violet-500/[0.07] to-transparent text-slate-900 dark:from-brand-400/15 dark:via-violet-400/10 dark:text-white'
                      : 'text-slate-700 dark:text-slate-300',
                  )}
                >
                  {selected && (
                    <span
                      className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                  )}
                  {command.avatar ? (
                    <Avatar
                      name={command.avatar.name}
                      seed={command.avatar.id}
                      square
                      size="xs"
                      className="ring-0"
                    />
                  ) : (
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                        selected
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{command.label}</span>
                    {command.hint && (
                      <span className="block truncate text-xs text-muted">{command.hint}</span>
                    )}
                  </span>
                  {selected && (
                    <CornerDownLeft
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Keyboard hints: phones have no keyboard. */}
        <div className="hidden items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-muted sm:flex dark:border-white/[0.06] dark:bg-white/[0.02]">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
