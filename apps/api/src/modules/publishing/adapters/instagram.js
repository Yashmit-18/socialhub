import {
  MEDIA_KINDS,
  PUBLISH_ERROR_CODES,
  PUBLISH_WARNINGS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { config } from '../../../config/env.js';
import { META_HOSTS, metaRequest, unwrapSingle } from '../../../integrations/meta/http.js';
import { facebookSettings, metaSettings } from '../../../integrations/meta/settings.js';
import { PublishError, fromMetaError } from '../publishError.js';

/**
 * Instagram professional account publishing through the official Content Publishing API, for
 * jobs created in LIVE mode (see publishing.settings.js). Tested against a simulated Meta; see
 * docs/PUBLISHING_API.md for what has and has not been verified live.
 *
 *   0. GET  /{ig-id}/content_publishing_limit   refuse early when the 24-hour limit is used up
 *   1. POST /{ig-id}/media          create a container: image_url (JPEG); or video_url with
 *                                   media_type=REELS, share_to_feed=true; or one container per
 *                                   file (is_carousel_item) plus a CAROUSEL container
 *   2. GET  /{container}?fields=status_code   wait until Instagram has processed it
 *   3. POST /{ig-id}/media_publish  creation_id → { id } (the published media)
 *   4. GET  /{media-id}?fields=permalink       the link (best effort)
 *
 * Accounts connected with Instagram Login use graph.instagram.com; accounts reached through
 * a Facebook Page or Instagram Unified Login (Business Integration System User token,
 * permissions instagram_basic + instagram_content_publish) use graph.facebook.com with
 * appsecret_proof (the Meta app secret). The container id is saved before step 3, so a
 * retry resumes instead of creating another container, and a container Instagram reports as
 * already PUBLISHED is never published again.
 */
const PLATFORM = 'Instagram';
const E = PUBLISH_ERROR_CODES;
/**
 * Pauses before each container check within one attempt (about a minute in total). Meta
 * suggests checking about once a minute for up to five minutes; a still-processing container
 * is checked again on the next attempt, so the whole window is several minutes.
 */
const POLL_PAUSES_MS = config.isTest ? [0, 0, 0, 0, 0] : [2000, 5000, 10_000, 15_000, 30_000];
const PROCESSING_RECHECK_MS = 60 * 1000;
const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

/** `config_issue` values Instagram may return with a successful media_publish. */
const CONFIG_ISSUE_WARNINGS = {
  CAPTION_NOT_ATTACHED: PUBLISH_WARNINGS.CAPTION_NOT_ATTACHED,
};

function warningsFrom(published) {
  const raw = published?.config_issue ?? published?.config_issues;
  const issues = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((issue) =>
    typeof issue === 'string' ? issue : (issue?.code ?? issue?.type ?? ''),
  );
  return [
    ...new Set(
      issues
        .filter(Boolean)
        .map((i) => CONFIG_ISSUE_WARNINGS[i] ?? PUBLISH_WARNINGS.PLATFORM_PARTIAL),
    ),
  ];
}

function requireId(value, what) {
  if ((typeof value === 'string' && value) || typeof value === 'number') return String(value);
  throw new PublishError(
    E.OUTCOME_UNKNOWN,
    `Instagram answered without the id of the ${what}, so it cannot be confirmed as published. Check the account before retrying.`,
  );
}

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
    const container = async (form) =>
      requireId((await call(`${user}/media`, { method: 'POST', form }))?.id, 'prepared post');
    const itemForm = (item) =>
      item.kind === MEDIA_KINDS.VIDEO
        ? { video_url: item.url }
        : { image_url: item.url, ...(item.altText ? { alt_text: item.altText } : {}) };

    let containerId = providerState?.containerId;
    if (!containerId) {
      await assertQuotaLeft(call, user);
      if (media.length === 1) {
        const [item] = media;
        const form = { ...itemForm(item), caption };
        if (item.kind === MEDIA_KINDS.VIDEO) {
          // Instagram publishes single videos as reels. Shown in the feed too, like a video post.
          form.media_type = 'REELS';
          form.share_to_feed = 'true';
        }
        containerId = await container(form);
      } else {
        const children = [];
        for (const item of media) {
          const form = { ...itemForm(item), is_carousel_item: 'true' };
          if (item.kind === MEDIA_KINDS.VIDEO) form.media_type = 'VIDEO';
          children.push(await container(form));
        }
        containerId = await container({
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption,
        });
      }
      await saveProviderState({ containerId });
    }

    // Videos are processed asynchronously; publishing before FINISHED fails.
    let status;
    for (const pause of POLL_PAUSES_MS) {
      await sleep(pause);
      status = (
        await call(`${root}/${encodeURIComponent(containerId)}`, {
          query: { fields: 'status_code' },
        })
      )?.status_code;
      if (status !== 'IN_PROGRESS') break;
    }
    if (status === 'IN_PROGRESS') {
      throw new PublishError(
        E.PLATFORM_UNAVAILABLE,
        'Instagram is still processing the media. It will be checked again shortly; nothing has been published yet.',
        { retryable: true, retryAfterMs: PROCESSING_RECHECK_MS },
      );
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      await saveProviderState(null);
      throw new PublishError(
        E.PLATFORM_REJECTED,
        status === 'EXPIRED'
          ? 'Instagram discarded the prepared post because it was not published within 24 hours.'
          : 'Instagram could not process the media of this post. Check the files (format, size, aspect ratio, length) and try again.',
        { retryable: status === 'EXPIRED' },
      );
    }
    if (status === 'PUBLISHED') {
      // A previous attempt got through after all: there is nothing left to send.
      throw new PublishError(
        E.OUTCOME_UNKNOWN,
        'Instagram reports that this post was already published by an earlier attempt. Check the account.',
      );
    }
    if (status !== 'FINISHED') {
      throw new PublishError(
        E.PLATFORM_UNAVAILABLE,
        'Instagram did not report whether the prepared post is ready. It will be checked again shortly.',
        { retryable: true, retryAfterMs: PROCESSING_RECHECK_MS },
      );
    }

    const published = await call(
      `${user}/media_publish`,
      { method: 'POST', form: { creation_id: containerId } },
      true,
    );
    const id = requireId(published?.id, 'published post');
    // The link is a convenience; the post exists whether or not this read works.
    const permalink = await metaRequest(`${root}/${encodeURIComponent(id)}`, {
      query: { fields: 'permalink' },
      accessToken,
      appSecret,
    })
      .then((body) =>
        typeof body?.permalink === 'string' && body.permalink.startsWith('https://')
          ? body.permalink
          : null,
      )
      .catch(() => null);
    return { externalPostId: id, externalUrl: permalink, warnings: warningsFrom(published) };
  },
});

/**
 * Instagram limits how many posts an account can publish through apps in 24 hours (Meta's
 * pages say 50 or 100; the API reports the real figure). Checked before a container is made.
 * If the check itself fails for a temporary reason, publishing goes ahead: Meta enforces the
 * limit anyway, and its refusal is handled as a rate limit.
 */
async function assertQuotaLeft(call, user) {
  let body;
  try {
    body = unwrapSingle(
      await call(`${user}/content_publishing_limit`, { query: { fields: 'quota_usage,config' } }),
    );
  } catch (err) {
    // A dead login or a missing permission would fail publishing too: report it now.
    // Anything else about this optional check (outage, rate limit, an unexpected answer)
    // must not stop the post.
    if (err?.code === E.ACCOUNT_NEEDS_RECONNECT || err?.code === E.PERMISSION_DENIED) throw err;
    return;
  }
  const used = Number(body?.quota_usage);
  const total = Number(body?.config?.quota_total);
  if (Number.isFinite(used) && Number.isFinite(total) && total > 0 && used >= total) {
    throw new PublishError(
      E.RATE_LIMITED,
      `This Instagram account has published ${used} of its ${total} posts allowed through apps in 24 hours. It will be tried again later.`,
      { retryable: true, retryAfterMs: 60 * 60 * 1000 },
    );
  }
}
