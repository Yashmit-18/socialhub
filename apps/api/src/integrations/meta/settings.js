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
