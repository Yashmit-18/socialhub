import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { safeRedirect } from '../../lib/utils.js';
import { PageLoader } from '../ui/Feedback.jsx';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader label="Restoring your session…" />;
  if (status === 'guest') {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status === 'authenticated') {
    const params = new URLSearchParams(location.search);
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />;
  }
  return <Outlet />;
}
