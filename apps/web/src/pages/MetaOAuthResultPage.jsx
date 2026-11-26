import { META_OAUTH_RESULTS } from '@socialhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ButtonLink } from '../components/ui/Button.jsx';
import { CenteredShell } from '../components/ui/CenteredShell.jsx';
import { cn } from '../lib/utils.js';
import { OAUTH_RESULT_MESSAGES } from '../lib/meta.js';

const SLUG = /^[a-z0-9-]{3,48}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;

/**
 * Landing page for the API's OAuth callback redirect. The URL carries only an outcome code
 * and identifiers (never tokens). Every value is validated before it is used in a route.
 */
export default function MetaOAuthResultPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const status = params.get('status');
  const reason = params.get('reason');
  const workspace = SLUG.test(params.get('workspace') ?? '') ? params.get('workspace') : null;
  const connection = OBJECT_ID.test(params.get('connection') ?? '')
    ? params.get('connection')
    : null;
  const success = status === 'success' && workspace && connection;

  useEffect(() => {
    if (!success) return;
    queryClient.invalidateQueries({ queryKey: ['workspace'] });
    queryClient.invalidateQueries({ queryKey: ['me'] });
    toast.success(OAUTH_RESULT_MESSAGES[reason] ?? 'Connected');
  }, [success, reason, queryClient]);

  if (success) {
    const target =
      reason === META_OAUTH_RESULTS.RECONNECTED
        ? `/w/${workspace}/accounts/logins/${connection}`
        : `/w/${workspace}/accounts/logins/${connection}/select`;
    return <Navigate to={target} replace />;
  }

  const message =
    OAUTH_RESULT_MESSAGES[reason] ?? 'The connection could not be completed. Please try again.';
  // Pressing Cancel at Meta is a choice, not a failure: a neutral sign instead of a warning.
  const cancelled = reason === META_OAUTH_RESULTS.USER_CANCELLED;
  const Icon = cancelled ? Ban : AlertTriangle;
  return (
    <CenteredShell>
      <div className="text-center" role="alert">
        <div
          className={cn(
            'mx-auto flex h-12 w-12 animate-pop-in items-center justify-center rounded-2xl ring-1 ring-inset',
            cancelled
              ? 'bg-slate-100 text-slate-600 ring-slate-900/5 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10'
              : 'bg-amber-50 text-amber-600 ring-amber-500/15 dark:bg-amber-500/10 dark:text-amber-400',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {cancelled ? 'Authorization cancelled' : 'Connection not completed'}
        </h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <ButtonLink
          to={workspace ? `/w/${workspace}/accounts` : '/'}
          variant="secondary"
          className="mt-6"
        >
          Back to social accounts
        </ButtonLink>
      </div>
    </CenteredShell>
  );
}
