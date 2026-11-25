import { SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import {
  META_ERROR_KINDS,
  META_HOSTS,
  MetaApiError,
  metaRequest,
} from '../../../integrations/meta/http.js';
import { facebookSettings, metaSettings } from '../../../integrations/meta/settings.js';
import { AnalyticsError, ANALYTICS_ERROR_CODES, fromMetaError } from '../analyticsError.js';

/**
 * Meta insights through the official Graph API (docs/ANALYTICS.md, "Meta insights"). Runs
 * only with ANALYTICS_MODE=live (off by default), GET requests only. Tested against a
 * simulated Meta; it has not yet been run against a real account with insights permissions.
 *
 * Metric names follow Meta's documentation as checked on 2026-11-23 (impressions and
 * page_fans are retired; views and unique viewers replace them):
 *  - Facebook Page, GET /{page-id}/insights, period=day, at most 90 days per request:
 *      page_media_view → views, page_total_media_view_unique → reach,
 *      page_post_engagements → engagement, page_follows → followers, page_views_total → profileVisits
 *    needs read_insights + pages_read_engagement and a Page token.
 *  - Instagram account, GET /{ig-user-id}/insights, period=day, metric_type=total_value (one
 *    total per request, so one request per day): reach, views, total_interactions → engagement,
 *    likes, comments, shares, saves; followers from the followers_count field (today only).
 *    Needs instagram_manage_insights (Facebook Login) or instagram_business_manage_insights.
 *  - Posts: Facebook post_media_view, post_total_media_view_unique and the post's like,
 *    comment and share counts; Instagram media reach, views, likes, comments, saved, shares,
 *    total_interactions.
 * A metric Meta does not return is left out (unavailable). Nothing is ever estimated.
 */
const E = ANALYTICS_ERROR_CODES;
const DAY_S = 86_400;

export const INSIGHT_SCOPES = Object.freeze({
  FACEBOOK_PAGE: Object.freeze(['read_insights', 'pages_read_engagement']),
  INSTAGRAM_VIA_FACEBOOK: Object.freeze([
    'instagram_basic',
    'instagram_manage_insights',
    'pages_read_engagement',
  ]),
  INSTAGRAM_LOGIN: Object.freeze([
    'instagram_business_basic',
    'instagram_business_manage_insights',
  ]),
  /** Unified Login: no Page involved, so pages_read_engagement is not needed. */
  INSTAGRAM_UNIFIED_LOGIN: Object.freeze(['instagram_basic', 'instagram_manage_insights']),
});

const FACEBOOK_DAILY = Object.freeze({
  page_media_view: 'views',
  page_total_media_view_unique: 'reach',
  page_post_engagements: 'engagement',
  page_follows: 'followers',
  page_views_total: 'profileVisits',
});
const INSTAGRAM_DAILY = Object.freeze({
  reach: 'reach',
  views: 'views',
  total_interactions: 'engagement',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
});
const FACEBOOK_POST = Object.freeze({
  post_media_view: 'views',
  post_total_media_view_unique: 'reach',
});
const INSTAGRAM_MEDIA = Object.freeze({
  reach: 'reach',
  views: 'views',
  likes: 'likes',
  comments: 'comments',
  saved: 'saves',
  shares: 'shares',
  total_interactions: 'engagement',
});

const viaInstagramLogin = (connection) => connection?.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN;
const platformName = (account) =>
  account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT ? 'Instagram' : 'Facebook';

function requiredScopes(account, connection) {
  if (account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) return INSIGHT_SCOPES.FACEBOOK_PAGE;
  if (viaInstagramLogin(connection)) return INSIGHT_SCOPES.INSTAGRAM_LOGIN;
  return connection?.provider === SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN
    ? INSIGHT_SCOPES.INSTAGRAM_UNIFIED_LOGIN
    : INSIGHT_SCOPES.INSTAGRAM_VIA_FACEBOOK;
}

/** Refuses before calling Meta when the login was not granted the insights permissions. */
export function assertInsightScopes(account, connection) {
  const granted = new Set(connection?.grantedScopes ?? []);
  const missing = requiredScopes(account, connection).filter((scope) => !granted.has(scope));
  if (missing.length) {
    throw new AnalyticsError(
      E.PERMISSION_MISSING,
      `This login has not granted the insights permissions: ${missing.join(', ')}. Reconnect it with these permissions to read insights.`,
    );
  }
}

function client(account, connection, accessToken) {
  const instagramLogin = viaInstagramLogin(connection);
  const host = instagramLogin ? META_HOSTS.instagramGraph : META_HOSTS.facebookGraph;
  const root = `${host}/${metaSettings().graphVersion}`;
  const appSecret = instagramLogin ? undefined : facebookSettings()?.appSecret;
  return {
    root,
    get: (path, query) =>
      metaRequest(`${root}/${path}`, { query, accessToken, appSecret }).catch((err) => {
        throw fromMetaError(err, platformName(account));
      }),
  };
}

const isInvalidMetric = (err) =>
  err instanceof AnalyticsError &&
  err.code === E.PLATFORM_REJECTED &&
  err.cause instanceof MetaApiError &&
  err.cause.kind === META_ERROR_KINDS.INVALID_REQUEST;

/**
 * Asks for several metrics at once; if Meta refuses the request because of one metric name
 * (retired or not available for this account), asks for each metric on its own and keeps those
 * that work. Returns { data, refused: [names] }.
 */
async function insightsWithFallback(api, path, names, query) {
  try {
    const body = await api.get(path, { ...query, metric: names.join(',') });
    return { data: body?.data ?? [], refused: [] };
  } catch (err) {
    if (!isInvalidMetric(err) || names.length === 1) throw err;
  }
  const data = [];
  const refused = [];
  for (const name of names) {
    try {
      const body = await api.get(path, { ...query, metric: name });
      data.push(...(body?.data ?? []));
    } catch (err) {
      if (!isInvalidMetric(err)) throw err;
      refused.push(name);
    }
  }
  return { data, refused };
}

const numberOrNull = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Page insights report a day by the end of its period: the reported day is end_time − 1 day. */
const reportedDay = (endTime) =>
  new Date(Date.parse(endTime) - DAY_S * 1000).toISOString().slice(0, 10);

const unixStart = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);

async function facebookDays(api, account, days) {
  const names = Object.keys(FACEBOOK_DAILY);
  const since = days[0];
  const until = new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + DAY_S * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, refused } = await insightsWithFallback(
    api,
    `${encodeURIComponent(account.externalId)}/insights`,
    names,
    { period: 'day', since, until },
  );
  const byDay = new Map(days.map((day) => [day, {}]));
  const reported = new Set();
  for (const series of data) {
    const key = FACEBOOK_DAILY[series?.name];
    if (!key || series.period !== 'day') continue;
    for (const point of series.values ?? []) {
      const day = point?.end_time ? reportedDay(point.end_time) : null;
      const value = numberOrNull(point?.value);
      if (!day || !byDay.has(day) || value === null) continue;
      byDay.get(day)[key] = value;
      reported.add(key);
    }
  }
  return { byDay, reported, refused };
}

async function instagramDays(api, account, days) {
  const names = Object.keys(INSTAGRAM_DAILY);
  const path = `${encodeURIComponent(account.externalId)}/insights`;
  const byDay = new Map(days.map((day) => [day, {}]));
  const reported = new Set();
  let refused = [];
  // metric_type=total_value returns one total for the range asked, so ask one day at a time.
  for (const day of days) {
    const result = await insightsWithFallback(api, path, names, {
      period: 'day',
      metric_type: 'total_value',
      since: unixStart(day),
      until: unixStart(day) + DAY_S,
    });
    refused = [...new Set([...refused, ...result.refused])];
    for (const metric of result.data) {
      const key = INSTAGRAM_DAILY[metric?.name];
      const value = numberOrNull(metric?.total_value?.value);
      if (!key || value === null) continue;
      byDay.get(day)[key] = value;
      reported.add(key);
    }
  }
  return { byDay, reported, refused };
}

export const metaInsightsAdapter = Object.freeze({
  simulated: false,

  /** → { days: [{ day, metrics }], unavailable: [metric keys never reported] } */
  async fetchAccountInsights({ account, connection, accessToken, days, today }) {
    assertInsightScopes(account, connection);
    const api = client(account, connection, accessToken);
    const isFacebook = account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
    const { byDay, reported } = isFacebook
      ? await facebookDays(api, account, days)
      : await instagramDays(api, account, days);
    if (!isFacebook && byDay.has(today)) {
      // Instagram's follower level is only available as "now": record it for today only.
      const body = await api.get(encodeURIComponent(account.externalId), {
        fields: 'followers_count',
      });
      const followers = numberOrNull(body?.followers_count);
      if (followers !== null) {
        byDay.get(today).followers = followers;
        reported.add('followers');
      }
    }
    const all = isFacebook
      ? Object.values(FACEBOOK_DAILY)
      : [...Object.values(INSTAGRAM_DAILY), 'followers'];
    return {
      days: [...byDay]
        .filter(([, metrics]) => Object.keys(metrics).length > 0)
        .map(([day, metrics]) => ({ day, metrics })),
      unavailable: all.filter((key) => !reported.has(key)),
    };
  },

  /** posts: [{ _id, platform, externalPostId }] → { items: [{ postId, metrics }], failed } */
  async fetchPostInsights({ account, connection, accessToken, posts }) {
    assertInsightScopes(account, connection);
    const api = client(account, connection, accessToken);
    const items = [];
    let failed = 0;
    for (const post of posts) {
      if (!post.externalPostId) continue;
      const id = encodeURIComponent(post.externalPostId);
      try {
        const metrics = {};
        if (post.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) {
          const { data } = await insightsWithFallback(
            api,
            `${id}/insights`,
            Object.keys(FACEBOOK_POST),
            {
              period: 'lifetime',
            },
          );
          for (const series of data) {
            const key = FACEBOOK_POST[series?.name];
            const value = numberOrNull(series?.values?.[0]?.value);
            if (key && value !== null) metrics[key] = value;
          }
          const counts = await api.get(id, {
            fields:
              'reactions.type(LIKE).limit(0).summary(total_count),comments.limit(0).summary(true),shares',
          });
          const likes = numberOrNull(counts?.reactions?.summary?.total_count);
          const comments = numberOrNull(counts?.comments?.summary?.total_count);
          const shares = numberOrNull(counts?.shares?.count);
          if (likes !== null) metrics.likes = likes;
          if (comments !== null) metrics.comments = comments;
          if (shares !== null) metrics.shares = shares;
        } else {
          const { data } = await insightsWithFallback(
            api,
            `${id}/insights`,
            Object.keys(INSTAGRAM_MEDIA),
            {},
          );
          for (const series of data) {
            const key = INSTAGRAM_MEDIA[series?.name];
            const value = numberOrNull(series?.values?.[0]?.value ?? series?.total_value?.value);
            if (key && value !== null) metrics[key] = value;
          }
        }
        items.push({ postId: String(post._id), metrics });
      } catch (err) {
        // A login or rate problem affects every post: stop and let the run retry or fail.
        if (err instanceof AnalyticsError && (err.retryable || err.code === E.NEEDS_RECONNECT)) {
          throw err;
        }
        failed += 1;
      }
    }
    return { items, failed };
  },
});
