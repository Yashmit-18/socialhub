import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_MESSAGES,
  CapabilityUnavailableError,
  getComposerCapabilities,
  requireCapability,
} from './capabilities.js';

const FLAGS = [
  ['VITE_COMPOSER_SERVER_DRAFTS', 'serverDrafts'],
  ['VITE_COMPOSER_MEDIA_UPLOAD', 'mediaUpload'],
  ['VITE_COMPOSER_SERVER_PRESETS', 'serverPresets'],
];
const ALL_OFF = {
  serverDrafts: false,
  mediaUpload: false,
  serverPresets: false,
  publishing: false,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getComposerCapabilities', () => {
  it('turns every backend capability off unless its flag is set', () => {
    expect(getComposerCapabilities()).toEqual(ALL_OFF);
    expect(getComposerCapabilities({})).toEqual(ALL_OFF);
    expect(getComposerCapabilities(null)).toEqual(ALL_OFF);
  });

  it.each(FLAGS)('%s turns on %s only', (flag, capability) => {
    vi.stubEnv(flag, 'true');
    // Publishing is done from saved team drafts, so it comes with them.
    const extra = capability === 'serverDrafts' ? { publishing: true } : {};
    expect(getComposerCapabilities()).toEqual({ ...ALL_OFF, [capability]: true, ...extra });
  });

  it('reads the flags each time it is called', () => {
    vi.stubEnv('VITE_COMPOSER_MEDIA_UPLOAD', 'true');
    expect(getComposerCapabilities().mediaUpload).toBe(true);
    vi.unstubAllEnvs();
    expect(getComposerCapabilities().mediaUpload).toBe(false);
  });

  it('accepts only an explicit true', () => {
    expect(getComposerCapabilities({ VITE_COMPOSER_SERVER_DRAFTS: true }).serverDrafts).toBe(true);
    expect(getComposerCapabilities({ VITE_COMPOSER_SERVER_DRAFTS: 'true' }).serverDrafts).toBe(
      true,
    );
    for (const value of ['false', '', '0', 'yes', 'enabled', undefined, null, false]) {
      expect(getComposerCapabilities({ VITE_COMPOSER_SERVER_DRAFTS: value }).serverDrafts).toBe(
        false,
      );
    }
  });

  it('turns publishing on only together with team drafts, never through a flag of its own', () => {
    vi.stubEnv('VITE_COMPOSER_PUBLISHING', 'true');
    vi.stubEnv('VITE_COMPOSER_MEDIA_UPLOAD', 'true');
    expect(getComposerCapabilities().publishing).toBe(false);
    expect(
      getComposerCapabilities({ VITE_COMPOSER_PUBLISHING: 'true', publishing: true }).publishing,
    ).toBe(false);
    vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
    expect(getComposerCapabilities().publishing).toBe(true);
  });

  it('returns a frozen snapshot', () => {
    const capabilities = getComposerCapabilities();
    expect(Object.isFrozen(capabilities)).toBe(true);
  });
});

describe('CAPABILITY_MESSAGES', () => {
  it('explains every capability, and cannot be changed', () => {
    expect(Object.keys(CAPABILITY_MESSAGES).sort()).toEqual(
      Object.keys(getComposerCapabilities()).sort(),
    );
    expect(Object.isFrozen(CAPABILITY_MESSAGES)).toBe(true);
  });

  it('says plainly why each capability is unavailable, without blaming a missing API', () => {
    for (const key of ['serverDrafts', 'mediaUpload', 'serverPresets']) {
      // The API exists: these are off because their flag is not set for this build.
      expect(CAPABILITY_MESSAGES[key]).toMatch(/not switched on for this site/);
      expect(CAPABILITY_MESSAGES[key]).toMatch(/in this browser/);
      expect(CAPABILITY_MESSAGES[key]).not.toMatch(/API|not available yet/);
    }
    // Real publishing really is not available: at most it is simulated.
    expect(CAPABILITY_MESSAGES.publishing).toMatch(/Real publishing is not available yet/);
    expect(CAPABILITY_MESSAGES.publishing).toMatch(/needs team drafts/);
  });

  it('labels device-only fallbacks as staying in this browser', () => {
    expect(CAPABILITY_MESSAGES.serverDrafts).toMatch(/saved in this browser only/);
    expect(CAPABILITY_MESSAGES.serverPresets).toMatch(/saved in this browser only/);
    expect(CAPABILITY_MESSAGES.mediaUpload).toMatch(
      /stay in this browser tab and are not uploaded/,
    );
  });

  it('says nothing is sent to Facebook or Instagram', () => {
    expect(CAPABILITY_MESSAGES.publishing).toMatch(/nothing is sent to Facebook or Instagram/);
  });
});

describe('CapabilityUnavailableError', () => {
  it('is an Error carrying a stable code, the capability and its explanation', () => {
    const error = new CapabilityUnavailableError('mediaUpload');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CapabilityUnavailableError);
    expect(error).toMatchObject({
      name: 'CapabilityUnavailableError',
      code: 'CAPABILITY_UNAVAILABLE',
      capability: 'mediaUpload',
      message: CAPABILITY_MESSAGES.mediaUpload,
    });
  });

  it('has a generic explanation for unknown capabilities', () => {
    expect(new CapabilityUnavailableError('teleport').message).toBe(
      'This feature is not available yet.',
    );
  });
});

describe('requireCapability', () => {
  it.each(FLAGS)('throws while %s is off', (_flag, capability) => {
    let thrown = null;
    try {
      requireCapability(capability);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CapabilityUnavailableError);
    expect(thrown).toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      capability,
      message: CAPABILITY_MESSAGES[capability],
    });
  });

  it.each(FLAGS)('passes once %s is on', (flag, capability) => {
    vi.stubEnv(flag, 'true');
    expect(() => requireCapability(capability)).not.toThrow();
  });

  it('throws for publishing unless team drafts are on', () => {
    vi.stubEnv('VITE_COMPOSER_PUBLISHING', 'true');
    vi.stubEnv('VITE_COMPOSER_MEDIA_UPLOAD', 'true');
    expect(() => requireCapability('publishing')).toThrow(CAPABILITY_MESSAGES.publishing);
    vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
    expect(() => requireCapability('publishing')).not.toThrow();
  });

  it('throws for capabilities that do not exist', () => {
    expect(() => requireCapability('teleport')).toThrow(CapabilityUnavailableError);
  });
});
