import { describe, expect, it } from 'vitest';
import {
  HASHTAG_PLACEMENTS,
  TEXT_LIMITS,
  composeCaption,
  composeFirstComment,
  countChars,
  extractHashtags,
  extractMentions,
  mergeUnique,
  normalizeHashtag,
  normalizeKeyword,
  parseHashtagInput,
  parseKeywordInput,
  removeItem,
  summarize,
  uniqueFolded,
} from './text.js';

const { CAPTION, FIRST_COMMENT } = HASHTAG_PLACEMENTS;
const INVALID_TAG = /can only contain letters, numbers and underscores\.$/;

describe('constants', () => {
  it('defines the two hashtag placements', () => {
    expect(HASHTAG_PLACEMENTS).toEqual({ CAPTION: 'CAPTION', FIRST_COMMENT: 'FIRST_COMMENT' });
    expect(Object.isFrozen(HASHTAG_PLACEMENTS)).toBe(true);
  });

  it('defines positive integer input limits that cannot be changed at runtime', () => {
    expect(Object.isFrozen(TEXT_LIMITS)).toBe(true);
    for (const key of [
      'HASHTAG_MAX_LENGTH',
      'HASHTAGS_MAX',
      'KEYWORD_MAX_LENGTH',
      'KEYWORDS_MAX',
    ]) {
      expect(Number.isInteger(TEXT_LIMITS[key]) && TEXT_LIMITS[key] > 0).toBe(true);
    }
  });
});

describe('countChars', () => {
  it('returns 0 for empty values', () => {
    expect(countChars('')).toBe(0);
    expect(countChars(null)).toBe(0);
    expect(countChars(undefined)).toBe(0);
  });

  it('counts plain characters, spaces and new lines', () => {
    expect(countChars('Hello')).toBe(5);
    expect(countChars('a b\nc')).toBe(5);
  });

  it('counts an emoji once although it takes two UTF-16 units', () => {
    expect('😀'.length).toBe(2);
    expect(countChars('😀')).toBe(1);
    expect(countChars('😀'.repeat(10))).toBe(10);
  });

  it('counts Unicode code points, not visual characters', () => {
    // Waving hand + skin-tone modifier.
    expect(countChars('Hi 👋🏽')).toBe(5);
    // Family emoji: three people joined by two zero-width joiners.
    expect(countChars('👨‍👩‍👧')).toBe(5);
    // "é" precomposed vs. "e" + combining acute accent.
    expect(countChars('é')).toBe(1);
    expect(countChars('é')).toBe(2);
  });
});

describe('normalizeHashtag', () => {
  it.each([
    ['summer', 'summer'],
    ['#summer', 'summer'],
    ['  #summer  ', 'summer'],
    ['###summer', 'summer'],
    ['＃summer', 'summer'],
    ['Summer_2026', 'Summer_2026'],
    ['café', 'café'],
    ['日本', '日本'],
    ['١٢٣', '١٢٣'],
  ])('normalizes %j to %j', (raw, tag) => {
    expect(normalizeHashtag(raw)).toEqual({ tag });
  });

  it.each(['', '   ', '#', '##', '＃', null, undefined])(
    'returns a null tag (skipped silently) for empty input %j',
    (raw) => {
      expect(normalizeHashtag(raw)).toEqual({ tag: null });
    },
  );

  it.each(['sum-mer', 'two words', 'summer!', 'summer#', '🔥', 'a.b'])('rejects %j', (raw) => {
    const result = normalizeHashtag(raw);
    expect(result).not.toHaveProperty('tag');
    expect(result.error).toMatch(INVALID_TAG);
  });

  it('names the rejected hashtag in the error', () => {
    expect(normalizeHashtag('#sum-mer')).toEqual({
      error: '#sum-mer can only contain letters, numbers and underscores.',
    });
  });

  it('enforces the maximum length, counted in code points', () => {
    const max = TEXT_LIMITS.HASHTAG_MAX_LENGTH;
    expect(normalizeHashtag('a'.repeat(max))).toEqual({ tag: 'a'.repeat(max) });
    expect(normalizeHashtag(`#${'a'.repeat(max + 1)}`)).toEqual({
      error: `Hashtags can be at most ${max} characters.`,
    });
    // Mathematical script letters are single letters that take two UTF-16 units each.
    expect(normalizeHashtag('𝒜'.repeat(max))).toEqual({ tag: '𝒜'.repeat(max) });
  });
});

describe('parseHashtagInput', () => {
  it('splits on spaces, commas, semicolons, new lines and # signs', () => {
    expect(parseHashtagInput('#summer #sale, deals;\nnew#arrivals')).toEqual({
      tags: ['summer', 'sale', 'deals', 'new', 'arrivals'],
      errors: [],
    });
  });

  it('splits on full-width and CJK separators', () => {
    expect(parseHashtagInput('＃夏，セール、sale').tags).toEqual(['夏', 'セール', 'sale']);
  });

  it('de-duplicates case-insensitively and keeps the first spelling', () => {
    expect(parseHashtagInput('#Summer #summer #SUMMER #sale #Sale')).toEqual({
      tags: ['Summer', 'sale'],
      errors: [],
    });
  });

  it('keeps the valid tags and reports each invalid one', () => {
    expect(parseHashtagInput('#ok #bad-tag #fine #no!')).toEqual({
      tags: ['ok', 'fine'],
      errors: [
        '#bad-tag can only contain letters, numbers and underscores.',
        '#no! can only contain letters, numbers and underscores.',
      ],
    });
  });

  it('reports hashtags over the length limit', () => {
    const long = 'x'.repeat(TEXT_LIMITS.HASHTAG_MAX_LENGTH + 1);
    expect(parseHashtagInput(`#short #${long}`)).toEqual({
      tags: ['short'],
      errors: [`Hashtags can be at most ${TEXT_LIMITS.HASHTAG_MAX_LENGTH} characters.`],
    });
  });

  it.each(['', '   ', '# , ;\n', null, undefined])('returns nothing for %j', (input) => {
    expect(parseHashtagInput(input)).toEqual({ tags: [], errors: [] });
  });
});

describe('normalizeKeyword', () => {
  it('trims and collapses whitespace but keeps the case', () => {
    expect(normalizeKeyword('  Coffee \n\t Shop ')).toEqual({ keyword: 'Coffee Shop' });
  });

  it.each(['', '   ', '\n\t', null, undefined])('returns a null keyword for %j', (raw) => {
    expect(normalizeKeyword(raw)).toEqual({ keyword: null });
  });

  it('allows punctuation and symbols (keywords are free text)', () => {
    expect(normalizeKeyword('C++ tips & 50% off #brand')).toEqual({
      keyword: 'C++ tips & 50% off #brand',
    });
  });

  it('enforces the maximum length, counted in code points', () => {
    const max = TEXT_LIMITS.KEYWORD_MAX_LENGTH;
    expect(normalizeKeyword('k'.repeat(max))).toEqual({ keyword: 'k'.repeat(max) });
    expect(normalizeKeyword('😀'.repeat(max))).toEqual({ keyword: '😀'.repeat(max) });
    expect(normalizeKeyword('k'.repeat(max + 1))).toEqual({
      error: `Keywords can be at most ${max} characters.`,
    });
  });
});

describe('parseKeywordInput', () => {
  it('keeps multi-word phrases and splits on commas, semicolons and new lines', () => {
    expect(parseKeywordInput('local seo, coffee shop; latte art\nbarista')).toEqual({
      keywords: ['local seo', 'coffee shop', 'latte art', 'barista'],
      errors: [],
    });
  });

  it('cleans whitespace, including Windows line endings and tabs', () => {
    expect(parseKeywordInput('  summer   sale \t deals ,\r\nwinter\r\n').keywords).toEqual([
      'summer sale deals',
      'winter',
    ]);
  });

  it('splits on full-width and CJK commas', () => {
    expect(parseKeywordInput('咖啡，拿铁、cafe').keywords).toEqual(['咖啡', '拿铁', 'cafe']);
  });

  it('de-duplicates case-insensitively after whitespace is cleaned', () => {
    expect(parseKeywordInput('Local SEO, local  seo; LOCAL SEO').keywords).toEqual(['Local SEO']);
  });

  it('keeps the valid keywords and reports the ones over the length limit', () => {
    const long = 'k'.repeat(TEXT_LIMITS.KEYWORD_MAX_LENGTH + 1);
    expect(parseKeywordInput(`brand, ${long}, launch`)).toEqual({
      keywords: ['brand', 'launch'],
      errors: [`Keywords can be at most ${TEXT_LIMITS.KEYWORD_MAX_LENGTH} characters.`],
    });
  });

  it.each(['', ' , ;\n', null, undefined])('returns nothing for %j', (input) => {
    expect(parseKeywordInput(input)).toEqual({ keywords: [], errors: [] });
  });
});

describe('mergeUnique', () => {
  it('appends new items in order, skipping case-insensitive duplicates', () => {
    expect(mergeUnique(['Summer'], ['summer', 'sale', 'SALE', 'deals'])).toEqual([
      'Summer',
      'sale',
      'deals',
    ]);
  });

  it('stops adding at max', () => {
    expect(mergeUnique(['a'], ['b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('never drops existing items when the list is already at or over max', () => {
    expect(mergeUnique(['a', 'b', 'c'], ['d'], 2)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its arguments', () => {
    const list = ['a'];
    const additions = ['b'];
    const merged = mergeUnique(list, additions);
    expect(merged).toEqual(['a', 'b']);
    expect(merged).not.toBe(list);
    expect(list).toEqual(['a']);
    expect(additions).toEqual(['b']);
  });
});

describe('removeItem', () => {
  it('removes case-insensitive matches without mutating the list', () => {
    const list = ['Summer', 'sale', 'SUMMER'];
    expect(removeItem(list, 'summer')).toEqual(['sale']);
    expect(list).toEqual(['Summer', 'sale', 'SUMMER']);
  });

  it('returns an equal list when nothing matches', () => {
    expect(removeItem(['a', 'b'], 'c')).toEqual(['a', 'b']);
  });
});

describe('uniqueFolded', () => {
  it('keeps the first value of each case-insensitive group, in order', () => {
    expect(uniqueFolded(['Acme', 'beta', 'ACME', 'Beta', 'gamma'])).toEqual([
      'Acme',
      'beta',
      'gamma',
    ]);
  });
});

describe('extractHashtags', () => {
  it('returns hashtags in order of appearance, without "#", including repeats', () => {
    expect(extractHashtags('#Sun is out. #beach day #sun')).toEqual(['Sun', 'beach', 'sun']);
  });

  it('supports letters from any script, numbers and underscores', () => {
    expect(extractHashtags('#café #日本 #tag_2026')).toEqual(['café', '日本', 'tag_2026']);
  });

  it('ends a hashtag at the first character that cannot be part of one', () => {
    expect(extractHashtags('#tag-two #end. (#paren)')).toEqual(['tag', 'end', 'paren']);
  });

  it('ignores "#" inside words, URLs and HTML entities', () => {
    expect(extractHashtags('page#section https://example.com/#anchor &#39; C#')).toEqual([]);
  });

  it('finds hashtags at the start of any line', () => {
    expect(extractHashtags('Hello\n#one\n\n#two')).toEqual(['one', 'two']);
  });

  it('returns [] for empty values', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
  });
});

describe('extractMentions', () => {
  it('returns usernames with letters, numbers, periods and underscores', () => {
    expect(extractMentions('Thanks @acme and @jane_doe! cc @Acme.Studio')).toEqual([
      'acme',
      'jane_doe',
      'Acme.Studio',
    ]);
  });

  it('ignores email addresses and doubled "@"', () => {
    expect(extractMentions('Write to ada@example.com or @@team')).toEqual([]);
  });

  it('counts repeats and mentions at the start of lines', () => {
    expect(extractMentions('@a\n@a @b')).toEqual(['a', 'a', 'b']);
  });

  it('reads at most 30 characters of a username (one mention)', () => {
    expect(extractMentions(`@${'a'.repeat(35)}`)).toEqual(['a'.repeat(30)]);
  });

  it('returns [] for empty values', () => {
    expect(extractMentions('')).toEqual([]);
    expect(extractMentions(null)).toEqual([]);
  });
});

describe('composeCaption', () => {
  it('appends the hashtags after a blank line when they go in the caption', () => {
    expect(
      composeCaption({ caption: 'Hello', hashtags: ['summer', 'sale'], hashtagPlacement: CAPTION }),
    ).toBe('Hello\n\n#summer #sale');
  });

  it('skips hashtags that are already written in the caption, ignoring case', () => {
    expect(
      composeCaption({
        caption: 'Hello #Summer',
        hashtags: ['summer', 'sale'],
        hashtagPlacement: CAPTION,
      }),
    ).toBe('Hello #Summer\n\n#sale');
  });

  it('returns the caption unchanged when every hashtag is already in it', () => {
    expect(
      composeCaption({ caption: '#a and #B', hashtags: ['A', 'b'], hashtagPlacement: CAPTION }),
    ).toBe('#a and #B');
  });

  it('does not mistake a URL fragment for a hashtag that is already present', () => {
    expect(
      composeCaption({
        caption: 'See https://acme.test/#summer',
        hashtags: ['summer'],
        hashtagPlacement: CAPTION,
      }),
    ).toBe('See https://acme.test/#summer\n\n#summer');
  });

  it('uses only the hashtag line when the caption is blank', () => {
    expect(composeCaption({ caption: '', hashtags: ['a', 'b'], hashtagPlacement: CAPTION })).toBe(
      '#a #b',
    );
    expect(composeCaption({ caption: '  \n ', hashtags: ['a'], hashtagPlacement: CAPTION })).toBe(
      '#a',
    );
  });

  it('trims the caption', () => {
    expect(
      composeCaption({ caption: '  Hello \n', hashtags: ['a'], hashtagPlacement: CAPTION }),
    ).toBe('Hello\n\n#a');
    expect(composeCaption({ caption: '  Hello \n', hashtagPlacement: CAPTION })).toBe('Hello');
  });

  it('leaves hashtags out when they go in the first comment or the placement is unknown', () => {
    const input = { caption: ' Hello ', hashtags: ['summer'] };
    expect(composeCaption({ ...input, hashtagPlacement: FIRST_COMMENT })).toBe('Hello');
    expect(composeCaption({ ...input, hashtagPlacement: undefined })).toBe('Hello');
    expect(composeCaption({ ...input, hashtagPlacement: 'SOMEWHERE' })).toBe('Hello');
  });

  it('treats a missing caption as empty', () => {
    expect(composeCaption({ caption: null, hashtagPlacement: CAPTION })).toBe('');
    expect(composeCaption({ caption: undefined, hashtagPlacement: FIRST_COMMENT })).toBe('');
  });
});

describe('composeFirstComment', () => {
  it('appends the hashtags after a blank line when they go in the first comment', () => {
    expect(
      composeFirstComment({
        firstComment: 'Link in bio',
        hashtags: ['summer', 'sale'],
        hashtagPlacement: FIRST_COMMENT,
      }),
    ).toBe('Link in bio\n\n#summer #sale');
  });

  it('is only the hashtags when the comment is empty', () => {
    expect(
      composeFirstComment({ firstComment: '', hashtags: ['a'], hashtagPlacement: FIRST_COMMENT }),
    ).toBe('#a');
  });

  it('skips hashtags already written in the comment', () => {
    expect(
      composeFirstComment({
        firstComment: 'More #Sale',
        hashtags: ['sale', 'deals'],
        hashtagPlacement: FIRST_COMMENT,
      }),
    ).toBe('More #Sale\n\n#deals');
  });

  it('is just the trimmed comment when the hashtags go in the caption', () => {
    expect(
      composeFirstComment({ firstComment: ' Hi ', hashtags: ['a'], hashtagPlacement: CAPTION }),
    ).toBe('Hi');
    expect(composeFirstComment({ firstComment: null, hashtagPlacement: CAPTION })).toBe('');
  });
});

describe('summarize', () => {
  it('returns the first non-empty line, trimmed', () => {
    expect(summarize('\n   \n  Big news!  \nMore details')).toBe('Big news!');
    expect(summarize('Hello\r\nWorld')).toBe('Hello');
  });

  it('keeps lines up to max characters and shortens longer ones with an ellipsis', () => {
    expect(summarize('x'.repeat(60))).toBe('x'.repeat(60));
    expect(summarize('x'.repeat(61))).toBe(`${'x'.repeat(59)}…`);
    expect(summarize('abcdefghij', 5)).toBe('abcd…');
    expect(countChars(summarize('y'.repeat(200), 20))).toBe(20);
  });

  it('never splits an emoji when shortening', () => {
    expect(summarize('😀'.repeat(10), 5)).toBe('😀😀😀😀…');
  });

  it.each(['', '   \n\t\n', null, undefined])('returns an empty string for %j', (text) => {
    expect(summarize(text)).toBe('');
  });
});
