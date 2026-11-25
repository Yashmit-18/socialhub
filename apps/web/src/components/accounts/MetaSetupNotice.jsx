import { Plug } from 'lucide-react';
import { cn } from '../../lib/utils.js';

/**
 * "Setup required" state shown when the server has no Meta app credentials for Facebook Login
 * and/or Instagram Login. Nothing is simulated: until credentials exist, SocialHub cannot
 * connect, reconnect or synchronize those logins, and existing records keep the state they
 * had at their last real synchronization.
 *
 * `integration` is the GET /integrations/meta response. Renders nothing when both are configured.
 */
export function MetaSetupNotice({ integration, className, compact = false }) {
  if (!integration) return null;
  const facebook = Boolean(integration.facebook?.configured);
  const instagram = Boolean(integration.instagram?.configured);
  if (facebook && instagram) return null;

  const missing = [
    !facebook && 'Facebook Login (META_APP_ID and META_APP_SECRET)',
    !instagram && 'Instagram Login (INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET)',
  ].filter(Boolean);
  const title =
    !facebook && !instagram
      ? 'Meta setup required'
      : !facebook
        ? 'Facebook Login is not configured'
        : 'Instagram Login is not configured';

  return (
    <section
      aria-label={title}
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3.5 dark:border-amber-500/20 dark:bg-amber-500/[0.07]',
        className,
      )}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <Plug className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-sm">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">{title}</h2>
        <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
          A server administrator must add the Meta app credentials for {missing.join(' and ')}.
          Until then SocialHub cannot connect, reconnect or synchronize{' '}
          {!facebook && !instagram ? 'any login' : 'these logins'}; accounts already added keep the
          state from their last successful synchronization.
        </p>
        {!compact && (
          <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            Setup steps: docs/META_SETUP_GUIDE.md in the SocialHub repository.
          </p>
        )}
      </div>
    </section>
  );
}
