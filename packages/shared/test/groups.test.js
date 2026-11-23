import { describe, expect, it } from 'vitest';
import {
  facebookGroupCreateSchema,
  facebookGroupUpdateSchema,
  groupShareCreateSchema,
  isFacebookUrl,
  parseFacebookGroupUrl,
  sharingTaskUpdateSchema,
} from '../src/index.js';

const ID = 'a'.repeat(24);

describe('parseFacebookGroupUrl', () => {
  it('accepts group links from every Facebook host and returns one canonical form', () => {
    for (const input of [
      'https://www.facebook.com/groups/Acme.Fans',
      'http://m.facebook.com/groups/Acme.Fans/posts/1?ref=x',
      'facebook.com/groups/acme.fans/',
      'https://web.facebook.com/groups/ACME.FANS/about',
    ]) {
      expect(parseFacebookGroupUrl(input)?.key, input).toBe('acme.fans');
    }
    expect(parseFacebookGroupUrl('https://www.facebook.com/groups/123456/').url).toBe(
      'https://www.facebook.com/groups/123456/',
    );
  });

  it('rejects anything that is not a Facebook Group', () => {
    for (const input of [
      '',
      'https://www.facebook.com/acme',
      'https://facebook.com.evil.example/groups/x',
      'https://evil.example/?u=facebook.com/groups/x',
      'javascript:alert(1)',
      null,
    ]) {
      expect(parseFacebookGroupUrl(input), String(input)).toBeNull();
    }
  });

  it('recognises Facebook post links', () => {
    expect(isFacebookUrl('https://www.facebook.com/groups/x/posts/1')).toBe(true);
    expect(isFacebookUrl('https://fb.com/x')).toBe(true);
    expect(isFacebookUrl('http://www.facebook.com/x')).toBe(false);
    expect(isFacebookUrl('https://notfacebook.com/x')).toBe(false);
  });
});

describe('group schemas', () => {
  it('normalises tags and validates group fields', () => {
    expect(
      facebookGroupCreateSchema.parse({
        name: ' Fans ',
        url: 'facebook.com/groups/fans',
        tags: ['Vegan', 'vegan ', 'London'],
        minDaysBetweenShares: 7,
      }),
    ).toMatchObject({ name: 'Fans', tags: ['vegan', 'london'], minDaysBetweenShares: 7 });
    expect(
      facebookGroupCreateSchema.safeParse({
        name: 'X',
        url: 'facebook.com/groups/x',
        minDaysBetweenShares: 0,
      }).success,
    ).toBe(false);
    expect(facebookGroupUpdateSchema.safeParse({}).success).toBe(false);
    expect(facebookGroupUpdateSchema.parse({ status: 'ARCHIVED' })).toEqual({ status: 'ARCHIVED' });
  });

  it('requires text, groups and https links on shares', () => {
    expect(
      groupShareCreateSchema.safeParse({ title: 'T', message: 'M', groupIds: [ID] }).success,
    ).toBe(true);
    expect(
      groupShareCreateSchema.safeParse({
        title: 'T',
        message: 'M',
        groupIds: [ID],
        link: 'ftp://x',
      }).success,
    ).toBe(false);
    expect(
      groupShareCreateSchema.safeParse({ title: 'T', message: 'M', groupIds: [] }).success,
    ).toBe(false);
  });

  it('accepts only Facebook links as a task’s post link', () => {
    expect(
      sharingTaskUpdateSchema.safeParse({ status: 'DONE', postUrl: 'https://www.facebook.com/x' })
        .success,
    ).toBe(true);
    expect(
      sharingTaskUpdateSchema.safeParse({ status: 'DONE', postUrl: 'https://x.example' }).success,
    ).toBe(false);
    expect(sharingTaskUpdateSchema.safeParse({}).success).toBe(false);
  });
});
