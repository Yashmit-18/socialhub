/**
 * Unit tests for the pure health rules in src/modules/meta/connectionHealth.js: destination
 * health (readiness, eligibility, attention), login-level attention, effective connection status
 * and the API view of a connection.
 *
 * Meta is not involved: every case evaluates in-memory SocialConnection / SocialAccount documents
 * (built with `new Model({...})`, never saved) at a fixed instant.
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ATTENTION,
  CONNECTION_STATUS,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
  SYNC_OUTCOMES,
} from '@socialhub/shared';
import { SocialAccount, SocialConnection } from '../src/models/index.js';
import {
  EXPIRING_SOON_DAYS,
  STATUS_REASONS,
  accountHealth,
  assessPublishing,
  connectionAttention,
  connectionView,
  effectiveStatus,
} from '../src/modules/meta/connectionHealth.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);
const oid = () => new mongoose.Types.ObjectId();

/** What a Facebook Login with every permission SocialHub asks for reports as granted. */
const FACEBOOK_GRANTS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];
const INSTAGRAM_GRANTS = ['instagram_business_basic', 'instagram_business_content_publish'];
const ADMIN_TASKS = ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'];
const without = (list, ...removed) => list.filter((item) => !removed.includes(item));

function facebookLogin(overrides = {}) {
  return new SocialConnection({
    workspace: oid(),
    provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
    externalUserId: '100',
    displayName: 'Alice',
    pictureUrl: 'https://example.fbcdn.net/100.jpg',
    grantedScopes: FACEBOOK_GRANTS,
    tokenExpiresAt: at(50 * DAY),
    dataAccessExpiresAt: at(80 * DAY),
    lastSyncedAt: at(-DAY),
    lastSyncAttemptAt: at(-DAY),
    lastSyncOutcome: SYNC_OUTCOMES.SUCCESS,
    connectedBy: oid(),
    ...overrides,
  });
}

function instagramLogin(overrides = {}) {
  return new SocialConnection({
    workspace: oid(),
    provider: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN,
    externalUserId: '9001',
    displayName: 'acme',
    grantedScopes: INSTAGRAM_GRANTS,
    tokenExpiresAt: at(50 * DAY),
    connectedBy: oid(),
    ...overrides,
  });
}

function destination(connection, overrides = {}) {
  return new SocialAccount({
    workspace: connection.workspace,
    connection: connection._id,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    externalId: '5001',
    name: 'Acme Store',
    tasks: ADMIN_TASKS,
    connectedBy: connection.connectedBy,
    ...overrides,
  });
}

const facebookPage = (connection, overrides) => destination(connection, overrides);

/** An Instagram professional account reached through its linked Page (Facebook Login). */
const instagramViaPage = (connection, overrides) =>
  destination(connection, {
    platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
    externalId: '17841400000000010',
    name: 'Acme',
    username: 'acme',
    linkedFacebookPageExternalId: '5001',
    linkedFacebookPageName: 'Acme Store',
    ...overrides,
  });

/** An Instagram professional account connected directly with Instagram Login (no Page, no tasks). */
const instagramDirect = (connection, overrides) =>
  destination(connection, {
    platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
    externalId: '17841400000000001',
    name: 'acme',
    username: 'acme',
    tasks: undefined,
    ...overrides,
  });

const HEALTHY = Object.freeze({
  connectionStatus: CONNECTION_STATUS.ACTIVE,
  connectionStatusReason: null,
  readiness: PUBLISHING_STATUS.READY,
  readinessReasons: [],
  eligibility: { eligible: true, createContent: true, missingPermissions: [] },
  attention: [],
  needsAttention: false,
});

const codes = (attention) => attention.map((item) => item.code);

describe('accountHealth: publishing permissions and the CREATE_CONTENT Page task', () => {
  it('is READY with every publishing permission and the CREATE_CONTENT task, with no attention', () => {
    const connection = facebookLogin();
    expect(accountHealth(facebookPage(connection), connection, NOW)).toEqual(HEALTHY);
    expect(accountHealth(instagramViaPage(connection), connection, NOW)).toEqual(HEALTHY);
  });

  it('is RESTRICTED with MISSING_CREATE_CONTENT when the Page role lacks CREATE_CONTENT', () => {
    const connection = facebookLogin();
    // MANAGE alone is not treated as enough to create content.
    for (const tasks of [['ANALYZE', 'MANAGE'], []]) {
      const health = accountHealth(facebookPage(connection, { tasks }), connection, NOW);
      expect(health).toEqual({
        connectionStatus: CONNECTION_STATUS.ACTIVE,
        connectionStatusReason: null,
        readiness: PUBLISHING_STATUS.RESTRICTED,
        readinessReasons: [expect.stringMatching(/CREATE_CONTENT/)],
        eligibility: { eligible: false, createContent: false, missingPermissions: [] },
        attention: [
          { code: ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT, message: health.readinessReasons[0] },
        ],
        needsAttention: true,
      });
    }
  });

  it('never assumes a Page role Meta has not reported: unknown tasks are not READY', () => {
    const connection = facebookLogin();
    const health = accountHealth(facebookPage(connection, { tasks: undefined }), connection, NOW);
    expect(health.readiness).toBe(PUBLISHING_STATUS.RESTRICTED);
    expect(health.eligibility).toEqual({
      eligible: false,
      createContent: null,
      missingPermissions: [],
    });
    expect(health.readinessReasons).toEqual([expect.stringMatching(/not been confirmed/)]);
    expect(health.attention).toEqual([
      { code: ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT, message: health.readinessReasons[0] },
    ]);
    expect(health.needsAttention).toBe(true);
  });

  it('computes readiness instead of trusting the stored publishingStatus', () => {
    const connection = facebookLogin();
    const account = facebookPage(connection, {
      tasks: ['ANALYZE'],
      publishingStatus: PUBLISHING_STATUS.READY,
    });
    expect(accountHealth(account, connection, NOW).readiness).toBe(PUBLISHING_STATUS.RESTRICTED);
  });

  it('is RESTRICTED and lists the missing permissions when a publishing scope is not granted', () => {
    const connection = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'pages_manage_posts'),
    });
    expect(accountHealth(facebookPage(connection), connection, NOW)).toEqual({
      connectionStatus: CONNECTION_STATUS.ACTIVE,
      connectionStatusReason: null,
      readiness: PUBLISHING_STATUS.RESTRICTED,
      readinessReasons: [expect.stringContaining('pages_manage_posts')],
      eligibility: {
        eligible: false,
        createContent: true,
        missingPermissions: ['pages_manage_posts'],
      },
      attention: [
        {
          code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
          message: expect.stringContaining('pages_manage_posts'),
        },
      ],
      needsAttention: true,
    });
    // pages_manage_posts is a Page permission: the linked Instagram account is unaffected.
    expect(accountHealth(instagramViaPage(connection), connection, NOW)).toEqual(HEALTHY);
  });

  it('judges each destination of one login by the permissions its platform needs', () => {
    const connection = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'instagram_content_publish'),
    });
    expect(accountHealth(facebookPage(connection), connection, NOW).readiness).toBe(
      PUBLISHING_STATUS.READY,
    );
    const instagram = accountHealth(instagramViaPage(connection), connection, NOW);
    expect(instagram.readiness).toBe(PUBLISHING_STATUS.RESTRICTED);
    expect(instagram.eligibility.missingPermissions).toEqual(['instagram_content_publish']);
  });

  it('reports a missing permission and a missing CREATE_CONTENT task together, in that order', () => {
    const connection = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'pages_read_engagement'),
    });
    const health = accountHealth(facebookPage(connection, { tasks: ['ANALYZE'] }), connection, NOW);
    expect(health.readiness).toBe(PUBLISHING_STATUS.RESTRICTED);
    expect(health.eligibility).toEqual({
      eligible: false,
      createContent: false,
      missingPermissions: ['pages_read_engagement'],
    });
    expect(health.readinessReasons).toEqual([
      expect.stringContaining('pages_read_engagement'),
      expect.stringMatching(/CREATE_CONTENT/),
    ]);
    expect(codes(health.attention)).toEqual([
      ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
      ACCOUNT_ATTENTION.MISSING_CREATE_CONTENT,
    ]);
  });

  it('does not apply Page tasks to Instagram Login accounts (createContent is null)', () => {
    const connection = instagramLogin();
    expect(accountHealth(instagramDirect(connection), connection, NOW)).toEqual({
      ...HEALTHY,
      eligibility: { eligible: true, createContent: null, missingPermissions: [] },
    });
    // Even if tasks were recorded, CREATE_CONTENT is a Facebook Page concept.
    const withTasks = accountHealth(
      instagramDirect(connection, { tasks: ['CREATE_CONTENT'] }),
      connection,
      NOW,
    );
    expect(withTasks.eligibility.createContent).toBeNull();
  });

  it('restricts an Instagram Login account without the content publishing permission', () => {
    const connection = instagramLogin({ grantedScopes: ['instagram_business_basic'] });
    const health = accountHealth(instagramDirect(connection), connection, NOW);
    expect(health.readiness).toBe(PUBLISHING_STATUS.RESTRICTED);
    expect(health.eligibility).toEqual({
      eligible: false,
      createContent: null,
      missingPermissions: ['instagram_business_content_publish'],
    });
    expect(codes(health.attention)).toEqual([ACCOUNT_ATTENTION.MISSING_PERMISSIONS]);
  });
});

describe('accountHealth: connection state', () => {
  it('treats a token past its expiry date as EXPIRED on read, before any sync', () => {
    for (const tokenExpiresAt of [at(-1000), NOW]) {
      const connection = facebookLogin({ tokenExpiresAt });
      expect(connection.status).toBe(CONNECTION_STATUS.ACTIVE); // stored value is stale
      expect(accountHealth(facebookPage(connection), connection, NOW)).toEqual({
        connectionStatus: CONNECTION_STATUS.EXPIRED,
        connectionStatusReason: STATUS_REASONS.TOKEN_EXPIRED,
        readiness: PUBLISHING_STATUS.UNAVAILABLE,
        readinessReasons: [STATUS_REASONS.TOKEN_EXPIRED],
        // Eligibility describes permissions only; readiness also needs a usable login.
        eligibility: { eligible: true, createContent: true, missingPermissions: [] },
        attention: [
          { code: ACCOUNT_ATTENTION.CONNECTION_EXPIRED, message: STATUS_REASONS.TOKEN_EXPIRED },
        ],
        needsAttention: true,
      });
    }
  });

  it('treats lapsed Meta data access as EXPIRED', () => {
    const connection = facebookLogin({ dataAccessExpiresAt: at(-1000) });
    const health = accountHealth(facebookPage(connection), connection, NOW);
    expect(health).toMatchObject({
      connectionStatus: CONNECTION_STATUS.EXPIRED,
      connectionStatusReason: STATUS_REASONS.DATA_ACCESS_EXPIRED,
      readiness: PUBLISHING_STATUS.UNAVAILABLE,
      needsAttention: true,
    });
    expect(health.attention).toEqual([
      { code: ACCOUNT_ATTENTION.CONNECTION_EXPIRED, message: STATUS_REASONS.DATA_ACCESS_EXPIRED },
    ]);
  });

  it('warns about an expiry inside the warning window while staying READY', () => {
    const connection = facebookLogin({ tokenExpiresAt: at(3 * DAY) });
    const health = accountHealth(facebookPage(connection), connection, NOW);
    expect(health).toMatchObject({
      connectionStatus: CONNECTION_STATUS.ACTIVE,
      readiness: PUBLISHING_STATUS.READY,
      eligibility: { eligible: true },
      needsAttention: true,
    });
    expect(health.attention).toEqual([
      {
        code: ACCOUNT_ATTENTION.EXPIRING_SOON,
        message: expect.stringContaining('2026-11-23'),
      },
    ]);
  });

  it('uses the earliest of token and data-access expiry and the exact window boundary', () => {
    const earliest = facebookLogin({
      tokenExpiresAt: at(30 * DAY),
      dataAccessExpiresAt: at(2 * DAY),
    });
    expect(accountHealth(facebookPage(earliest), earliest, NOW).attention).toEqual([
      { code: ACCOUNT_ATTENTION.EXPIRING_SOON, message: expect.stringContaining('2026-11-22') },
    ]);

    const edge = facebookLogin({ tokenExpiresAt: at(EXPIRING_SOON_DAYS * DAY) });
    expect(codes(accountHealth(facebookPage(edge), edge, NOW).attention)).toEqual([
      ACCOUNT_ATTENTION.EXPIRING_SOON,
    ]);

    const later = facebookLogin({ tokenExpiresAt: at(EXPIRING_SOON_DAYS * DAY + 1) });
    expect(accountHealth(facebookPage(later), later, NOW)).toEqual(HEALTHY);

    const noExpiry = facebookLogin({ tokenExpiresAt: null, dataAccessExpiresAt: null });
    expect(accountHealth(facebookPage(noExpiry), noExpiry, NOW)).toEqual(HEALTHY);
  });

  it('flags a failed last sync while the login is ACTIVE, without changing readiness', () => {
    const failures = Object.values(SYNC_OUTCOMES).filter((o) => o !== SYNC_OUTCOMES.SUCCESS);
    expect(failures.length).toBeGreaterThan(0);
    for (const lastSyncOutcome of failures) {
      const connection = facebookLogin({ lastSyncOutcome });
      const health = accountHealth(facebookPage(connection), connection, NOW);
      expect(health.readiness).toBe(PUBLISHING_STATUS.READY);
      expect(health.attention).toEqual([
        { code: ACCOUNT_ATTENTION.SYNC_FAILED, message: expect.stringMatching(/did not complete/) },
      ]);
      expect(health.needsAttention).toBe(true);
    }
    // Never synced yet, or last sync succeeded: nothing to report.
    const neverSynced = facebookLogin({ lastSyncOutcome: undefined, lastSyncAttemptAt: undefined });
    expect(accountHealth(facebookPage(neverSynced), neverSynced, NOW)).toEqual(HEALTHY);
  });

  it.each([
    [CONNECTION_STATUS.REVOKED, ACCOUNT_ATTENTION.CONNECTION_REVOKED, STATUS_REASONS.REVOKED],
    [CONNECTION_STATUS.DISCONNECTED, ACCOUNT_ATTENTION.DISCONNECTED, STATUS_REASONS.DISCONNECTED],
    [
      CONNECTION_STATUS.ERROR,
      ACCOUNT_ATTENTION.CONNECTION_ERROR,
      expect.stringMatching(/Reconnect/),
    ],
  ])(
    'makes every destination of a %s login UNAVAILABLE with %s',
    (status, code, fallbackReason) => {
      // The destination's own stored status is still ACTIVE: the login's state wins.
      const connection = facebookLogin({
        status,
        lastSyncOutcome: SYNC_OUTCOMES.TOKEN_REVOKED,
      });
      const account = facebookPage(connection);
      expect(account.connectionStatus).toBe(CONNECTION_STATUS.ACTIVE);
      expect(accountHealth(account, connection, NOW)).toEqual({
        connectionStatus: status,
        connectionStatusReason: fallbackReason,
        readiness: PUBLISHING_STATUS.UNAVAILABLE,
        readinessReasons: [fallbackReason],
        eligibility: { eligible: true, createContent: true, missingPermissions: [] },
        // Only the login problem: no SYNC_FAILED / EXPIRING_SOON noise on an unusable login.
        attention: [{ code, message: fallbackReason }],
        needsAttention: true,
      });

      // A reason stored with the status is shown instead of the generic one.
      const explained = facebookLogin({ status, statusReason: 'Removed in Meta settings.' });
      const health = accountHealth(facebookPage(explained), explained, NOW);
      expect(health.connectionStatusReason).toBe('Removed in Meta settings.');
      expect(health.attention).toEqual([{ code, message: 'Removed in Meta settings.' }]);
    },
  );

  it('keeps a stored login problem even when its expiry dates are in the future or past', () => {
    for (const tokenExpiresAt of [at(30 * DAY), at(-DAY)]) {
      const connection = facebookLogin({ status: CONNECTION_STATUS.REVOKED, tokenExpiresAt });
      expect(accountHealth(facebookPage(connection), connection, NOW).connectionStatus).toBe(
        CONNECTION_STATUS.REVOKED,
      );
    }
  });

  it('reports ACCESS_LOST when a healthy login lost access to this one destination', () => {
    const connection = facebookLogin();
    const account = facebookPage(connection, {
      connectionStatus: CONNECTION_STATUS.ERROR,
      connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
    });
    expect(accountHealth(account, connection, NOW)).toEqual({
      connectionStatus: CONNECTION_STATUS.ERROR,
      connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
      readiness: PUBLISHING_STATUS.UNAVAILABLE,
      readinessReasons: [STATUS_REASONS.ACCOUNT_LOST],
      eligibility: { eligible: true, createContent: true, missingPermissions: [] },
      attention: [{ code: ACCOUNT_ATTENTION.ACCESS_LOST, message: STATUS_REASONS.ACCOUNT_LOST }],
      needsAttention: true,
    });
    // The other destinations of that login stay READY.
    expect(
      accountHealth(facebookPage(connection, { externalId: '5002' }), connection, NOW),
    ).toEqual(HEALTHY);
  });

  it('reports UNAVAILABLE + ACCESS_LOST when the connection no longer exists', () => {
    const orphan = facebookPage(facebookLogin());
    expect(accountHealth(orphan, null, NOW)).toEqual({
      connectionStatus: CONNECTION_STATUS.ERROR,
      connectionStatusReason: STATUS_REASONS.ACCOUNT_LOST,
      readiness: PUBLISHING_STATUS.UNAVAILABLE,
      readinessReasons: [STATUS_REASONS.ACCOUNT_LOST],
      eligibility: { eligible: false, createContent: null, missingPermissions: [] },
      attention: [{ code: ACCOUNT_ATTENTION.ACCESS_LOST, message: STATUS_REASONS.ACCOUNT_LOST }],
      needsAttention: true,
    });
  });
});

describe('assessPublishing', () => {
  const input = (overrides = {}) => ({
    provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
    tasks: ADMIN_TASKS,
    grantedScopes: FACEBOOK_GRANTS,
    ...overrides,
  });

  it('is READY only with the permissions and, via Facebook Login, the CREATE_CONTENT task', () => {
    expect(assessPublishing(input())).toEqual({ status: PUBLISHING_STATUS.READY, reason: null });
    expect(
      assessPublishing(
        input({
          provider: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN,
          platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
          tasks: undefined,
          grantedScopes: INSTAGRAM_GRANTS,
        }),
      ),
    ).toEqual({ status: PUBLISHING_STATUS.READY, reason: null });
  });

  it('is RESTRICTED with every reason joined into one explanation', () => {
    const result = assessPublishing(
      input({ tasks: ['MANAGE'], grantedScopes: without(FACEBOOK_GRANTS, 'pages_manage_posts') }),
    );
    expect(result.status).toBe(PUBLISHING_STATUS.RESTRICTED);
    expect(result.reason).toMatch(/pages_manage_posts.*CREATE_CONTENT/s);

    expect(assessPublishing(input({ tasks: undefined }))).toEqual({
      status: PUBLISHING_STATUS.RESTRICTED,
      reason: expect.stringMatching(/not been confirmed/),
    });
    expect(assessPublishing(input({ grantedScopes: undefined })).status).toBe(
      PUBLISHING_STATUS.RESTRICTED,
    );
  });

  it('agrees with accountHealth eligibility', () => {
    const connection = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'instagram_basic'),
    });
    for (const account of [facebookPage(connection), instagramViaPage(connection)]) {
      const assessed = assessPublishing({
        provider: connection.provider,
        platform: account.platform,
        tasks: account.tasks,
        grantedScopes: connection.grantedScopes,
      });
      const { eligibility } = accountHealth(account, connection, NOW);
      expect(assessed.status === PUBLISHING_STATUS.READY).toBe(eligibility.eligible);
    }
  });
});

describe('effectiveStatus', () => {
  it('applies expiry dates to an ACTIVE login and keeps any stored problem', () => {
    expect(effectiveStatus(facebookLogin(), NOW)).toEqual({
      status: CONNECTION_STATUS.ACTIVE,
      reason: null,
    });
    expect(effectiveStatus(facebookLogin({ tokenExpiresAt: at(-1) }), NOW)).toEqual({
      status: CONNECTION_STATUS.EXPIRED,
      reason: STATUS_REASONS.TOKEN_EXPIRED,
    });
    expect(effectiveStatus(facebookLogin({ dataAccessExpiresAt: at(-1) }), NOW)).toEqual({
      status: CONNECTION_STATUS.EXPIRED,
      reason: STATUS_REASONS.DATA_ACCESS_EXPIRED,
    });
    // When both lapsed, the token expiry is the reason given.
    expect(
      effectiveStatus(facebookLogin({ tokenExpiresAt: at(-1), dataAccessExpiresAt: at(-1) }), NOW)
        .reason,
    ).toBe(STATUS_REASONS.TOKEN_EXPIRED);
    expect(
      effectiveStatus(
        facebookLogin({ status: CONNECTION_STATUS.DISCONNECTED, tokenExpiresAt: at(-1) }),
        NOW,
      ),
    ).toEqual({ status: CONNECTION_STATUS.DISCONNECTED, reason: null });
    expect(
      effectiveStatus(
        facebookLogin({
          status: CONNECTION_STATUS.REVOKED,
          statusReason: 'Removed by the person.',
        }),
        NOW,
      ),
    ).toEqual({ status: CONNECTION_STATUS.REVOKED, reason: 'Removed by the person.' });
  });

  it('evaluates the dates against the instant it is given', () => {
    const connection = facebookLogin({ tokenExpiresAt: at(DAY) });
    expect(effectiveStatus(connection, NOW).status).toBe(CONNECTION_STATUS.ACTIVE);
    expect(effectiveStatus(connection, at(2 * DAY)).status).toBe(CONNECTION_STATUS.EXPIRED);
  });
});

describe('connectionAttention (login level)', () => {
  it('is empty for a healthy login', () => {
    expect(connectionAttention(facebookLogin(), NOW)).toEqual([]);
    expect(connectionAttention(instagramLogin(), NOW)).toEqual([]);
  });

  it('reports only REQUIRED permissions; publishing gaps belong to the destinations', () => {
    expect(
      connectionAttention(
        facebookLogin({ grantedScopes: without(FACEBOOK_GRANTS, 'pages_show_list') }),
        NOW,
      ),
    ).toEqual([
      {
        code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
        message: expect.stringContaining('pages_show_list'),
      },
    ]);
    expect(
      connectionAttention(
        instagramLogin({ grantedScopes: ['instagram_business_content_publish'] }),
        NOW,
      ),
    ).toEqual([
      {
        code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS,
        message: expect.stringContaining('instagram_business_basic'),
      },
    ]);
    expect(
      connectionAttention(
        facebookLogin({ grantedScopes: without(FACEBOOK_GRANTS, 'pages_manage_posts') }),
        NOW,
      ),
    ).toEqual([]);
  });

  it('lists missing permissions, upcoming expiry and a failed sync in priority order', () => {
    const connection = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'pages_show_list'),
      dataAccessExpiresAt: at(2 * DAY),
      lastSyncOutcome: SYNC_OUTCOMES.TRANSIENT_FAILURE,
    });
    expect(connectionAttention(connection, NOW)).toEqual([
      { code: ACCOUNT_ATTENTION.MISSING_PERMISSIONS, message: expect.any(String) },
      { code: ACCOUNT_ATTENTION.EXPIRING_SOON, message: expect.stringContaining('2026-11-22') },
      { code: ACCOUNT_ATTENTION.SYNC_FAILED, message: expect.stringMatching(/did not complete/) },
    ]);
  });

  it('reports a single item for an unusable login', () => {
    const connection = facebookLogin({
      tokenExpiresAt: at(-DAY),
      grantedScopes: [],
      lastSyncOutcome: SYNC_OUTCOMES.TOKEN_EXPIRED,
    });
    expect(connectionAttention(connection, NOW)).toEqual([
      { code: ACCOUNT_ATTENTION.CONNECTION_EXPIRED, message: STATUS_REASONS.TOKEN_EXPIRED },
    ]);
    expect(connectionAttention(facebookLogin({ status: CONNECTION_STATUS.ERROR }), NOW)).toEqual([
      { code: ACCOUNT_ATTENTION.CONNECTION_ERROR, message: expect.stringMatching(/Reconnect/) },
    ]);
  });
});

describe('connectionView', () => {
  it('never contains token material, even when the document holds an encrypted token', () => {
    const connection = facebookLogin();
    connection.setAccessToken('EAAG-long-lived-user-token-secret');
    expect(connection.getAccessToken()).toBe('EAAG-long-lived-user-token-secret');

    const view = connectionView(connection, { now: NOW });
    expect(JSON.stringify(view)).not.toMatch(/EAAG|ciphertext|authTag|keyVersion|accessToken/);
    expect(Object.keys(view).filter((key) => /token|secret|cipher/i.test(key))).toEqual([
      'tokenExpiresAt',
    ]);
  });

  it('describes a healthy login', () => {
    const connection = facebookLogin({ declinedScopes: ['business_management'] });
    const view = connectionView(connection, { now: NOW });
    expect(view).toMatchObject({
      id: String(connection._id),
      provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
      displayName: 'Alice',
      pictureUrl: 'https://example.fbcdn.net/100.jpg',
      status: CONNECTION_STATUS.ACTIVE,
      statusReason: null,
      grantedScopes: FACEBOOK_GRANTS,
      declinedScopes: ['business_management'],
      missingScopes: { required: [], recommended: [], publishing: [] },
      expiringSoonAt: null,
      lastSyncOutcome: SYNC_OUTCOMES.SUCCESS,
      syncInProgress: false,
      lastError: null,
      attention: [],
      needsAttention: false,
      connectedBy: null, // not populated
    });
    expect(view.tokenExpiresAt).toEqual(at(50 * DAY));
    expect(view.lastSyncedAt).toEqual(at(-DAY));
  });

  it('keeps needsAttention login-level: destination problems only appear in accountCounts', () => {
    const healthy = facebookLogin();
    const accountCounts = { facebookPages: 2, instagramAccounts: 1, needsAttention: 3 };
    const view = connectionView(healthy, { accountCount: 3, accountCounts, now: NOW });
    expect(view).toMatchObject({ attention: [], needsAttention: false, accountCount: 3 });
    expect(view.accountCounts).toEqual(accountCounts);

    // A Page-level gap (missing publishing scope) does not flag the login either...
    const pageGap = facebookLogin({
      grantedScopes: without(FACEBOOK_GRANTS, 'pages_manage_posts'),
    });
    const gapView = connectionView(pageGap, { now: NOW });
    expect(gapView.needsAttention).toBe(false);
    expect(gapView.missingScopes.publishing).toEqual(['pages_manage_posts']);

    // ...while a login-level problem does, whatever its destinations look like.
    const failedSync = facebookLogin({ lastSyncOutcome: SYNC_OUTCOMES.RATE_LIMITED });
    const failedView = connectionView(failedSync, {
      accountCounts: { facebookPages: 1, instagramAccounts: 0, needsAttention: 0 },
      now: NOW,
    });
    expect(failedView.needsAttention).toBe(true);
    expect(codes(failedView.attention)).toEqual([ACCOUNT_ATTENTION.SYNC_FAILED]);
  });

  it('reports status, expiry and sync lock as of the given instant', () => {
    const expired = connectionView(facebookLogin({ tokenExpiresAt: at(-1000) }), { now: NOW });
    expect(expired).toMatchObject({
      status: CONNECTION_STATUS.EXPIRED,
      statusReason: STATUS_REASONS.TOKEN_EXPIRED,
      expiringSoonAt: null,
      needsAttention: true,
    });
    expect(codes(expired.attention)).toEqual([ACCOUNT_ATTENTION.CONNECTION_EXPIRED]);

    const soon = connectionView(facebookLogin({ tokenExpiresAt: at(3 * DAY) }), { now: NOW });
    expect(soon.status).toBe(CONNECTION_STATUS.ACTIVE);
    expect(soon.expiringSoonAt).toEqual(at(3 * DAY));
    expect(codes(soon.attention)).toEqual([ACCOUNT_ATTENTION.EXPIRING_SOON]);

    expect(
      connectionView(facebookLogin({ syncLockedUntil: at(60_000) }), { now: NOW }).syncInProgress,
    ).toBe(true);
    expect(
      connectionView(facebookLogin({ syncLockedUntil: at(-1) }), { now: NOW }).syncInProgress,
    ).toBe(false);
  });

  it('reports the Instagram Login permission groups', () => {
    const view = connectionView(instagramLogin({ grantedScopes: ['instagram_business_basic'] }), {
      now: NOW,
    });
    expect(view.missingScopes).toEqual({
      required: [],
      recommended: [],
      publishing: ['instagram_business_content_publish'],
    });
    expect(view.needsAttention).toBe(false);
  });
});
