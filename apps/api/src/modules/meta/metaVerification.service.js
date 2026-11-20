/**
 * Real-world verification of the Meta integration (READ-ONLY).
 *
 * Evaluates the Phase 2 verification checklist from evidence only: the server's
 * configuration, what is actually stored in MongoDB, what Meta actually returns for the
 * stored tokens (`live`), and the server logs supplied by the operator. It never writes to
 * the database, never calls a Meta endpoint that changes anything, and never prints a token.
 *
 * Statuses:
 *   PASS    — evidence supports the claim
 *   FAIL    — evidence contradicts the claim (a defect or a misconfiguration)
 *   PENDING — the manual step that produces the evidence has not been done yet
 *   BLOCKED — cannot be evaluated until configuration is in place
 */
import mongoose from 'mongoose';
import {
  ACTIVITY_ACTIONS,
  CONNECTION_STATUS,
  PAGE_PUBLISHING_TASK,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import * as facebook from '../../integrations/meta/facebook.js';
import { MetaApiError } from '../../integrations/meta/http.js';
import * as instagram from '../../integrations/meta/instagram.js';
import {
  ActivityLog,
  Membership,
  OAuthState,
  SocialAccount,
  SocialConnection,
  Workspace,
} from '../../models/index.js';
import {
  listAccessibleAccounts,
  listConnections,
} from '../socialAccounts/socialAccount.service.js';
import { effectiveStatus } from './connectionHealth.js';
import { metaIntegrationStatus } from './metaOAuth.service.js';

export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PENDING: 'PENDING',
  BLOCKED: 'BLOCKED',
});

/** Token-shaped strings that must never appear in logs, whatever their origin. */
const LOG_PATTERNS = [
  ['Facebook access token (EAA…)', /EAA[A-Za-z0-9]{20,}/],
  ['Instagram access token (IGAA…/IGQV…)', /IG(?:AA|QV)[A-Za-z0-9_-]{20,}/],
  ['unredacted access_token parameter', /access_token=(?!\[redacted\])[^&\s"'\\]+/],
  [
    'unredacted OAuth code on a callback URL',
    /\/oauth\/(?:facebook|instagram)\/callback\?[^"\s]*\bcode=(?!\[redacted\])[^&\s"]/,
  ],
  [
    'unredacted OAuth state on a callback URL',
    /\/oauth\/(?:facebook|instagram)\/callback\?[^"\s]*\bstate=(?!\[redacted\])[^&\s"]/,
  ],
];

const isHex64 = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v) => String(v?._id ?? v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function result(item, title, status, evidence = []) {
  return { item, title, status, evidence };
}

/** Lines (1-based) of `text` matching `regex`, without echoing the content. */
function matchingLines(text, predicate) {
  const lines = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (predicate(line)) lines.push(index + 1);
  });
  return lines;
}

async function liveFacebookEvidence(connection, token) {
  try {
    const debug = await facebook.debugToken(token);
    const pages = debug.isValid ? await facebook.fetchManagedPages(token) : [];
    return {
      ok: debug.isValid && debug.appId === config.meta.facebook.appId,
      debug,
      pageIds: new Set(pages.map((p) => p.id)),
      pages,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof MetaApiError
          ? `${err.kind} (${err.code ?? 'no code'}): ${err.message}`
          : err.message,
    };
  }
}

async function liveInstagramEvidence(token) {
  try {
    const profile = await instagram.fetchInstagramProfile(token);
    return { ok: Boolean(profile.accountId), profile };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof MetaApiError
          ? `${err.kind} (${err.code ?? 'no code'}): ${err.message}`
          : err.message,
    };
  }
}

/**
 * @param {object} options
 * @param {string} [options.workspaceSlug] limit to one workspace
 * @param {{name: string, text: string}[]} [options.logs] server log files to scan
 * @param {boolean} [options.live] re-validate stored tokens against Meta (read-only calls)
 */
export async function verifyMetaIntegration({ workspaceSlug, logs = [], live = false } = {}) {
  const results = [];
  const status = metaIntegrationStatus();
  const errors = status.checks.filter((c) => c.level === 'error');
  const anyConfigured = status.facebook.configured || status.instagram.configured;

  /* ------------------------------------------------------- 1–3 configuration */
  const missing = [];
  if (!status.facebook.configured) missing.push('META_APP_ID', 'META_APP_SECRET');
  if (!status.instagram.configured) missing.push('INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET');
  results.push(
    result(
      1,
      'Required environment variables',
      !anyConfigured ? STATUS.BLOCKED : errors.length ? STATUS.FAIL : STATUS.PASS,
      [
        `Facebook Login: ${status.facebook.configured ? 'configured' : 'not configured'}`,
        `Instagram Login: ${status.instagram.configured ? 'configured' : 'not configured (optional)'}`,
        ...(missing.length ? [`Not set: ${missing.join(', ')}`] : []),
        ...errors.map((c) => `${c.id}: ${c.message}`),
      ],
    ),
  );
  results.push(
    result(
      2,
      'Meta configuration endpoint (GET /api/v1/integrations/meta)',
      !anyConfigured
        ? STATUS.BLOCKED
        : status.facebook.ready || status.instagram.ready
          ? errors.length
            ? STATUS.FAIL
            : STATUS.PASS
          : STATUS.FAIL,
      [
        `facebook.ready=${status.facebook.ready} instagram.ready=${status.instagram.ready}`,
        ...status.checks.map((c) => `[${c.level}] ${c.id}`),
      ],
    ),
  );
  const httpsProblems = status.checks.filter((c) =>
    ['PUBLIC_URL_NOT_HTTPS', 'CALLBACK_HOST_MISMATCH'].includes(c.id),
  );
  results.push(
    result(
      3,
      'HTTPS callback configuration',
      !anyConfigured ? STATUS.BLOCKED : httpsProblems.length ? STATUS.FAIL : STATUS.PASS,
      [
        `API_PUBLIC_URL resolves to ${status.publicApiUrl}`,
        ...(status.facebook.configured
          ? [`Facebook redirect URI to register: ${status.facebook.redirectUri}`]
          : []),
        ...(status.instagram.configured
          ? [`Instagram redirect URI to register: ${status.instagram.redirectUri}`]
          : []),
        ...httpsProblems.map((c) => `${c.id}: ${c.message}`),
        'Meta-side registration of these URIs can only be confirmed by a successful real login (item 4).',
      ],
    ),
  );

  /* ------------------------------------------------------------ inventory */
  const workspaceFilter = workspaceSlug ? { slug: workspaceSlug } : {};
  const workspaces = await Workspace.find(workspaceFilter).sort({ createdAt: 1 });
  const wsIds = workspaces.map((w) => w._id);
  const [connections, accounts] = await Promise.all([
    SocialConnection.find({ workspace: { $in: wsIds } })
      .select('+accessToken')
      .sort({ createdAt: 1 }),
    SocialAccount.find({ workspace: { $in: wsIds } })
      .select('+accessToken')
      .sort({ platform: 1, name: 1 }),
  ]);
  const connById = new Map(connections.map((c) => [id(c), c]));
  const wsName = new Map(workspaces.map((w) => [id(w), w.slug]));
  const fbConns = connections.filter((c) => c.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN);
  const igConns = connections.filter((c) => c.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN);
  const pages = accounts.filter((a) => a.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE);
  const igAccounts = accounts.filter((a) => a.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT);
  const label = (c) =>
    `"${c.displayName ?? 'unnamed'}" [${id(c).slice(-6)}] in ${wsName.get(id(c.workspace))}`;
  const pendingOr = (blockedWhen) => (blockedWhen ? STATUS.BLOCKED : STATUS.PENDING);

  // Live evidence from Meta (read-only) for each stored connection.
  const liveByConn = new Map();
  if (live) {
    for (const c of connections) {
      if (!c.hasAccessToken()) continue;
      if (c.provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN && config.meta.facebook) {
        liveByConn.set(id(c), await liveFacebookEvidence(c, c.getAccessToken()));
      } else if (c.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN && config.meta.instagram) {
        liveByConn.set(id(c), await liveInstagramEvidence(c.getAccessToken()));
      }
    }
  }

  /* --------------------------------------------- 4 real Facebook OAuth */
  {
    const evidence = fbConns.map((c) => {
      const lv = liveByConn.get(id(c));
      const stored = `${label(c)}: stored status ${effectiveStatus(c).status}, scopes [${c.grantedScopes.join(', ')}]`;
      if (!live) return stored;
      if (!lv) return `${stored}; live: no token to check`;
      return lv.error
        ? `${stored}; live: Meta error ${lv.error}`
        : `${stored}; live: debug_token is_valid=${lv.debug.isValid}, app_id matches=${lv.debug.appId === config.meta.facebook.appId}, expires=${lv.debug.expiresAt?.toISOString() ?? 'never'}`;
    });
    let st;
    if (fbConns.length === 0) st = pendingOr(!status.facebook.configured);
    else if (!live) st = STATUS.PENDING;
    else st = fbConns.some((c) => liveByConn.get(id(c))?.ok) ? STATUS.PASS : STATUS.FAIL;
    if (!live && fbConns.length)
      evidence.push(
        'Run with --live so Meta itself confirms the stored tokens belong to this app.',
      );
    if (fbConns.length === 0) evidence.push('No Facebook connection stored yet.');
    results.push(result(4, 'Facebook OAuth with a real authorized account', st, evidence));
  }

  /* --------------------------------------------- 5 two identities */
  {
    const byWorkspace = new Map();
    for (const c of fbConns) {
      const key = id(c.workspace);
      byWorkspace.set(key, new Set([...(byWorkspace.get(key) ?? []), c.externalUserId]));
    }
    const best = [...byWorkspace.entries()].sort((a, b) => b[1].size - a[1].size)[0];
    const count = best?.[1].size ?? 0;
    results.push(
      result(
        5,
        'Two independent Facebook identities in one workspace',
        count >= 2 ? STATUS.PASS : pendingOr(!status.facebook.configured),
        [
          best
            ? `Workspace ${wsName.get(best[0])}: ${plural(count, 'distinct Facebook identity')} (${plural(fbConns.filter((c) => id(c.workspace) === best[0]).length, 'connection')})`
            : 'No Facebook connections yet.',
        ],
      ),
    );
  }

  /* --------------------------------------------- 6 Pages from both identities */
  {
    const evidence = fbConns.map((c) => {
      const stored = pages.filter((p) => id(p.connection) === id(c)).length;
      const lv = liveByConn.get(id(c));
      return `${label(c)}: ${plural(stored, 'Page')} added${lv?.pages ? `; Meta currently returns ${plural(lv.pages.length, 'Page')} for this identity` : ''}`;
    });
    const withPages = fbConns.filter(
      (c) =>
        pages.some((p) => id(p.connection) === id(c)) ||
        (liveByConn.get(id(c))?.pages?.length ?? 0) > 0,
    );
    results.push(
      result(
        6,
        'Pages retrieved from both identities',
        fbConns.length >= 2 && withPages.length >= 2
          ? STATUS.PASS
          : pendingOr(!status.facebook.configured),
        evidence.length ? evidence : ['No Facebook connections yet.'],
      ),
    );
  }

  /* --------------------------------------------- 7 multiple Pages selected */
  {
    const perWs = new Map();
    for (const p of pages) perWs.set(id(p.workspace), (perWs.get(id(p.workspace)) ?? 0) + 1);
    const max = Math.max(0, ...perWs.values());
    results.push(
      result(
        7,
        'Multiple Pages selected',
        max >= 2 ? STATUS.PASS : pendingOr(!status.facebook.configured),
        [...perWs.entries()]
          .map(([ws, n]) => `Workspace ${wsName.get(ws)}: ${plural(n, 'Page')}`)
          .concat(perWs.size ? [] : ['No Pages added yet.']),
      ),
    );
  }

  /* --------------------------------------------- 8 association with connection */
  {
    const problems = [];
    const evidence = [];
    for (const a of accounts) {
      const c = connById.get(id(a.connection));
      if (!c) {
        problems.push(`${a.platform} "${a.name}" references a connection that does not exist`);
        continue;
      }
      if (id(c.workspace) !== id(a.workspace))
        problems.push(`"${a.name}" belongs to a different workspace than its connection`);
      if (
        a.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE &&
        c.provider !== SOCIAL_PROVIDERS.FACEBOOK_LOGIN
      ) {
        problems.push(`Page "${a.name}" is linked to a non-Facebook connection`);
      }
      const lv = liveByConn.get(id(c));
      let liveNote = '';
      if (lv?.pageIds && a.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) {
        const reachable = lv.pageIds.has(a.externalId);
        liveNote = reachable
          ? '; Meta confirms this identity manages it'
          : '; NOT in this identity’s /me/accounts';
        if (!reachable && a.connectionStatus === CONNECTION_STATUS.ACTIVE)
          problems.push(`Page "${a.name}" is ACTIVE but Meta no longer returns it for ${label(c)}`);
      }
      evidence.push(`${a.platform} "${a.name}" → ${label(c)}${liveNote}`);
    }
    results.push(
      result(
        8,
        'Each Page is associated with the correct SocialConnection',
        accounts.length === 0
          ? pendingOr(!anyConfigured)
          : problems.length
            ? STATUS.FAIL
            : STATUS.PASS,
        [...problems.map((p) => `PROBLEM: ${p}`), ...evidence],
      ),
    );
  }

  /* --------------------------------------------- 9 CREATE_CONTENT */
  {
    const problems = [];
    const evidence = pages.map((p) => {
      const tasks = p.tasks ?? [];
      const canCreate = tasks.includes(PAGE_PUBLISHING_TASK);
      if (p.publishingStatus === PUBLISHING_STATUS.READY && !canCreate)
        problems.push(`"${p.name}" is READY without CREATE_CONTENT`);
      return `"${p.name}": tasks [${tasks.join(', ') || 'none recorded'}] → ${canCreate ? 'has' : 'lacks'} CREATE_CONTENT; publishing readiness ${p.publishingStatus}${p.publishingStatusReason ? ` (${p.publishingStatusReason})` : ''}`;
    });
    results.push(
      result(
        9,
        'CREATE_CONTENT eligibility',
        pages.length === 0
          ? pendingOr(!status.facebook.configured)
          : problems.length
            ? STATUS.FAIL
            : STATUS.PASS,
        [...problems.map((p) => `PROBLEM: ${p}`), ...evidence],
      ),
    );
  }

  /* --------------------------------------------- 10 Instagram discovery */
  {
    const evidence = igAccounts.map((a) => {
      const c = connById.get(id(a.connection));
      return `Instagram "${a.name}"${a.username ? ` @${a.username}` : ''} via ${c?.provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN ? 'Instagram Login' : `Page ${a.linkedFacebookPageExternalId ?? '?'}`} (type ${a.instagramAccountType ?? 'not exposed by Meta'})`;
    });
    for (const c of igConns) {
      const lv = liveByConn.get(id(c));
      if (lv)
        evidence.push(
          `${label(c)}: live /me ${lv.ok ? `OK (account type ${lv.profile.accountType ?? 'unknown'})` : `failed: ${lv.error}`}`,
        );
    }
    const st =
      igAccounts.length > 0
        ? igConns.some((c) => liveByConn.get(id(c))?.ok === false)
          ? STATUS.FAIL
          : STATUS.PASS
        : pendingOr(!anyConfigured);
    results.push(
      result(
        10,
        'Instagram professional account discovery',
        st,
        evidence.length
          ? evidence
          : [
              'No Instagram account added yet (needs an Instagram Business/Creator account linked to a test Page, or Instagram Login).',
            ],
      ),
    );
  }

  /* --------------------------------------------- 11 expiry / revocation */
  {
    const unhealthy = connections.filter((c) =>
      [CONNECTION_STATUS.EXPIRED, CONNECTION_STATUS.REVOKED].includes(effectiveStatus(c).status),
    );
    const events = await ActivityLog.find({
      workspace: { $in: wsIds },
      action: {
        $in: [
          ACTIVITY_ACTIONS.SOCIAL_CONNECTION_STATUS_CHANGED,
          ACTIVITY_ACTIONS.SOCIAL_CONNECTION_REVOKED,
        ],
      },
    })
      .sort({ _id: -1 })
      .limit(20);
    const problems = [];
    for (const c of unhealthy) {
      const own = accounts.filter((a) => id(a.connection) === id(c));
      const stillActive = own.filter((a) => a.connectionStatus === CONNECTION_STATUS.ACTIVE);
      if (stillActive.length && c.status !== CONNECTION_STATUS.ACTIVE)
        problems.push(
          `${label(c)} is ${c.status} but ${plural(stillActive.length, 'account')} still ACTIVE`,
        );
    }
    const evidence = [
      ...unhealthy.map(
        (c) => `${label(c)}: ${effectiveStatus(c).status} — ${effectiveStatus(c).reason ?? ''}`,
      ),
      ...events.map(
        (e) =>
          `Activity ${e.createdAt.toISOString()}: ${e.action} on "${e.target?.label ?? '?'}" ${e.metadata?.from ? `(${e.metadata.from} → ${e.metadata.to})` : ''}`,
      ),
      'Natural 60-day expiry cannot be produced on demand; it is covered by automated tests (effective-status and OAuth 190/463 handling).',
    ];
    results.push(
      result(
        11,
        'Token expiration and revocation handling',
        problems.length
          ? STATUS.FAIL
          : unhealthy.length || events.length
            ? STATUS.PASS
            : pendingOr(!anyConfigured),
        [...problems.map((p) => `PROBLEM: ${p}`), ...evidence],
      ),
    );
  }

  /* --------------------------------------------- 12 disconnect isolation */
  {
    const disconnected = connections.filter((c) => c.status === CONNECTION_STATUS.DISCONNECTED);
    const problems = [];
    const evidence = [];
    let isolated = false;
    for (const c of disconnected) {
      if (c.hasAccessToken()) problems.push(`${label(c)} is DISCONNECTED but still holds a token`);
      const own = accounts.filter((a) => id(a.connection) === id(c));
      const leftovers = own.filter(
        (a) => a.hasAccessToken() || a.connectionStatus === CONNECTION_STATUS.ACTIVE,
      );
      if (leftovers.length)
        problems.push(
          `${plural(leftovers.length, 'account')} of disconnected ${label(c)} still active or holding tokens`,
        );
      const siblings = connections.filter(
        (o) =>
          id(o) !== id(c) &&
          id(o.workspace) === id(c.workspace) &&
          o.status === CONNECTION_STATUS.ACTIVE,
      );
      for (const s of siblings) {
        const sAccounts = accounts.filter((a) => id(a.connection) === id(s));
        const healthy =
          s.hasAccessToken() &&
          sAccounts.every(
            (a) => a.hasAccessToken() || a.connectionStatus !== CONNECTION_STATUS.ACTIVE,
          );
        evidence.push(
          `After disconnecting ${label(c)}: ${label(s)} is still ACTIVE with ${s.hasAccessToken() ? 'its token' : 'NO TOKEN'} and ${plural(sAccounts.filter((a) => a.connectionStatus === CONNECTION_STATUS.ACTIVE).length, 'active account')}`,
        );
        if (!healthy)
          problems.push(`${label(s)} lost tokens after another connection was disconnected`);
        else isolated = true;
      }
    }
    results.push(
      result(
        12,
        'Disconnecting one account does not affect others',
        problems.length ? STATUS.FAIL : isolated ? STATUS.PASS : pendingOr(!anyConfigured),
        [
          ...problems.map((p) => `PROBLEM: ${p}`),
          ...evidence,
          ...(disconnected.length === 0
            ? [
                'No connection has been disconnected yet (disconnect one of two connected identities).',
              ]
            : []),
        ],
      ),
    );
  }

  /* --------------------------------------------- 13 tokens in responses / logs */
  {
    const problems = [];
    const evidence = [];
    const tokens = [];
    for (const [collection, docs] of [
      ['socialconnections', connections],
      ['socialaccounts', accounts],
    ]) {
      for (const doc of docs) {
        if (!doc.hasAccessToken()) continue;
        let plain;
        try {
          plain = doc.getAccessToken();
        } catch {
          problems.push(
            `A stored token in ${collection} [${id(doc).slice(-6)}] fails authenticated decryption`,
          );
          continue;
        }
        tokens.push(plain);
        const raw = await mongoose.connection.db.collection(collection).findOne({ _id: doc._id });
        if (!raw?.accessToken?.ciphertext || !raw?.accessToken?.authTag)
          problems.push(
            `${collection} [${id(doc).slice(-6)}] token is not stored as AES-GCM ciphertext`,
          );
        if (JSON.stringify(raw).includes(plain))
          problems.push(`${collection} [${id(doc).slice(-6)}] contains the plaintext token`);
      }
    }
    evidence.push(
      `${plural(tokens.length, 'stored token')} decrypted for comparison (never printed); all stored as AES-256-GCM ciphertext unless reported above.`,
    );

    // What the API sends to browsers, rendered by the same service functions.
    for (const ws of workspaces) {
      const views = JSON.stringify({
        connections: await listConnections(ws._id),
        accounts: await listAccessibleAccounts({
          workspace: ws._id,
          role: 'OWNER',
          accountAccess: { mode: 'ALL' },
        }),
      });
      if (/accessToken|ciphertext|authTag/.test(views))
        problems.push(`API views for workspace ${ws.slug} contain token fields`);
      if (tokens.some((t) => views.includes(t)))
        problems.push(`API views for workspace ${ws.slug} contain a real token`);
    }
    evidence.push(
      `API responses (connections + accounts) checked for ${plural(workspaces.length, 'workspace')}.`,
    );

    const secrets = [
      ['META_APP_SECRET', config.meta.facebook?.appSecret],
      ['INSTAGRAM_APP_SECRET', config.meta.instagram?.appSecret],
      ['JWT_ACCESS_SECRET', config.auth.accessSecret],
      ['TOKEN_ENCRYPTION_KEY', config.tokenEncryptionKey.toString('base64')],
    ].filter(([, v]) => v);
    for (const log of logs) {
      const hits = [];
      for (const t of tokens) {
        const lines = matchingLines(log.text, (l) => l.includes(t));
        if (lines.length) hits.push(`a stored token on line(s) ${lines.slice(0, 5).join(', ')}`);
      }
      for (const [name, value] of secrets) {
        const lines = matchingLines(log.text, (l) => l.includes(value));
        if (lines.length) hits.push(`${name} on line(s) ${lines.slice(0, 5).join(', ')}`);
      }
      for (const [name, regex] of LOG_PATTERNS) {
        const lines = matchingLines(log.text, (l) => regex.test(l));
        if (lines.length) hits.push(`${name} on line(s) ${lines.slice(0, 5).join(', ')}`);
      }
      const callbacks = matchingLines(log.text, (l) =>
        /\/oauth\/(?:facebook|instagram)\/callback/.test(l),
      ).length;
      if (hits.length) problems.push(`Log ${log.name}: ${hits.join('; ')}`);
      else
        evidence.push(
          `Log ${log.name}: ${log.text.split(/\r?\n/).length} lines, ${plural(callbacks, 'OAuth callback request')}, no tokens or secrets found.`,
        );
    }
    if (logs.length === 0)
      evidence.push('No server log supplied (--log <file>); logs not checked.');

    let st;
    if (problems.length) st = STATUS.FAIL;
    else if (tokens.length === 0) st = pendingOr(!anyConfigured);
    else if (logs.length === 0) st = STATUS.PENDING;
    else st = STATUS.PASS;
    results.push(
      result(13, 'Tokens never appear in browser responses or logs', st, [
        ...problems.map((p) => `PROBLEM: ${p}`),
        ...evidence,
      ]),
    );
  }

  /* --------------------------------------------- 14 workspace isolation */
  {
    const problems = [];
    for (const a of accounts) {
      const c = connById.get(id(a.connection));
      if (c && id(c.workspace) !== id(a.workspace))
        problems.push(`"${a.name}" and its connection are in different workspaces`);
    }
    const accountWs = new Map(accounts.map((a) => [id(a), id(a.workspace)]));
    const memberships = await Membership.find({
      workspace: { $in: wsIds },
      'accountAccess.socialAccounts.0': { $exists: true },
    });
    for (const m of memberships) {
      for (const ref of m.accountAccess.socialAccounts) {
        const ws = accountWs.get(id(ref));
        if (ws && ws !== id(m.workspace))
          problems.push(`A member's account access references an account from another workspace`);
      }
    }
    const identities = new Map();
    for (const c of connections)
      identities.set(`${c.provider}:${c.externalUserId}`, [
        ...(identities.get(`${c.provider}:${c.externalUserId}`) ?? []),
        wsName.get(id(c.workspace)),
      ]);
    const shared = [...identities.values()].filter((list) => list.length > 1);
    results.push(
      result(
        14,
        'Workspace isolation and account permissions',
        problems.length ? STATUS.FAIL : accounts.length ? STATUS.PASS : pendingOr(!anyConfigured),
        [
          ...problems.map((p) => `PROBLEM: ${p}`),
          `${plural(accounts.length, 'account')} and ${plural(memberships.length, 'restricted member')} checked for cross-workspace references.`,
          ...shared.map(
            (list) => `One identity is connected independently in workspaces: ${list.join(', ')}`,
          ),
          'API-level isolation (404 for other workspaces, role checks) is covered by automated tests; see the runbook for the manual role check.',
        ],
      ),
    );
  }

  /* --------------------------------------------- 15 OAuth state security */
  {
    const states = await OAuthState.find({ workspace: { $in: wsIds } });
    const problems = states
      .filter((s) => !isHex64(s.stateHash) || !isHex64(s.browserBindingHash))
      .map((s) => `OAuth state [${id(s).slice(-6)}] is not stored as SHA-256 digests`);
    const consumed = states.filter((s) => s.consumedAt).length;
    const expiredOpen = states.filter((s) => !s.consumedAt && s.expiresAt <= new Date()).length;
    results.push(
      result(
        15,
        'OAuth state and callback security',
        problems.length ? STATUS.FAIL : consumed > 0 ? STATUS.PASS : pendingOr(!anyConfigured),
        [
          ...problems.map((p) => `PROBLEM: ${p}`),
          `${plural(states.length, 'recent OAuth state')} (purged an hour after expiry): ${consumed} consumed, ${expiredOpen} expired unused; all stored as digests unless reported above.`,
          'Replay, cross-browser and cancellation rejection are covered by automated + production-mode tests; repeat them manually per the runbook for real-world evidence.',
        ],
      ),
    );
  }

  return {
    results,
    inventory: {
      workspaces: workspaces.map((w) => w.slug),
      facebookConnections: fbConns.length,
      instagramConnections: igConns.length,
      facebookPages: pages.length,
      instagramAccounts: igAccounts.length,
    },
    live,
    logsScanned: logs.map((l) => l.name),
  };
}
