import { describe, expect, it } from 'vitest';
import { PLATFORM_RULES, platformLabel } from '../constants/platformRules.js';
import { accountList, fbPage, igAccount } from '../test/fixtures.js';
import { normalizeAccounts } from './accounts.js';
import {
  ALT_TEXT_MAX,
  COMPOSER_PLATFORMS,
  INSPECTION_STATUS,
  MEDIA_KINDS,
  MEDIA_MAX_ITEMS,
  createInitialComposerState,
  createMediaItem,
} from './composerState.js';
import { HASHTAG_PLACEMENTS } from './text.js';
import { SEVERITY, UNVERIFIED_NOTE, platformOutput, validateComposer } from './validation.js';

const FB = 'FACEBOOK_PAGE';
const IG = 'INSTAGRAM_ACCOUNT';
const FB_ID = 'acc-fb-1';
const IG_ID = 'acc-ig-1';
const MB = 1000 * 1000;

/**
 * Small, fully verified limits so each check can be triggered precisely and independently of
 * the researched values in constants/platformRules.js (which may still be refined).
 */
function testRules() {
  return {
    [FB]: {
      platform: FB,
      label: 'Facebook',
      caption: { maxChars: 100, maxHashtags: null, maxMentions: null },
      firstComment: { maxChars: 50, maxHashtags: null, maxMentions: null },
      media: {
        required: false,
        maxItems: 3,
        allowMixed: false,
        maxVideos: 1,
        image: {
          mimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
          maxBytes: 4 * MB,
          maxBytesLabel: '4 MB',
          staticOnlyMimeTypes: ['image/gif'],
          recommendedMaxBytesByType: { 'image/png': 1 * MB },
          recommendedMaxBytesLabel: '1 MB',
        },
        video: { mimeTypes: ['video/mp4'], maxBytes: 100 * MB, maxDurationSec: 600 },
        carouselVideo: null,
      },
      altText: { supported: true, maxChars: null },
      unverified: [],
    },
    [IG]: {
      platform: IG,
      label: 'Instagram',
      caption: {
        maxChars: 120,
        maxHashtags: 4,
        maxMentions: 2,
        advisoryMaxHashtags: 2,
        advisoryNote: 'Help Center',
      },
      firstComment: { maxChars: 60, maxHashtags: 2, maxMentions: 1 },
      media: {
        required: true,
        maxItems: 4,
        allowMixed: true,
        maxVideos: null,
        image: {
          mimeTypes: ['image/jpeg'],
          maxBytes: 8 * MB,
          maxBytesLabel: '8 MB',
          minAspectRatio: 0.8,
          minAspectRatioLabel: '4:5',
          maxAspectRatio: 1.91,
          maxAspectRatioLabel: '1.91:1',
          minWidth: 320,
        },
        video: {
          mimeTypes: ['video/mp4', 'video/quicktime'],
          maxBytes: 300 * MB,
          maxBytesLabel: '300 MB',
          minDurationSec: 3,
          maxDurationSec: 900,
          recommendedAspectRatio: 9 / 16,
          recommendedAspectRatioLabel: '9:16',
        },
        carouselVideo: {
          maxBytes: 100 * MB,
          maxBytesLabel: '100 MB',
          minDurationSec: 3,
          maxDurationSec: 60,
          minAspectRatio: 0.8,
          minAspectRatioLabel: '4:5',
          maxAspectRatio: 16 / 9,
          maxAspectRatioLabel: '16:9',
          recommendedAspectRatio: null,
        },
      },
      altText: { supported: true, maxChars: 1000 },
      unverified: [],
    },
  };
}

/** Healthy Facebook Page + Instagram account (both ACTIVE / READY). */
const ACCOUNTS = normalizeAccounts([fbPage(), igAccount()]);

const composer = (patch = {}) => ({ ...createInitialComposerState(), ...patch });

const image = (id, patch = {}) => ({
  ...createMediaItem({
    id,
    kind: MEDIA_KINDS.IMAGE,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 500_000,
  }),
  width: 1080,
  height: 1080,
  inspection: INSPECTION_STATUS.DONE,
  altText: 'A photo',
  ...patch,
});

const video = (id, patch = {}) => ({
  ...createMediaItem({
    id,
    kind: MEDIA_KINDS.VIDEO,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: 5 * MB,
  }),
  width: 1080,
  height: 1920,
  durationSec: 30,
  inspection: INSPECTION_STATUS.DONE,
  ...patch,
});

function check(patch, { rules = testRules(), accounts = ACCOUNTS } = {}) {
  return validateComposer(composer(patch), accounts, rules);
}

const issueIds = (result) => result.issues.map((i) => i.id);
const find = (result, id) => result.issues.find((i) => i.id === id);

describe('platformOutput', () => {
  it('composes each platform’s caption and counts code points, hashtags and mentions', () => {
    const state = composer({
      caption: 'Hi @acme 👋',
      hashtags: ['summer', 'sale'],
      platformCaptions: { [FB]: null, [IG]: 'IG only #insta' },
    });
    expect(platformOutput(state, FB)).toEqual({
      caption: 'Hi @acme 👋\n\n#summer #sale',
      firstComment: '',
      captionLength: 25,
      firstCommentLength: 0,
      captionHashtags: 2,
      captionMentions: 1,
      firstCommentHashtags: 0,
      firstCommentMentions: 0,
    });
    expect(platformOutput(state, IG)).toMatchObject({
      caption: 'IG only #insta\n\n#summer #sale',
      captionHashtags: 3,
      captionMentions: 0,
    });
  });

  it('moves the hashtags into the first comment for FIRST_COMMENT placement', () => {
    const state = composer({
      caption: 'Caption',
      firstComment: 'Thanks @ada',
      hashtags: ['summer'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    });
    expect(platformOutput(state, IG)).toEqual({
      caption: 'Caption',
      firstComment: 'Thanks @ada\n\n#summer',
      captionLength: 7,
      firstCommentLength: 20,
      captionHashtags: 0,
      captionMentions: 0,
      firstCommentHashtags: 1,
      firstCommentMentions: 1,
    });
  });

  it('counts each occurrence of a repeated hashtag or mention', () => {
    const state = composer({ caption: '#a #a #A @x @x' });
    expect(platformOutput(state, IG)).toMatchObject({ captionHashtags: 3, captionMentions: 2 });
  });
});

describe('validateComposer: accounts and content', () => {
  it('asks for an account and for content when the composer is empty', () => {
    const result = check({});
    expect(issueIds(result)).toEqual(['accounts-required', 'content-required']);
    expect(find(result, 'accounts-required')).toMatchObject({
      severity: SEVERITY.ERROR,
      scope: 'global',
      field: 'accounts',
    });
    expect(find(result, 'content-required')).toMatchObject({
      severity: SEVERITY.ERROR,
      scope: 'global',
      field: 'caption',
    });
    expect(result.isReady).toBe(false);
    expect(result.platforms).toEqual([]);
  });

  it('still requires an account when there is content', () => {
    const result = check({ caption: 'Hello' });
    expect(issueIds(result)).toEqual(['accounts-required']);
  });

  it('returns selected accounts in selection order and platforms in composer order', () => {
    const result = check({
      caption: 'Hi',
      media: [image('m1')],
      selectedAccountIds: [IG_ID, FB_ID],
    });
    expect(result.selected.map((a) => a.id)).toEqual([IG_ID, FB_ID]);
    expect(result.platforms).toEqual([FB, IG]);
    expect(result.missingAccountIds).toEqual([]);
  });

  it('warns once about selected accounts that are no longer available', () => {
    const one = check({ caption: 'Hi', selectedAccountIds: [FB_ID, 'gone-1'] });
    expect(one.missingAccountIds).toEqual(['gone-1']);
    expect(find(one, 'accounts-missing')).toMatchObject({
      severity: SEVERITY.WARNING,
      scope: 'global',
      field: 'accounts',
      message: '1 selected account is no longer available to you and will be left out.',
    });
    expect(one.isReady).toBe(true);

    const two = check({ caption: 'Hi', selectedAccountIds: ['gone-1', FB_ID, 'gone-2'] });
    expect(two.selected.map((a) => a.id)).toEqual([FB_ID]);
    expect(find(two, 'accounts-missing').message).toBe(
      '2 selected accounts are no longer available to you and will be left out.',
    );
  });

  it('requires an account when every selected account has gone', () => {
    const result = check({ caption: 'Hi', selectedAccountIds: ['gone-1'] });
    expect(issueIds(result)).toEqual(['accounts-required', 'accounts-missing']);
  });

  it('reports accounts without publishing access as account errors, keeping them selected', () => {
    const accounts = normalizeAccounts(accountList());
    const result = check(
      { caption: 'Hi', media: [image('m1')], selectedAccountIds: ['acc-ig-2', FB_ID] },
      { accounts },
    );
    const issue = find(result, 'account:acc-ig-2');
    expect(issue).toEqual({
      id: 'account:acc-ig-2',
      severity: SEVERITY.ERROR,
      scope: 'account',
      field: 'accounts',
      platform: IG,
      accountId: 'acc-ig-2',
      message: 'Acme Studio: Missing permission: instagram_content_publish',
    });
    expect(result.selected.map((a) => a.id)).toEqual(['acc-ig-2', FB_ID]);
    expect(result.byAccount['acc-ig-2']).toContainEqual(issue);
    expect(result.byPlatform[IG]).not.toContainEqual(issue);
    expect(result.isReady).toBe(false);
  });

  it('is ready when only warnings and suggestions remain', () => {
    const result = check({
      caption: 'Hello',
      media: [image('m1', { altText: '' })],
      selectedAccountIds: [FB_ID, 'gone'],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.id)).toEqual(['accounts-missing']);
    expect(result.infos.map((i) => i.id)).toEqual(['alt-text']);
    expect(result.isReady).toBe(true);
  });
});

describe('validateComposer: caption and first comment limits', () => {
  it('reports captions over the limit with en-US number formatting', () => {
    const rules = testRules();
    rules[FB].caption.maxChars = 1000;
    const result = check({ caption: 'x'.repeat(1001), selectedAccountIds: [FB_ID] }, { rules });
    expect(find(result, `${FB}:caption-length`)).toMatchObject({
      severity: SEVERITY.ERROR,
      scope: 'platform',
      field: 'caption',
      platform: FB,
      ruleKey: 'caption.maxChars',
      unverified: false,
      message: 'Facebook captions can be up to 1,000 characters. This one is 1,001.',
    });
  });

  it('accepts captions exactly at the limit, counted in code points', () => {
    expect(issueIds(check({ caption: 'x'.repeat(100), selectedAccountIds: [FB_ID] }))).toEqual([]);
    expect(issueIds(check({ caption: '😀'.repeat(100), selectedAccountIds: [FB_ID] }))).toEqual([]);
  });

  it('counts appended hashtags toward the caption and says so', () => {
    const patch = { caption: 'x'.repeat(95), hashtags: ['abcdef'], selectedAccountIds: [FB_ID] };
    expect(find(check(patch), `${FB}:caption-length`).message).toBe(
      'Facebook captions can be up to 100 characters. This one is 104 including hashtags.',
    );
    const inComment = check({ ...patch, hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT });
    expect(issueIds(inComment)).toEqual([]);
  });

  it('checks a customized caption for its own platform only', () => {
    const result = check({
      caption: 'Short',
      platformCaptions: { [FB]: null, [IG]: 'y'.repeat(121) },
      media: [image('m1')],
      selectedAccountIds: [FB_ID, IG_ID],
    });
    expect(find(result, `${IG}:caption-length`)).toMatchObject({
      field: 'platformCaption',
      platform: IG,
    });
    expect(find(result, `${FB}:caption-length`)).toBeUndefined();
  });

  it('downgrades unverified limits to warnings and says they are unconfirmed', () => {
    const rules = testRules();
    rules[FB].unverified = ['caption.maxChars'];
    const issue = find(
      check({ caption: 'x'.repeat(101), selectedAccountIds: [FB_ID] }, { rules }),
      `${FB}:caption-length`,
    );
    expect(issue).toMatchObject({
      severity: SEVERITY.WARNING,
      ruleKey: 'caption.maxChars',
      unverified: true,
    });
    expect(issue.message).toBe(
      `Facebook captions can be up to 100 characters. This one is 101. ${UNVERIFIED_NOTE}`,
    );
  });

  it('enforces the caption hashtag limit, counting written and appended hashtags', () => {
    const result = check({
      caption: 'Hi #one #two',
      hashtags: ['three', 'four', 'five'],
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    expect(find(result, `${IG}:caption-hashtags`)).toMatchObject({
      severity: SEVERITY.ERROR,
      field: 'hashtags',
      ruleKey: 'caption.maxHashtags',
      message: 'Instagram allows up to 4 hashtags in a caption. This caption has 5.',
    });
    // Over the hard limit, the softer advisory is not repeated.
    expect(find(result, `${IG}:caption-hashtags-advisory`)).toBeUndefined();
  });

  it('warns (without blocking) above the advisory hashtag count', () => {
    const result = check({
      caption: '#a #b #c',
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    const issue = find(result, `${IG}:caption-hashtags-advisory`);
    expect(issue).toMatchObject({ severity: SEVERITY.WARNING, field: 'hashtags' });
    expect(issue.unverified).toBeUndefined();
    expect(issue.message).toBe(
      'Instagram now says posts can use up to 2 hashtags (Help Center). This caption has 3, so some may not work.',
    );
    expect(result.isReady).toBe(true);
  });

  it('enforces the caption mention limit and ignores email addresses', () => {
    const over = check({
      caption: '@one @two @three',
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    expect(find(over, `${IG}:caption-mentions`)).toMatchObject({
      severity: SEVERITY.ERROR,
      field: 'caption',
      ruleKey: 'caption.maxMentions',
      message: 'Instagram allows up to 2 @mentions in a caption. This caption has 3.',
    });
    const emails = check({
      caption: '@one a@b.co c@d.co',
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    expect(find(emails, `${IG}:caption-mentions`)).toBeUndefined();
  });

  it('does not check hashtags in the caption against the first comment limits', () => {
    // Three hashtags in the caption: over the first comment hashtag limit (2), within the
    // caption limit (4). Only the caption advisory may apply.
    const result = check({
      caption: '#a #b #c',
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    expect(issueIds(result)).toEqual([`${IG}:caption-hashtags-advisory`]);
  });

  it('enforces the first comment length', () => {
    const result = check({
      caption: 'Hi',
      firstComment: 'c'.repeat(1051),
      selectedAccountIds: [FB_ID],
    });
    // testRules: Facebook first comment limit is 50.
    expect(find(result, `${FB}:comment-length`)).toMatchObject({
      severity: SEVERITY.ERROR,
      field: 'firstComment',
      ruleKey: 'firstComment.maxChars',
      message: 'Facebook comments can be up to 50 characters. The first comment is 1,051.',
    });
  });

  it('counts hashtags placed in the first comment toward the comment, not the caption', () => {
    const result = check({
      caption: 'Caption',
      firstComment: 'Thanks @a @b',
      hashtags: ['one', 'two', 'three'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
      media: [image('m1')],
      selectedAccountIds: [IG_ID],
    });
    expect(find(result, `${IG}:comment-hashtags`)).toMatchObject({
      field: 'firstComment',
      message:
        'Instagram comments with more than 2 hashtags may not post. The first comment has 3.',
    });
    expect(find(result, `${IG}:comment-mentions`)).toMatchObject({
      field: 'firstComment',
      message:
        'Instagram comments with more than 1 @mentions may not post. The first comment has 2.',
    });
    expect(find(result, `${IG}:caption-hashtags`)).toBeUndefined();
    expect(find(result, `${IG}:caption-hashtags-advisory`)).toBeUndefined();
  });
});

describe('validateComposer: media rules', () => {
  it('requires media where the platform has no text-only posts', () => {
    const result = check({ caption: 'Text only', selectedAccountIds: [IG_ID] });
    expect(find(result, `${IG}:media-required`)).toMatchObject({
      severity: SEVERITY.ERROR,
      scope: 'platform',
      field: 'media',
      platform: IG,
      message: 'Instagram posts need at least one photo or video.',
    });
  });

  it('allows text-only posts where media is optional', () => {
    expect(issueIds(check({ caption: 'Text only', selectedAccountIds: [FB_ID] }))).toEqual([]);
  });

  it('reports an empty post per platform', () => {
    const result = check({ selectedAccountIds: [FB_ID] });
    expect(find(result, `${FB}:empty`)).toMatchObject({
      severity: SEVERITY.ERROR,
      field: 'caption',
      message: 'Add a caption or a photo or video for Facebook.',
    });
    // A first comment alone is not a post.
    const commentOnly = check({ firstComment: 'Hi', selectedAccountIds: [FB_ID] });
    expect(find(commentOnly, `${FB}:empty`)).toBeDefined();
  });

  it('counts hashtags appended to the caption as content', () => {
    const result = check({ hashtags: ['summer'], selectedAccountIds: [FB_ID] });
    expect(find(result, `${FB}:empty`)).toBeUndefined();
  });

  it('limits the number of files', () => {
    const media = ['a', 'b', 'c', 'd'].map((id) => image(id));
    expect(find(check({ media, selectedAccountIds: [FB_ID] }), `${FB}:media-count`)).toMatchObject({
      severity: SEVERITY.ERROR,
      ruleKey: 'media.maxItems',
      message: 'Facebook posts can include up to 3 files. This post has 4.',
    });
    const rules = testRules();
    rules[FB].media.maxItems = 1;
    expect(
      find(
        check({ media: media.slice(0, 2), selectedAccountIds: [FB_ID] }, { rules }),
        `${FB}:media-count`,
      ).message,
    ).toBe('Facebook posts can include up to 1 file. This post has 2.');
    rules[FB].media.maxItems = null;
    expect(
      find(check({ media, selectedAccountIds: [FB_ID] }, { rules }), `${FB}:media-count`),
    ).toBeUndefined();
  });

  it('rejects photos mixed with a video where that is not allowed', () => {
    const media = [image('m1'), video('v1')];
    expect(find(check({ media, selectedAccountIds: [FB_ID] }), `${FB}:media-mixed`)).toMatchObject({
      severity: SEVERITY.ERROR,
      ruleKey: 'media.allowMixed',
      message: 'Facebook posts can include photos or a video, not both.',
    });
    expect(
      find(check({ media, selectedAccountIds: [IG_ID] }), `${IG}:media-mixed`),
    ).toBeUndefined();
  });

  it('limits the number of videos when the platform does', () => {
    const media = [video('v1'), video('v2')];
    expect(find(check({ media, selectedAccountIds: [FB_ID] }), `${FB}:video-count`)).toMatchObject({
      ruleKey: 'media.maxVideos',
      message: 'Facebook posts can include 1 video. This post has 2.',
    });
    expect(
      find(check({ media, selectedAccountIds: [IG_ID] }), `${IG}:video-count`),
    ).toBeUndefined();
  });

  it('reports formats a platform does not accept, per file', () => {
    const png = image('m1', { fileName: 'photo.png', mimeType: 'image/png' });
    const result = check({ media: [png], selectedAccountIds: [FB_ID, IG_ID] });
    expect(find(result, `${IG}:m1:mimeTypes`)).toEqual({
      id: `${IG}:m1:mimeTypes`,
      severity: SEVERITY.ERROR,
      ruleKey: 'media.image.mimeTypes',
      unverified: false,
      scope: 'media',
      field: 'media',
      platform: IG,
      mediaId: 'm1',
      message: 'photo.png (Instagram): Instagram accepts JPEG images, not PNG.',
    });
    expect(find(result, `${FB}:m1:mimeTypes`)).toBeUndefined();
  });

  it('reports files over the size limit using the platform’s wording when there is one', () => {
    const big = image('m1', { fileName: 'big.jpg', sizeBytes: 9 * MB });
    const rules = testRules();
    rules[IG].media.image.maxBytesLabel = '8 megabytes';
    expect(
      find(check({ media: [big], selectedAccountIds: [IG_ID] }, { rules }), `${IG}:m1:maxBytes`),
    ).toMatchObject({
      severity: SEVERITY.ERROR,
      ruleKey: 'media.image.maxBytes',
      message: 'big.jpg (Instagram): 9 MB is over the 8 megabytes limit.',
    });

    delete rules[IG].media.image.maxBytesLabel;
    expect(
      find(check({ media: [big], selectedAccountIds: [IG_ID] }, { rules }), `${IG}:m1:maxBytes`)
        .message,
    ).toBe('big.jpg (Instagram): 9 MB is over the 8 MB limit.');
    expect(
      find(check({ media: [image('m2')], selectedAccountIds: [IG_ID] }), `${IG}:m2:maxBytes`),
    ).toBeUndefined();
  });

  it('suggests a smaller file when it is under the limit but over the recommended size', () => {
    const png = image('m1', { fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 2 * MB });
    const result = check({ media: [png], selectedAccountIds: [FB_ID] });
    expect(find(result, `${FB}:m1:recommendedMaxBytes`)).toMatchObject({
      severity: SEVERITY.INFO,
      message:
        'photo.png (Facebook): Facebook recommends PNG files under 1 MB, or the image may look pixelated.',
    });

    const tooBig = image('m2', { fileName: 'huge.png', mimeType: 'image/png', sizeBytes: 5 * MB });
    const over = check({ media: [tooBig], selectedAccountIds: [FB_ID] });
    expect(find(over, `${FB}:m2:maxBytes`)).toBeDefined();
    expect(find(over, `${FB}:m2:recommendedMaxBytes`)).toBeUndefined();
  });

  it('notes that animated formats are published as still images', () => {
    const gif = image('m1', { fileName: 'anim.gif', mimeType: 'image/gif' });
    expect(
      find(check({ media: [gif], selectedAccountIds: [FB_ID] }), `${FB}:m1:staticOnly`),
    ).toMatchObject({
      severity: SEVERITY.INFO,
      message:
        "anim.gif (Facebook): Facebook publishes GIF files as still images. Animation isn't supported.",
    });
  });

  it('warns when the browser could not read a file, and skips the checks that need it', () => {
    const unread = image('m1', {
      inspection: INSPECTION_STATUS.FAILED,
      width: 100,
      height: 1000,
    });
    const result = check({ media: [unread], selectedAccountIds: [IG_ID] });
    expect(find(result, `${IG}:m1:inspection`)).toMatchObject({
      severity: SEVERITY.WARNING,
      scope: 'media',
      mediaId: 'm1',
      message:
        "m1.jpg (Instagram): SocialHub couldn't read this file's dimensions in this browser, so Instagram's limits can't be checked.",
    });
    expect(issueIds(result).filter((id) => id.startsWith(`${IG}:m1:`))).toEqual([
      `${IG}:m1:inspection`,
    ]);

    const clip = video('v1', { inspection: INSPECTION_STATUS.FAILED, durationSec: 1 });
    expect(
      find(check({ media: [clip], selectedAccountIds: [IG_ID] }), `${IG}:v1:inspection`).message,
    ).toMatch(/couldn't read this file's length and dimensions/);
  });

  it('waits for the inspection before checking dimensions or duration', () => {
    const pending = image('m1', {
      inspection: INSPECTION_STATUS.PENDING,
      width: 100,
      height: 1000,
    });
    const clip = video('v1', { inspection: INSPECTION_STATUS.PENDING, durationSec: 1 });
    expect(issueIds(check({ media: [pending], selectedAccountIds: [IG_ID] }))).toEqual([]);
    expect(issueIds(check({ media: [clip], selectedAccountIds: [IG_ID] }))).toEqual([]);
  });

  it('checks the aspect ratio with a small tolerance', () => {
    const at = (width, height) =>
      check({ media: [image('m1', { width, height })], selectedAccountIds: [IG_ID] });
    expect(issueIds(at(1080, 1350))).toEqual([]); // exactly 4:5
    expect(issueIds(at(1910, 1000))).toEqual([]); // exactly 1.91:1
    expect(find(at(1080, 1400), `${IG}:m1:minAspectRatio`)).toMatchObject({
      severity: SEVERITY.ERROR,
      ruleKey: 'media.image.minAspectRatio',
      message: 'm1.jpg (Instagram): too tall for Instagram. The aspect ratio must be at least 4:5.',
    });
    expect(find(at(2000, 1000), `${IG}:m1:maxAspectRatio`)).toMatchObject({
      ruleKey: 'media.image.maxAspectRatio',
      message:
        'm1.jpg (Instagram): too wide for Instagram. The aspect ratio must be at most 1.91:1.',
    });
  });

  it('falls back to the numeric ratio when the rule has no label', () => {
    const rules = testRules();
    delete rules[IG].media.image.minAspectRatioLabel;
    const result = check(
      { media: [image('m1', { width: 1000, height: 2000 })], selectedAccountIds: [IG_ID] },
      { rules },
    );
    expect(find(result, `${IG}:m1:minAspectRatio`).message).toMatch(/must be at least 0\.8\.$/);
  });

  it('suggests larger images below the minimum width', () => {
    const small = image('m1', { width: 300, height: 300 });
    expect(
      find(check({ media: [small], selectedAccountIds: [IG_ID] }), `${IG}:m1:minWidth`),
    ).toMatchObject({
      severity: SEVERITY.INFO,
      message:
        'm1.jpg (Instagram): Instagram scales images narrower than 320 px up, which can look blurry.',
    });
  });

  it('checks the length of a single video', () => {
    const at = (durationSec) =>
      check({ media: [video('v1', { durationSec })], selectedAccountIds: [IG_ID] });
    expect(find(at(1), `${IG}:v1:minDurationSec`)).toMatchObject({
      severity: SEVERITY.ERROR,
      ruleKey: 'media.video.minDurationSec',
      message: 'v1.mp4 (Instagram): 0:01 is shorter than the 0:03 minimum.',
    });
    expect(find(at(1000), `${IG}:v1:maxDurationSec`)).toMatchObject({
      ruleKey: 'media.video.maxDurationSec',
      message: 'v1.mp4 (Instagram): 16:40 is longer than the 15:00 limit.',
    });
    expect(issueIds(at(3))).toEqual([]);
    expect(issueIds(at(900))).toEqual([]);
    expect(issueIds(at(null))).toEqual([]);
  });

  it('suggests the recommended shape for a single video', () => {
    const square = video('v1', { width: 1080, height: 1080 });
    expect(
      find(
        check({ media: [square], selectedAccountIds: [IG_ID] }),
        `${IG}:v1:recommendedAspectRatio`,
      ),
    ).toMatchObject({
      severity: SEVERITY.INFO,
      message:
        'v1.mp4 (Instagram): Instagram recommends 9:16 videos to avoid cropping or blank space.',
    });
    const nearlyVertical = video('v1', { width: 1080, height: 1900 }); // within 2% of 9:16
    expect(issueIds(check({ media: [nearlyVertical], selectedAccountIds: [IG_ID] }))).toEqual([]);
  });

  it('applies the carousel video limits when a video is one of several files', () => {
    const rules = testRules();
    rules[IG].unverified = ['media.carouselVideo.maxDurationSec'];
    const result = check(
      {
        media: [image('m1'), video('v1', { width: 1080, height: 1080, durationSec: 61 })],
        selectedAccountIds: [IG_ID],
      },
      { rules },
    );
    expect(find(result, `${IG}:v1:maxDurationSec`)).toMatchObject({
      severity: SEVERITY.WARNING,
      ruleKey: 'media.carouselVideo.maxDurationSec',
      unverified: true,
      message: `v1.mp4 (Instagram): 1:01 is longer than the 1:00 limit for videos in a carousel. ${UNVERIFIED_NOTE}`,
    });
    // The Reel shape suggestion does not apply inside a carousel.
    expect(find(result, `${IG}:v1:recommendedAspectRatio`)).toBeUndefined();
  });

  it('keeps the video’s own limits in a carousel where none are defined for carousels', () => {
    const result = check({
      media: [video('v1', { durationSec: 601 }), video('v2')],
      selectedAccountIds: [FB_ID],
    });
    expect(find(result, `${FB}:v1:maxDurationSec`)).toMatchObject({
      ruleKey: 'media.video.maxDurationSec',
      message: 'v1.mp4 (Facebook): 10:01 is longer than the 10:00 limit.',
    });
  });

  it('skips platforms that have no rules', () => {
    const rules = { [FB]: testRules()[FB] };
    const result = check({ caption: 'Text only', selectedAccountIds: [FB_ID, IG_ID] }, { rules });
    expect(result.platforms).toEqual([FB, IG]);
    expect(result.issues.filter((i) => i.platform === IG)).toEqual([]);
  });

  // BUG: model/validation.js:254-270 — durations are rounded to whole seconds for the message,
  // so a 2.6 s clip reads "0:03 is shorter than the 0:03 minimum" (and 900.4 s reads "15:00 is
  // longer than the 15:00 limit"). Round down for "shorter", up for "longer", or show tenths.
  it('never tells people a duration is shorter or longer than the same displayed value', () => {
    const short = check({
      media: [video('v1', { durationSec: 2.6 })],
      selectedAccountIds: [IG_ID],
    });
    expect(find(short, `${IG}:v1:minDurationSec`).message).not.toContain(
      '0:03 is shorter than the 0:03',
    );
    const long = check({
      media: [video('v1', { durationSec: 900.4 })],
      selectedAccountIds: [IG_ID],
    });
    expect(find(long, `${IG}:v1:maxDurationSec`).message).not.toContain(
      '15:00 is longer than the 15:00',
    );
  });

  // BUG: model/validation.js:179-185 — formatBytes rounds the file size for the message, so a
  // file slightly over the limit reads "big.jpg (Instagram): 8 MB is over the 8 MB limit."
  it('never tells people a size is over a limit that displays the same', () => {
    const big = image('m1', { fileName: 'big.jpg', sizeBytes: 8_040_000 });
    const issue = find(check({ media: [big], selectedAccountIds: [IG_ID] }), `${IG}:m1:maxBytes`);
    expect(issue.message).not.toContain('8 MB is over the 8 MB limit');
  });
});

describe('validateComposer: alt text', () => {
  it('suggests alt text for each image without it', () => {
    const result = check({
      caption: 'Hi',
      media: [image('m1', { altText: '' }), image('m2', { altText: '   ' }), video('v1')],
      selectedAccountIds: [FB_ID],
    });
    expect(find(result, 'alt-text')).toEqual({
      id: 'alt-text',
      severity: SEVERITY.INFO,
      scope: 'global',
      field: 'altText',
      message: 'Add alt text to 2 images so people using screen readers know what they show.',
    });
  });

  it('uses the singular for one image and stays quiet when every image is described', () => {
    const one = check({
      media: [image('m1', { altText: '' }), image('m2')],
      selectedAccountIds: [],
    });
    expect(find(one, 'alt-text').message).toBe(
      'Add alt text to 1 image so people using screen readers know what it shows.',
    );
    expect(find(check({ media: [image('m1'), video('v1')] }), 'alt-text')).toBeUndefined();
  });
});

describe('validateComposer: grouping', () => {
  const accounts = normalizeAccounts(accountList());
  const busy = () =>
    check(
      {
        caption: '#a #b #c',
        firstComment: 'c'.repeat(61),
        media: [image('m1', { mimeType: 'image/png', altText: '' }), video('v1')],
        selectedAccountIds: [FB_ID, 'acc-ig-2', IG_ID, 'gone'],
      },
      { accounts },
    );

  it('partitions the issues by severity', () => {
    const result = busy();
    expect(result.errors.length + result.warnings.length + result.infos.length).toBe(
      result.issues.length,
    );
    expect(result.errors.every((i) => i.severity === SEVERITY.ERROR)).toBe(true);
    expect(result.warnings.every((i) => i.severity === SEVERITY.WARNING)).toBe(true);
    expect(result.infos.every((i) => i.severity === SEVERITY.INFO)).toBe(true);
    expect(result.isReady).toBe(false);
  });

  it('gives every issue a unique id, a known severity and a message', () => {
    const { issues } = busy();
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
    for (const issue of issues) {
      expect(Object.values(SEVERITY)).toContain(issue.severity);
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('groups platform and media issues by platform, without account issues', () => {
    const result = busy();
    expect(Object.keys(result.byPlatform)).toEqual([FB, IG]);
    expect(result.byPlatform[IG].map((i) => i.id)).toEqual(
      result.issues.filter((i) => i.platform === IG && !i.accountId).map((i) => i.id),
    );
    expect(result.byPlatform[IG].map((i) => i.id)).toContain(`${IG}:m1:mimeTypes`);
    expect(result.byPlatform[IG].map((i) => i.id)).not.toContain('account:acc-ig-2');
  });

  it('groups each account’s own issues with its platform’s issues', () => {
    const result = busy();
    expect(Object.keys(result.byAccount)).toEqual([FB_ID, 'acc-ig-2', IG_ID]);
    expect(result.byAccount['acc-ig-2'].map((i) => i.id)).toEqual([
      'account:acc-ig-2',
      ...result.byPlatform[IG].map((i) => i.id),
    ]);
    expect(result.byAccount[IG_ID]).toEqual(result.byPlatform[IG]);
    expect(result.byAccount[FB_ID]).toEqual(result.byPlatform[FB]);
  });
});

describe('PLATFORM_RULES', () => {
  it.each(COMPOSER_PLATFORMS)('defines every section validation reads for %s', (platform) => {
    const rules = PLATFORM_RULES[platform];
    expect(rules.platform).toBe(platform);
    expect(rules.label).toEqual(expect.any(String));
    expect(rules.label.length).toBeGreaterThan(0);
    expect(rules.caption).toEqual(expect.any(Object));
    expect(rules.firstComment).toEqual(expect.any(Object));
    expect(typeof rules.media.required).toBe('boolean');
    expect(typeof rules.media.allowMixed).toBe('boolean');
    expect(Array.isArray(rules.media.image.mimeTypes)).toBe(true);
    expect(Array.isArray(rules.media.video.mimeTypes)).toBe(true);
    expect(typeof rules.altText.supported).toBe('boolean');
    expect(Array.isArray(rules.unverified)).toBe(true);
    for (const key of rules.unverified) expect(key).toMatch(/^(caption|firstComment|media)\.\w+/);
  });

  it('labels platforms, falling back to the raw value', () => {
    for (const platform of COMPOSER_PLATFORMS) {
      expect(platformLabel(platform)).toBe(PLATFORM_RULES[platform].label);
    }
    expect(platformLabel('TIKTOK')).toBe('TIKTOK');
  });

  it('never lets alt text grow past a platform’s alt text limit', () => {
    for (const platform of COMPOSER_PLATFORMS) {
      const { maxChars } = PLATFORM_RULES[platform].altText;
      if (maxChars) expect(ALT_TEXT_MAX).toBeLessThanOrEqual(maxChars);
    }
  });

  it('lets people attach as many files as any platform allows', () => {
    for (const platform of COMPOSER_PLATFORMS) {
      const { maxItems } = PLATFORM_RULES[platform].media;
      if (maxItems) expect(MEDIA_MAX_ITEMS).toBeGreaterThanOrEqual(maxItems);
    }
  });

  it('is what validateComposer uses by default', () => {
    const state = composer({
      caption: 'Hello #summer',
      media: [image('m1', { mimeType: 'image/png', width: 4000, height: 1000 })],
      selectedAccountIds: [FB_ID, IG_ID],
    });
    expect(validateComposer(state, ACCOUNTS)).toEqual(
      validateComposer(state, ACCOUNTS, PLATFORM_RULES),
    );
  });
});
