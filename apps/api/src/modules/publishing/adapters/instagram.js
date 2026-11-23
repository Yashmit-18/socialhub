import { MEDIA_KINDS, PUBLISH_ERROR_CODES, SOCIAL_PROVIDERS } from '@socialhub/shared';
import { config } from '../../../config/env.js';
import { META_HOSTS, metaRequest } from '../../../integrations/meta/http.js';
import { facebookSettings, metaSettings } from '../../../integrations/meta/settings.js';
import { PublishError, fromMetaError } from '../publishError.js';

/**
 * Instagram professional account publishing through the official Content Publishing API.
 * NOT VERIFIED AGAINST REAL META and unreachable on a running server: see
 * publishing.settings.js.
 *
 *   1. POST /{ig-id}/media          create a container (image_url, or video_url as a reel,
 *                                   or one container per file plus a CAROUSEL container)
 *   2. GET  /{container}?fields=status_code   wait until Instagram has processed it
 *   3. POST /{ig-id}/media_publish  creation_id
 *
 * Accounts connected with Instagram Login use graph.instagram.com; accounts reached through
 * a Facebook Page use graph.facebook.com. The container id is saved before step 3, so a
 * retry resumes instead of creating another container.
 */
const PLATFORM = 'Instagram';
const POLL_INTERVAL_MS = config.isTest ? 0 : 5000;
const POLL_ATTEMPTS = 12;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const instagramAdapter = Object.freeze({
  name: 'instagram',
  simulated: false,

  async publish({
    account,
    connection,
    accessToken,
    caption,
    media,
    providerState,
    saveProviderState,
  }) {
    const viaInstagramLogin = connection?.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN;
    const host = viaInstagramLogin ? META_HOSTS.instagramGraph : META_HOSTS.facebookGraph;
    const appSecret = viaInstagramLogin ? undefined : facebookSettings()?.appSecret;
    const root = `${host}/${metaSettings().graphVersion}`;
    const user = `${root}/${encodeURIComponent(account.externalId)}`;
    const call = async (url, options, committing = false) => {
      try {
        return await metaRequest(url, { ...options, accessToken, appSecret });
      } catch (err) {
        throw fromMetaError(err, { platformName: PLATFORM, committing });
      }
    };
    const container = (form) => call(`${user}/media`, { method: 'POST', form });
    const itemForm = (item) =>
      item.kind === MEDIA_KINDS.VIDEO
        ? { video_url: item.url }
        : { image_url: item.url, ...(item.altText ? { alt_text: item.altText } : {}) };

    let containerId = providerState?.containerId;
    if (!containerId) {
      if (media.length === 1) {
        const [item] = media;
        const form = { ...itemForm(item), caption };
        if (item.kind === MEDIA_KINDS.VIDEO) form.media_type = 'REELS';
        containerId = (await container(form)).id;
      } else {
        const children = [];
        for (const item of media) {
          const form = { ...itemForm(item), is_carousel_item: 'true' };
          if (item.kind === MEDIA_KINDS.VIDEO) form.media_type = 'VIDEO';
          children.push((await container(form)).id);
        }
        containerId = (
          await container({ media_type: 'CAROUSEL', children: children.join(','), caption })
        ).id;
      }
      await saveProviderState({ containerId: String(containerId) });
    }

    // Videos are processed asynchronously; publishing before FINISHED fails.
    let status;
    for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
      status = (
        await call(`${root}/${encodeURIComponent(containerId)}`, {
          query: { fields: 'status_code' },
        })
      ).status_code;
      if (status !== 'IN_PROGRESS') break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (status === 'IN_PROGRESS') {
      throw new PublishError(
        PUBLISH_ERROR_CODES.PLATFORM_UNAVAILABLE,
        'Instagram is still processing the media. It will be tried again shortly.',
        { retryable: true },
      );
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      await saveProviderState(null);
      throw new PublishError(
        PUBLISH_ERROR_CODES.PLATFORM_REJECTED,
        status === 'EXPIRED'
          ? 'Instagram discarded the prepared post because it was not published in time.'
          : 'Instagram could not process the media of this post.',
        { retryable: status === 'EXPIRED' },
      );
    }
    if (status === 'PUBLISHED') {
      // A previous attempt got through after all: there is nothing left to send.
      throw new PublishError(
        PUBLISH_ERROR_CODES.OUTCOME_UNKNOWN,
        'Instagram reports that this post was already published by an earlier attempt. Check the account.',
      );
    }

    const published = await call(
      `${user}/media_publish`,
      { method: 'POST', form: { creation_id: containerId } },
      true,
    );
    const id = String(published.id);
    // The link is a convenience; the post exists whether or not this read works.
    const permalink = await metaRequest(`${root}/${encodeURIComponent(id)}`, {
      query: { fields: 'permalink' },
      accessToken,
      appSecret,
    })
      .then((body) => (typeof body?.permalink === 'string' ? body.permalink : null))
      .catch(() => null);
    return { externalPostId: id, externalUrl: permalink };
  },
});
