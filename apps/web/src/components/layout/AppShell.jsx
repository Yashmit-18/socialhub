import { PERMISSIONS, ROLE_LABELS, hasPermission } from '@socialhub/shared';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Command,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  SquarePen,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptionalWorkspace } from '../../context/WorkspaceContext.jsx';
import { clearLocalDraftsForUser } from '../../features/composer/services/localStore.js';
import { useSharingTasks } from '../../features/groups/api.js';
import { useActiveIndicator } from '../../hooks/useActiveIndicator.js';
import { useThemeTransition } from '../../hooks/useThemeTransition.js';
import { useWorkspaces } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';
import { BackLink } from '../ui/BackLink.jsx';
import { Logo } from '../ui/Brand.jsx';
import { Button, ButtonLink } from '../ui/Button.jsx';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu.jsx';
import { SectionToneContext, useSectionTone } from '../ui/sectionTone.js';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { currentNavItem, shellSections } from './navigation.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

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
            'group flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left text-white transition-[border-color,background-color] duration-150',
            'border-white/[0.09] bg-white/[0.05] hover:border-white/[0.16] hover:bg-white/[0.08]',
            open && 'border-brand-300/50 ring-2 ring-brand-400/20',
          )}
        >
          {current ? (
            <>
              <Avatar name={current.name} seed={current.id} square size="sm" className="ring-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{current.name}</span>
                <span className="block text-xs text-white/55">
                  {ROLE_LABELS[current.membership.role]}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm text-white/60">Choose a workspace</span>
          )}
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-white/40 transition-colors group-hover:text-white/80"
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

/**
 * Live counts shown next to sidebar pages: group sharing tasks still open for this person
 * (theirs and unassigned). Nothing is shown while loading or when the count is zero.
 */
function useNavBadges(workspace, can) {
  const enabled = Boolean(workspace) && can(PERMISSIONS.SHARING_TASKS_COMPLETE);
  const tasks = useSharingTasks(
    workspace?.id,
    { status: 'OPEN', assignee: 'available', limit: 1 },
    { enabled },
  );
  return { groupTasks: enabled ? (tasks.data?.total ?? 0) : 0 };
}

function SidebarContent({ workspace, can, sections, area, onNavigate }) {
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const pillRef = useRef(null);
  useActiveIndicator(navRef, pillRef, pathname);
  const badges = useNavBadges(workspace, can);
  const AreaIcon = area?.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Link to="/" onClick={onNavigate} aria-label="SocialHub home">
          <Logo light />
        </Link>
      </div>
      <div className="px-3">
        {area ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-white/[0.09] bg-white/[0.05] px-2.5 py-2">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white',
                  area.tone,
                )}
              >
                <AreaIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {area.label}
                </span>
                <span className="block truncate text-xs text-white/55">{area.description}</span>
              </span>
            </div>
            <Link
              to={area.back.to}
              onClick={onNavigate}
              className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-white/65 transition-colors duration-150 hover:bg-white/[0.05] hover:text-white"
            >
              {area.back.create ? (
                <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{area.back.label}</span>
            </Link>
          </>
        ) : (
          <WorkspaceSwitcher current={workspace} />
        )}
      </div>

      <nav
        ref={navRef}
        className="relative mt-5 flex-1 overflow-y-auto px-3 pb-4"
        aria-label={area ? area.label : 'Workspace'}
      >
        <div
          ref={pillRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-3 left-3 rounded-lg bg-gradient-to-r from-brand-400/30 via-violet-400/15 to-transparent opacity-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-gradient-to-b before:from-brand-300 before:to-pink-400 data-[ready]:transition-[transform,height,opacity] data-[ready]:duration-300 data-[ready]:ease-out-expo"
        />
        {sections.map((section) => (
          <div key={section.id} className={cn(section.label && 'mt-6')}>
            {section.label && (
              <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wide text-white/55 uppercase">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end, badge }) => {
                const count = badge ? badges[badge] : 0;
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                          isActive
                            ? 'text-white'
                            : 'text-white/65 hover:bg-white/[0.05] hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cn(
                              'h-[18px] w-[18px] transition-colors duration-150',
                              isActive
                                ? 'text-brand-300'
                                : 'text-white/45 group-hover:text-white/80',
                            )}
                            aria-hidden="true"
                          />
                          <span className="flex-1">{label}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-pink-600 px-1.5 py-px text-[11px] font-semibold text-white tabular-nums">
                              {count > 99 ? '99+' : count}
                              <span className="sr-only"> to share</span>
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
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

export function AppShell({ children, workspace: workspaceOverride, area = null }) {
  const ctx = useOptionalWorkspace();
  const { user } = useAuth();
  // An area (the admin console) brings its own pages and has no workspace.
  const workspace = area ? null : (workspaceOverride ?? ctx?.workspace ?? null);
  // A page that shows a workspace without being inside it (Account settings) still lists
  // that workspace's pages for the person's role. UI gating only; the API enforces access.
  const role = workspace?.membership?.role;
  const can = ctx?.can ?? ((permission) => Boolean(role) && hasPermission(role, permission));
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

  const sections = area ? area.sections : shellSections(workspace, can, user);
  const current = currentNavItem(
    sections.flatMap((section) => section.items),
    location.pathname,
  );
  const canCompose = workspace && can(PERMISSIONS.CONTENT_CREATE);
  // Compose and the Overview have their own "Create post" button.
  const onCompose =
    current?.to === `/w/${workspace?.slug}/compose` || current?.to === `/w/${workspace?.slug}`;

  return (
    <div className="min-h-screen">
      <aside className="sidebar-ink fixed inset-y-0 left-0 z-30 hidden w-60 lg:block dark:border-r dark:border-white/[0.06]">
        <SidebarContent workspace={workspace} can={can} sections={sections} area={area} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="sidebar-ink absolute inset-y-0 left-0 w-72 animate-drawer-in shadow-pop dark:border-r dark:border-white/10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 rounded-lg p-1.5 text-white/50 transition duration-300 ease-out-expo hover:rotate-90 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              workspace={workspace}
              can={can}
              sections={sections}
              area={area}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="relative lg:pl-60">
        {/* A soft wash of the brand colours behind the top of every page. */}
        <div className="page-wash" aria-hidden="true" />
        <header
          className={cn(
            'sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 transition-[border-color,background-color] duration-200 sm:gap-3 sm:px-6 lg:px-8',
            scrolled
              ? 'border-slate-200 bg-canvas/85 backdrop-blur-md dark:border-white/[0.07] dark:bg-slate-950/80'
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

          {area && (
            <span className="shrink-0 rounded-full bg-fuchsia-50 px-2.5 py-0.5 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200 ring-inset md:hidden dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/20">
              {area.label}
            </span>
          )}

          {current && (area || workspace) && (
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                <li className="hidden min-w-0 truncate text-slate-600 md:block dark:text-slate-400">
                  {area ? area.label : workspace.name}
                </li>
                <li aria-hidden="true" className="hidden md:block">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                </li>
                {/* On a phone the page name appears once the title has scrolled away. */}
                <li
                  key={current.to}
                  aria-current="page"
                  className={cn(
                    'min-w-0 animate-fade-in truncate font-medium text-slate-900 transition-opacity duration-200 dark:text-white',
                    !scrolled && 'max-md:opacity-0',
                  )}
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
            className="group hidden h-9 items-center gap-2.5 rounded-lg border border-slate-200 bg-white pr-1.5 pl-3 text-sm text-slate-500 transition-[border-color,color] duration-150 hover:border-slate-300 hover:text-slate-700 sm:flex dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="w-28 text-left lg:w-36">Jump to…</span>
            <span className="kbd whitespace-nowrap" aria-hidden="true">
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
            // Quieter than a page's own main button, so each view keeps one primary action.
            <ButtonLink
              to={`/w/${workspace.slug}/compose`}
              variant="tonal"
              size="sm"
              className="hidden h-9 px-3.5 md:inline-flex"
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden="true" /> New post
            </ButtonLink>
          )}

          <ThemeToggle isDark={isDark} onToggle={toggle} />
          <UserMenu />
        </header>
        <main className="relative mx-auto w-full max-w-6xl px-4 pt-6 pb-10 sm:px-6 lg:px-8">
          <SectionToneContext.Provider value={current}>
            <div className="page-enter">{children}</div>
          </SectionToneContext.Provider>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          sections={sections}
          workspace={workspace}
          isDark={isDark}
          onToggleTheme={toggle}
          onClose={closePalette}
        />
      )}
    </div>
  );
}

/**
 * The title block of a page. The tile next to the title is the colour of the page's sidebar
 * section; a page outside the sidebar (Account settings, a detail page) passes `icon` and
 * `tone` (gradient classes), or `media` (any node, e.g. an account picture) instead. `back`
 * ({ to, label }) puts a back link above it. Actions sit on the title row.
 */
export function PageHeader({ title, description, actions, eyebrow, icon, tone, media, back }) {
  const page = useSectionTone();
  // Every section has its own colour: an icon tile next to the title. The Overview greets the
  // person instead, so it has none.
  const Icon = icon ?? (page?.tone && !page.end ? page.icon : null);
  const tileTone = tone ?? page?.tone;
  return (
    <div className="mb-6">
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {media ? (
            <div className="mt-0.5 shrink-0">{media}</div>
          ) : (
            Icon && (
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg shadow-slate-900/10 ring-1 ring-white/20 ring-inset dark:shadow-black/30',
                  tileTone,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
            )
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words text-slate-900 dark:text-white">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1.5">{actions}</div>}
      </div>
    </div>
  );
}
