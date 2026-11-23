import { PUBLISHING_MODES } from '@socialhub/shared';
import { config } from '../../config/env.js';

/**
 * Publishing settings (config.publishing), read through here so tests can change them.
 *
 * REAL PUBLISHING IS NOT ENABLED IN THIS BUILD. The configuration only accepts `disabled`
 * and `simulated`, so `mode` can never be LIVE on a running server. The live adapters exist
 * and are tested against a simulated Meta, with LIVE switched on through the test-only
 * override below. Enabling real publishing later is a deliberate change to config/env.js,
 * after the adapters have been verified against a real Meta app.
 */
let override;

export function publishingSettings() {
  return override ?? config.publishing;
}

/** Pass a partial object (e.g. `{ mode: 'LIVE' }`); pass nothing to reset. */
export function setPublishingSettingsForTests(partial) {
  if (!config.isTest) throw new Error('Publishing settings can only be overridden in tests');
  override = partial ? { ...config.publishing, ...partial } : undefined;
}

export const isPublishingEnabled = () => publishingSettings().mode !== PUBLISHING_MODES.DISABLED;
