import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MEDIA_KINDS } from '../model/composerState.js';
import { toContentPackageInput } from '../model/serialize.js';
import { createDraft, deleteDraft } from '../services/composerApi.js';

/**
 * One post per video, for Facebook (see features/publishing/videoPosts.js): the server
 * publishes drafts, so each video gets a one-video copy of the composer content as a draft
 * of its own, and the Publish dialog creates one job for each.
 *
 * The copies are working files, not drafts anyone asked for:
 *  - A copy is made when its post is about to be created, and kept until it is: a retry
 *    reuses it, so the dialog sends the same request (same idempotency key) and the server
 *    answers with the job it may already have made instead of making a second one.
 *  - Once the post's job exists the copy is deleted. The job keeps its own copy of the content
 *    and the media clean-up keeps the files a scheduled or sending post needs.
 *  - Copies for content that changed, or that is left behind, are deleted (best effort).
 *
 * The posts sent from this composer are remembered by their content and accounts, so publishing
 * the same videos again is caught, as the server catches it for a single post
 * (ALREADY_PUBLISHED), and a stop part-way through carries on with the posts not sent yet.
 *
 *  - pending: how many of the current videos have not been sent from here yet
 *  - prepare({ again }): the posts to create now, each with the id of its draft copy, as
 *    [{ key, label, contentPackageId }]. `again` includes posts already sent.
 *  - markSent(key): the post's job exists; its copy is deleted.
 */
export function useVideoPosts({ workspaceId, state, availableAccountIds = null }) {
  /** Post key → id of its draft copy, until the post's job exists. */
  const copies = useRef(new Map());
  const [sent, setSent] = useState(() => new Set());

  const posts = useMemo(() => {
    const { input } = toContentPackageInput(state, { availableAccountIds });
    return state.media
      .filter((item) => item.kind === MEDIA_KINDS.VIDEO && item.upload.mediaId)
      .map((video) => {
        const one = {
          ...input,
          media: [{ mediaId: video.upload.mediaId, altText: video.altText }],
        };
        return { key: JSON.stringify(one), input: one, label: video.fileName };
      });
  }, [state, availableAccountIds]);

  const discard = useCallback(
    (keep = new Set()) => {
      for (const [key, id] of copies.current) {
        if (keep.has(key)) continue;
        copies.current.delete(key);
        deleteDraft(workspaceId, id).catch(() => {});
      }
    },
    [workspaceId],
  );

  // Leaving the composer: copies of posts that were never created are not needed.
  useEffect(() => () => discard(), [discard]);

  const prepare = useCallback(
    async ({ again = false } = {}) => {
      // Copies made for earlier content (a caption changed, a video removed) are not needed.
      discard(new Set(posts.map((post) => post.key)));
      const list = [];
      for (const post of posts) {
        if (!again && sent.has(post.key)) continue;
        let id = copies.current.get(post.key);
        if (!id) {
          const response = await createDraft(workspaceId, post.input);
          id = response?.contentPackage?.id;
          if (!id) {
            throw new Error(
              'SocialHub did not return the draft for one of the videos, so nothing more was sent. Try again.',
            );
          }
          copies.current.set(post.key, id);
        }
        list.push({ key: post.key, label: post.label, contentPackageId: id });
      }
      return list;
    },
    [discard, posts, sent, workspaceId],
  );

  const markSent = useCallback(
    (key) => {
      const id = copies.current.get(key);
      copies.current.delete(key);
      setSent((previous) => new Set(previous).add(key));
      if (id) deleteDraft(workspaceId, id).catch(() => {});
    },
    [workspaceId],
  );

  return {
    pending: posts.filter((post) => !sent.has(post.key)).length,
    prepare,
    markSent,
  };
}
