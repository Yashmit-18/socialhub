import { PERMISSIONS, ROLE_LABELS } from '@socialhub/shared';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Command,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  SquarePen,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptionalWorkspace } from '../../context/WorkspaceContext.jsx';
import { clearLocalDraftsForUser } from '../../features/composer/services/localStore.js';
import { useActiveIndicator } from '../../hooks/useActiveIndicator.js';
import { useThemeTransition } from '../../hooks/useThemeTransition.js';
import { useWorkspaces } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Logo } from '../ui/Brand.jsx';
import { Button, ButtonLink } from '../ui/Button.jsx';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { currentNavItem, navItems, navSections } from './navigation.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const MOD_KEY = isMac ? '⌘' : 'Ctrl';

function WorkspaceSwitcher({ current }) {
  const { data: workspaces = [] } = useWorkspaces();
  const navigate = useNavigate();

  return (
    <Menu
      align="left"
      className="w-64"
      trigger={({ toggle, open, props }) => (
        <button
          type="button"
          onClick={toggle}
          {...props}
          className={cn(
            'group flex w-full items-center gap-3 rounded-xl border bg-white/80 px-2.5 py-2 text-left shadow-[0_1px_2px_rgb(24_20_51/0.05)] transition-[border-color,box-shadow,background-color] duration-200',
            'border-slate-200/80 hover:border-slate-300 hover:shadow-card dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/20',
            open && 'border-brand-300 ring-4 ring-brand-500/10 dark:border-brand-400/40',
          )}
        >
          {current ? (
            <>
              <Avatar name={current.name} seed={current.id} square size="sm" className="ring-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{current.name}</span>
                <span className="block text-xs text-muted">
                  {ROLE_LABELS[current.membership.role]}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm text-muted">Choose a workspace</span>
          )}
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-600 dark:group-hover:text-slate-200"
            aria-hidden="true"
          />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Workspaces
          </p>
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map((ws) => (
              <MenuItem
                key={ws.id}
                onClick={() => {
                  close();
                  navigate(`/w/${ws.slug}`);
                }}
              >
                <Avatar name={ws.name} seed={ws.id} square size="xs" className="ring-0" />
                <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                {ws.id === current?.id && (
                  <Check className="h-4 w-4 text-brand-600" aria-label="Current workspace" />
                )}
              </MenuItem>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            icon={Plus}
            onClick={() => {
              close();
              navigate('/onboarding');
            }}
          >
            Create workspace
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function SidebarContent({ workspace, can, onNavigate, onOpenPalette }) {
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const pillRef = useRef(null);
  useActiveIndicator(navRef, pillRef, pathname);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Link to="/" onClick={onNavigate} aria-label="SocialHub home">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <WorkspaceSwitcher current={workspace} />
      </div>

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onOpenPalette();
        }}
        className="group mx-3 mt-3 flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-900/[0.025] px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400 dark:hover:border-white/15 dark:hover:text-slate-200"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">Jump to…</span>
        <span className="flex items-center gap-1 pointer-coarse:hidden" aria-hidden="true">
          <kbd className="kbd">{MOD_KEY}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      <nav
        ref={navRef}
        className="relative mt-4 flex-1 overflow-y-auto px-3 pb-4"
        aria-label="Workspace"
      >
        <div
          ref={pillRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-3 left-3 rounded-xl bg-gradient-to-r from-brand-500/[0.12] via-violet-500/[0.07] to-fuchsia-500/[0.03] opacity-0 ring-1 ring-brand-500/15 ring-inset data-[ready]:transition-[transform,height,opacity] data-[ready]:duration-500 data-[ready]:ease-out-expo dark:from-brand-400/[0.16] dark:via-violet-400/[0.08] dark:ring-brand-400/20"
        >
          <span className="absolute inset-y-2 -left-px w-[3px] rounded-full bg-gradient-to-b from-brand-500 via-violet-500 to-fuchsia-500 shadow-[0_0_12px_rgb(139_92_246/0.6)]" />
        </div>
        {workspace &&
          navSections(workspace.slug, can).map((section) => (
            <div key={section.id} className={cn(section.label && 'mt-5')}>
              {section.label && (
                <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase dark:text-slate-500">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon, end }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-200',
                          isActive
                            ? 'text-brand-700 dark:text-white'
                            : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cn(
                              'h-[18px] w-[18px] transition-[color,transform] duration-300 ease-spring group-hover:scale-110',
                              isActive
                                ? 'text-brand-600 dark:text-brand-300'
                                : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200',
                            )}
                            aria-hidden="true"
                          />
                          {label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </nav>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <Menu
      trigger={({ toggle, props }) => (
        <button
          type="button"
          onClick={toggle}
          {...props}
          className="group flex items-center gap-2 rounded-full border border-transparent p-1 pr-2.5 transition-colors hover:border-slate-200 hover:bg-white/70 dark:hover:border-white/10 dark:hover:bg-white/[0.04]"
          aria-label="Account menu"
        >
          <Avatar name={user?.name} seed={user?.id} size="sm" />
          <span className="hidden max-w-36 truncate text-sm font-medium sm:block">
            {user?.name}
          </span>
          <ChevronDown
            className="hidden h-3.5 w-3.5 text-slate-400 transition-transform duration-300 ease-out-expo group-aria-expanded:rotate-180 sm:block"
            aria-hidden="true"
          />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={user?.name} seed={user?.id} size="md" className="ring-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user?.name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
          </div>
          <MenuSeparator />
          <MenuItem
            icon={UserRound}
            onClick={() => {
              close();
              navigate('/account');
            }}
          >
            Account settings
          </MenuItem>
          <MenuItem
            icon={LogOut}
            danger
            onClick={async () => {
              close();
              const userId = user?.id;
              await signOut();
              // Composer drafts are plain text in this browser: don't leave them behind for
              // the next person on a shared computer. (Done after sign-out so the composer's
              // own unmount autosave can't write a draft back.)
              clearLocalDraftsForUser(userId);
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function ThemeToggle({ isDark, onToggle }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        <Sun key="sun" className="h-[18px] w-[18px] animate-icon-in text-amber-300" />
      ) : (
        <Moon key="moon" className="h-[18px] w-[18px] animate-icon-in" />
      )}
    </Button>
  );
}

/** Whether the page has scrolled past the top (the header then gets its edge and shadow). */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

export function AppShell({ children, workspace: workspaceOverride }) {
  const ctx = useOptionalWorkspace();
  const workspace = workspaceOverride ?? ctx?.workspace ?? null;
  const can = ctx?.can ?? (() => false);
  const { isDark, toggle } = useThemeTransition();
  const location = useLocation();
  const scrolled = useScrolled();
  // The drawer remembers the path it was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState(null);
  const mobileOpen = drawerPath === location.pathname;
  const setMobileOpen = (open) => setDrawerPath(open ? location.pathname : null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Ctrl/⌘ K opens the palette from anywhere, unless a dialog is already open.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (String(event.key).toLowerCase() !== 'k') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = workspace
    ? currentNavItem(navItems(workspace.slug, can), location.pathname)
    : null;
  const canCompose = workspace && can(PERMISSIONS.CONTENT_CREATE);
  const onCompose = current?.to === `/w/${workspace?.slug}/compose`;

  return (
    <div className="min-h-screen">
      <div className="app-ambient" aria-hidden="true">
        <div className="app-glow app-glow-a" />
        <div className="app-glow app-glow-b" />
      </div>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200/70 bg-white/60 backdrop-blur-2xl lg:block dark:border-white/[0.06] dark:bg-slate-950/50">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-brand-500/25 to-transparent"
          aria-hidden="true"
        />
        <SidebarContent workspace={workspace} can={can} onOpenPalette={openPalette} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-72 animate-drawer-in border-r border-slate-200 bg-white shadow-pop dark:border-white/10 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 rounded-lg p-1.5 text-slate-400 transition duration-300 ease-out-expo hover:rotate-90 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              workspace={workspace}
              can={can}
              onNavigate={() => setMobileOpen(false)}
              onOpenPalette={openPalette}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header
          className={cn(
            'sticky top-0 z-20 flex h-16 items-center gap-2 border-b px-4 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-300 sm:gap-3 sm:px-6 lg:px-8',
            scrolled
              ? 'border-slate-200/70 bg-slate-50/75 shadow-[0_8px_30px_-18px_rgb(24_20_51/0.25)] dark:border-white/[0.06] dark:bg-slate-950/70'
              : 'border-transparent bg-transparent',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </Button>

          {workspace && current && (
            <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                <li className="min-w-0 truncate text-muted">{workspace.name}</li>
                <li aria-hidden="true">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                </li>
                <li
                  key={current.to}
                  aria-current="page"
                  className="flex animate-fade-in items-center gap-1.5 font-medium text-slate-900 dark:text-white"
                >
                  {current.label}
                </li>
              </ol>
            </nav>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={openPalette}
            aria-label="Search and jump to"
            className="group hidden h-9 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/70 pr-1.5 pl-3 text-sm text-slate-500 shadow-[0_1px_2px_rgb(24_20_51/0.04)] transition-[border-color,color,box-shadow] duration-200 hover:border-slate-300 hover:text-slate-700 hover:shadow-card sm:flex dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="w-28 text-left lg:w-36">Jump to…</span>
            <span className="kbd" aria-hidden="true">
              {isMac ? <Command className="h-3 w-3" /> : 'Ctrl'} K
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={openPalette}
            aria-label="Search and jump to"
          >
            <Search className="h-[18px] w-[18px]" />
          </Button>

          {canCompose && !onCompose && (
            <ButtonLink
              to={`/w/${workspace.slug}/compose`}
              size="sm"
              className="hidden h-9 rounded-full px-3.5 md:inline-flex"
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden="true" /> New post
            </ButtonLink>
          )}

          <ThemeToggle isDark={isDark} onToggle={toggle} />
          <UserMenu />
        </header>
        <main className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="page-enter">{children}</div>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          workspace={workspace}
          can={can}
          isDark={isDark}
          onToggleTheme={toggle}
          onClose={closePalette}
        />
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-brand-600 uppercase dark:text-brand-300">
            <span
              className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 shadow-[0_0_10px_rgb(168_85_247/0.8)]"
              aria-hidden="true"
            />
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-slate-900 sm:text-[30px] sm:leading-tight dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
