import { MEDIA_KINDS, SOCIAL_PLATFORMS } from '@socialhub/shared';

/**
 * Facebook takes one video per post. A Page video is published through /{page-id}/videos as a
 * post of its own, and a feed post can only attach photos, so the API refuses a draft with
 * several videos for a Page ("A Facebook post can have one video, or images, but not both").
 *
 * A post with several videos and no photos that goes to a Facebook Page is therefore published
 * as one post per video, each with the same text, on every selected account. Each of those
 * posts gets its own one-video draft (composer/hooks/useVideoPosts.js) and its own publishing
 * job, through the same API and checks as any other post.
 *
 * Returns how many posts that makes, or 0 when the post is published as it is.
 */
export function separateVideoPosts(accounts, media) {
  const videos = media.filter((item) => item.kind === MEDIA_KINDS.VIDEO).length;
  const toFacebook = accounts.some(
    (account) => account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  );
  return toFacebook && videos > 1 && videos === media.length ? videos : 0;
}
