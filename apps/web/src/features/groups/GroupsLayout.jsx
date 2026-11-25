import { Info } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { PageLoader } from '../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { cn } from '../../lib/utils.js';

/**
 * Facebook Group sharing (Phase 6): header, the manual-workflow notice and the section tabs
 * (sharing tasks "Tasks", shares "By post", the group directory "Groups").
 */
export default function GroupsLayout() {
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.slug}/groups`;
  const tabs = [
    { to: base, label: 'Tasks', end: true },
    { to: `${base}/shares`, label: 'By post' },
    { to: `${base}/directory`, label: 'Groups' },
  ];
  return (
    <>
      <PageHeader
        title="Group sharing"
        description="Your posts, ready to share in the Facebook Groups your Pages are in."
      />
      <p className="-mt-4 mb-6 flex items-start gap-2.5 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Facebook doesn’t let apps post in groups, so you share each one yourself: copy the text,
          open the group, post it, then mark it as shared.
        </span>
      </p>
      <nav
        aria-label="Group sharing sections"
        className="mb-6 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-white/10"
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
