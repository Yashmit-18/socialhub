import { createHash } from 'node:crypto';
import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { AnalyticsError, ANALYTICS_ERROR_CODES } from '../analyticsError.js';

/**
 * SIMULATED insights, for local development and automated tests ONLY.
 *
 * Contacts nobody. Every number is made up, deterministically (the same account and day always
 * give the same values), and is stored with source SIMULATED, which the API and the web app
 * always label as DEMO data. It is never shown as a real Facebook or Instagram figure and never
 * mixed with META data. Like Meta, it leaves out metrics a platform does not report:
 * Facebook Pages have no saves and no profile visits here, so the dashboard shows those as
 * unavailable.
 *
 * Rehearsing failures with TEST accounts (real Meta ids are digits only, so never match):
 *   sim-fail-      refused for good
 *   sim-down-      temporary failure on every attempt
 *   sim-flaky-     temporary failure on the first attempt only
 *   sim-partial-   account insights work, every post's insights fail (a PARTIAL sync)
 */
const E = ANALYTICS_ERROR_CODES;

function unit(...parts) {
  const hash = createHash('sha256').update(parts.join('|')).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}
const between = (u, min, max) => Math.round(min + u * (max - min));

function rehearse(account, attempt) {
  const id = String(account?.externalId ?? '');
  if (id.startsWith('sim-fail-')) {
    throw new AnalyticsError(E.PLATFORM_REJECTED, 'Simulated: the platform refused the request.');
  }
  if (id.startsWith('sim-down-') || (id.startsWith('sim-flaky-') && attempt <= 1)) {
    throw new AnalyticsError(E.PLATFORM_UNAVAILABLE, 'Simulated: a temporary problem.', {
      retryable: true,
    });
  }
}

function dayMetrics(account, day) {
  const key = String(account._id);
  const u = (metric) => unit(key, day, metric);
  const isInstagram = account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;
  const reach = between(u('reach'), 150, 2400);
  const likes = between(u('likes'), Math.round(reach * 0.02), Math.round(reach * 0.08));
  const comments = between(u('comments'), 0, Math.round(reach * 0.01));
  const shares = between(u('shares'), 0, Math.round(reach * 0.008));
  const saves = isInstagram ? between(u('saves'), 0, Math.round(reach * 0.02)) : undefined;
  // A follower level that drifts slowly from day to day.
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const baseFollowers = between(unit(key, 'followers-base'), 800, 25_000);
  const followers = baseFollowers + Math.round((dayNumber % 365) * (unit(key, 'growth') * 4 - 1));
  return {
    reach,
    views: Math.round(reach * (1.2 + u('views') * 0.9)),
    likes,
    comments,
    shares,
    ...(isInstagram ? { saves, profileVisits: between(u('visits'), 5, 120) } : {}),
    engagement: likes + comments + shares + (saves ?? 0),
    followers: Math.max(0, followers),
  };
}

function postMetrics(post) {
  const key = String(post._id);
  const u = (metric) => unit(key, metric);
  const isInstagram = post.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;
  const reach = between(u('reach'), 80, 6000);
  const likes = between(u('likes'), Math.round(reach * 0.01), Math.round(reach * 0.1));
  const comments = between(u('comments'), 0, Math.round(reach * 0.015));
  const shares = between(u('shares'), 0, Math.round(reach * 0.01));
  const saves = isInstagram ? between(u('saves'), 0, Math.round(reach * 0.03)) : undefined;
  return {
    reach,
    views: Math.round(reach * (1.1 + u('views'))),
    likes,
    comments,
    shares,
    ...(isInstagram ? { saves } : {}),
    engagement: likes + comments + shares + (saves ?? 0),
    ...(post.hasVideo
      ? {
          watchTimeSec: between(u('watch'), 60, 20_000),
          avgWatchTimeSec: between(u('avgWatch'), 3, 40),
        }
      : {}),
  };
}

export const simulatedInsightsAdapter = Object.freeze({
  simulated: true,

  /** → { days: [{ day, metrics }], unavailable: [metric keys never reported] } */
  async fetchAccountInsights({ account, days, attempt = 1 }) {
    rehearse(account, attempt);
    const isInstagram = account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;
    return {
      days: days.map((day) => ({ day, metrics: dayMetrics(account, day) })),
      unavailable: isInstagram
        ? ['impressions', 'watchTimeSec', 'avgWatchTimeSec']
        : ['impressions', 'saves', 'profileVisits', 'watchTimeSec', 'avgWatchTimeSec'],
    };
  },

  /** posts: [{ _id, platform, hasVideo }] → { items: [{ postId, metrics }], failed } */
  async fetchPostInsights({ account, posts }) {
    if (String(account?.externalId ?? '').startsWith('sim-partial-')) {
      return { items: [], failed: posts.length };
    }
    return {
      items: posts.map((post) => ({ postId: String(post._id), metrics: postMetrics(post) })),
      failed: 0,
    };
  },
});
