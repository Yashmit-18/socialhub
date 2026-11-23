import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_METRICS,
  METRIC_KEYS,
  analyticsExportQuerySchema,
  analyticsPostsQuerySchema,
  analyticsQuerySchema,
  analyticsSyncSchema,
  engagementRate,
  followerGrowth,
  hasPermission,
  publishingSuccessRate,
  sourceForMode,
} from '../src/index.js';

describe('formulas', () => {
  it('engagement rate is engagement ÷ reach × 100, only when both are reported', () => {
    expect(engagementRate({ engagement: 40, reach: 400 })).toBe(10);
    expect(engagementRate({ engagement: 1, reach: 3 })).toBe(33.33);
    expect(engagementRate({ engagement: 40 })).toBeNull();
    expect(engagementRate({ reach: 400 })).toBeNull();
    expect(engagementRate({ engagement: 0, reach: 0 })).toBeNull();
    expect(engagementRate(null)).toBeNull();
  });

  it('follower growth needs both ends; a missing day is not 0 followers', () => {
    expect(followerGrowth(500, 510)).toBe(10);
    expect(followerGrowth(510, 500)).toBe(-10);
    expect(followerGrowth(null, 510)).toBeNull();
    expect(followerGrowth(500, undefined)).toBeNull();
  });

  it('success rate leaves cancelled and waiting deliveries out', () => {
    expect(publishingSuccessRate({ published: 3, failed: 1 })).toBe(75);
    expect(publishingSuccessRate({ published: 0, failed: 0 })).toBeNull();
    expect(publishingSuccessRate()).toBeNull();
  });

  it('says how each metric adds up over days', () => {
    expect(METRIC_KEYS).toHaveLength(12);
    expect(ANALYTICS_METRICS.followers.aggregate).toBe('last');
    expect(ANALYTICS_METRICS.avgWatchTimeSec.aggregate).toBe('none');
    expect(ANALYTICS_METRICS.reach.rangeLabel).toBe('Daily reach, added up');
  });

  it('maps server modes to sources: simulated is never Meta', () => {
    expect(sourceForMode('SIMULATED')).toBe('SIMULATED');
    expect(sourceForMode('LIVE')).toBe('META');
    expect(sourceForMode('DISABLED')).toBeNull();
  });

  it('lets every role read analytics and only editors and above sync', () => {
    for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']) {
      expect(hasPermission(role, 'analytics:read')).toBe(true);
    }
    expect(hasPermission('EDITOR', 'analytics:sync')).toBe(true);
    expect(hasPermission('VIEWER', 'analytics:sync')).toBe(false);
  });
});

describe('request schemas', () => {
  it('accepts a valid range and filters', () => {
    expect(
      analyticsQuerySchema.parse({
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        platform: 'FACEBOOK_PAGE',
        source: 'SIMULATED',
      }),
    ).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(analyticsQuerySchema.parse({})).toEqual({});
  });

  it.each([
    [{ startDate: '2026-11-30', endDate: '2026-11-01' }, 'endDate'],
    [{ startDate: '2026-11-01' }, 'endDate'],
    [{ endDate: '2026-11-01' }, 'startDate'],
    [{ startDate: '2025-01-01', endDate: '2026-11-01' }, 'endDate'],
    [{ startDate: '2026-02-30', endDate: '2026-03-01' }, 'startDate'],
  ])('refuses %j', (query, path) => {
    const result = analyticsQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual([path]);
  });

  it('refuses unknown fields, sorts and oversized pages', () => {
    expect(analyticsQuerySchema.safeParse({ workspaceId: 'x' }).success).toBe(false);
    expect(analyticsPostsQuerySchema.safeParse({ sortBy: 'password' }).success).toBe(false);
    expect(analyticsPostsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(analyticsPostsQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    expect(analyticsExportQuerySchema.safeParse({ type: 'tokens' }).success).toBe(false);
  });

  it('caps a sync at 100 accounts', () => {
    const ids = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(24, '0'));
    expect(analyticsSyncSchema.safeParse({ accountIds: ids }).success).toBe(false);
    expect(analyticsSyncSchema.safeParse({ accountIds: [] }).success).toBe(false);
    expect(analyticsSyncSchema.parse({})).toEqual({});
  });
});
