import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { HASHTAG_PLACEMENTS, TEXT_LIMITS, mergeUnique, removeItem } from './text.js';

/**
 * Composer state (pure reducer). It holds only serializable data: `File` objects live in
 * `useMediaManager`, keyed by media item id.
 *
 * `revision` increases on every content change. Autosave and the unsaved-changes guard
 * compare it with the revision that was last saved.
 */

/** Destinations the composer can target, in display order. */
export const COMPOSER_PLATFORMS = Object.freeze([
  SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
]);

export const MEDIA_KINDS = Object.freeze({ IMAGE: 'IMAGE', VIDEO: 'VIDEO' });

/** Whether the browser could read a file's dimensions / duration. */
export const INSPECTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  DONE: 'DONE',
  FAILED: 'FAILED',
});

/**
 * Where a media file is. LOCAL means it only exists in this browser tab (the upload API is
 * unavailable or the upload has not started); it is never described as uploaded.
 */
export const UPLOAD_STATUS = Object.freeze({
  LOCAL: 'LOCAL',
  UPLOADING: 'UPLOADING',
  PROCESSING: 'PROCESSING',
  UPLOADED: 'UPLOADED',
  FAILED: 'FAILED',
});

/**
 * Shape of one media item (metadata only):
 * {
 *   id, kind: MEDIA_KINDS, fileName, mimeType, sizeBytes,
 *   previewUrl: string | null,          // object URL owned by useMediaManager, or a server URL
 *   posterUrl: string | null,           // still frame for server videos (previewUrl plays)
 *   width, height, durationSec: number | null,
 *   inspection: INSPECTION_STATUS,
 *   altText: string,
 *   upload: { status: UPLOAD_STATUS, progress: 0..1, mediaId: string | null, error: string | null },
 * }
 */
export function createMediaItem({
  id,
  kind,
  fileName,
  mimeType,
  sizeBytes,
  previewUrl = null,
  posterUrl = null,
}) {
  return {
    id,
    kind,
    fileName,
    mimeType,
    sizeBytes,
    previewUrl,
    posterUrl,
    width: null,
    height: null,
    durationSec: null,
    inspection: INSPECTION_STATUS.PENDING,
    altText: '',
    upload: { status: UPLOAD_STATUS.LOCAL, progress: 0, mediaId: null, error: null },
  };
}

export const ALT_TEXT_MAX = 1000;

export function createInitialComposerState() {
  return {
    caption: '',
    /** `null` = use the shared caption; a string = customized for that platform. */
    platformCaptions: {
      [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: null,
      [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: null,
    },
    hashtags: [],
    hashtagPlacement: HASHTAG_PLACEMENTS.CAPTION,
    /** Internal SEO keywords: stored with the content, never published. */
    keywords: [],
    firstComment: '',
    media: [],
    selectedAccountIds: [],
    revision: 0,
  };
}

export const COMPOSER_ACTIONS = Object.freeze({
  SET_CAPTION: 'caption/set',
  CUSTOMIZE_PLATFORM_CAPTION: 'platformCaption/customize',
  SET_PLATFORM_CAPTION: 'platformCaption/set',
  RESET_PLATFORM_CAPTION: 'platformCaption/reset',
  ADD_HASHTAGS: 'hashtags/add',
  REMOVE_HASHTAG: 'hashtags/remove',
  CLEAR_HASHTAGS: 'hashtags/clear',
  SET_HASHTAG_PLACEMENT: 'hashtags/placement',
  ADD_KEYWORDS: 'keywords/add',
  REMOVE_KEYWORD: 'keywords/remove',
  SET_FIRST_COMMENT: 'firstComment/set',
  ADD_MEDIA: 'media/add',
  UPDATE_MEDIA: 'media/update',
  MEDIA_UPLOAD_PROGRESS: 'media/uploadProgress',
  REMOVE_MEDIA: 'media/remove',
  MOVE_MEDIA: 'media/move',
  SET_MEDIA_ALT_TEXT: 'media/altText',
  TOGGLE_ACCOUNT: 'accounts/toggle',
  SELECT_ACCOUNTS: 'accounts/select',
  DESELECT_ACCOUNTS: 'accounts/deselect',
  SET_SELECTED_ACCOUNTS: 'accounts/set',
  LOAD: 'composer/load',
  RESET: 'composer/reset',
});

const A = COMPOSER_ACTIONS;

/** Action creators — components dispatch these rather than hand-written objects. */
export const composerActions = Object.freeze({
  setCaption: (value) => ({ type: A.SET_CAPTION, value }),
  customizePlatformCaption: (platform) => ({ type: A.CUSTOMIZE_PLATFORM_CAPTION, platform }),
  setPlatformCaption: (platform, value) => ({ type: A.SET_PLATFORM_CAPTION, platform, value }),
  resetPlatformCaption: (platform) => ({ type: A.RESET_PLATFORM_CAPTION, platform }),
  addHashtags: (tags) => ({ type: A.ADD_HASHTAGS, tags }),
  removeHashtag: (tag) => ({ type: A.REMOVE_HASHTAG, tag }),
  clearHashtags: () => ({ type: A.CLEAR_HASHTAGS }),
  setHashtagPlacement: (placement) => ({ type: A.SET_HASHTAG_PLACEMENT, placement }),
  addKeywords: (keywords) => ({ type: A.ADD_KEYWORDS, keywords }),
  removeKeyword: (keyword) => ({ type: A.REMOVE_KEYWORD, keyword }),
  setFirstComment: (value) => ({ type: A.SET_FIRST_COMMENT, value }),
  addMedia: (items) => ({ type: A.ADD_MEDIA, items }),
  /** Merge `patch` into a media item. `patch.upload` is merged into `item.upload`. */
  updateMedia: (id, patch) => ({ type: A.UPDATE_MEDIA, id, patch }),
  /** Upload progress ticks do not count as content changes (no autosave per tick). */
  mediaUploadProgress: (id, progress) => ({ type: A.MEDIA_UPLOAD_PROGRESS, id, progress }),
  removeMedia: (id) => ({ type: A.REMOVE_MEDIA, id }),
  moveMedia: (id, toIndex) => ({ type: A.MOVE_MEDIA, id, toIndex }),
  setMediaAltText: (id, altText) => ({ type: A.SET_MEDIA_ALT_TEXT, id, altText }),
  toggleAccount: (id) => ({ type: A.TOGGLE_ACCOUNT, id }),
  selectAccounts: (ids) => ({ type: A.SELECT_ACCOUNTS, ids }),
  deselectAccounts: (ids) => ({ type: A.DESELECT_ACCOUNTS, ids }),
  setSelectedAccounts: (ids) => ({ type: A.SET_SELECTED_ACCOUNTS, ids }),
  /** Replace the content (restoring a draft). The loaded state counts as saved (revision 0). */
  load: (state) => ({ type: A.LOAD, state }),
  reset: () => ({ type: A.RESET }),
});

/** The media count cap across all platforms (per-platform limits are validation issues). */
export const MEDIA_MAX_ITEMS = 20;

const isPlatform = (platform) => COMPOSER_PLATFORMS.includes(platform);
const bump = (state, patch) => ({ ...state, ...patch, revision: state.revision + 1 });
const isId = (id) => typeof id === 'string' && id.length > 0;
const uniqueIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter(isId))];
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
/** Caps text at `max` code points, never splitting a surrogate pair (emoji). */
const capCodePoints = (value, max) => [...String(value ?? '')].slice(0, max).join('');

/** De-duplicates and caps lists in a state being loaded (drafts are untrusted input). */
function sanitizeLoaded(next) {
  const seenMedia = new Set();
  const media = (Array.isArray(next.media) ? next.media : [])
    .filter((m) => {
      if (!m?.id || seenMedia.has(m.id)) return false;
      seenMedia.add(m.id);
      return true;
    })
    .slice(0, MEDIA_MAX_ITEMS);
  return {
    hashtags: mergeUnique(
      [],
      Array.isArray(next.hashtags) ? next.hashtags : [],
      TEXT_LIMITS.HASHTAGS_MAX,
    ),
    keywords: mergeUnique(
      [],
      Array.isArray(next.keywords) ? next.keywords : [],
      TEXT_LIMITS.KEYWORDS_MAX,
    ),
    selectedAccountIds: uniqueIds(next.selectedAccountIds),
    media,
  };
}

function patchMedia(state, id, update) {
  let changed = false;
  const media = state.media.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return update(item);
  });
  return changed ? media : null;
}

export function composerReducer(state, action) {
  switch (action.type) {
    case A.SET_CAPTION: {
      const caption = String(action.value ?? '');
      return caption === state.caption ? state : bump(state, { caption });
    }

    case A.CUSTOMIZE_PLATFORM_CAPTION:
      if (!isPlatform(action.platform) || state.platformCaptions[action.platform] !== null)
        return state;
      return bump(state, {
        platformCaptions: { ...state.platformCaptions, [action.platform]: state.caption },
      });

    case A.SET_PLATFORM_CAPTION: {
      if (!isPlatform(action.platform)) return state;
      const value = String(action.value ?? '');
      if (state.platformCaptions[action.platform] === value) return state;
      return bump(state, {
        platformCaptions: { ...state.platformCaptions, [action.platform]: value },
      });
    }

    case A.RESET_PLATFORM_CAPTION:
      if (!isPlatform(action.platform) || state.platformCaptions[action.platform] === null)
        return state;
      return bump(state, {
        platformCaptions: { ...state.platformCaptions, [action.platform]: null },
      });

    case A.ADD_HASHTAGS: {
      const hashtags = mergeUnique(state.hashtags, action.tags ?? [], TEXT_LIMITS.HASHTAGS_MAX);
      return hashtags.length === state.hashtags.length ? state : bump(state, { hashtags });
    }

    case A.REMOVE_HASHTAG: {
      const hashtags = removeItem(state.hashtags, action.tag);
      return hashtags.length === state.hashtags.length ? state : bump(state, { hashtags });
    }

    case A.CLEAR_HASHTAGS:
      return state.hashtags.length ? bump(state, { hashtags: [] }) : state;

    case A.SET_HASHTAG_PLACEMENT:
      if (!Object.values(HASHTAG_PLACEMENTS).includes(action.placement)) return state;
      if (action.placement === state.hashtagPlacement) return state;
      return bump(state, { hashtagPlacement: action.placement });

    case A.ADD_KEYWORDS: {
      const keywords = mergeUnique(state.keywords, action.keywords ?? [], TEXT_LIMITS.KEYWORDS_MAX);
      return keywords.length === state.keywords.length ? state : bump(state, { keywords });
    }

    case A.REMOVE_KEYWORD: {
      const keywords = removeItem(state.keywords, action.keyword);
      return keywords.length === state.keywords.length ? state : bump(state, { keywords });
    }

    case A.SET_FIRST_COMMENT: {
      const firstComment = String(action.value ?? '');
      return firstComment === state.firstComment ? state : bump(state, { firstComment });
    }

    case A.ADD_MEDIA: {
      const known = new Set(state.media.map((m) => m.id));
      const room = MEDIA_MAX_ITEMS - state.media.length;
      const items = (action.items ?? [])
        .filter((m) => {
          if (!m?.id || known.has(m.id)) return false;
          known.add(m.id);
          return true;
        })
        .slice(0, room);
      return items.length ? bump(state, { media: [...state.media, ...items] }) : state;
    }

    case A.UPDATE_MEDIA: {
      if (!action.patch || Object.keys(action.patch).length === 0) return state;
      const { upload, ...rest } = action.patch;
      const media = patchMedia(state, action.id, (item) => ({
        ...item,
        ...rest,
        id: item.id,
        upload: upload ? { ...item.upload, ...upload } : item.upload,
      }));
      return media ? bump(state, { media }) : state;
    }

    case A.MEDIA_UPLOAD_PROGRESS: {
      const progress = Math.min(1, Math.max(0, Number(action.progress) || 0));
      const media = patchMedia(state, action.id, (item) => ({
        ...item,
        upload: { ...item.upload, progress },
      }));
      return media ? { ...state, media } : state;
    }

    case A.REMOVE_MEDIA: {
      const media = state.media.filter((m) => m.id !== action.id);
      return media.length === state.media.length ? state : bump(state, { media });
    }

    case A.MOVE_MEDIA: {
      const from = state.media.findIndex((m) => m.id === action.id);
      if (from === -1) return state;
      const to = Math.min(state.media.length - 1, Math.max(0, Math.trunc(action.toIndex)));
      if (to === from || Number.isNaN(to)) return state;
      const media = [...state.media];
      const [item] = media.splice(from, 1);
      media.splice(to, 0, item);
      return bump(state, { media });
    }

    case A.SET_MEDIA_ALT_TEXT: {
      const altText = capCodePoints(action.altText, ALT_TEXT_MAX);
      const current = state.media.find((m) => m.id === action.id);
      if (!current || current.altText === altText) return state;
      const media = patchMedia(state, action.id, (item) => ({ ...item, altText }));
      return bump(state, { media });
    }

    case A.TOGGLE_ACCOUNT: {
      if (!isId(action.id)) return state;
      const selected = state.selectedAccountIds.includes(action.id)
        ? state.selectedAccountIds.filter((id) => id !== action.id)
        : uniqueIds([...state.selectedAccountIds, action.id]);
      return bump(state, { selectedAccountIds: selected });
    }

    case A.SELECT_ACCOUNTS: {
      const selected = uniqueIds([...state.selectedAccountIds, ...(action.ids ?? [])]);
      return selected.length === state.selectedAccountIds.length
        ? state
        : bump(state, { selectedAccountIds: selected });
    }

    case A.DESELECT_ACCOUNTS: {
      const drop = new Set(action.ids ?? []);
      const selected = state.selectedAccountIds.filter((id) => !drop.has(id));
      return selected.length === state.selectedAccountIds.length
        ? state
        : bump(state, { selectedAccountIds: selected });
    }

    case A.SET_SELECTED_ACCOUNTS: {
      const selected = uniqueIds(action.ids);
      return sameList(selected, state.selectedAccountIds)
        ? state
        : bump(state, { selectedAccountIds: selected });
    }

    case A.LOAD: {
      const base = createInitialComposerState();
      const next = action.state ?? {};
      return {
        ...base,
        ...next,
        ...sanitizeLoaded(next),
        platformCaptions: { ...base.platformCaptions, ...(next.platformCaptions ?? {}) },
        revision: 0,
      };
    }

    case A.RESET:
      return createInitialComposerState();

    default:
      return state;
  }
}

/** The caption text a platform uses before hashtags are appended. */
export function captionForPlatform(state, platform) {
  return state.platformCaptions[platform] ?? state.caption;
}

export function isPlatformCustomized(state, platform) {
  return (
    state.platformCaptions[platform] !== null && state.platformCaptions[platform] !== undefined
  );
}

/** True when the composer holds anything worth keeping. */
export function hasContent(state) {
  return Boolean(
    state.caption.trim() ||
    Object.values(state.platformCaptions).some((c) => c && c.trim()) ||
    state.hashtags.length ||
    state.keywords.length ||
    state.firstComment.trim() ||
    state.media.length ||
    state.selectedAccountIds.length,
  );
}
