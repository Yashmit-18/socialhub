import { isPlatformAdmin } from '@socialhub/shared';
import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { WorkspaceProvider } from '../../context/WorkspaceContext.jsx';
import { useWorkspaces } from '../../lib/queries.js';
import { storage } from '../../lib/utils.js';
import { ButtonLink } from '../ui/Button.jsx';
import { Card } from '../ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../ui/Feedback.jsx';
import { BrokenLinkArt } from '../ui/illustrations.jsx';
import { AppShell } from './AppShell.jsx';

export const LAST_WORKSPACE_KEY = 'sh-last-workspace';

/** Resolves `/w/:slug` against the user's workspaces and provides it to child routes. */
export function WorkspaceLayout() {
  const { slug } = useParams();
  const { data: workspaces, isPending, error, refetch } = useWorkspaces();
  const workspace = workspaces?.find((w) => w.slug === slug);

  useEffect(() => {
    if (workspace) storage.set(LAST_WORKSPACE_KEY, workspace.slug);
  }, [workspace]);

  if (isPending) return <PageLoader fullScreen />;
  if (error) {
    return (
      <AppShell>
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      </AppShell>
    );
  }
  if (!workspace) {
    return (
      <AppShell>
        <Card>
          <EmptyState
            art={BrokenLinkArt}
            title="Workspace not found"
            description="It may have been renamed or deleted, or you may no longer be a member."
            action={<ButtonLink to="/">Go to my workspaces</ButtonLink>}
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <WorkspaceProvider workspace={workspace}>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}

/**
 * `/` — send the user to their most recent workspace, or to onboarding if they have none. A
 * platform admin without a workspace lands in the operator console instead.
 */
export function RootRedirect() {
  const { user } = useAuth();
  const { data: workspaces, isPending, error, refetch } = useWorkspaces();
  if (isPending) return <PageLoader fullScreen />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (workspaces.length === 0) {
    return <Navigate to={isPlatformAdmin(user) ? '/admin' : '/onboarding'} replace />;
  }
  const last = storage.get(LAST_WORKSPACE_KEY);
  const target = workspaces.find((w) => w.slug === last) ?? workspaces[0];
  return <Navigate to={`/w/${target.slug}`} replace />;
}
