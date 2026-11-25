// Frontend interaction tests for Facebook Group sharing (Phase 6). The SocialHub API is mocked
// with fetch; Facebook is never involved.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';

configure({ asyncUtilTimeout: 5000 });

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const user = { id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' };
const EDITOR = { id: 'u3', name: 'Eddie Editor', email: 'eddie@example.com' };
const G1 = 'a10000000000000000000001';
const G2 = 'a10000000000000000000002';
const S1 = 'b10000000000000000000001';
const T1 = 'c10000000000000000000001';
const T2 = 'c10000000000000000000002';
const P1 = 'd10000000000000000000001';
const P2 = 'd10000000000000000000002';

const workspace = (role) => ({
  id: 'w1',
  name: 'Acme Social',
  slug: 'acme',
  timezone: 'UTC',
  membership: {
    id: 'm1',
    role,
    permissions: [],
    accountAccess: { mode: 'ALL', socialAccountIds: [] },
  },
});

const group = (overrides = {}) => ({
  id: G1,
  name: 'London Bakers',
  url: 'https://www.facebook.com/groups/londonbakers/',
  category: { id: 'cat1', name: 'Food' },
  tags: ['bread', 'london'],
  memberCount: 5400,
  notes: 'Promotions on Fridays only',
  minDaysBetweenShares: 7,
  status: 'ACTIVE',
  lastSharedAt: null,
  nextShareAllowedAt: null,
  createdAt: '2026-11-20T07:00:00.000Z',
  updatedAt: '2026-11-20T07:00:00.000Z',
  ...overrides,
});

const share = {
  id: S1,
  title: 'Autumn menu',
  message: 'Our autumn menu is here',
  link: 'https://acme.example/menu',
};
const task = (overrides = {}) => ({
  id: T1,
  status: 'OPEN',
  share,
  group: {
    id: G1,
    name: 'London Bakers',
    url: 'https://www.facebook.com/groups/londonbakers/',
    notes: 'Promotions on Fridays only',
    status: 'ACTIVE',
    nextShareAllowedAt: null,
  },
  assignee: null,
  dueAt: null,
  completedBy: null,
  completedAt: null,
  postUrl: null,
  note: null,
  createdAt: '2026-11-21T07:00:00.000Z',
  updatedAt: '2026-11-21T07:00:00.000Z',
  ...overrides,
});
const page = (items, extra = {}) => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  pages: 1,
  ...extra,
});
const counts = { open: 2, done: 0, skipped: 0, total: 2 };

function setup(role, routes = {}, me = user) {
  return mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user: me, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [workspace(role)] }),
    'GET /workspaces/w1/sharing-tasks': () =>
      jsonResponse(
        200,
        page(
          [
            task(),
            task({
              id: T2,
              assignee: { id: 'u2', name: 'Adam Admin' },
              group: { ...task().group, id: G2, name: 'Vegan Eats', notes: '' },
            }),
          ],
          { counts },
        ),
      ),
    'GET /workspaces/w1/group-categories': () =>
      jsonResponse(200, { items: [{ id: 'cat1', name: 'Food', groupCount: 2 }] }),
    'GET /workspaces/w1/facebook-groups': () =>
      jsonResponse(200, {
        ...page(
          [
            group(),
            group({
              id: G2,
              name: 'Vegan Eats',
              category: null,
              tags: ['vegan'],
              notes: '',
              lastSharedAt: '2026-12-23T00:00:00.000Z',
              nextShareAllowedAt: '2026-12-30T00:00:00.000Z',
            }),
          ],
          { limit: 25 },
        ),
        facets: {
          categories: { cat1: 1, none: 1 },
          tags: [{ tag: 'bread', count: 1 }],
          status: { ACTIVE: 2 },
        },
      }),
    'GET /workspaces/w1/social-accounts': () =>
      jsonResponse(200, {
        items: [
          { id: P1, platform: 'FACEBOOK_PAGE', name: 'Acme Store' },
          { id: P2, platform: 'FACEBOOK_PAGE', name: 'Acme Labs' },
          { id: 'ig1', platform: 'INSTAGRAM_ACCOUNT', name: 'Acme IG' },
        ],
      }),
    'GET /workspaces/w1/members': () =>
      jsonResponse(200, {
        items: [
          { id: 'm1', role: 'OWNER', user },
          { id: 'm3', role: 'EDITOR', user: EDITOR },
          { id: 'm4', role: 'VIEWER', user: { id: 'u4', name: 'Vera Viewer' } },
        ],
      }),
    ...routes,
  });
}

const bodyOf = (mock, key) => JSON.parse(mock.calls.filter((c) => c.key === key).at(-1).init.body);
const lastQuery = (mock, key) => mock.calls.filter((c) => c.key === key).at(-1).url.searchParams;

beforeEach(() => {
  setAccessToken(null);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Sharing tasks', () => {
  it('shows an editor their queue with the text, the group rules and a copy button', async () => {
    const mock = setup('EDITOR', {}, EDITOR);
    const ue = userEvent.setup();
    renderApp('/w/acme/groups');

    const card = (await screen.findByRole('link', { name: /London Bakers/ })).closest('li');
    expect(within(card).getByRole('link', { name: /London Bakers/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/groups/londonbakers/',
    );
    expect(within(card).getByText('Promotions on Fridays only')).toBeInTheDocument();
    expect(within(card).getByText('Our autumn menu is here')).toBeInTheDocument();
    expect(lastQuery(mock, 'GET /workspaces/w1/sharing-tasks').get('assignee')).toBe('available');
    expect(screen.getByRole('link', { name: /^Group sharing/ })).toBeInTheDocument();

    await ue.click(within(card).getByRole('button', { name: /Copy text/ }));
    // user-event installs its own clipboard, so read back what was copied.
    expect(await navigator.clipboard.readText()).toBe(
      'Our autumn menu is here\n\nhttps://acme.example/menu',
    );
    expect(toast.success).toHaveBeenCalledWith('Text copied');
    // A task assigned to someone else can be read and copied, not worked on.
    const other = screen.getByRole('link', { name: /Vegan Eats/ }).closest('li');
    expect(within(other).getByText('Assigned to Adam Admin')).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: /Mark as shared/ })).not.toBeInTheDocument();
  });

  it('marks a task as shared with the post link and refuses links that are not Facebook', async () => {
    const mock = setup(
      'EDITOR',
      {
        [`PATCH /workspaces/w1/sharing-tasks/${T1}`]: () =>
          jsonResponse(200, { task: task({ status: 'DONE' }) }),
      },
      EDITOR,
    );
    const ue = userEvent.setup();
    renderApp('/w/acme/groups');
    const card = (await screen.findByRole('link', { name: /London Bakers/ })).closest('li');
    await ue.click(within(card).getByRole('button', { name: /Mark as shared/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Shared in London Bakers?' });
    const url = within(dialog).getByLabelText(/Link to the post/);
    await ue.type(url, 'https://evil.example/x');
    await ue.click(within(dialog).getByRole('button', { name: 'Mark as shared' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/link of the post on Facebook/);
    expect(mock.count(`PATCH /workspaces/w1/sharing-tasks/${T1}`)).toBe(0);

    await ue.clear(url);
    await ue.type(url, 'https://www.facebook.com/groups/londonbakers/posts/9');
    await ue.click(within(dialog).getByRole('button', { name: 'Mark as shared' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Marked as shared in London Bakers'),
    );
    expect(bodyOf(mock, `PATCH /workspaces/w1/sharing-tasks/${T1}`)).toEqual({
      status: 'DONE',
      postUrl: 'https://www.facebook.com/groups/londonbakers/posts/9',
    });
  });

  it('lets an editor take an unassigned task, and shows viewers no task actions', async () => {
    const mock = setup(
      'EDITOR',
      {
        [`PATCH /workspaces/w1/sharing-tasks/${T1}`]: () =>
          jsonResponse(200, { task: task({ assignee: { id: 'u3', name: 'Eddie Editor' } }) }),
      },
      EDITOR,
    );
    const ue = userEvent.setup();
    const { unmount } = renderApp('/w/acme/groups');
    const card = (await screen.findByRole('link', { name: /London Bakers/ })).closest('li');
    await ue.click(within(card).getByRole('button', { name: /Take it/ }));
    await waitFor(() =>
      expect(bodyOf(mock, `PATCH /workspaces/w1/sharing-tasks/${T1}`)).toEqual({
        assigneeId: 'u3',
      }),
    );
    unmount();

    const viewerMock = setup('VIEWER');
    renderApp('/w/acme/groups');
    const viewerCard = (await screen.findByRole('link', { name: /London Bakers/ })).closest('li');
    expect(within(viewerCard).getByRole('button', { name: /Copy text/ })).toBeInTheDocument();
    expect(
      within(viewerCard).queryByRole('button', { name: /Mark as shared|Take it|Skip/ }),
    ).not.toBeInTheDocument();
    expect(lastQuery(viewerMock, 'GET /workspaces/w1/sharing-tasks').get('assignee')).toBe('any');
  });
});

describe('Shares', () => {
  it('creates a share for the chosen groups and reports the groups that were skipped', async () => {
    const mock = setup('OWNER', {
      'GET /workspaces/w1/group-shares': () => jsonResponse(200, page([])),
      'POST /workspaces/w1/group-shares': () =>
        jsonResponse(201, {
          share: { ...share, counts: { open: 1, done: 0, skipped: 0, total: 1 } },
          created: 1,
          skipped: [
            {
              groupId: G2,
              name: 'Vegan Eats',
              reason: 'TOO_SOON',
              nextShareAllowedAt: '2026-12-30T00:00:00.000Z',
            },
          ],
        }),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/groups/shares');
    await ue.click((await screen.findAllByRole('button', { name: /New share/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New share' });

    await ue.click(within(dialog).getByRole('button', { name: /Create/ }));
    expect(within(dialog).getByText('Give the share a title')).toBeInTheDocument();
    expect(mock.count('POST /workspaces/w1/group-shares')).toBe(0);

    await ue.type(within(dialog).getByLabelText('Title'), 'Autumn menu');
    await ue.type(within(dialog).getByLabelText('Text to post'), 'Our autumn menu is here');
    await ue.type(within(dialog).getByLabelText(/Link/), 'https://acme.example/menu');
    expect(await within(dialog).findByText(/it will be skipped/)).toBeInTheDocument();
    await ue.click(within(dialog).getByRole('button', { name: 'Select all shown' }));
    await ue.selectOptions(within(dialog).getByLabelText('Who posts it'), 'u3');
    // Viewers cannot complete tasks, so they are not offered.
    expect(
      within(within(dialog).getByLabelText('Who posts it')).queryByRole('option', {
        name: 'Vera Viewer',
      }),
    ).toBeNull();
    await ue.click(within(dialog).getByRole('button', { name: 'Create 2 tasks' }));

    expect(await screen.findByRole('dialog', { name: 'Share created' })).toHaveTextContent(
      /Vegan Eats: its rules allow the next share on/,
    );
    expect(bodyOf(mock, 'POST /workspaces/w1/group-shares')).toEqual({
      title: 'Autumn menu',
      message: 'Our autumn menu is here',
      link: 'https://acme.example/menu',
      groupIds: [G1, G2],
      assigneeId: 'u3',
    });
  });

  it('shows a share’s groups and hides delete once it was posted', async () => {
    setup('OWNER', {
      [`GET /workspaces/w1/group-shares/${S1}`]: () =>
        jsonResponse(200, {
          share: {
            ...share,
            createdBy: { id: 'u1', name: 'Olivia Owner' },
            createdAt: '2026-11-21T07:00:00.000Z',
            counts: { open: 1, done: 1, skipped: 0, total: 2 },
          },
          tasks: [
            task(),
            task({
              id: T2,
              status: 'DONE',
              completedBy: { id: 'u3', name: 'Eddie Editor' },
              completedAt: '2026-11-21T08:00:00.000Z',
              postUrl: 'https://www.facebook.com/groups/vegan/posts/1',
              group: { ...task().group, id: G2, name: 'Vegan Eats' },
            }),
          ],
        }),
    });
    renderApp(`/w/acme/groups/shares/${S1}`);
    const row = (await screen.findByRole('link', { name: /Vegan Eats/ })).closest('tr');
    expect(within(row).getByText('Shared')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /View post/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/groups/vegan/posts/1',
    );
    expect(screen.getByText('1 of 2 shared')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add groups/ })).toBeInTheDocument();
  });
});

describe('Group directory', () => {
  it('adds a group, parsing tags and checking the link before sending', async () => {
    let attempts = 0;
    const mock = setup('ADMIN', {
      'POST /workspaces/w1/facebook-groups': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(
              409,
              'CONFLICT',
              'This group is already in the directory as “London Bakers”.',
              {
                fields: { url: 'This group is already in the directory' },
              },
            )
          : jsonResponse(201, { group: group({ id: 'new', name: 'Camden Market' }) });
      },
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/groups/directory');
    expect(await screen.findByRole('link', { name: /London Bakers/ })).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: /Add group/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a Facebook Group' });
    await ue.type(within(dialog).getByLabelText('Name'), 'Camden Market');
    await ue.type(within(dialog).getByLabelText('Group link'), 'https://www.facebook.com/camden');
    await ue.click(within(dialog).getByRole('button', { name: 'Add group' }));
    expect(within(dialog).getByText(/Enter a Facebook Group link/)).toBeInTheDocument();
    expect(mock.count('POST /workspaces/w1/facebook-groups')).toBe(0);

    await ue.clear(within(dialog).getByLabelText('Group link'));
    await ue.type(within(dialog).getByLabelText('Group link'), 'facebook.com/groups/camden.market');
    await ue.type(within(dialog).getByLabelText('Relevance tags'), 'Markets, London ,');
    await ue.type(within(dialog).getByLabelText('Days between shares'), '14');
    await ue.click(within(dialog).getByRole('button', { name: 'Add group' }));
    expect(
      await within(dialog).findByText('This group is already in the directory as “London Bakers”.'),
    ).toBeInTheDocument();

    await ue.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Camden Market added to the directory'),
    );
    expect(bodyOf(mock, 'POST /workspaces/w1/facebook-groups')).toEqual({
      name: 'Camden Market',
      url: 'facebook.com/groups/camden.market',
      categoryId: null,
      tags: ['markets', 'london'],
      memberCount: null,
      minDaysBetweenShares: 14,
      notes: '',
      pageIds: [],
    });
  });

  it('filters the directory through the API and shows editors no management controls', async () => {
    const mock = setup('EDITOR', {}, EDITOR);
    const ue = userEvent.setup();
    renderApp('/w/acme/groups/directory');
    const row = (await screen.findByRole('link', { name: /Vegan Eats/ })).closest('tr');
    expect(within(row).getByText(/Next share from/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    await ue.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'none');
    await waitFor(() =>
      expect(lastQuery(mock, 'GET /workspaces/w1/facebook-groups').get('category')).toBe('none'),
    );
    await ue.click(screen.getAllByRole('button', { name: 'bread' })[0]);
    await waitFor(() =>
      expect(lastQuery(mock, 'GET /workspaces/w1/facebook-groups').get('tag')).toBe('bread'),
    );
  });
});

describe('Pages in groups and auto share', () => {
  it('links Pages to a group, shows them in the list and filters by Page', async () => {
    const mock = setup('OWNER', {
      'GET /workspaces/w1/facebook-groups': () =>
        jsonResponse(200, {
          ...page([group({ pages: [{ id: P1, name: 'Acme Store' }] })], { limit: 25 }),
          facets: {
            categories: { cat1: 1 },
            tags: [],
            status: { ACTIVE: 1 },
            pages: { [P1]: 1 },
          },
        }),
      [`PATCH /workspaces/w1/facebook-groups/${G1}`]: () =>
        jsonResponse(200, { group: group({ pages: [{ id: P2, name: 'Acme Labs' }] }) }),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/groups/directory');
    const row = (await screen.findByRole('link', { name: /London Bakers/ })).closest('tr');
    expect(within(row).getByText('Acme Store')).toBeInTheDocument();

    const filter = await screen.findByRole('combobox', { name: 'Filter by Page' });
    expect(within(filter).getByRole('option', { name: 'Acme Store (1)' })).toBeInTheDocument();
    expect(within(filter).queryByRole('option', { name: /Acme IG/ })).not.toBeInTheDocument();
    await ue.selectOptions(filter, P1);
    await waitFor(() =>
      expect(lastQuery(mock, 'GET /workspaces/w1/facebook-groups').get('pageId')).toBe(P1),
    );

    await ue.click(within(row).getByRole('button', { name: 'Actions for London Bakers' }));
    await ue.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit London Bakers' });
    const store = within(dialog).getByRole('checkbox', { name: 'Acme Store' });
    expect(store).toHaveAttribute('aria-checked', 'true');
    await ue.click(store);
    await ue.click(within(dialog).getByRole('checkbox', { name: 'Acme Labs' }));
    await ue.click(within(dialog).getByRole('button', { name: 'Save group' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Group saved'));
    expect(bodyOf(mock, `PATCH /workspaces/w1/facebook-groups/${G1}`).pageIds).toEqual([P2]);
  });

  it('adds many groups from pasted links and reports what happened to each', async () => {
    const mock = setup('ADMIN', {
      'POST /workspaces/w1/facebook-groups/bulk': () =>
        jsonResponse(200, {
          added: [
            { id: 'n1', name: 'First Group', url: 'https://www.facebook.com/groups/first-group/' },
          ],
          existing: [
            { id: G1, name: 'London Bakers', url: 'https://www.facebook.com/groups/londonbakers/' },
          ],
          invalid: ['not a link'],
        }),
    });
    const ue = userEvent.setup();
    renderApp('/w/acme/groups/directory');
    await screen.findByRole('link', { name: /London Bakers/ });
    await ue.click(screen.getByRole('button', { name: /Add many/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add many groups' });
    await ue.type(
      within(dialog).getByLabelText('Group links'),
      'facebook.com/groups/first-group{Enter}facebook.com/groups/londonbakers{Enter}not a link',
    );
    expect(within(dialog).getByText('2 of 3 lines are group links.')).toBeInTheDocument();
    await ue.click(within(dialog).getByRole('checkbox', { name: 'Acme Store' }));
    await ue.click(within(dialog).getByRole('button', { name: 'Add 2 groups' }));

    expect(
      await within(dialog).findByText(/These lines are not Facebook Group links/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('not a link')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '1 added, 1 already in your list (your Pages were added to them).',
    );
    expect(toast.success).toHaveBeenCalledWith('1 group added');
    expect(bodyOf(mock, 'POST /workspaces/w1/facebook-groups/bulk')).toEqual({
      urls: ['facebook.com/groups/first-group', 'facebook.com/groups/londonbakers', 'not a link'],
      categoryId: null,
      pageIds: [P1],
    });
  });

  it('shows an auto-shared task with the Page to post as and copies the live post link', async () => {
    setup(
      'EDITOR',
      {
        'GET /workspaces/w1/sharing-tasks': () =>
          jsonResponse(
            200,
            page(
              [
                task({
                  share: {
                    id: S1,
                    title: 'Winter sale',
                    message: 'Winter sale today',
                    link: '',
                    auto: true,
                  },
                  page: { id: P1, name: 'Acme Store' },
                  pagePost: { state: 'PUBLISHED', url: 'https://www.facebook.com/acme/posts/1' },
                }),
              ],
              { counts },
            ),
          ),
      },
      EDITOR,
    );
    const ue = userEvent.setup();
    renderApp('/w/acme/groups');
    const card = (await screen.findByRole('link', { name: /London Bakers/ })).closest('li');
    expect(within(card).getByText('Acme Store')).toBeInTheDocument();
    expect(within(card).getByText(/Post as/)).toBeInTheDocument();
    expect(
      within(card).getByRole('link', { name: /View the Page post on Facebook/ }),
    ).toHaveAttribute('href', 'https://www.facebook.com/acme/posts/1');
    expect(within(card).getByRole('link', { name: /Open group/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/groups/londonbakers/',
    );
    await ue.click(within(card).getByRole('button', { name: /Copy text/ }));
    expect(await navigator.clipboard.readText()).toBe(
      'Winter sale today\n\nhttps://www.facebook.com/acme/posts/1',
    );
  });
});
