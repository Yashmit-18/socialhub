import { SOCIAL_PROVIDERS } from '@socialhub/shared';
import { config } from '../../config/env.js';

/**
 * Single source of the Meta integration settings (config.meta). Every Meta code path reads
 * them through here, so tests can exercise the "not configured" state of a running server.
 * The override is refused outside NODE_ENV=test.
 */
let override;

export function metaSettings() {
  return override ?? config.meta;
}

/** Pass a partial object to override (e.g. `{ facebook: null }`); pass nothing to reset. */
export function setMetaSettingsForTests(partial) {
  if (!config.isTest) throw new Error('Meta settings can only be overridden in tests');
  override = partial ? { ...config.meta, ...partial } : undefined;
}

export const facebookSettings = () => metaSettings().facebook;
export const instagramSettings = () => metaSettings().instagram;
export const instagramUnifiedSettings = () => metaSettings().instagramUnified;

/**
 * The settings a login provider needs on this server, or null when that provider is not
 * configured (Meta must then not be contacted for its connections).
 */
export function providerSettings(provider) {
  switch (provider) {
    case SOCIAL_PROVIDERS.FACEBOOK_LOGIN:
      return facebookSettings();
    case SOCIAL_PROVIDERS.INSTAGRAM_LOGIN:
      return instagramSettings();
    case SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN:
      return instagramUnifiedSettings();
    default:
      return null;
  }
}

/** Human name of a login provider, for messages. */
export const PROVIDER_NAMES = Object.freeze({
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'Facebook Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'Instagram Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'Instagram (Unified Login)',
});
