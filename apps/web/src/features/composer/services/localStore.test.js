import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_DRAFT_VERSION,
  clearLocalDraft,
  isLocalStorageAvailable,
  localDraftKey,
  localPresetsKey,
  readLocalDraft,
  readLocalPresets,
  writeLocalDraft,
  writeLocalPresets,
} from './localStore.js';

const SAVED_AT = '2026-11-20T10:30:00.000Z';
const DRAFT = { caption: 'Hello', hashtags: ['summer'], selectedAccountIds: ['acc-fb-1'] };
const PRESET = {
  id: 'preset_1',
  name: 'Stores',
  socialAccountIds: ['acc-fb-1', 'acc-ig-1'],
  createdAt: '2026-11-20T09:00:00.000Z',
};

const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

/** Makes writes of the composer's own keys fail with `error`; other writes still work. */
function failComposerWrites(error) {
  const realSetItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
    if (String(key).startsWith('sh-composer-')) throw error;
    return realSetItem.call(this, key, value);
  });
}

/** Every write throws, as in browsers that block site data (some private modes). */
function blockStorageWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
}

/** Reading window.localStorage itself throws (storage disabled for the site). */
function denyStorageAccess() {
  return vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Access is denied for this document.', 'SecurityError');
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('storage keys', () => {
  it('scopes drafts and presets per person and workspace', () => {
    expect(localDraftKey('u1', 'w1')).toBe('sh-composer-draft:v1:u1:w1');
    expect(localPresetsKey('u1', 'w1')).toBe('sh-composer-presets:v1:u1:w1');
    expect(localDraftKey('u2', 'w1')).not.toBe(localDraftKey('u1', 'w1'));
    expect(localDraftKey('u1', 'w2')).not.toBe(localDraftKey('u1', 'w1'));
  });
});

describe('isLocalStorageAvailable', () => {
  it('is true when the browser lets SocialHub store data, and leaves nothing behind', () => {
    expect(isLocalStorageAvailable()).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('is false when writes are blocked', () => {
    blockStorageWrites();
    expect(isLocalStorageAvailable()).toBe(false);
  });

  it('is false when the browser denies access to storage', () => {
    const access = denyStorageAccess();
    try {
      expect(isLocalStorageAvailable()).toBe(false);
    } finally {
      access.mockRestore();
    }
  });
});

describe('device drafts', () => {
  it('saves a versioned record and reads it back', () => {
    expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({ ok: true, savedAt: SAVED_AT });
    expect(JSON.parse(localStorage.getItem('sh-composer-draft:v1:u1:w1'))).toEqual({
      version: LOCAL_DRAFT_VERSION,
      savedAt: SAVED_AT,
      data: DRAFT,
    });
    expect(readLocalDraft('u1', 'w1')).toEqual({ savedAt: SAVED_AT, data: DRAFT });
  });

  it('stamps the save time when none is given', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(SAVED_AT));
    expect(writeLocalDraft('u1', 'w1', DRAFT)).toEqual({ ok: true, savedAt: SAVED_AT });
    expect(readLocalDraft('u1', 'w1').savedAt).toBe(SAVED_AT);
  });

  it('replaces the previous draft', () => {
    writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT);
    writeLocalDraft('u1', 'w1', { caption: 'Newer' }, '2026-11-20T11:00:00.000Z');
    expect(readLocalDraft('u1', 'w1')).toEqual({
      savedAt: '2026-11-20T11:00:00.000Z',
      data: { caption: 'Newer' },
    });
  });

  it('never shows one person’s or workspace’s draft to another', () => {
    writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT);
    expect(readLocalDraft('u2', 'w1')).toBeNull();
    expect(readLocalDraft('u1', 'w2')).toBeNull();
  });

  it('returns null when there is no draft', () => {
    expect(readLocalDraft('u1', 'w1')).toBeNull();
  });

  it('discards a corrupted draft', () => {
    localStorage.setItem(localDraftKey('u1', 'w1'), '{"version":1,"savedAt":');
    expect(readLocalDraft('u1', 'w1')).toBeNull();
    expect(localStorage.getItem(localDraftKey('u1', 'w1'))).toBeNull();
  });

  it('ignores, but keeps, a draft written by a newer version', () => {
    const record = JSON.stringify({
      version: LOCAL_DRAFT_VERSION + 1,
      savedAt: SAVED_AT,
      data: {},
    });
    localStorage.setItem(localDraftKey('u1', 'w1'), record);
    expect(readLocalDraft('u1', 'w1')).toBeNull();
    expect(localStorage.getItem(localDraftKey('u1', 'w1'))).toBe(record);
  });

  it.each([
    ['no save time', { version: LOCAL_DRAFT_VERSION, data: DRAFT }],
    ['a numeric save time', { version: LOCAL_DRAFT_VERSION, savedAt: 1700000000000, data: DRAFT }],
    ['null data', { version: LOCAL_DRAFT_VERSION, savedAt: SAVED_AT, data: null }],
    ['text data', { version: LOCAL_DRAFT_VERSION, savedAt: SAVED_AT, data: 'caption' }],
    ['no version', { savedAt: SAVED_AT, data: DRAFT }],
    ['a bare string', 'just text'],
    ['null', null],
  ])('returns null for a record with %s', (_label, record) => {
    localStorage.setItem(localDraftKey('u1', 'w1'), JSON.stringify(record));
    expect(readLocalDraft('u1', 'w1')).toBeNull();
  });

  it('clears only that person’s draft for that workspace', () => {
    writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT);
    writeLocalDraft('u1', 'w2', DRAFT, SAVED_AT);
    writeLocalDraft('u2', 'w1', DRAFT, SAVED_AT);
    writeLocalPresets('u1', 'w1', [PRESET]);

    clearLocalDraft('u1', 'w1');
    expect(readLocalDraft('u1', 'w1')).toBeNull();
    expect(readLocalDraft('u1', 'w2')).not.toBeNull();
    expect(readLocalDraft('u2', 'w1')).not.toBeNull();
    expect(readLocalPresets('u1', 'w1')).toEqual([PRESET]);
  });

  describe('when saving fails', () => {
    it.each([
      ['QuotaExceededError', quotaError()],
      [
        'Firefox’s legacy quota error',
        Object.assign(new Error('full'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }),
      ],
      ['error code 22', Object.assign(new Error('full'), { code: 22 })],
      ['error code 1014', Object.assign(new Error('full'), { code: 1014 })],
    ])('reports a full storage for %s', (_label, error) => {
      failComposerWrites(error);
      expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({ ok: false, reason: 'quota' });
    });

    it('reports other write errors as "error"', () => {
      failComposerWrites(new TypeError('Something odd'));
      expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({ ok: false, reason: 'error' });
    });

    it('keeps the previous draft when a newer one cannot be saved', () => {
      writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT);
      failComposerWrites(quotaError());
      writeLocalDraft('u1', 'w1', { caption: 'Too big' }, '2026-11-20T11:00:00.000Z');
      expect(readLocalDraft('u1', 'w1')).toEqual({ savedAt: SAVED_AT, data: DRAFT });
    });

    it('reports storage as unavailable when the browser blocks it', () => {
      blockStorageWrites();
      expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(readLocalDraft('u1', 'w1')).toBeNull();
      expect(() => clearLocalDraft('u1', 'w1')).not.toThrow();
    });

    it('never throws when access to storage is denied', () => {
      const access = denyStorageAccess();
      try {
        expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({
          ok: false,
          reason: 'unavailable',
        });
        expect(readLocalDraft('u1', 'w1')).toBeNull();
        expect(() => clearLocalDraft('u1', 'w1')).not.toThrow();
        expect(readLocalPresets('u1', 'w1')).toEqual([]);
        expect(writeLocalPresets('u1', 'w1', [PRESET])).toEqual({
          ok: false,
          reason: 'unavailable',
        });
      } finally {
        access.mockRestore();
      }
    });
  });

  // BUG: services/localStore.js:23-33 + 49-52 — getStorage() probes with setItem() before every
  // read. When the origin's quota is used up the probe itself throws QuotaExceededError, so
  // readLocalDraft/readLocalPresets return null/[] and an existing draft silently disappears from
  // the UI (and writeLocalDraft reports 'unavailable' instead of 'quota'). Reads should not need
  // write space: only probe for writes / isLocalStorageAvailable, and read with getItem directly.
  it('still reads the saved draft and presets when storage is full', () => {
    writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT);
    writeLocalPresets('u1', 'w1', [PRESET]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    expect(readLocalDraft('u1', 'w1')).toEqual({ savedAt: SAVED_AT, data: DRAFT });
    expect(readLocalPresets('u1', 'w1')).toEqual([PRESET]);
  });

  // BUG: same root cause as above (services/localStore.js:23-33, 63-65) — a full storage is
  // reported as 'unavailable' ("this browser blocks storage") rather than 'quota' ("storage is
  // full"), so people get the wrong explanation and remedy.
  it('reports a completely full storage as "quota"', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    expect(writeLocalDraft('u1', 'w1', DRAFT, SAVED_AT)).toEqual({ ok: false, reason: 'quota' });
  });
});

describe('device presets', () => {
  it('saves and reads presets for the person and workspace', () => {
    expect(writeLocalPresets('u1', 'w1', [PRESET])).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem('sh-composer-presets:v1:u1:w1'))).toEqual([PRESET]);
    expect(readLocalPresets('u1', 'w1')).toEqual([PRESET]);
    expect(readLocalPresets('u2', 'w1')).toEqual([]);
    expect(readLocalPresets('u1', 'w2')).toEqual([]);
  });

  it('returns [] when nothing is saved or the value is not a list', () => {
    expect(readLocalPresets('u1', 'w1')).toEqual([]);
    localStorage.setItem(localPresetsKey('u1', 'w1'), JSON.stringify({ presets: [PRESET] }));
    expect(readLocalPresets('u1', 'w1')).toEqual([]);
  });

  it('discards a corrupted preset list', () => {
    localStorage.setItem(localPresetsKey('u1', 'w1'), '[{"id":');
    expect(readLocalPresets('u1', 'w1')).toEqual([]);
    expect(localStorage.getItem(localPresetsKey('u1', 'w1'))).toBeNull();
  });

  it('drops malformed presets and keeps valid ones', () => {
    const valid = { id: 'p2', name: 'Instagram only', socialAccountIds: [] };
    localStorage.setItem(
      localPresetsKey('u1', 'w1'),
      JSON.stringify([
        PRESET,
        { id: 3, name: 'Numeric id', socialAccountIds: [] },
        { id: 'p4', socialAccountIds: [] },
        { id: 'p5', name: 'Ids not a list', socialAccountIds: 'acc-1' },
        { id: 'p6', name: 'Bad id inside', socialAccountIds: ['acc-1', 7] },
        null,
        'preset',
        valid,
      ]),
    );
    expect(readLocalPresets('u1', 'w1')).toEqual([PRESET, valid]);
  });

  it('reports why presets could not be saved', () => {
    failComposerWrites(quotaError());
    expect(writeLocalPresets('u1', 'w1', [PRESET])).toEqual({ ok: false, reason: 'quota' });
    vi.restoreAllMocks();

    blockStorageWrites();
    expect(writeLocalPresets('u1', 'w1', [PRESET])).toEqual({ ok: false, reason: 'unavailable' });
    expect(readLocalPresets('u1', 'w1')).toEqual([]);
  });
});
