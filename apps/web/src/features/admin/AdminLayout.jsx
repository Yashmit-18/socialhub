import { isPlatformAdmin } from '@socialhub/shared';
import { Suspense, useMemo } from 'react';
import { Outlet } from 'react-router';
import { AppShell } from '../../components/layout/AppShell.jsx';
import { LAST_WORKSPACE_KEY } from '../../components/layout/WorkspaceLayout.jsx';
import { PageLoader } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useWorkspaces } from '../../lib/queries.js';
import { storage } from '../../lib/utils.js';
import { NotFoundPage } from '../../pages/NotFoundPage.jsx';
import { ADMIN_AREA, adminBackLink } from './adminNav.js';

/**
 * The operator console's frame: the app shell with the admin pages instead of a workspace's.
 * Display gating only; every admin endpoint checks the role itself.
 */
export default function AdminLayout() {
  const { user } = useAuth();
  const allowed = isPlatformAdmin(user);
  // Only to offer the way back; the same list the workspace switcher uses.
  const { data: workspaces } = useWorkspaces({ enabled: allowed });
  const back = adminBackLink(workspaces, storage.get(LAST_WORKSPACE_KEY));
  const area = useMemo(
    () => ({ ...ADMIN_AREA, back: { to: back.to, label: back.label } }),
    [back.to, back.label],
  );
  // Hidden like the API hides it: the same page as any address that does not exist.
  if (!allowed) return <NotFoundPage />;
  return (
    <AppShell area={area}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
