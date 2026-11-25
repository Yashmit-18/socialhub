import { PERMISSIONS } from '@socialhub/shared';
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Megaphone,
  Send,
  Settings,
  Share2,
  SquarePen,
  Users,
} from 'lucide-react';

/**
 * The workspace's pages, grouped as the sidebar shows them: the everyday pages first, then
 * the workspace's own settings. Pages a role cannot use are left out. `hint` is the short
 * description the command palette shows and searches; `badge` names a live count the sidebar
 * shows next to the page.
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
          end: true,
          hint: 'Your workspace at a glance',
        },
        can(PERMISSIONS.CONTENT_CREATE) && {
          to: `${base}/compose`,
          label: 'Create post',
          icon: SquarePen,
          hint: 'Write once, preview for Facebook and Instagram, publish',
        },
        can(PERMISSIONS.CONTENT_READ) && {
          to: `${base}/publishing`,
          label: 'Posts',
          icon: Send,
          hint: 'Published, scheduled and failed posts',
        },
        can(PERMISSIONS.CONTENT_READ) && {
          to: `${base}/groups`,
          label: 'Group sharing',
          icon: Megaphone,
          badge: 'groupTasks',
          hint: 'Share your posts in the Facebook Groups your Pages are in',
        },
        {
          to: `${base}/accounts`,
          label: 'Social accounts',
          icon: Share2,
          hint: 'Facebook Pages, Instagram accounts and logins',
        },
        can(PERMISSIONS.ANALYTICS_READ) && {
          to: `${base}/analytics`,
          label: 'Analytics',
          icon: BarChart3,
          hint: 'Account, post and publishing performance',
        },
      ].filter(Boolean),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        { to: `${base}/team`, label: 'Team', icon: Users, hint: 'Members, roles and invitations' },
        can(PERMISSIONS.ACTIVITY_READ) && {
          to: `${base}/activity`,
          label: 'Activity',
          icon: Activity,
          hint: 'Audit trail of every change',
        },
        {
          to: `${base}/settings`,
          label: 'Settings',
          icon: Settings,
          hint: 'Workspace name, time zone and publishing mode',
        },
      ].filter(Boolean),
    },
  ].filter((section) => section.items.length > 0);
}

/** The flat list of pages, in sidebar order. */
export function navItems(slug, can) {
  return navSections(slug, can).flatMap((section) => section.items);
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
