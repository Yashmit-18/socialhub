import { MEDIA_KINDS } from '@socialhub/shared';
import { META_HOSTS, metaRequest } from '../../../integrations/meta/http.js';
import { facebookSettings, metaSettings } from '../../../integrations/meta/settings.js';
import { fromMetaError } from '../publishError.js';

/**
 * Facebook Page publishing through the official Pages API (Graph API), with the Page access
 * token. NOT VERIFIED AGAINST REAL META and unreachable on a running server: see
 * publishing.settings.js.
 *
 *   text only        POST /{page-id}/feed    message
 *   one image        POST /{page-id}/photos  url, caption
 *   several images   POST /{page-id}/photos  url, published=false   (once per image)
 *                    POST /{page-id}/feed    message, attached_media[n]={"media_fbid":…}
 *   one video        POST /{page-id}/videos  file_url, description
 *
 * Meta downloads media from the given URLs, so they must be public HTTPS URLs.
 */
const PLATFORM = 'Facebook';

export const facebookPageAdapter = Object.freeze({
  name: 'facebook-page',
  simulated: false,

  async publish({ account, accessToken, caption, media }) {
    const { appSecret } = facebookSettings();
    const base = `${META_HOSTS.facebookGraph}/${metaSettings().graphVersion}/${encodeURIComponent(account.externalId)}`;
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

    let id;
    if (media.length === 0) {
      id = (await post('/feed', { message: caption }, true)).id;
    } else if (media[0].kind === MEDIA_KINDS.VIDEO) {
      id = (await post('/videos', { file_url: media[0].url, description: caption }, true)).id;
    } else if (media.length === 1) {
      const body = await post(
        '/photos',
        { url: media[0].url, caption, ...withAlt(media[0]) },
        true,
      );
      id = body.post_id ?? body.id;
    } else {
      const form = { message: caption };
      for (const [index, item] of media.entries()) {
        // Unpublished photos are invisible, so repeating this step on a retry is harmless.
        const photo = await post(
          '/photos',
          { url: item.url, published: 'false', ...withAlt(item) },
          false,
        );
        form[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photo.id });
      }
      id = (await post('/feed', form, true)).id;
    }
    return { externalPostId: String(id), externalUrl: `https://www.facebook.com/${id}` };
  },
});
