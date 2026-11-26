import { PERMISSIONS, isPlatformAdmin } from '@socialhub/shared';
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Megaphone,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  SquarePen,
  Users,
} from 'lucide-react';

/**
 * The workspace's pages, grouped as the sidebar shows them: the everyday pages first, then
 * the workspace's own settings. Pages a role cannot use are left out. `hint` is the short
 * description the command palette shows and searches; `badge` names a live count the sidebar
 * shows next to the page; `tone` is the page's colour (the gradient of the icon tile next to its
 * title) and `soft` the matching quiet chip (a key of SOFT_TONES) that its cards' icons use.
 */
export function navSections(slug, can) {
  const base = `/w/${slug}`;
  return [
    {
      id: 'main',
      label: null,
      items: [
        {
          to: base,
          label: 'Overview',
          icon: LayoutDashboard,
          tone: 'from-indigo-500 to-violet-600',
          soft: 'brand',
          end: true,
          hint: 'Your workspace at a glance',
        },
        can(PERMISSIONS.CONTENT_CREATE) && {
          to: `${base}/compose`,
          label: 'Create post',
          icon: SquarePen,
          tone: 'from-indigo-500 to-violet-600',
          soft: 'brand',
          hint: 'Write once, preview for Facebook and Instagram, publish',
        },
        can(PERMISSIONS.CONTENT_READ) && {
          to: `${base}/publishing`,
          label: 'Posts',
          icon: Send,
          tone: 'from-violet-500 to-fuchsia-600',
          soft: 'violet',
          hint: 'Published, scheduled and failed posts',
        },
        can(PERMISSIONS.CONTENT_READ) && {
          to: `${base}/groups`,
          label: 'Group sharing',
          icon: Megaphone,
          tone: 'from-pink-500 to-rose-500',
          soft: 'pink',
          badge: 'groupTasks',
          hint: 'Share your posts in the Facebook Groups your Pages are in',
        },
        {
          to: `${base}/accounts`,
          label: 'Social accounts',
          icon: Share2,
          tone: 'from-blue-500 to-indigo-600',
          soft: 'blue',
          hint: 'Facebook Pages, Instagram accounts and logins',
        },
        can(PERMISSIONS.ANALYTICS_READ) && {
          to: `${base}/analytics`,
          label: 'Analytics',
          icon: BarChart3,
          tone: 'from-emerald-500 to-teal-600',
          soft: 'teal',
          hint: 'Account, post and publishing performance',
        },
      ].filter(Boolean),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        {
          to: `${base}/team`,
          label: 'Team',
          icon: Users,
          tone: 'from-sky-500 to-cyan-600',
          soft: 'sky',
          hint: 'Members, roles and invitations',
        },
        can(PERMISSIONS.ACTIVITY_READ) && {
          to: `${base}/activity`,
          label: 'Activity',
          icon: Activity,
          tone: 'from-amber-400 to-amber-600',
          soft: 'amber',
          hint: 'Audit trail of every change',
        },
        {
          to: `${base}/settings`,
          label: 'Settings',
          icon: Settings,
          tone: 'from-slate-500 to-slate-700',
          soft: 'neutral',
          hint: 'Workspace name, time zone and publishing mode',
        },
      ].filter(Boolean),
    },
  ].filter((section) => section.items.length > 0);
}

/** The way into the operator console. Platform admins only; nobody else has this entry. */
export function platformSections(user) {
  if (!isPlatformAdmin(user)) return [];
  return [
    {
      id: 'platform',
      label: 'Operator',
      items: [
        {
          to: '/admin',
          label: 'Admin console',
          icon: ShieldCheck,
          tone: 'from-fuchsia-500 to-purple-600',
          soft: 'fuchsia',
          hint: 'Users, workspaces and system status of this SocialHub',
        },
      ],
    },
  ];
}

/** What the sidebar and the palette list outside an area: workspace pages, then the entry. */
export function shellSections(workspace, can, user) {
  return [...(workspace ? navSections(workspace.slug, can) : []), ...platformSections(user)];
}

/** The page the path belongs to (the longest matching prefix), or null. */
export function currentNavItem(items, pathname) {
  let best = null;
  for (const item of items) {
    const match = item.end
      ? pathname === item.to || pathname === `${item.to}/`
      : pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (match && (!best || item.to.length > best.to.length)) best = item;
  }
  return best;
}
