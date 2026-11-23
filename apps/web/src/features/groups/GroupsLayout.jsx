import { Info } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { PageLoader } from '../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { cn } from '../../lib/utils.js';

/**
 * Facebook Group sharing (Phase 6): header, the manual-workflow notice and the section tabs
 * (sharing tasks, shares, group directory).
 */
export default function GroupsLayout() {
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.slug}/groups`;
  const tabs = [
    { to: base, label: 'Sharing tasks', end: true },
    { to: `${base}/shares`, label: 'Shares' },
    { to: `${base}/directory`, label: 'Group directory' },
  ];
  return (
    <>
      <PageHeader
        title="Group sharing"
        description="Share posts in Facebook Groups by hand, with a directory of your groups, one task per group and a record of what was posted where."
      />
      <p className="-mt-4 mb-6 flex items-start gap-2.5 rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/[0.07] dark:text-sky-200">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300"
          aria-hidden="true"
        />
        <span>
          SocialHub never posts to, joins or reads Facebook Groups. Each task gives you the text,
          the link and the group: you post it yourself on Facebook, then mark the task as shared.
        </span>
      </p>
      <nav
        aria-label="Group sharing sections"
        className="mb-6 overflow-x-auto border-b border-slate-200/80 dark:border-white/10"
      >
        <ul className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-brand-500 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-100',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </>
  );
}
