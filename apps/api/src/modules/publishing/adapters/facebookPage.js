import { MEDIA_KINDS, PUBLISH_ERROR_CODES } from '@socialhub/shared';
import { config } from '../../../config/env.js';
import {
  META_ERROR_KINDS,
  META_HOSTS,
  MetaApiError,
  metaRequest,
} from '../../../integrations/meta/http.js';
import { facebookSettings, metaSettings } from '../../../integrations/meta/settings.js';
import { PublishError, fromMetaError } from '../publishError.js';

/**
 * Facebook Page publishing through the official Pages API (Graph API), with the Page access
 * token, for jobs created in LIVE mode (see publishing.settings.js). Tested against a
 * simulated Meta; see docs/PUBLISHING_API.md for what has and has not been verified live.
 *
 *   text only        POST /{page-id}/feed    message                         → { id }
 *   one image        POST /{page-id}/photos  url, caption                    → { id, post_id }
 *   several images   POST /{page-id}/photos  url, published=false  (each)    → { id }
 *                    POST /{page-id}/feed    message, attached_media[n]       → { id }
 *   one video        POST /{page-id}/videos  file_url, description           → { id } (video)
 *                    GET  /{video-id}?fields=status,permalink_url   until processed
 *
 * Meta downloads media from the given URLs, so they must be public HTTPS URLs.
 *
 * A post is only reported as published when Meta returned its id. A video is only reported
 * once Facebook says it finished processing: the upload returns the video id at once, but the
 * video can still fail afterwards. The id is saved first, so a later attempt checks the same
 * video again instead of uploading a second one.
 */
const PLATFORM = 'Facebook';
const E = PUBLISH_ERROR_CODES;
/** Pauses before each processing check within one attempt (about a minute in total). */
const VIDEO_CHECKS_MS = config.isTest ? [0, 0, 0] : [3000, 5000, 10_000, 15_000, 30_000];
/** If the video is still processing after those checks, look again this much later. */
const VIDEO_RECHECK_MS = 2 * 60 * 1000;
const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

/**
 * Where a Page video is, from its `status` field: 'ready' (processed and published),
 * 'error' (Facebook gave up on it), 'processing', or null when no status was reported.
 */
export function videoState(status) {
  if (!status || typeof status !== 'object') return null;
  const phases = [status.uploading_phase, status.processing_phase, status.publishing_phase];
  if (
    status.video_status === 'error' ||
    status.video_status === 'expired' ||
    phases.some((phase) => phase?.status === 'error')
  ) {
    return 'error';
  }
  const publishing = status.publishing_phase;
  const published =
    !publishing ||
    (publishing.status === 'complete' &&
      (publishing.publish_status === undefined || publishing.publish_status === 'published'));
  return status.video_status === 'ready' && published ? 'ready' : 'processing';
}

function videoUrl(permalink, videoId) {
  if (typeof permalink === 'string' && permalink.startsWith('https://')) return permalink;
  if (typeof permalink === 'string' && permalink.startsWith('/')) {
    return `https://www.facebook.com${permalink}`;
  }
  return `https://www.facebook.com/${videoId}`;
}

/** The id Meta returned for a created object; without one nothing is reported as published. */
function requireId(value, what) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value);
    if (id) return id;
  }
  throw new PublishError(
    E.OUTCOME_UNKNOWN,
    `Facebook answered without the id of the ${what}, so it cannot be confirmed as published. Check the Page before retrying.`,
  );
}

export const facebookPageAdapter = Object.freeze({
  name: 'facebook-page',
  simulated: false,

  async publish({ account, accessToken, caption, media, providerState, saveProviderState }) {
    const { appSecret } = facebookSettings();
    const root = `${META_HOSTS.facebookGraph}/${metaSettings().graphVersion}`;
    const base = `${root}/${encodeURIComponent(account.externalId)}`;
    const post = async (path, form, committing) => {
      try {
        return await metaRequest(`${base}${path}`, {
          method: 'POST',
          form,
          accessToken,
          appSecret,
        });
      } catch (err) {
        throw fromMetaError(err, { platformName: PLATFORM, committing });
      }
    };
    const withAlt = (item) => (item.altText ? { alt_text_custom: item.altText } : {});

    // A video upload that an earlier attempt already handed to Facebook: only check it.
    if (providerState?.videoId) {
      return confirmVideo({
        root,
        videoId: providerState.videoId,
        accessToken,
        appSecret,
        saveProviderState,
      });
    }

    // After Meta returned the id: read the post back (GET, best effort) for its real link.
    const published = async (id) => ({
      externalPostId: id,
      externalUrl: await postPermalink({ root, id, accessToken, appSecret }),
    });

    if (media.length === 0) {
      return published(requireId((await post('/feed', { message: caption }, true))?.id, 'post'));
    }

    if (media[0].kind === MEDIA_KINDS.VIDEO) {
      const body = await post('/videos', { file_url: media[0].url, description: caption }, true);
      const videoId = requireId(body?.id ?? body?.video_id, 'video');
      try {
        await saveProviderState({ videoId });
      } catch (cause) {
        // Without the saved id a retry would upload the video again.
        throw new PublishError(
          E.OUTCOME_UNKNOWN,
          `Facebook accepted the video (id ${videoId}), but SocialHub could not record it. Check the Page before retrying.`,
          { cause },
        );
      }
      return confirmVideo({ root, videoId, accessToken, appSecret, saveProviderState });
    }

    if (media.length === 1) {
      const body = await post(
        '/photos',
        { url: media[0].url, caption, ...withAlt(media[0]) },
        true,
      );
      // `post_id` is the feed post ("pageid_postid"); `id` is the photo itself.
      return published(requireId(body?.post_id ?? body?.id, 'photo post'));
    }

    const form = { message: caption };
    for (const [index, item] of media.entries()) {
      // Unpublished photos are invisible (Meta keeps them about 24 hours), so repeating this
      // step on a retry is harmless.
      const photo = await post(
        '/photos',
        { url: item.url, published: 'false', ...withAlt(item) },
        false,
      );
      form[`attached_media[${index}]`] = JSON.stringify({
        media_fbid: requireId(photo?.id, 'uploaded photo'),
      });
    }
    return published(requireId((await post('/feed', form, true))?.id, 'post'));
  },
});

/**
 * The published post's link, read back from Meta (GET /{post-id}?fields=permalink_url, read
 * with the same Page token). This also shows the post can be read. Best effort: the post is
 * already published (Meta returned its id), so a failed read changes nothing but the link,
 * which then falls back to https://www.facebook.com/{post-id}.
 */
async function postPermalink({ root, id, accessToken, appSecret }) {
  try {
    const body = await metaRequest(`${root}/${encodeURIComponent(id)}`, {
      query: { fields: 'permalink_url' },
      accessToken,
      appSecret,
    });
    const link = body?.permalink_url;
    if (typeof link === 'string' && link.startsWith('https://')) return link;
  } catch {
    /* the link only */
  }
  return `https://www.facebook.com/${id}`;
}

/**
 * Waits (about a minute) for Facebook to finish processing an uploaded Page video. Reports it
 * as published only when Facebook says so. Still processing: a retry later checks again (the
 * id is saved). Processing failed: not published. Status unreadable: the outcome is unknown.
 */
async function confirmVideo({ root, videoId, accessToken, appSecret, saveProviderState }) {
  for (const pause of VIDEO_CHECKS_MS) {
    await sleep(pause);
    let body;
    try {
      body = await metaRequest(`${root}/${encodeURIComponent(videoId)}`, {
        query: { fields: 'status,permalink_url' },
        accessToken,
        appSecret,
      });
    } catch (err) {
      const temporary =
        err instanceof MetaApiError &&
        (err.kind === META_ERROR_KINDS.TRANSIENT || err.kind === META_ERROR_KINDS.RATE_LIMITED);
      if (temporary) continue;
      throw new PublishError(
        E.OUTCOME_UNKNOWN,
        `Facebook accepted the video (id ${videoId}), but SocialHub could not check whether it finished processing. Check the Page before retrying.`,
        { cause: err },
      );
    }
    const state = videoState(body?.status);
    if (state === null) {
      throw new PublishError(
        E.OUTCOME_UNKNOWN,
        `Facebook accepted the video (id ${videoId}) but did not report whether it finished processing. Check the Page before retrying.`,
      );
    }
    if (state === 'ready') {
      return { externalPostId: videoId, externalUrl: videoUrl(body.permalink_url, videoId) };
    }
    if (state === 'error') {
      // Nothing was published; a person's retry may upload it again.
      await saveProviderState(null).catch(() => {});
      throw new PublishError(
        E.PLATFORM_REJECTED,
        'Facebook could not process this video, so it was not published. Check the file (format, length, size) and try again.',
      );
    }
  }
  throw new PublishError(
    E.PLATFORM_UNAVAILABLE,
    `Facebook is still processing the video (id ${videoId}). SocialHub will check again shortly; it is not shown as published until Facebook confirms it.`,
    { retryable: true, retryAfterMs: VIDEO_RECHECK_MS },
  );
}

/**
 * Changes made to a post that is already published on a Facebook Page, with the Page token
 * (pages_manage_posts):
 *
 *   edit the text   POST   /{post-id}  message   → { success: true }
 *   delete          DELETE /{post-id}            → { success: true }
 *
 * Done only when Meta answered `success: true`. Any other answer, or none, leaves it unknown
 * whether Facebook applied it: that is reported (OUTCOME_UNKNOWN) and nothing is recorded, so a
 * person checks the Page. Tested against a simulated Meta only.
 */
export const facebookPostActions = Object.freeze({
  async edit({ postId, message, accessToken }) {
    return postAction({ postId, accessToken, method: 'POST', form: { message } }, 'changed');
  },
  async remove({ postId, accessToken }) {
    return postAction({ postId, accessToken, method: 'DELETE' }, 'deleted');
  },
});

async function postAction({ postId, accessToken, method, form }, done) {
  const { appSecret } = facebookSettings();
  const url = `${META_HOSTS.facebookGraph}/${metaSettings().graphVersion}/${encodeURIComponent(postId)}`;
  let body;
  try {
    body = await metaRequest(url, { method, form, accessToken, appSecret });
  } catch (err) {
    throw fromMetaError(err, { platformName: PLATFORM, committing: true });
  }
  if (body?.success !== true) {
    throw new PublishError(
      E.OUTCOME_UNKNOWN,
      `Facebook answered without confirming that the post was ${done}. Check the Page before trying again.`,
    );
  }
}
