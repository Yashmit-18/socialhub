import { PUBLISHING_MODES, effectivePublishingMode } from '@socialhub/shared';
import { config } from '../../config/env.js';

/**
 * Publishing settings (config.publishing), read through here so tests can change them.
 *
 * Real publishing takes TWO deliberate switches, and simulation is the default at both:
 *   1. the server operator sets PUBLISHING_MODE=live (`mode` LIVE: real publishing available);
 *   2. an owner or admin of a workspace switches THAT workspace to live, confirming with their
 *      password (Workspace.publishingMode, PUT /workspaces/:id/publishing/mode).
 * A job keeps the mode it was created in. A LIVE job is checked again just before it is sent
 * and is refused, never downgraded or silently simulated, if either switch was turned off.
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

/** Whether this server lets workspaces switch to real publishing. */
export const isLivePublishingAvailable = () => publishingSettings().mode === PUBLISHING_MODES.LIVE;

/** The mode a new job of `workspace` gets right now: DISABLED, SIMULATED or LIVE. */
export function workspacePublishingMode(workspace) {
  return effectivePublishingMode(publishingSettings().mode, workspace?.publishingMode);
}
