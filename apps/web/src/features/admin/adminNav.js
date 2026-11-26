import {
  Building2,
  LayoutDashboard,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Users,
} from 'lucide-react';

/**
 * The operator console's pages, in the shape of navigation.js (AppShell renders them in the
 * sidebar and the palette). `tone` is the page's header tile, `soft` the chip its cards use.
 */
export const ADMIN_NAV_SECTIONS = [
  {
    id: 'admin-main',
    label: null,
    items: [
      {
        to: '/admin',
        label: 'Overview',
        icon: LayoutDashboard,
        tone: 'from-fuchsia-500 to-purple-600',
        soft: 'fuchsia',
        end: true,
        hint: 'Numbers and things that need attention',
      },
      {
        to: '/admin/users',
        label: 'Users',
        icon: Users,
        tone: 'from-sky-500 to-cyan-600',
        soft: 'sky',
        hint: 'Everyone with an account; suspend or reactivate',
      },
      {
        to: '/admin/workspaces',
        label: 'Workspaces',
        icon: Building2,
        tone: 'from-indigo-500 to-violet-600',
        soft: 'brand',
        hint: 'Every workspace, its people and counts',
      },
    ],
  },
  {
    id: 'admin-operations',
    label: 'Operations',
    items: [
      {
        to: '/admin/system',
        label: 'System status',
        icon: ServerCog,
        tone: 'from-emerald-500 to-teal-600',
        soft: 'teal',
        hint: 'Database, queue, worker, storage and email',
      },
      {
        to: '/admin/audit',
        label: 'Audit log',
        icon: ScrollText,
        tone: 'from-amber-400 to-amber-600',
        soft: 'amber',
        hint: 'What platform admins did, and why',
      },
    ],
  },
];

/** The area AppShell shows instead of a workspace (`back` is added by AdminLayout). */
export const ADMIN_AREA = {
  id: 'admin',
  label: 'Admin',
  description: 'Operator console',
  icon: ShieldCheck,
  tone: 'from-fuchsia-500 to-purple-600',
  sections: ADMIN_NAV_SECTIONS,
};

/** Where "back" leads: the last used workspace, the first one, or creating one. */
export function adminBackLink(workspaces, lastSlug) {
  if (!workspaces) return { to: '/', label: 'Back to workspace' };
  if (workspaces.length === 0) return { to: '/onboarding', label: 'Create a workspace' };
  const target = workspaces.find((w) => w.slug === lastSlug) ?? workspaces[0];
  return { to: `/w/${target.slug}`, label: `Back to ${target.name}` };
}
