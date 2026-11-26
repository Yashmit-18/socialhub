import { lazy } from 'react';
import { RootRedirect } from '../../components/layout/WorkspaceLayout.jsx';
import { PageLoader } from '../../components/ui/Feedback.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** Code-split so the dashboard bundle doesn't carry the marketing page (and vice versa). */
export const LandingPage = lazy(() => import('./LandingPage.jsx'));

/**
 * `/`: signed-out visitors see the landing page; signed-in users go straight to their most
 * recent workspace (or onboarding), exactly as before the landing page existed.
 */
export function HomeRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <PageLoader label="Restoring your session…" fullScreen />;
  if (status === 'authenticated') return <RootRedirect />;
  return <LandingPage />;
}
