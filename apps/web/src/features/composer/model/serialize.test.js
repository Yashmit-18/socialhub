import { describe, expect, it } from 'vitest';
import {
  INSPECTION_STATUS,
  MEDIA_KINDS,
  UPLOAD_STATUS,
  composerActions,
  composerReducer,
  createInitialComposerState,
  createMediaItem,
} from './composerState.js';
import { HASHTAG_PLACEMENTS } from './text.js';
import {
  fromContentPackage,
  fromLocalDraft,
  toContentPackageInput,
  toLocalDraft,
} from './serialize.js';

const FB = 'FACEBOOK_PAGE';
const IG = 'INSTAGRAM_ACCOUNT';

const media = (id, kind, upload = {}, patch = {}) => ({
  ...createMediaItem({
    id,
    kind,
    fileName: `${id}.${kind === MEDIA_KINDS.VIDEO ? 'mp4' : 'jpg'}`,
    mimeType: kind === MEDIA_KINDS.VIDEO ? 'video/mp4' : 'image/jpeg',
    sizeBytes: 2048,
    previewUrl: `blob:mock/${id}`,
  }),
  width: 1080,
  height: 1350,
  inspection: INSPECTION_STATUS.DONE,
  ...patch,
  upload: { status: UPLOAD_STATUS.LOCAL, progress: 0, mediaId: null, error: null, ...upload },
});

const uploaded = (id, mediaId, patch) =>
  media(id, MEDIA_KINDS.IMAGE, { status: UPLOAD_STATUS.UPLOADED, progress: 1, mediaId }, patch);

/** A composer state that uses every field. */
function fullState() {
  return {
    ...createInitialComposerState(),
    caption: 'Summer sale!',
    platformCaptions: { [FB]: null, [IG]: 'Summer sale on Instagram' },
    hashtags: ['summer', 'sale'],
    hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    keywords: ['summer sale', 'discounts'],
    firstComment: 'Link in bio',
    selectedAccountIds: ['acc-fb-1', 'acc-ig-1'],
    media: [
      uploaded('m1', 'med_1', { altText: 'Beach at sunset' }),
      media('m2', MEDIA_KINDS.VIDEO),
    ],
    revision: 7,
  };
}

/** A content package as the API returns it (docs/COMPOSER_API_CONTRACT.md §4). */
function contentPackage(patch = {}) {
  return {
    id: 'cp_1',
    status: 'DRAFT',
    version: 3,
    caption: 'Summer sale!',
    platformCaptions: { [IG]: 'Instagram version' },
    hashtags: ['summer'],
    hashtagPlacement: HASHTAG_PLACEMENTS.CAPTION,
    keywords: ['summer sale'],
    firstComment: 'Link in bio',
    targetAccountIds: ['acc-fb-1', 'acc-ig-1'],
    media: [
      {
        mediaId: 'med_1',
        altText: 'Beach',
        media: {
          id: 'med_1',
          kind: 'IMAGE',
          mimeType: 'image/jpeg',
          sizeBytes: 123_456,
          width: 1080,
          height: 1350,
          durationSec: null,
          status: 'READY',
          url: 'https://cdn.example/med_1.jpg',
          thumbnailUrl: 'https://cdn.example/med_1_thumb.jpg',
          failureReason: null,
        },
      },
      {
        mediaId: 'med_2',
        altText: '',
        media: {
          id: 'med_2',
          kind: 'VIDEO',
          mimeType: 'video/mp4',
          sizeBytes: 9_000_000,
          width: 1080,
          height: 1920,
          durationSec: 12.5,
          status: 'READY',
          url: 'https://cdn.example/med_2.mp4',
          thumbnailUrl: null,
          failureReason: null,
        },
      },
    ],
    createdBy: { id: 'u1', name: 'Ada Lovelace' },
    updatedBy: { id: 'u1', name: 'Ada Lovelace' },
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T11:00:00.000Z',
    ...patch,
  };
}

describe('toLocalDraft', () => {
  it('keeps all text and selections, and describes media without their contents', () => {
    expect(toLocalDraft(fullState())).toEqual({
      caption: 'Summer sale!',
      platformCaptions: { [FB]: null, [IG]: 'Summer sale on Instagram' },
      hashtags: ['summer', 'sale'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
      keywords: ['summer sale', 'discounts'],
      firstComment: 'Link in bio',
      selectedAccountIds: ['acc-fb-1', 'acc-ig-1'],
      missingMedia: [
        { fileName: 'm1.jpg', kind: MEDIA_KINDS.IMAGE, altText: 'Beach at sunset' },
        { fileName: 'm2.mp4', kind: MEDIA_KINDS.VIDEO, altText: '' },
      ],
    });
  });

  it('never stores object URLs, upload state or the revision', () => {
    const json = JSON.stringify(toLocalDraft(fullState()));
    expect(json).not.toContain('blob:');
    expect(json).not.toContain('med_1');
    expect(json).not.toContain('revision');
  });

  it('copies arrays and objects so later edits do not leak into the saved draft', () => {
    const state = fullState();
    const draft = toLocalDraft(state);
    expect(draft.hashtags).not.toBe(state.hashtags);
    expect(draft.keywords).not.toBe(state.keywords);
    expect(draft.selectedAccountIds).not.toBe(state.selectedAccountIds);
    expect(draft.platformCaptions).not.toBe(state.platformCaptions);
  });

  it('survives a JSON round trip unchanged', () => {
    const draft = toLocalDraft(fullState());
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });
});

describe('fromLocalDraft', () => {
  it('restores everything except the files, and lists the files to add again', () => {
    const state = fullState();
    const restored = fromLocalDraft(JSON.parse(JSON.stringify(toLocalDraft(state))));
    expect(restored.state).toEqual({ ...state, media: [], revision: 0 });
    expect(restored.missingMedia).toEqual([
      { fileName: 'm1.jpg', kind: MEDIA_KINDS.IMAGE, altText: 'Beach at sunset' },
      { fileName: 'm2.mp4', kind: MEDIA_KINDS.VIDEO, altText: '' },
    ]);
  });

  it('produces a state the reducer loads as unchanged', () => {
    const { state } = fromLocalDraft(toLocalDraft(fullState()));
    const loaded = composerReducer(
      composerReducer(createInitialComposerState(), composerActions.setCaption('old')),
      composerActions.load(state),
    );
    expect(loaded).toEqual(state);
    expect(loaded.revision).toBe(0);
  });

  it('replaces malformed values with safe defaults', () => {
    const { state, missingMedia } = fromLocalDraft({
      caption: 42,
      platformCaptions: { [FB]: 7, [IG]: 'IG text', TIKTOK: 'ignored' },
      hashtags: ['ok', 3, null, 'fine'],
      hashtagPlacement: 'SIDEWAYS',
      keywords: 'not-an-array',
      firstComment: { text: 'nope' },
      selectedAccountIds: ['acc-1', 2, undefined],
      missingMedia: [
        { fileName: 'kept.mov', kind: MEDIA_KINDS.VIDEO, altText: 5 },
        { fileName: 'odd-kind.png', kind: 'AUDIO' },
        { kind: MEDIA_KINDS.IMAGE },
        null,
        'loose string',
      ],
    });
    expect(state).toEqual({
      ...createInitialComposerState(),
      platformCaptions: { [FB]: null, [IG]: 'IG text' },
      hashtags: ['ok', 'fine'],
      selectedAccountIds: ['acc-1'],
    });
    expect(missingMedia).toEqual([
      { fileName: 'kept.mov', kind: MEDIA_KINDS.VIDEO, altText: '' },
      { fileName: 'odd-kind.png', kind: MEDIA_KINDS.IMAGE, altText: '' },
    ]);
  });

  it.each([null, undefined, 'text', 42, []])('returns an empty composer for %j', (data) => {
    expect(fromLocalDraft(data)).toEqual({
      state: createInitialComposerState(),
      missingMedia: [],
    });
  });
});

describe('toContentPackageInput', () => {
  it('maps the composer to ContentPackageInput, including internal keywords', () => {
    const { input } = toContentPackageInput(fullState());
    expect(input).toEqual({
      caption: 'Summer sale!',
      platformCaptions: { [IG]: 'Summer sale on Instagram' },
      hashtags: ['summer', 'sale'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
      keywords: ['summer sale', 'discounts'],
      firstComment: 'Link in bio',
      media: [{ mediaId: 'med_1', altText: 'Beach at sunset' }],
      targetAccountIds: ['acc-fb-1', 'acc-ig-1'],
    });
  });

  it('sends only customized platform captions, including an empty one', () => {
    const state = {
      ...createInitialComposerState(),
      platformCaptions: { [FB]: '', [IG]: null },
    };
    expect(toContentPackageInput(state).input.platformCaptions).toEqual({ [FB]: '' });
  });

  it('references only files the media API stores (ready or processing), in order, and reports the rest', () => {
    const local = media('local', MEDIA_KINDS.IMAGE);
    const uploading = media('uploading', MEDIA_KINDS.IMAGE, { status: UPLOAD_STATUS.UPLOADING });
    const processing = media('processing', MEDIA_KINDS.VIDEO, {
      status: UPLOAD_STATUS.PROCESSING,
      mediaId: 'med_p',
    });
    const failed = media('failed', MEDIA_KINDS.IMAGE, {
      status: UPLOAD_STATUS.FAILED,
      error: 'Storage answered 500',
    });
    const noServerId = media('no-id', MEDIA_KINDS.IMAGE, { status: UPLOAD_STATUS.UPLOADED });
    const first = uploaded('first', 'med_a', { altText: 'First' });
    const second = uploaded('second', 'med_b');

    const { input, omittedMedia } = toContentPackageInput({
      ...createInitialComposerState(),
      media: [local, first, uploading, processing, second, failed, noServerId],
    });
    // A server file still processing keeps its place: dropping it on re-save would lose it.
    expect(input.media).toEqual([
      { mediaId: 'med_a', altText: 'First' },
      { mediaId: 'med_p', altText: '' },
      { mediaId: 'med_b', altText: '' },
    ]);
    expect(omittedMedia.map((m) => m.id)).toEqual(['local', 'uploading', 'failed', 'no-id']);
  });

  it('reports nothing omitted when every file is stored', () => {
    const { omittedMedia } = toContentPackageInput({
      ...createInitialComposerState(),
      media: [uploaded('m1', 'med_1')],
    });
    expect(omittedMedia).toEqual([]);
  });

  it('copies arrays so the request body cannot change with the composer', () => {
    const state = fullState();
    const { input } = toContentPackageInput(state);
    expect(input.hashtags).not.toBe(state.hashtags);
    expect(input.keywords).not.toBe(state.keywords);
    expect(input.targetAccountIds).not.toBe(state.selectedAccountIds);
  });
});

describe('fromContentPackage', () => {
  it('maps a content package to composer state', () => {
    const state = fromContentPackage(contentPackage());
    expect(state).toMatchObject({
      caption: 'Summer sale!',
      platformCaptions: { [FB]: null, [IG]: 'Instagram version' },
      hashtags: ['summer'],
      hashtagPlacement: HASHTAG_PLACEMENTS.CAPTION,
      keywords: ['summer sale'],
      firstComment: 'Link in bio',
      selectedAccountIds: ['acc-fb-1', 'acc-ig-1'],
      revision: 0,
    });
  });

  it('restores attached media as stored server files', () => {
    const [photo, clip] = fromContentPackage(contentPackage()).media;
    expect(photo).toEqual({
      id: 'remote_med_1',
      kind: MEDIA_KINDS.IMAGE,
      fileName: 'Image',
      mimeType: 'image/jpeg',
      sizeBytes: 123_456,
      previewUrl: 'https://cdn.example/med_1_thumb.jpg',
      posterUrl: null,
      width: 1080,
      height: 1350,
      durationSec: null,
      inspection: INSPECTION_STATUS.DONE,
      altText: 'Beach',
      upload: { status: UPLOAD_STATUS.UPLOADED, progress: 1, mediaId: 'med_1', error: null },
    });
    expect(clip).toMatchObject({
      id: 'remote_med_2',
      kind: MEDIA_KINDS.VIDEO,
      fileName: 'Video',
      previewUrl: 'https://cdn.example/med_2.mp4',
      durationSec: 12.5,
      upload: { mediaId: 'med_2' },
    });
  });

  it('plays server videos from their file URL and keeps the thumbnail as the poster', () => {
    const pkg = contentPackage();
    pkg.media[1].media.thumbnailUrl = 'https://cdn.example/med_2_poster.jpg';
    const clip = fromContentPackage(pkg).media[1];
    expect(clip.previewUrl).toBe('https://cdn.example/med_2.mp4');
    expect(clip.posterUrl).toBe('https://cdn.example/med_2_poster.jpg');
  });

  it('uses the server file name when one is sent', () => {
    const pkg = contentPackage();
    pkg.media[0].media.fileName = 'beach.jpg';
    expect(fromContentPackage(pkg).media[0].fileName).toBe('beach.jpg');
  });

  it('copes with assets missing details', () => {
    const [item] = fromContentPackage(
      contentPackage({ media: [{ mediaId: 'med_x', altText: 9 }] }),
    ).media;
    expect(item).toMatchObject({
      id: 'remote_med_x',
      kind: MEDIA_KINDS.IMAGE,
      fileName: 'Image',
      mimeType: '',
      sizeBytes: 0,
      previewUrl: null,
      width: null,
      height: null,
      inspection: INSPECTION_STATUS.FAILED,
      altText: '',
    });
  });

  it('skips media entries without a server media id', () => {
    const pkg = contentPackage();
    pkg.media.push({ altText: 'orphan' }, null);
    expect(fromContentPackage(pkg).media.map((m) => m.upload.mediaId)).toEqual(['med_1', 'med_2']);
  });

  it.each([null, undefined, {}, { caption: 5, media: 'nope', hashtagPlacement: 'X' }])(
    'returns an empty composer for %j',
    (pkg) => {
      expect(fromContentPackage(pkg)).toEqual(createInitialComposerState());
    },
  );

  it('round-trips with toContentPackageInput', () => {
    const pkg = contentPackage();
    const { input, omittedMedia } = toContentPackageInput(fromContentPackage(pkg));
    expect(omittedMedia).toEqual([]);
    expect(input).toEqual({
      caption: pkg.caption,
      platformCaptions: pkg.platformCaptions,
      hashtags: pkg.hashtags,
      hashtagPlacement: pkg.hashtagPlacement,
      keywords: pkg.keywords,
      firstComment: pkg.firstComment,
      media: pkg.media.map(({ mediaId, altText }) => ({ mediaId, altText })),
      targetAccountIds: pkg.targetAccountIds,
    });
  });

  // BUG: model/serialize.js:136-141 — every restored file is marked UPLOADED regardless of the
  // MediaAsset `status` the API returns (PROCESSING | READY | FAILED, contract §3), so a file
  // that failed processing on the server is shown as "Uploaded" and counted as ready. Map
  // READY → UPLOADED, PROCESSING → PROCESSING, FAILED → FAILED (error = failureReason).
  it('keeps the server status of files that are still processing or failed', () => {
    const pkg = contentPackage();
    pkg.media[0].media.status = 'PROCESSING';
    pkg.media[1].media.status = 'FAILED';
    pkg.media[1].media.failureReason = 'Unsupported video codec';
    const [processing, failed] = fromContentPackage(pkg).media;
    expect(processing.upload.status).toBe(UPLOAD_STATUS.PROCESSING);
    expect(failed.upload).toMatchObject({
      status: UPLOAD_STATUS.FAILED,
      error: 'Unsupported video codec',
    });
  });
});
