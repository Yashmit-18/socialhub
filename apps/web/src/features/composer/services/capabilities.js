/**
 * Which backend capabilities the composer may use.
 *
 * The API implements drafts, media upload and account presets
 * (docs/COMPOSER_API_CONTRACT.md §4–§6). Each one is used only when its flag is set for this
 * build; media upload also needs storage configured on the API. While a flag is off, the
 * composer:
 *   - never calls that endpoint,
 *   - keeps the feature in this browser and says so, and
 *   - never reports a server-side success that did not happen.
 * Publishing has no flag of its own: a post is published from a saved team draft, so the
 * composer can publish exactly when team drafts are on. Whether the server accepts posts, and
 * whether it only simulates them, is decided at runtime by GET /publishing/status
 * (PUBLISHING_MODE and the Redis queue), never by the build.
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
     * Publishing through the SocialHub publishing API (docs/PUBLISHING_API.md). Follows team
     * drafts, because a publishing job is made from a saved draft; VITE_COMPOSER_PUBLISHING
     * does not exist. Real posting to Meta is a server setting that this build cannot enable.
     */
    publishing: isOn(env?.VITE_COMPOSER_SERVER_DRAFTS),
  });
}

/** People-facing explanations for capabilities that are not available yet. */
export const CAPABILITY_MESSAGES = Object.freeze({
  serverDrafts:
    'Team drafts are not switched on for this site. Drafts are saved in this browser only.',
  mediaUpload:
    'Media upload is not switched on for this site. Files stay in this browser tab and are not uploaded.',
  serverPresets:
    'Shared presets are not switched on for this site. Presets are saved in this browser only.',
  publishing:
    'Publishing from the composer needs team drafts, which are not switched on for this site, so nothing can be sent to Facebook or Instagram from here.',
});

/**
 * Shown wherever the composer talks about readiness. True in every mode: whether Publish
 * simulates or sends a real post depends on the workspace, and a real post is always previewed
 * and confirmed in the Publish dialog first.
 */
export const REAL_PUBLISHING_NOTE =
  'Whether Publish sends a real post or a simulation depends on the workspace’s publishing mode; a real post is always previewed and confirmed first.';

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
