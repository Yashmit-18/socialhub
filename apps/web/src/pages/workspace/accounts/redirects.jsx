import { Navigate, useParams } from 'react-router';

/**
 * Phase 2 sent new connections to /w/:slug/accounts/connections/:connectionId. Account
 * selection now lives under the login: /w/:slug/accounts/logins/:connectionId/select.
 */
export function LegacyConnectionRedirect() {
  const { slug, connectionId } = useParams();
  return <Navigate to={`/w/${slug}/accounts/logins/${connectionId}/select`} replace />;
}
