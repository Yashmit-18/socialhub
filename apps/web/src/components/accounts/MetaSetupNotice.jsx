import { Plug } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const and = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** The variables the server says are missing, or the documented ones for an older server. */
const missingFor = (block, fallback) => (block?.missing?.length ? block.missing : fallback);

/**
 * "Setup required" state shown when the server cannot start Facebook Login and/or any
 * Instagram login. Nothing is simulated: until the settings exist, SocialHub cannot connect,
 * reconnect or synchronize those logins, and existing records keep the state they had at
 * their last real synchronization.
 *
 * Instagram counts as configured when Instagram Unified Login (Meta's recommended setup, which
 * runs under the Meta app with a configuration id) or the older Instagram Login is set up.
 * The missing variable names come from the server (`missing`); values are never shown.
 *
 * `integration` is the GET /integrations/meta response. Renders nothing when both are configured.
 */
export function MetaSetupNotice({ integration, className, compact = false }) {
  if (!integration) return null;
  const facebook = Boolean(integration.facebook?.configured);
  const instagram = Boolean(
    integration.instagramUnified?.configured || integration.instagram?.configured,
  );
  if (facebook && instagram) return null;

  // Servers that know Unified Login report it; older ones only know Instagram Login.
  const unified = integration.instagramUnified;
  const instagramName = unified ? 'Instagram Unified Login' : 'Instagram Login';
  const instagramMissing = unified
    ? missingFor(unified, ['META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID'])
    : missingFor(integration.instagram, ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']);
  const missing = [
    !facebook &&
      `Facebook Login (${and(missingFor(integration.facebook, ['META_APP_ID', 'META_APP_SECRET']))})`,
    !instagram && `${instagramName} (${and(instagramMissing)})`,
  ].filter(Boolean);
  const title =
    !facebook && !instagram
      ? 'Meta setup required'
      : !facebook
        ? 'Facebook Login is not configured'
        : `${instagramName} is not configured`;

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
          A server administrator must add the Meta app settings for {missing.join(' and ')}. Until
          then SocialHub cannot connect, reconnect or synchronize{' '}
          {!facebook && !instagram ? 'any login' : 'these logins'}; accounts already added keep the
          state from their last successful synchronization.
          {facebook && ' Facebook connections keep working.'}
        </p>
        {!instagram &&
          unified &&
          instagramMissing.includes('META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID') && (
            <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-300/80">
              META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID is the Configuration ID of the Unified Login
              configuration in the Meta App Dashboard. It is not an app ID.
            </p>
          )}
        {!compact && (
          <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            Setup steps: docs/META_SETUP_GUIDE.md in the SocialHub repository.
          </p>
        )}
      </div>
    </section>
  );
}
