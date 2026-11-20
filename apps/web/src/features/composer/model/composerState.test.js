import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALT_TEXT_MAX,
  COMPOSER_ACTIONS,
  COMPOSER_PLATFORMS,
  INSPECTION_STATUS,
  MEDIA_KINDS,
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  captionForPlatform,
  composerActions as actions,
  composerReducer,
  createInitialComposerState,
  createMediaItem,
  hasContent,
  isPlatformCustomized,
} from './composerState.js';
import { createClientId } from './ids.js';
import { HASHTAG_PLACEMENTS, TEXT_LIMITS, countChars } from './text.js';

const FB = 'FACEBOOK_PAGE';
const IG = 'INSTAGRAM_ACCOUNT';

const composer = (patch = {}) => ({ ...createInitialComposerState(), ...patch });

/** Runs actions through the real reducer, starting from a (partial) state. */
const run = (actionList, patch = {}) => actionList.reduce(composerReducer, composer(patch));

const image = (id, patch = {}) => ({
  ...createMediaItem({
    id,
    kind: MEDIA_KINDS.IMAGE,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
  }),
  ...patch,
});

const ids = (state) => state.media.map((m) => m.id);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('constants', () => {
  it('targets Facebook Pages then Instagram accounts', () => {
    expect(COMPOSER_PLATFORMS).toEqual([FB, IG]);
    expect(Object.isFrozen(COMPOSER_PLATFORMS)).toBe(true);
  });

  it('defines frozen media kinds and statuses', () => {
    expect(MEDIA_KINDS).toEqual({ IMAGE: 'IMAGE', VIDEO: 'VIDEO' });
    expect(INSPECTION_STATUS).toEqual({ PENDING: 'PENDING', DONE: 'DONE', FAILED: 'FAILED' });
    expect(UPLOAD_STATUS).toEqual({
      LOCAL: 'LOCAL',
      UPLOADING: 'UPLOADING',
      PROCESSING: 'PROCESSING',
      UPLOADED: 'UPLOADED',
      FAILED: 'FAILED',
    });
    for (const value of [MEDIA_KINDS, INSPECTION_STATUS, UPLOAD_STATUS, COMPOSER_ACTIONS]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('has exactly one action creator per action type', () => {
    expect(Object.isFrozen(actions)).toBe(true);
    const created = Object.values(actions).map((create) => create().type);
    expect(new Set(created).size).toBe(created.length);
    expect([...created].sort()).toEqual(Object.values(COMPOSER_ACTIONS).sort());
  });

  it('builds actions carrying their arguments', () => {
    expect(actions.setPlatformCaption(IG, 'Hi')).toEqual({
      type: COMPOSER_ACTIONS.SET_PLATFORM_CAPTION,
      platform: IG,
      value: 'Hi',
    });
    expect(actions.updateMedia('m1', { altText: 'x' })).toEqual({
      type: COMPOSER_ACTIONS.UPDATE_MEDIA,
      id: 'm1',
      patch: { altText: 'x' },
    });
    expect(actions.moveMedia('m1', 2)).toEqual({
      type: COMPOSER_ACTIONS.MOVE_MEDIA,
      id: 'm1',
      toIndex: 2,
    });
  });
});

describe('createInitialComposerState', () => {
  it('starts empty, with shared captions, hashtags in the caption and revision 0', () => {
    expect(createInitialComposerState()).toEqual({
      caption: '',
      platformCaptions: { [FB]: null, [IG]: null },
      hashtags: [],
      hashtagPlacement: HASHTAG_PLACEMENTS.CAPTION,
      keywords: [],
      firstComment: '',
      media: [],
      selectedAccountIds: [],
      revision: 0,
    });
  });

  it('returns a fresh object every time (no shared arrays)', () => {
    const a = createInitialComposerState();
    const b = createInitialComposerState();
    expect(a).not.toBe(b);
    for (const key of ['platformCaptions', 'hashtags', 'keywords', 'media', 'selectedAccountIds']) {
      expect(a[key]).not.toBe(b[key]);
    }
  });
});

describe('createMediaItem', () => {
  it('describes a local file that has not been inspected or uploaded', () => {
    expect(
      createMediaItem({
        id: 'm1',
        kind: MEDIA_KINDS.VIDEO,
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2048,
        previewUrl: 'blob:mock/1',
      }),
    ).toEqual({
      id: 'm1',
      kind: MEDIA_KINDS.VIDEO,
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
      previewUrl: 'blob:mock/1',
      posterUrl: null,
      width: null,
      height: null,
      durationSec: null,
      inspection: INSPECTION_STATUS.PENDING,
      altText: '',
      upload: { status: UPLOAD_STATUS.LOCAL, progress: 0, mediaId: null, error: null },
    });
  });

  it('has no preview URL unless one is given', () => {
    expect(image('m1').previewUrl).toBeNull();
  });
});

describe('composerReducer: captions', () => {
  it('sets the shared caption and bumps the revision', () => {
    const state = run([actions.setCaption('Hello')]);
    expect(state.caption).toBe('Hello');
    expect(state.revision).toBe(1);
  });

  it('stores missing caption values as empty strings', () => {
    expect(run([actions.setCaption(null)]).caption).toBe('');
    expect(run([actions.setCaption(undefined)]).caption).toBe('');
    expect(run([actions.setFirstComment(null)]).firstComment).toBe('');
  });

  it('customizes a platform by copying the shared caption once', () => {
    const state = run([actions.setCaption('Shared'), actions.customizePlatformCaption(IG)]);
    expect(state.platformCaptions).toEqual({ [FB]: null, [IG]: 'Shared' });
    expect(state.revision).toBe(2);
    expect(isPlatformCustomized(state, IG)).toBe(true);
    expect(isPlatformCustomized(state, FB)).toBe(false);

    // Customizing again keeps the edited text (no-op, same object).
    const edited = composerReducer(state, actions.setPlatformCaption(IG, 'IG only'));
    expect(composerReducer(edited, actions.customizePlatformCaption(IG))).toBe(edited);
  });

  it('keeps a customized caption when the shared caption changes', () => {
    const state = run([
      actions.setCaption('Shared'),
      actions.customizePlatformCaption(IG),
      actions.setPlatformCaption(IG, 'IG version'),
      actions.setCaption('New shared text'),
    ]);
    expect(captionForPlatform(state, FB)).toBe('New shared text');
    expect(captionForPlatform(state, IG)).toBe('IG version');
  });

  it('can set a platform caption directly and coerces missing values to ""', () => {
    expect(run([actions.setPlatformCaption(FB, 'FB text')]).platformCaptions[FB]).toBe('FB text');
    expect(run([actions.setPlatformCaption(FB, null)]).platformCaptions[FB]).toBe('');
  });

  it('resets a platform to the shared caption', () => {
    const state = run([
      actions.setPlatformCaption(IG, 'IG text'),
      actions.resetPlatformCaption(IG),
    ]);
    expect(state.platformCaptions[IG]).toBeNull();
    expect(state.revision).toBe(2);
    // Resetting a platform that is not customized changes nothing.
    expect(composerReducer(state, actions.resetPlatformCaption(IG))).toBe(state);
  });

  it('ignores platforms the composer does not support', () => {
    const state = composer({ caption: 'x' });
    expect(composerReducer(state, actions.customizePlatformCaption('TIKTOK'))).toBe(state);
    expect(composerReducer(state, actions.setPlatformCaption('TIKTOK', 'y'))).toBe(state);
    expect(composerReducer(state, actions.resetPlatformCaption('TIKTOK'))).toBe(state);
  });
});

describe('captionForPlatform / isPlatformCustomized', () => {
  it('uses the shared caption unless the platform is customized', () => {
    const state = composer({ caption: 'Shared', platformCaptions: { [FB]: null, [IG]: 'IG' } });
    expect(captionForPlatform(state, FB)).toBe('Shared');
    expect(captionForPlatform(state, IG)).toBe('IG');
  });

  it('treats an empty customized caption as customized (it does not fall back)', () => {
    const state = composer({ caption: 'Shared', platformCaptions: { [FB]: null, [IG]: '' } });
    expect(captionForPlatform(state, IG)).toBe('');
    expect(isPlatformCustomized(state, IG)).toBe(true);
  });

  it('treats a missing entry as not customized', () => {
    const state = composer({ caption: 'Shared', platformCaptions: { [FB]: null } });
    expect(isPlatformCustomized(state, IG)).toBe(false);
    expect(captionForPlatform(state, IG)).toBe('Shared');
  });
});

describe('composerReducer: hashtags and keywords', () => {
  it('adds hashtags in order, skipping case-insensitive duplicates', () => {
    const state = run([
      actions.addHashtags(['Summer', 'sale']),
      actions.addHashtags(['SALE', 'new']),
    ]);
    expect(state.hashtags).toEqual(['Summer', 'sale', 'new']);
    expect(state.revision).toBe(2);
  });

  it('returns the same state when no hashtag is new', () => {
    const state = composer({ hashtags: ['summer'] });
    expect(composerReducer(state, actions.addHashtags(['SUMMER']))).toBe(state);
    expect(composerReducer(state, actions.addHashtags([]))).toBe(state);
    expect(composerReducer(state, actions.addHashtags(undefined))).toBe(state);
  });

  it(`caps hashtags at ${TEXT_LIMITS.HASHTAGS_MAX}`, () => {
    const many = Array.from({ length: TEXT_LIMITS.HASHTAGS_MAX + 5 }, (_, i) => `tag${i}`);
    const state = run([actions.addHashtags(many)]);
    expect(state.hashtags).toHaveLength(TEXT_LIMITS.HASHTAGS_MAX);
    expect(state.hashtags.at(-1)).toBe(`tag${TEXT_LIMITS.HASHTAGS_MAX - 1}`);
    expect(composerReducer(state, actions.addHashtags(['extra']))).toBe(state);
  });

  it('removes a hashtag ignoring case, and ignores unknown ones', () => {
    const state = run([actions.addHashtags(['Summer', 'sale']), actions.removeHashtag('summer')]);
    expect(state.hashtags).toEqual(['sale']);
    expect(composerReducer(state, actions.removeHashtag('winter'))).toBe(state);
  });

  it('clears all hashtags', () => {
    const state = run([actions.addHashtags(['a', 'b']), actions.clearHashtags()]);
    expect(state.hashtags).toEqual([]);
    expect(state.revision).toBe(2);
    expect(composerReducer(state, actions.clearHashtags())).toBe(state);
  });

  it('switches the hashtag placement and rejects unknown placements', () => {
    const state = run([actions.setHashtagPlacement(HASHTAG_PLACEMENTS.FIRST_COMMENT)]);
    expect(state.hashtagPlacement).toBe(HASHTAG_PLACEMENTS.FIRST_COMMENT);
    expect(state.revision).toBe(1);
    expect(composerReducer(state, actions.setHashtagPlacement('FIRST_COMMENT'))).toBe(state);
    expect(composerReducer(state, actions.setHashtagPlacement('BIO'))).toBe(state);
  });

  it(`adds keyword phrases up to ${TEXT_LIMITS.KEYWORDS_MAX} and removes them ignoring case`, () => {
    let state = run([actions.addKeywords(['local seo', 'Coffee Shop', 'LOCAL SEO'])]);
    expect(state.keywords).toEqual(['local seo', 'Coffee Shop']);

    state = composerReducer(state, actions.removeKeyword('coffee shop'));
    expect(state.keywords).toEqual(['local seo']);
    expect(composerReducer(state, actions.removeKeyword('missing'))).toBe(state);

    const many = Array.from({ length: TEXT_LIMITS.KEYWORDS_MAX + 3 }, (_, i) => `phrase ${i}`);
    expect(run([actions.addKeywords(many)]).keywords).toHaveLength(TEXT_LIMITS.KEYWORDS_MAX);
    expect(composerReducer(state, actions.addKeywords(undefined))).toBe(state);
  });

  it('sets the first comment', () => {
    const state = run([actions.setFirstComment('Link in bio')]);
    expect(state.firstComment).toBe('Link in bio');
    expect(state.revision).toBe(1);
  });
});

describe('composerReducer: media', () => {
  it('appends media items and bumps the revision once per batch', () => {
    const state = run([
      actions.addMedia([image('m1'), image('m2')]),
      actions.addMedia([image('m3')]),
    ]);
    expect(ids(state)).toEqual(['m1', 'm2', 'm3']);
    expect(state.revision).toBe(2);
  });

  it('ignores items without an id and ids that are already attached', () => {
    const state = run([actions.addMedia([image('m1')])]);
    const next = composerReducer(state, actions.addMedia([image('m1'), { kind: 'IMAGE' }, null]));
    expect(next).toBe(state);
    expect(composerReducer(state, actions.addMedia([]))).toBe(state);
    expect(composerReducer(state, actions.addMedia(undefined))).toBe(state);
  });

  it(`never holds more than ${MEDIA_MAX_ITEMS} items`, () => {
    const batch = Array.from({ length: MEDIA_MAX_ITEMS + 2 }, (_, i) => image(`m${i}`));
    const state = run([actions.addMedia(batch)]);
    expect(state.media).toHaveLength(MEDIA_MAX_ITEMS);
    expect(state.media.at(-1).id).toBe(`m${MEDIA_MAX_ITEMS - 1}`);
    expect(composerReducer(state, actions.addMedia([image('late')]))).toBe(state);
  });

  // BUG: model/composerState.js:225 — ADD_MEDIA only skips ids already in `state.media`, not
  // ids repeated inside the same batch, so both copies are added (duplicate React keys;
  // removeMedia/updateMedia then hit both). Fix: add each accepted id to `known` as it is kept.
  it('adds each media id once even when a batch repeats it', () => {
    const state = run([actions.addMedia([image('m1'), image('m1', { fileName: 'copy.jpg' })])]);
    expect(ids(state)).toEqual(['m1']);
  });

  it('merges a patch into one item, merging upload fields and keeping the id', () => {
    const state = run([
      actions.addMedia([image('m1'), image('m2')]),
      actions.updateMedia('m1', {
        id: 'hijacked',
        width: 1080,
        height: 1350,
        inspection: INSPECTION_STATUS.DONE,
        upload: { status: UPLOAD_STATUS.UPLOADING },
      }),
    ]);
    expect(state.media[0]).toMatchObject({
      id: 'm1',
      width: 1080,
      height: 1350,
      inspection: INSPECTION_STATUS.DONE,
      upload: { status: UPLOAD_STATUS.UPLOADING, progress: 0, mediaId: null, error: null },
    });
    expect(state.media[1]).toEqual(image('m2'));
    expect(state.revision).toBe(2);
  });

  it('keeps the upload object when the patch has none', () => {
    const state = run([actions.addMedia([image('m1')]), actions.updateMedia('m1', { width: 10 })]);
    expect(state.media[0].upload).toEqual(image('m1').upload);
  });

  it('ignores updates for unknown media', () => {
    const state = run([actions.addMedia([image('m1')])]);
    expect(composerReducer(state, actions.updateMedia('nope', { width: 1 }))).toBe(state);
    expect(composerReducer(state, actions.mediaUploadProgress('nope', 0.5))).toBe(state);
    expect(composerReducer(state, actions.removeMedia('nope'))).toBe(state);
    expect(composerReducer(state, actions.moveMedia('nope', 0))).toBe(state);
    expect(composerReducer(state, actions.setMediaAltText('nope', 'x'))).toBe(state);
  });

  it('records upload progress without counting it as a content change', () => {
    const state = run([
      actions.addMedia([image('m1')]),
      actions.updateMedia('m1', { upload: { status: UPLOAD_STATUS.UPLOADING } }),
    ]);
    const next = composerReducer(state, actions.mediaUploadProgress('m1', 0.42));
    expect(next.media[0].upload).toEqual({
      status: UPLOAD_STATUS.UPLOADING,
      progress: 0.42,
      mediaId: null,
      error: null,
    });
    expect(next.revision).toBe(state.revision);
  });

  it.each([
    [1.7, 1],
    [-0.3, 0],
    [Number.NaN, 0],
    [undefined, 0],
    ['0.25', 0.25],
    [Number.POSITIVE_INFINITY, 1],
  ])('clamps upload progress %j to %j', (progress, expected) => {
    const state = run([
      actions.addMedia([image('m1')]),
      actions.mediaUploadProgress('m1', progress),
    ]);
    expect(state.media[0].upload.progress).toBe(expected);
  });

  it('removes one item', () => {
    const state = run([actions.addMedia([image('m1'), image('m2')]), actions.removeMedia('m1')]);
    expect(ids(state)).toEqual(['m2']);
    expect(state.revision).toBe(2);
  });

  describe('moveMedia', () => {
    const start = () => run([actions.addMedia(['a', 'b', 'c', 'd'].map((id) => image(id)))]);

    it('moves an item later or earlier', () => {
      expect(ids(composerReducer(start(), actions.moveMedia('a', 2)))).toEqual([
        'b',
        'c',
        'a',
        'd',
      ]);
      expect(ids(composerReducer(start(), actions.moveMedia('d', 0)))).toEqual([
        'd',
        'a',
        'b',
        'c',
      ]);
    });

    it('clamps targets beyond either end and truncates fractional indexes', () => {
      expect(ids(composerReducer(start(), actions.moveMedia('b', 99)))).toEqual([
        'a',
        'c',
        'd',
        'b',
      ]);
      expect(ids(composerReducer(start(), actions.moveMedia('c', -5)))).toEqual([
        'c',
        'a',
        'b',
        'd',
      ]);
      expect(ids(composerReducer(start(), actions.moveMedia('a', 1.9)))).toEqual([
        'b',
        'a',
        'c',
        'd',
      ]);
    });

    it('bumps the revision only when the order changes', () => {
      const state = start();
      expect(composerReducer(state, actions.moveMedia('b', 2)).revision).toBe(state.revision + 1);
      expect(composerReducer(state, actions.moveMedia('b', 1))).toBe(state);
      expect(composerReducer(state, actions.moveMedia('a', -1))).toBe(state);
      expect(composerReducer(state, actions.moveMedia('b', Number.NaN))).toBe(state);
      expect(composerReducer(state, actions.moveMedia('b', undefined))).toBe(state);
    });
  });

  it('sets alt text and caps it at ALT_TEXT_MAX', () => {
    let state = run([actions.addMedia([image('m1')]), actions.setMediaAltText('m1', 'A red bike')]);
    expect(state.media[0].altText).toBe('A red bike');
    expect(state.revision).toBe(2);

    state = composerReducer(state, actions.setMediaAltText('m1', 'x'.repeat(ALT_TEXT_MAX + 50)));
    expect(state.media[0].altText).toBe('x'.repeat(ALT_TEXT_MAX));

    state = composerReducer(state, actions.setMediaAltText('m1', null));
    expect(state.media[0].altText).toBe('');
  });

  // BUG: model/composerState.js:266 — the alt text cap uses String#slice (UTF-16 units), unlike
  // countChars (code points) used everywhere else. Over-long text can be cut inside an emoji,
  // leaving a lone surrogate (invalid Unicode sent to the API), and 1,000 emoji are cut to 500.
  // Fix: `[...value].slice(0, ALT_TEXT_MAX).join('')`.
  it('caps alt text in code points without splitting an emoji', () => {
    const state = run([
      actions.addMedia([image('m1')]),
      actions.setMediaAltText('m1', `a${'😀'.repeat(ALT_TEXT_MAX)}`),
    ]);
    const { altText } = state.media[0];
    expect(altText.isWellFormed()).toBe(true);
    expect(countChars(altText)).toBe(ALT_TEXT_MAX);
  });
});

describe('composerReducer: account selection', () => {
  it('toggles an account on and off', () => {
    const on = run([actions.toggleAccount('acc-1'), actions.toggleAccount('acc-2')]);
    expect(on.selectedAccountIds).toEqual(['acc-1', 'acc-2']);
    const off = composerReducer(on, actions.toggleAccount('acc-1'));
    expect(off.selectedAccountIds).toEqual(['acc-2']);
    expect(off.revision).toBe(3);
  });

  it('never stores empty or non-string ids', () => {
    expect(run([actions.toggleAccount(undefined)]).selectedAccountIds).toEqual([]);
    expect(run([actions.toggleAccount('')]).selectedAccountIds).toEqual([]);
    expect(run([actions.selectAccounts(['a', null, 7, '', 'b'])]).selectedAccountIds).toEqual([
      'a',
      'b',
    ]);
    expect(run([actions.setSelectedAccounts([null, 'a', 'a', 3])]).selectedAccountIds).toEqual([
      'a',
    ]);
  });

  it('selects several accounts, keeping order and skipping ones already selected', () => {
    const state = run([
      actions.selectAccounts(['a', 'b']),
      actions.selectAccounts(['b', 'c', 'a']),
    ]);
    expect(state.selectedAccountIds).toEqual(['a', 'b', 'c']);
    expect(composerReducer(state, actions.selectAccounts(['c']))).toBe(state);
    expect(composerReducer(state, actions.selectAccounts(undefined))).toBe(state);
  });

  it('deselects several accounts', () => {
    const state = run([
      actions.selectAccounts(['a', 'b', 'c']),
      actions.deselectAccounts(['a', 'c']),
    ]);
    expect(state.selectedAccountIds).toEqual(['b']);
    expect(composerReducer(state, actions.deselectAccounts(['zzz']))).toBe(state);
    expect(composerReducer(state, actions.deselectAccounts(undefined))).toBe(state);
  });

  it('replaces the selection (presets) with unique ids', () => {
    const state = run([
      actions.selectAccounts(['a', 'b']),
      actions.setSelectedAccounts(['c', 'a', 'c']),
    ]);
    expect(state.selectedAccountIds).toEqual(['c', 'a']);
    expect(run([actions.setSelectedAccounts(undefined)]).selectedAccountIds).toEqual([]);
  });
});

describe('composerReducer: load, reset and unknown actions', () => {
  it('loads a saved state as unchanged (revision 0), filling missing fields', () => {
    const edited = run([actions.setCaption('Old'), actions.addHashtags(['old'])]);
    const loaded = composerReducer(
      edited,
      actions.load({
        caption: 'Restored',
        platformCaptions: { [IG]: 'IG restored' },
        selectedAccountIds: ['acc-1'],
        revision: 12,
      }),
    );
    expect(loaded).toEqual({
      ...createInitialComposerState(),
      caption: 'Restored',
      platformCaptions: { [FB]: null, [IG]: 'IG restored' },
      selectedAccountIds: ['acc-1'],
      revision: 0,
    });
  });

  it('loads an empty composer when no state is given', () => {
    expect(composerReducer(composer({ caption: 'x', revision: 4 }), actions.load())).toEqual(
      createInitialComposerState(),
    );
  });

  it('resets everything', () => {
    const state = run([
      actions.setCaption('x'),
      actions.addMedia([image('m1')]),
      actions.selectAccounts(['a']),
    ]);
    expect(composerReducer(state, actions.reset())).toEqual(createInitialComposerState());
  });

  it('returns the same state for unknown actions', () => {
    const state = composer({ caption: 'x' });
    expect(composerReducer(state, { type: 'something/else' })).toBe(state);
  });

  it('never mutates the previous state', () => {
    const before = run([actions.addMedia([image('m1'), image('m2')]), actions.addHashtags(['a'])]);
    const snapshot = structuredClone(before);
    run(
      [
        actions.setCaption('changed'),
        actions.customizePlatformCaption(IG),
        actions.addHashtags(['b']),
        actions.updateMedia('m1', { upload: { progress: 0.5 } }),
        actions.mediaUploadProgress('m2', 0.3),
        actions.moveMedia('m2', 0),
        actions.setMediaAltText('m1', 'alt'),
        actions.toggleAccount('a'),
      ],
      before,
    );
    expect(before).toEqual(snapshot);
  });
});

describe('hasContent', () => {
  it('is false for an empty composer and for whitespace-only text', () => {
    expect(hasContent(createInitialComposerState())).toBe(false);
    expect(
      hasContent(
        composer({
          caption: '  \n',
          firstComment: '\t',
          platformCaptions: { [FB]: '   ', [IG]: '' },
        }),
      ),
    ).toBe(false);
  });

  it('does not count settings such as the hashtag placement as content', () => {
    expect(hasContent(composer({ hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT }))).toBe(
      false,
    );
  });

  it.each([
    ['a caption', { caption: 'Hi' }],
    ['a customized caption', { platformCaptions: { [FB]: null, [IG]: 'IG' } }],
    ['hashtags', { hashtags: ['summer'] }],
    ['keywords', { keywords: ['local seo'] }],
    ['a first comment', { firstComment: 'Link in bio' }],
    ['media', { media: [image('m1')] }],
    ['selected accounts', { selectedAccountIds: ['acc-1'] }],
  ])('is true with %s', (_label, patch) => {
    expect(hasContent(composer(patch))).toBe(true);
  });
});

describe('createClientId', () => {
  it('prefixes ids and never repeats them', () => {
    const generated = Array.from({ length: 50 }, () => createClientId('media'));
    expect(new Set(generated).size).toBe(50);
    for (const id of generated) expect(id).toMatch(/^media_.+/);
    expect(createClientId()).toMatch(/^id_.+/);
  });

  it('falls back to a time-based id when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const generated = Array.from({ length: 50 }, () => createClientId('preset'));
    expect(new Set(generated).size).toBe(50);
    for (const id of generated) expect(id).toMatch(/^preset_[0-9a-z]+$/);
  });

  it('falls back when randomUUID throws (insecure context)', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('randomUUID needs a secure context');
      },
    });
    expect(createClientId('media')).toMatch(/^media_[0-9a-z]+$/);
  });
});
