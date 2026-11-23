import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DESTINATION_STATES,
  DESTINATION_STATES,
  DESTINATION_TRANSITIONS,
  PUBLISH_JOB_STATUS,
  canTransitionDestination,
  composeCaption,
  createPublishJobSchema,
  deriveJobStatus,
  emptyDestinationCounts,
  publishIssues,
  publishJobQuerySchema,
  rescheduleJobSchema,
} from '../src/index.js';

const D = DESTINATION_STATES;
const counts = (partial) => ({ ...emptyDestinationCounts(), ...partial });

describe('destination transitions', () => {
  it('defines a rule for every state, and final states allow nothing', () => {
    expect(Object.keys(DESTINATION_TRANSITIONS).sort()).toEqual(Object.values(D).sort());
    expect(DESTINATION_TRANSITIONS[D.PUBLISHED]).toEqual([]);
    expect(DESTINATION_TRANSITIONS[D.CANCELLED]).toEqual([]);
  });

  it('allows only the legal moves', () => {
    expect(canTransitionDestination(D.QUEUED, D.PROCESSING)).toBe(true);
    expect(canTransitionDestination(D.PROCESSING, D.PUBLISHED)).toBe(true);
    expect(canTransitionDestination(D.PROCESSING, D.RETRY_SCHEDULED)).toBe(true);
    expect(canTransitionDestination(D.FAILED, D.QUEUED)).toBe(true);
    // No shortcut to published, no cancelling mid-publish, nothing after a final state.
    expect(canTransitionDestination(D.QUEUED, D.PUBLISHED)).toBe(false);
    expect(canTransitionDestination(D.PROCESSING, D.CANCELLED)).toBe(false);
    expect(canTransitionDestination(D.PUBLISHED, D.QUEUED)).toBe(false);
    expect(canTransitionDestination(D.PUBLISHED, D.PUBLISHED)).toBe(false);
    expect(canTransitionDestination(D.CANCELLED, D.QUEUED)).toBe(false);
    expect(canTransitionDestination('NOPE', D.QUEUED)).toBe(false);
  });

  it('active states are exactly those that are not final or failed', () => {
    expect([...ACTIVE_DESTINATION_STATES].sort()).toEqual(
      [D.SCHEDULED, D.QUEUED, D.PROCESSING, D.RETRY_SCHEDULED].sort(),
    );
  });
});

describe('deriveJobStatus', () => {
  const J = PUBLISH_JOB_STATUS;
  it.each([
    [{ SCHEDULED: 3 }, J.SCHEDULED],
    [{ QUEUED: 3 }, J.QUEUED],
    [{ QUEUED: 1, SCHEDULED: 2 }, J.QUEUED],
    [{ QUEUED: 2, PROCESSING: 1 }, J.PROCESSING],
    [{ RETRY_SCHEDULED: 1 }, J.PROCESSING],
    [{ QUEUED: 1, PUBLISHED: 2 }, J.PROCESSING],
    [{ QUEUED: 1, FAILED: 2 }, J.PROCESSING],
    // A scheduled post with an account cancelled is still a scheduled post.
    [{ SCHEDULED: 2, CANCELLED: 1 }, J.SCHEDULED],
    [{ SCHEDULED: 1, QUEUED: 1, CANCELLED: 1 }, J.PROCESSING],
    [{ SCHEDULED: 1, RETRY_SCHEDULED: 1 }, J.PROCESSING],
    [{ PUBLISHED: 3 }, J.PUBLISHED],
    [{ PUBLISHED: 2, FAILED: 1 }, J.PARTIALLY_PUBLISHED],
    [{ PUBLISHED: 1, CANCELLED: 2 }, J.PARTIALLY_PUBLISHED],
    [{ FAILED: 3 }, J.FAILED],
    [{ FAILED: 1, CANCELLED: 2 }, J.FAILED],
    [{ CANCELLED: 3 }, J.CANCELLED],
  ])('%j → %s', (partial, expected) => {
    expect(deriveJobStatus(counts(partial))).toBe(expected);
  });

  it('one failure never turns published destinations into a failed job', () => {
    expect(deriveJobStatus(counts({ PUBLISHED: 99, FAILED: 1 }))).not.toBe(J.FAILED);
  });
});

describe('request schemas', () => {
  const valid = { contentPackageId: 'a'.repeat(24), idempotencyKey: 'k'.repeat(20) };

  it('accepts a minimal request and applies defaults', () => {
    expect(createPublishJobSchema.parse(valid)).toEqual({ ...valid, republish: false });
  });

  it('requires a well-formed idempotency key', () => {
    expect(
      createPublishJobSchema.safeParse({ contentPackageId: valid.contentPackageId }).success,
    ).toBe(false);
    expect(createPublishJobSchema.safeParse({ ...valid, idempotencyKey: 'short' }).success).toBe(
      false,
    );
    expect(
      createPublishJobSchema.safeParse({ ...valid, idempotencyKey: 'has spaces in the key!!' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown fields, duplicate accounts and empty account lists', () => {
    expect(createPublishJobSchema.safeParse({ ...valid, accessToken: 'x' }).success).toBe(false);
    const id = 'b'.repeat(24);
    expect(
      createPublishJobSchema.safeParse({ ...valid, socialAccountIds: [id, id.toUpperCase()] })
        .success,
    ).toBe(false);
    expect(createPublishJobSchema.safeParse({ ...valid, socialAccountIds: [] }).success).toBe(
      false,
    );
    expect(
      createPublishJobSchema.safeParse({ ...valid, socialAccountIds: [{ $ne: null }] }).success,
    ).toBe(false);
  });

  it('accepts only real date-times for scheduling', () => {
    expect(
      createPublishJobSchema.safeParse({ ...valid, scheduledAt: '2027-01-01T10:00:00Z' }).success,
    ).toBe(true);
    expect(createPublishJobSchema.safeParse({ ...valid, scheduledAt: 'tomorrow' }).success).toBe(
      false,
    );
  });

  it('validates list queries', () => {
    expect(publishJobQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(publishJobQuerySchema.safeParse({ status: 'DRAFT' }).success).toBe(false);
    expect(publishJobQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(publishJobQuerySchema.parse({ order: 'scheduled' }).order).toBe('scheduled');
    expect(publishJobQuerySchema.safeParse({ order: 'oldest' }).success).toBe(false);
    // Opaque page links: base64url for the schedule order, an id for the default order.
    expect(publishJobQuerySchema.safeParse({ cursor: 'MTc5NzUuYWJj_-' }).success).toBe(true);
    expect(publishJobQuerySchema.safeParse({ cursor: '{"$gt":""}' }).success).toBe(false);
    expect(publishJobQuerySchema.safeParse({ cursor: 'a'.repeat(101) }).success).toBe(false);
  });

  it('validates a new scheduled time', () => {
    expect(rescheduleJobSchema.parse({ scheduledAt: '2026-12-01T09:30:00+05:30' })).toEqual({
      scheduledAt: '2026-12-01T09:30:00+05:30',
    });
    for (const scheduledAt of [undefined, '', 'tomorrow', '2026-12-01T09:30:00', 1764560000000]) {
      expect(rescheduleJobSchema.safeParse({ scheduledAt }).success).toBe(false);
    }
    expect(
      rescheduleJobSchema.safeParse({ scheduledAt: '2026-12-01T09:30:00Z', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('content rules', () => {
  const base = {
    caption: 'Hi',
    platformCaptions: {},
    hashtags: ['a', 'b'],
    hashtagPlacement: 'CAPTION',
    media: [],
  };

  it('composes the caption per platform', () => {
    expect(composeCaption(base, 'FACEBOOK_PAGE')).toBe('Hi\n\n#a #b');
    expect(
      composeCaption(
        { ...base, platformCaptions: { INSTAGRAM_ACCOUNT: 'IG' } },
        'INSTAGRAM_ACCOUNT',
      ),
    ).toBe('IG\n\n#a #b');
    expect(composeCaption({ ...base, hashtagPlacement: 'FIRST_COMMENT' }, 'FACEBOOK_PAGE')).toBe(
      'Hi',
    );
    expect(composeCaption({ ...base, caption: '', hashtags: [] }, 'FACEBOOK_PAGE')).toBe('');
    expect(composeCaption({ ...base, caption: '' }, 'FACEBOOK_PAGE')).toBe('#a #b');
  });

  it('does not repeat hashtags already written in the caption, as the composer previews it', () => {
    expect(composeCaption({ ...base, caption: 'Hi #A' }, 'FACEBOOK_PAGE')).toBe('Hi #A\n\n#b');
    expect(composeCaption({ ...base, caption: 'Hi #a and #b' }, 'FACEBOOK_PAGE')).toBe(
      'Hi #a and #b',
    );
    // Not a hashtag: part of a URL or a word.
    expect(composeCaption({ ...base, caption: 'see x.com/#a' }, 'FACEBOOK_PAGE')).toBe(
      'see x.com/#a\n\n#a #b',
    );
  });

  it('counts every hashtag in an Instagram caption, typed ones too', () => {
    const image = { kind: 'IMAGE' };
    const typed = Array.from({ length: 29 }, (_, i) => `#t${i}`).join(' ');
    const post = { ...base, caption: typed, hashtags: ['x', 'y'], media: [image] };
    expect(publishIssues(post, 'INSTAGRAM_ACCOUNT')[0]).toMatch(/at most 30 hashtags/);
    // The same tags typed and listed count once.
    expect(publishIssues({ ...post, hashtags: ['t0', 't1'] }, 'INSTAGRAM_ACCOUNT')).toEqual([]);
  });

  it('applies Instagram and Facebook rules', () => {
    expect(publishIssues(base, 'FACEBOOK_PAGE')).toEqual([]);
    expect(publishIssues(base, 'INSTAGRAM_ACCOUNT')[0]).toMatch(/at least one image or video/);
    const image = { kind: 'IMAGE' };
    const video = { kind: 'VIDEO' };
    expect(publishIssues({ ...base, media: [image] }, 'INSTAGRAM_ACCOUNT')).toEqual([]);
    expect(
      publishIssues({ ...base, media: Array(11).fill(image) }, 'INSTAGRAM_ACCOUNT')[0],
    ).toMatch(/at most 10/);
    expect(
      publishIssues(
        { ...base, caption: 'x'.repeat(2201), hashtags: [], media: [image] },
        'INSTAGRAM_ACCOUNT',
      )[0],
    ).toMatch(/2,200/);
    expect(publishIssues({ ...base, caption: '', hashtags: [] }, 'FACEBOOK_PAGE')[0]).toMatch(
      /need text/,
    );
    expect(publishIssues({ ...base, media: [video, image] }, 'FACEBOOK_PAGE')[0]).toMatch(
      /one video, or images/,
    );
    expect(publishIssues({ ...base, media: [video] }, 'FACEBOOK_PAGE')).toEqual([]);
  });
});
