import { describe, expect, it } from 'vitest';
import { accountList, fbPage, igAccount, withHealth } from '../test/fixtures.js';
import {
  BUILT_IN_PRESETS,
  PLATFORM_FILTERS,
  accountBlocker,
  countByPlatform,
  describeAccount,
  displayHandle,
  existingIds,
  filterAccounts,
  isFacebookPage,
  isInstagramAccount,
  normalizeAccount,
  normalizeAccounts,
  platformsOf,
  quickSelectGroups,
} from './accounts.js';

const FB = 'FACEBOOK_PAGE';
const IG = 'INSTAGRAM_ACCOUNT';

const idsOf = (accounts) => accounts.map((a) => a.id);

describe('normalizeAccount', () => {
  it('maps a Phase 2 Facebook Page (stored statuses only)', () => {
    expect(normalizeAccount(fbPage())).toEqual({
      id: 'acc-fb-1',
      platform: FB,
      name: 'Acme Store',
      username: null,
      pictureUrl: null,
      category: 'Retail',
      instagramAccountType: null,
      connectionName: 'Alice Facebook',
      linkedPageName: null,
      connectionStatus: 'ACTIVE',
      connectionStatusReason: null,
      readiness: 'READY',
      readinessReasons: [],
      attention: [],
      needsAttention: false,
      publishable: true,
      labels: [],
      starred: false,
    });
  });

  it('keeps the workspace labels and the person’s star, dropping malformed labels', () => {
    const account = normalizeAccount(
      fbPage({
        labels: [
          { id: 'l1', name: 'Client A', color: 'sky' },
          { id: 'l2' },
          null,
          { id: 'l3', name: 'North' },
        ],
        starred: true,
      }),
    );
    expect(account.labels).toEqual([
      { id: 'l1', name: 'Client A', color: 'sky' },
      { id: 'l3', name: 'North', color: 'slate' },
    ]);
    expect(account.starred).toBe(true);
  });

  it('maps a Phase 2 Instagram account with its linked Page', () => {
    expect(normalizeAccount(igAccount({ pictureUrl: 'https://cdn.test/ig.jpg' }))).toMatchObject({
      id: 'acc-ig-1',
      platform: IG,
      name: 'Acme Instagram',
      username: 'acme',
      pictureUrl: 'https://cdn.test/ig.jpg',
      instagramAccountType: 'BUSINESS',
      linkedPageName: 'Acme Store',
      publishable: true,
    });
  });

  it('falls back to linkedFacebookPageName for the linked Page', () => {
    const raw = igAccount({ linkedPage: null, linkedFacebookPageName: 'Old Page Name' });
    expect(normalizeAccount(raw).linkedPageName).toBe('Old Page Name');
  });

  it('fills defaults for missing fields and stringifies the id', () => {
    const account = normalizeAccount({ id: 42, platform: FB, name: '' });
    expect(account).toMatchObject({
      id: '42',
      name: 'Unnamed account',
      username: null,
      category: null,
      connectionName: null,
      linkedPageName: null,
    });
  });

  it('treats an account with no status information as unusable', () => {
    for (const raw of [null, undefined, {}]) {
      expect(normalizeAccount(raw)).toMatchObject({
        id: '',
        connectionStatus: 'ERROR',
        readiness: 'UNAVAILABLE',
        readinessReasons: [],
        attention: [],
        needsAttention: true,
        publishable: false,
      });
    }
  });

  it('uses the stored publishing reason when a Phase 2 account is not ready', () => {
    const account = normalizeAccount(
      fbPage({
        publishingStatus: 'RESTRICTED',
        publishingStatusReason: 'Missing pages_manage_posts',
      }),
    );
    expect(account).toMatchObject({
      readiness: 'RESTRICTED',
      readinessReasons: ['Missing pages_manage_posts'],
      publishable: false,
      needsAttention: true,
    });
  });

  it('ignores a stale publishing reason when the account is ready', () => {
    const account = normalizeAccount(fbPage({ publishingStatusReason: 'Old problem' }));
    expect(account.readinessReasons).toEqual([]);
  });

  it('keeps the stored connection reason for a Phase 2 account', () => {
    const account = normalizeAccount(
      fbPage({ connectionStatus: 'EXPIRED', connectionStatusReason: 'The token expired.' }),
    );
    expect(account).toMatchObject({
      connectionStatus: 'EXPIRED',
      connectionStatusReason: 'The token expired.',
      publishable: false,
      needsAttention: true,
    });
  });

  describe('with the Phase 3 health object', () => {
    it('prefers live health over the stored statuses', () => {
      const raw = withHealth(fbPage(), {
        connectionStatus: 'EXPIRED',
        connectionStatusReason: 'Reconnect to renew access.',
        readiness: 'RESTRICTED',
        needsAttention: true,
      });
      expect(normalizeAccount(raw)).toMatchObject({
        connectionStatus: 'EXPIRED',
        connectionStatusReason: 'Reconnect to renew access.',
        readiness: 'RESTRICTED',
        publishable: false,
        needsAttention: true,
      });
    });

    it('trusts healthy live status over stale stored problems', () => {
      const raw = withHealth(
        fbPage({ connectionStatus: 'ERROR', publishingStatus: 'UNAVAILABLE' }),
        {},
      );
      expect(normalizeAccount(raw)).toMatchObject({
        connectionStatus: 'ACTIVE',
        readiness: 'READY',
        publishable: true,
        needsAttention: false,
      });
    });

    it('turns readiness reasons (strings, objects or codes) into messages', () => {
      const raw = withHealth(igAccount(), {
        readiness: 'RESTRICTED',
        readinessReasons: [
          'Missing permission: instagram_content_publish',
          { code: 'MISSING_CREATE_CONTENT', message: 'You need the Create content task.' },
          { code: 'SOME_CODE' },
          null,
          {},
        ],
      });
      expect(normalizeAccount(raw).readinessReasons).toEqual([
        'Missing permission: instagram_content_publish',
        'You need the Create content task.',
        'SOME_CODE',
      ]);
    });

    it('falls back to the stored reason when health lists none', () => {
      const raw = withHealth(fbPage({ publishingStatusReason: 'Stored reason' }), {
        readiness: 'UNAVAILABLE',
        readinessReasons: [],
      });
      expect(normalizeAccount(raw).readinessReasons).toEqual(['Stored reason']);
    });

    it('normalizes attention items and drops ones without a message', () => {
      const raw = withHealth(fbPage(), {
        attention: [
          { code: 'EXPIRING_SOON', message: 'Access expires in 5 days.' },
          'Sync failed yesterday.',
          { code: 'SYNC_FAILED' },
          { message: '' },
          null,
        ],
        needsAttention: true,
      });
      expect(normalizeAccount(raw).attention).toEqual([
        { code: 'EXPIRING_SOON', message: 'Access expires in 5 days.' },
        { code: null, message: 'Sync failed yesterday.' },
        { code: 'SYNC_FAILED', message: 'SYNC_FAILED' },
      ]);
    });

    it('can flag a publishable account as needing attention', () => {
      const raw = withHealth(fbPage(), {
        attention: [{ code: 'EXPIRING_SOON', message: 'Access expires in 5 days.' }],
        needsAttention: true,
      });
      expect(normalizeAccount(raw)).toMatchObject({ publishable: true, needsAttention: true });
    });

    it('derives needsAttention from publishability when health omits it', () => {
      const raw = withHealth(fbPage(), { readiness: 'RESTRICTED', needsAttention: undefined });
      expect(normalizeAccount(raw).needsAttention).toBe(true);
    });
  });
});

describe('normalizeAccounts', () => {
  it('normalizes items in order and drops ones without an id or platform', () => {
    const accounts = normalizeAccounts([
      fbPage(),
      { id: 'no-platform', name: 'X' },
      { platform: FB, name: 'No id' },
      null,
      igAccount(),
    ]);
    expect(idsOf(accounts)).toEqual(['acc-fb-1', 'acc-ig-1']);
  });

  it('returns [] for missing lists', () => {
    expect(normalizeAccounts(undefined)).toEqual([]);
    expect(normalizeAccounts(null)).toEqual([]);
  });
});

describe('platform helpers', () => {
  const [page, , instagram] = normalizeAccounts(accountList());

  it('identifies Facebook Pages and Instagram accounts', () => {
    expect(isFacebookPage(page)).toBe(true);
    expect(isInstagramAccount(page)).toBe(false);
    expect(isInstagramAccount(instagram)).toBe(true);
    expect(isFacebookPage(instagram)).toBe(false);
  });

  it.each([
    [fbPage(), 'Facebook Page · Retail'],
    [fbPage({ category: null }), 'Facebook Page'],
    [igAccount(), '@acme · Business account'],
    [igAccount({ instagramAccountType: 'CREATOR' }), '@acme · Creator account'],
    [igAccount({ instagramAccountType: null }), '@acme · Professional account'],
    [igAccount({ username: null }), 'Instagram · Business account'],
  ])('describes the account (%#)', (raw, description) => {
    expect(describeAccount(normalizeAccount(raw))).toBe(description);
  });

  it('shows @username for Instagram and the Page name for Facebook', () => {
    expect(displayHandle(normalizeAccount(igAccount()))).toBe('acme');
    expect(displayHandle(normalizeAccount(igAccount({ username: null })))).toBe('Acme Instagram');
    expect(displayHandle(normalizeAccount(fbPage({ username: 'ignored' })))).toBe('Acme Store');
  });
});

describe('accountBlocker', () => {
  const blocker = (raw) => accountBlocker(normalizeAccount(raw));

  it('returns null when the connection is active and permissions are in order', () => {
    expect(blocker(fbPage())).toBeNull();
    expect(blocker(withHealth(igAccount()))).toBeNull();
  });

  it('asks to reconnect a disconnected account', () => {
    expect(blocker(fbPage({ connectionStatus: 'DISCONNECTED' }))).toBe(
      'This account is disconnected. Reconnect it in Social accounts.',
    );
  });

  it.each(['EXPIRED', 'REVOKED', 'ERROR'])('asks to reconnect a %s connection', (status) => {
    expect(blocker(fbPage({ connectionStatus: status }))).toBe(
      'This account needs to be reconnected in Social accounts.',
    );
  });

  it('prefers the server reason, and connection problems over permission problems', () => {
    expect(
      blocker(
        fbPage({
          connectionStatus: 'EXPIRED',
          connectionStatusReason: 'Facebook access expired on 1 Nov.',
          publishingStatus: 'RESTRICTED',
          publishingStatusReason: 'Missing pages_manage_posts',
        }),
      ),
    ).toBe('Facebook access expired on 1 Nov.');
  });

  it('explains restricted publishing access', () => {
    expect(blocker(fbPage({ publishingStatus: 'RESTRICTED' }))).toBe(
      'Meta has not granted publishing access for this account.',
    );
    expect(
      blocker(
        withHealth(igAccount(), {
          readiness: 'RESTRICTED',
          readinessReasons: ['Missing permission: instagram_content_publish', 'Second reason'],
        }),
      ),
    ).toBe('Missing permission: instagram_content_publish');
  });

  it('explains unavailable publishing', () => {
    expect(blocker(fbPage({ publishingStatus: 'UNAVAILABLE' }))).toBe(
      'Publishing is not available for this account.',
    );
    expect(
      blocker(
        fbPage({ publishingStatus: 'UNAVAILABLE', publishingStatusReason: 'Page unpublished' }),
      ),
    ).toBe('Page unpublished');
  });

  it('never claims an account is ready to publish', () => {
    const messages = [
      blocker(fbPage({ connectionStatus: 'DISCONNECTED' })),
      blocker(fbPage({ connectionStatus: 'EXPIRED' })),
      blocker(fbPage({ publishingStatus: 'RESTRICTED' })),
      blocker(fbPage({ publishingStatus: 'UNAVAILABLE' })),
    ];
    for (const message of messages) expect(message).not.toMatch(/ready/i);
  });
});

describe('filterAccounts', () => {
  const accounts = normalizeAccounts([
    ...accountList(),
    fbPage({ id: 'acc-fb-3', name: 'Café Société', category: 'Restaurant' }),
  ]);

  it('returns every account by default, in the original order', () => {
    expect(filterAccounts(accounts)).toEqual(accounts);
    expect(filterAccounts(accounts, { platform: PLATFORM_FILTERS.ALL, query: '   ' })).toEqual(
      accounts,
    );
  });

  it('filters by platform', () => {
    expect(idsOf(filterAccounts(accounts, { platform: PLATFORM_FILTERS.FACEBOOK_PAGE }))).toEqual([
      'acc-fb-1',
      'acc-fb-2',
      'acc-fb-3',
    ]);
    expect(
      idsOf(filterAccounts(accounts, { platform: PLATFORM_FILTERS.INSTAGRAM_ACCOUNT })),
    ).toEqual(['acc-ig-1', 'acc-ig-2']);
  });

  it('searches name, username, category and linked Page, ignoring case', () => {
    expect(idsOf(filterAccounts(accounts, { query: 'OUTLET' }))).toEqual(['acc-fb-2']);
    expect(idsOf(filterAccounts(accounts, { query: 'acme.studio' }))).toEqual(['acc-ig-2']);
    expect(idsOf(filterAccounts(accounts, { query: 'shopping' }))).toEqual(['acc-fb-2']);
    // "Acme Store" is acc-fb-1's name and acc-ig-1's linked Page.
    expect(idsOf(filterAccounts(accounts, { query: 'acme store' }))).toEqual([
      'acc-fb-1',
      'acc-ig-1',
    ]);
  });

  it('ignores accents in both the query and the account fields', () => {
    expect(idsOf(filterAccounts(accounts, { query: 'cafe societe' }))).toEqual(['acc-fb-3']);
    expect(idsOf(filterAccounts(accounts, { query: 'RESTAURANT' }))).toEqual(['acc-fb-3']);
    expect(idsOf(filterAccounts(accounts, { query: 'Société' }))).toEqual(['acc-fb-3']);
  });

  it('trims the query and ignores a leading @', () => {
    expect(idsOf(filterAccounts(accounts, { query: '  @acme.studio ' }))).toEqual(['acc-ig-2']);
  });

  it('combines the platform and the query', () => {
    expect(
      idsOf(
        filterAccounts(accounts, { platform: PLATFORM_FILTERS.INSTAGRAM_ACCOUNT, query: 'store' }),
      ),
    ).toEqual(['acc-ig-1']);
  });

  it('returns [] when nothing matches, without changing the input', () => {
    const before = [...accounts];
    expect(filterAccounts(accounts, { query: 'zzz' })).toEqual([]);
    expect(accounts).toEqual(before);
  });
});

describe('label search and quick-select groups', () => {
  const CLIENT = { id: 'l1', name: 'Client A', color: 'sky' };
  const NORTH = { id: 'l2', name: 'North', color: 'green' };
  const accounts = normalizeAccounts([
    fbPage({ labels: [CLIENT, NORTH], starred: true }),
    fbPage({ id: 'acc-fb-2', name: 'Acme Outlet', labels: [NORTH] }),
    igAccount({ labels: [CLIENT] }),
    igAccount({ id: 'acc-ig-2', name: 'Acme Studio', starred: true }),
  ]);

  it('finds accounts by label name', () => {
    expect(idsOf(filterAccounts(accounts, { query: 'client' }))).toEqual(['acc-fb-1', 'acc-ig-1']);
    expect(idsOf(filterAccounts(accounts, { query: 'north', platform: IG }))).toEqual([]);
  });

  it('groups starred accounts first, then each label by name', () => {
    expect(quickSelectGroups(accounts)).toEqual([
      { key: 'starred', name: 'Starred', ids: ['acc-fb-1', 'acc-ig-2'] },
      { key: 'label:l1', name: 'Client A', color: 'sky', ids: ['acc-fb-1', 'acc-ig-1'] },
      { key: 'label:l2', name: 'North', color: 'green', ids: ['acc-fb-1', 'acc-fb-2'] },
    ]);
    expect(quickSelectGroups(normalizeAccounts([fbPage()]))).toEqual([]);
  });
});

describe('countByPlatform / platformsOf', () => {
  it('counts accounts per filter', () => {
    expect(countByPlatform(normalizeAccounts(accountList()))).toEqual({
      ALL: 4,
      [FB]: 2,
      [IG]: 2,
    });
    expect(countByPlatform([])).toEqual({ ALL: 0, [FB]: 0, [IG]: 0 });
  });

  it('lists the platforms present, Facebook first', () => {
    const [page, , instagram] = normalizeAccounts(accountList());
    expect(platformsOf([instagram, page, instagram])).toEqual([FB, IG]);
    expect(platformsOf([instagram])).toEqual([IG]);
    expect(platformsOf([])).toEqual([]);
  });
});

describe('BUILT_IN_PRESETS', () => {
  const accounts = normalizeAccounts(accountList());
  const preset = (id) => BUILT_IN_PRESETS.find((p) => p.id === id);

  it('are fixed, uniquely identified and described', () => {
    expect(Object.isFrozen(BUILT_IN_PRESETS)).toBe(true);
    const presetIds = BUILT_IN_PRESETS.map((p) => p.id);
    expect(new Set(presetIds).size).toBe(presetIds.length);
    for (const p of BUILT_IN_PRESETS) {
      expect(p.id).toMatch(/^builtin:/);
      expect(p.name).toEqual(expect.any(String));
      expect(p.description).toEqual(expect.any(String));
      expect(typeof p.resolve).toBe('function');
    }
  });

  it('resolve to account ids from the current list', () => {
    expect(preset('builtin:all').resolve(accounts)).toEqual([
      'acc-fb-1',
      'acc-fb-2',
      'acc-ig-1',
      'acc-ig-2',
    ]);
    expect(preset('builtin:facebook').resolve(accounts)).toEqual(['acc-fb-1', 'acc-fb-2']);
    expect(preset('builtin:instagram').resolve(accounts)).toEqual(['acc-ig-1', 'acc-ig-2']);
  });

  it('only pick accounts with publishing access for the publishing preset', () => {
    // acc-ig-2 is restricted in the fixture list.
    expect(preset('builtin:publishable').resolve(accounts)).toEqual([
      'acc-fb-1',
      'acc-fb-2',
      'acc-ig-1',
    ]);
    expect(preset('builtin:publishable').name).not.toMatch(/ready/i);
  });

  it('resolve to nothing when there are no accounts', () => {
    for (const p of BUILT_IN_PRESETS) expect(p.resolve([])).toEqual([]);
  });
});

describe('existingIds', () => {
  it('keeps ids that still exist, in their original order', () => {
    const accounts = normalizeAccounts(accountList());
    expect(existingIds(['acc-ig-2', 'deleted', 'acc-fb-1'], accounts)).toEqual([
      'acc-ig-2',
      'acc-fb-1',
    ]);
    expect(existingIds(['deleted'], accounts)).toEqual([]);
    expect(existingIds([], accounts)).toEqual([]);
    expect(existingIds(['acc-fb-1'], [])).toEqual([]);
  });
});
