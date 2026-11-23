import { PUBLISHING_MODES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { facebookPageAdapter } from './facebookPage.js';
import { instagramAdapter } from './instagram.js';
import { simulatedAdapter } from './simulated.js';

/**
 * Publishing adapters. Every adapter offers
 *
 *   publish({ account, connection, accessToken, caption, media, providerState,
 *             saveProviderState }) → { externalPostId, externalUrl }
 *
 * and throws a PublishError on failure. `simulated` adapters contact nobody.
 *
 * A job's own mode decides the adapter: a SIMULATED job can only ever get the simulated
 * adapter, whatever the server is set to later.
 */
const LIVE = Object.freeze({
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: facebookPageAdapter,
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: instagramAdapter,
});

export function adapterFor(mode, platform) {
  if (mode === PUBLISHING_MODES.SIMULATED) return simulatedAdapter;
  if (mode === PUBLISHING_MODES.LIVE) return LIVE[platform] ?? null;
  return null;
}
