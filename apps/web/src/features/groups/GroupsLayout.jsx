import { Info } from 'lucide-react';
import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { PageLoader } from '../../components/ui/Feedback.jsx';
import { TabNav } from '../../components/ui/Tabs.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';

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
      {/* Lined up under the title (past the header's 44 px tile and its 16 px gap). */}
      <p className="-mt-4 mb-6 flex items-start gap-2.5 text-sm text-slate-600 sm:pl-[3.75rem] dark:text-slate-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Facebook doesn’t let apps post in groups, so you share each one yourself: copy the text,
          open the group, post it, then mark it as shared.
        </span>
      </p>
      <TabNav label="Group sharing sections" tabs={tabs} className="mb-6" />
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </>
  );
}
