import { PERMISSIONS, ROLE_LABELS } from '@socialhub/shared';
import {
  Activity,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Settings,
  Share2,
  SquarePen,
  Sun,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptionalWorkspace } from '../../context/WorkspaceContext.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { useWorkspaces } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Logo } from '../ui/Brand.jsx';
import { Button } from '../ui/Button.jsx';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu.jsx';

function navItems(slug, can) {
  const base = `/w/${slug}`;
  return [
    { to: base, label: 'Overview', icon: LayoutDashboard, end: true },
    can(PERMISSIONS.CONTENT_CREATE) && {
      to: `${base}/compose`,
      label: 'Create post',
      icon: SquarePen,
    },
    { to: `${base}/accounts`, label: 'Social accounts', icon: Share2 },
    { to: `${base}/team`, label: 'Team', icon: Users },
    can(PERMISSIONS.ACTIVITY_READ) && { to: `${base}/activity`, label: 'Activity', icon: Activity },
    { to: `${base}/settings`, label: 'Settings', icon: Settings },
  ].filter(Boolean);
}

function WorkspaceSwitcher({ current }) {
  const { data: workspaces = [] } = useWorkspaces();
  const navigate = useNavigate();

  return (
    <Menu
      align="left"
      className="w-64"
      trigger={({ toggle, props }) => (
        <button
          type="button"
          onClick={toggle}
          {...props}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-2.5 py-2 text-left shadow-xs transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
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
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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

function SidebarContent({ workspace, can, onNavigate }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <Link to="/" onClick={onNavigate} aria-label="SocialHub home">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <WorkspaceSwitcher current={workspace} />
      </div>
      <nav className="mt-5 flex-1 space-y-0.5 px-3" aria-label="Workspace">
        {workspace &&
          navItems(workspace.slug, can).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px]',
                      isActive
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200',
                    )}
                    aria-hidden="true"
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
      </nav>
      <div className="m-3 rounded-xl border border-dashed border-slate-200 p-3.5 dark:border-white/10">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Publishing</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {workspace && can(PERMISSIONS.CONTENT_CREATE)
            ? 'You can compose, preview and save posts as drafts in this browser. '
            : ''}
          Publishing to Facebook and Instagram isn&rsquo;t available yet.
        </p>
      </div>
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
          className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition hover:bg-slate-100 dark:hover:bg-white/5"
          aria-label="Account menu"
        >
          <Avatar name={user?.name} seed={user?.id} size="sm" />
          <span className="hidden max-w-36 truncate text-sm font-medium sm:block">
            {user?.name}
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
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
              await signOut();
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

export function AppShell({ children, workspace: workspaceOverride }) {
  const ctx = useOptionalWorkspace();
  const workspace = workspaceOverride ?? ctx?.workspace ?? null;
  const can = ctx?.can ?? (() => false);
  const { isDark, toggle } = useTheme();
  const location = useLocation();
  // The drawer remembers the path it was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState(null);
  const mobileOpen = drawerPath === location.pathname;
  const setMobileOpen = (open) => setDrawerPath(open ? location.pathname : null);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200/80 bg-white/70 backdrop-blur-xl lg:block dark:border-white/5 dark:bg-slate-900/40">
        <SidebarContent workspace={workspace} can={can} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-72 animate-scale-in border-r border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              workspace={workspace}
              can={can}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-slate-50/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-white/5 dark:bg-slate-950/70">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? (
              <Sun className="h-[18px] w-[18px]" />
            ) : (
              <Moon className="h-[18px] w-[18px]" />
            )}
          </Button>
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] dark:text-white">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
