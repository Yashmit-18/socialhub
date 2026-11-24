import {
  ALT_TEXT_MAX,
  COMPOSER_PLATFORMS,
  INSPECTION_STATUS,
  MEDIA_KINDS,
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  createInitialComposerState,
  createMediaItem,
} from './composerState.js';
import { resolveApiLink } from '../../../lib/api.js';
import { HASHTAG_PLACEMENTS, TEXT_LIMITS, mergeUnique } from './text.js';

/**
 * Mapping between composer state and:
 *   - the device draft (services/localStore.js), and
 *   - the ContentPackageInput / ContentPackage contract (docs/COMPOSER_API_CONTRACT.md §4).
 *
 * Deserializers treat their input as untrusted: lists are de-duplicated and capped like the
 * reducer would, and server media keep the status the server reported (never "uploaded" unless
 * the media API said READY).
 */

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
const text = (value) => (typeof value === 'string' ? value : '');
const uniqueStrings = (value) => [...new Set(strings(value).filter(Boolean))];
const capCodePoints = (value, max) => [...text(value)].slice(0, max).join('');

function platformCaptionsOf(value) {
  const out = {};
  for (const platform of COMPOSER_PLATFORMS) {
    out[platform] = typeof value?.[platform] === 'string' ? value[platform] : null;
  }
  return out;
}

const placementOf = (value) =>
  Object.values(HASHTAG_PLACEMENTS).includes(value) ? value : HASHTAG_PLACEMENTS.CAPTION;

const hashtagsOf = (value) =>
  mergeUnique(
    [],
    strings(value)
      .map((tag) => tag.replace(/^[#＃]+/u, '').trim())
      .filter(Boolean),
    TEXT_LIMITS.HASHTAGS_MAX,
  );

const keywordsOf = (value) =>
  mergeUnique(
    [],
    strings(value)
      .map((k) => k.trim())
      .filter(Boolean),
    TEXT_LIMITS.KEYWORDS_MAX,
  );

/* ------------------------------------------------------------ device drafts */

/**
 * What a device draft keeps: all text, selections and media *descriptions*. File contents
 * cannot be stored, so restored drafts list the files to add again.
 */
export function toLocalDraft(state) {
  return {
    caption: state.caption,
    platformCaptions: { ...state.platformCaptions },
    hashtags: [...state.hashtags],
    hashtagPlacement: state.hashtagPlacement,
    keywords: [...state.keywords],
    firstComment: state.firstComment,
    selectedAccountIds: [...state.selectedAccountIds],
    missingMedia: state.media.map((m) => ({
      fileName: m.fileName,
      kind: m.kind,
      altText: m.altText,
    })),
  };
}

/** Returns `{ state, missingMedia }` — state ready for `composerActions.load`. */
export function fromLocalDraft(data) {
  const base = createInitialComposerState();
  const missingMedia = Array.isArray(data?.missingMedia)
    ? data.missingMedia
        .filter((m) => m && typeof m.fileName === 'string')
        .slice(0, MEDIA_MAX_ITEMS)
        .map((m) => ({
          fileName: m.fileName,
          kind: Object.values(MEDIA_KINDS).includes(m.kind) ? m.kind : MEDIA_KINDS.IMAGE,
          altText: capCodePoints(m.altText, ALT_TEXT_MAX),
        }))
    : [];
  return {
    state: {
      ...base,
      caption: text(data?.caption),
      platformCaptions: platformCaptionsOf(data?.platformCaptions),
      hashtags: hashtagsOf(data?.hashtags),
      hashtagPlacement: placementOf(data?.hashtagPlacement),
      keywords: keywordsOf(data?.keywords),
      firstComment: text(data?.firstComment),
      selectedAccountIds: uniqueStrings(data?.selectedAccountIds),
    },
    missingMedia,
  };
}

/* ------------------------------------------------------- server drafts (§4) */

/** Media the server already stores (ready, or still processing) — a draft can reference them. */
const isStoredOnServer = (m) =>
  Boolean(m.upload.mediaId) &&
  (m.upload.status === UPLOAD_STATUS.UPLOADED || m.upload.status === UPLOAD_STATUS.PROCESSING);

/**
 * ContentPackageInput for create/update. Only media the media API already stores (with a
 * server `mediaId`) can be referenced; the rest is reported in `omittedMedia` so the UI can
 * say so instead of silently dropping files.
 *
 * `platformCaptions` lists only customized platforms: PATCH replaces the whole object, so a
 * platform that is absent uses the shared caption (contract §4.3).
 *
 * `availableAccountIds` (optional) is the list of accounts the person can use right now.
 * Selected accounts outside it are left out of `targetAccountIds`, exactly as the readiness
 * check says ("no longer available to you and will be left out"); the API would reject them.
 * Leave it out while the account list is unknown: nothing is filtered then.
 */
export function toContentPackageInput(state, { availableAccountIds = null } = {}) {
  const available = Array.isArray(availableAccountIds) ? new Set(availableAccountIds) : null;
  const platformCaptions = {};
  for (const platform of COMPOSER_PLATFORMS) {
    if (typeof state.platformCaptions[platform] === 'string') {
      platformCaptions[platform] = state.platformCaptions[platform];
    }
  }
  const uploaded = state.media.filter(isStoredOnServer);
  const omittedMedia = state.media.filter((m) => !uploaded.includes(m));
  return {
    input: {
      caption: state.caption,
      platformCaptions,
      hashtags: [...state.hashtags],
      hashtagPlacement: state.hashtagPlacement,
      keywords: [...state.keywords],
      firstComment: state.firstComment,
      media: uploaded.map((m) => ({ mediaId: m.upload.mediaId, altText: m.altText })),
      targetAccountIds: available
        ? state.selectedAccountIds.filter((id) => available.has(id))
        : [...state.selectedAccountIds],
    },
    omittedMedia,
  };
}

/** Upload status for a server MediaAsset.status. Anything but READY is not "uploaded". */
function uploadStateOf(asset, mediaId) {
  switch (asset?.status) {
    case 'READY':
      return { status: UPLOAD_STATUS.UPLOADED, progress: 1, mediaId, error: null };
    case 'FAILED':
      return {
        status: UPLOAD_STATUS.FAILED,
        progress: 0,
        mediaId: null,
        error: text(asset.failureReason) || 'SocialHub couldn’t process this file.',
      };
    default:
      // PENDING_UPLOAD, PROCESSING, or a missing/unknown status: stored by the server but not
      // ready yet. The id is kept so re-saving the draft keeps referencing the file.
      return { status: UPLOAD_STATUS.PROCESSING, progress: 1, mediaId, error: null };
  }
}

/**
 * Composer state from a ContentPackage returned by the API (media come back as server assets).
 * Videos keep their playable `url` as `previewUrl` and the still frame as `posterUrl`.
 */
export function fromContentPackage(contentPackage) {
  const base = createInitialComposerState();
  const seen = new Set();
  const media = (Array.isArray(contentPackage?.media) ? contentPackage.media : [])
    .filter((entry) => {
      if (!entry?.mediaId || seen.has(entry.mediaId)) return false;
      seen.add(entry.mediaId);
      return true;
    })
    .slice(0, MEDIA_MAX_ITEMS)
    .map((entry) => {
      const asset = entry.media ?? {};
      const kind = asset.kind === MEDIA_KINDS.VIDEO ? MEDIA_KINDS.VIDEO : MEDIA_KINDS.IMAGE;
      const isVideo = kind === MEDIA_KINDS.VIDEO;
      return {
        ...createMediaItem({
          id: `remote_${entry.mediaId}`,
          kind,
          fileName: text(asset.fileName) || (isVideo ? 'Video' : 'Image'),
          mimeType: text(asset.mimeType),
          sizeBytes: Number.isFinite(asset.sizeBytes) ? asset.sizeBytes : 0,
          previewUrl:
            resolveApiLink(isVideo ? asset.url : (asset.thumbnailUrl ?? asset.url)) ?? null,
        }),
        posterUrl: isVideo ? (resolveApiLink(asset.thumbnailUrl) ?? null) : null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationSec: asset.durationSec ?? null,
        inspection: asset.width && asset.height ? INSPECTION_STATUS.DONE : INSPECTION_STATUS.FAILED,
        altText: capCodePoints(entry.altText, ALT_TEXT_MAX),
        upload: uploadStateOf(asset, entry.mediaId),
      };
    });
  return {
    ...base,
    caption: text(contentPackage?.caption),
    platformCaptions: platformCaptionsOf(contentPackage?.platformCaptions),
    hashtags: hashtagsOf(contentPackage?.hashtags),
    hashtagPlacement: placementOf(contentPackage?.hashtagPlacement),
    keywords: keywordsOf(contentPackage?.keywords),
    firstComment: text(contentPackage?.firstComment),
    media,
    selectedAccountIds: uniqueStrings(contentPackage?.targetAccountIds),
  };
}
