/**
 * Which backend capabilities the composer may use.
 *
 * The endpoints are specified in docs/COMPOSER_API_CONTRACT.md but are NOT implemented by the
 * API yet. Until the backend team ships an endpoint and the matching flag is turned on, the
 * composer:
 *   - never calls that endpoint,
 *   - shows an honest "not available yet" state, and
 *   - never reports a server-side success that did not happen.
 *
 * Flags are read at call time (not import time) so tests can use `vi.stubEnv`.
 */

const isOn = (value) => value === true || value === 'true';

export function getComposerCapabilities(env = import.meta.env) {
  return Object.freeze({
    /** Team drafts stored as content packages (contract §4). Flag: VITE_COMPOSER_SERVER_DRAFTS. */
    serverDrafts: isOn(env?.VITE_COMPOSER_SERVER_DRAFTS),
    /** Direct-to-storage media upload (contract §3). Flag: VITE_COMPOSER_MEDIA_UPLOAD. */
    mediaUpload: isOn(env?.VITE_COMPOSER_MEDIA_UPLOAD),
    /** Workspace-shared account presets (contract §5). Flag: VITE_COMPOSER_SERVER_PRESETS. */
    serverPresets: isOn(env?.VITE_COMPOSER_SERVER_PRESETS),
    /**
     * Publishing (contract §6). Deliberately not configurable: the publishing engine does not
     * exist, so the composer never submits posts in this release.
     */
    publishing: false,
  });
}

/** People-facing explanations for capabilities that are not available yet. */
export const CAPABILITY_MESSAGES = Object.freeze({
  serverDrafts:
    'Team drafts need the SocialHub content API, which is not available yet. Drafts are saved in this browser only.',
  mediaUpload:
    'Media uploads need the SocialHub media API, which is not available yet. Files stay in this browser tab and are not uploaded.',
  serverPresets:
    'Shared presets need the SocialHub presets API, which is not available yet. Presets are saved in this browser only.',
  publishing:
    'Publishing is not available yet. The SocialHub publishing engine has not been built, so nothing is sent to Facebook or Instagram.',
});

/** Thrown when code tries to use a capability that is switched off. No request is made. */
export class CapabilityUnavailableError extends Error {
  constructor(capability) {
    super(CAPABILITY_MESSAGES[capability] ?? 'This feature is not available yet.');
    this.name = 'CapabilityUnavailableError';
    this.code = 'CAPABILITY_UNAVAILABLE';
    this.capability = capability;
  }
}

export function requireCapability(capability) {
  if (!getComposerCapabilities()[capability]) throw new CapabilityUnavailableError(capability);
}
