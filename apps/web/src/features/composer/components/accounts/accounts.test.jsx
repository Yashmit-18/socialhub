import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../../lib/api.js';
import { apiError, jsonResponse } from '../../../../test/fetchMock.js';
import { useAccountPresets } from '../../hooks/useAccountPresets.js';
import { BUILT_IN_PRESETS, normalizeAccount, normalizeAccounts } from '../../model/accounts.js';
import { composerActions } from '../../model/composerState.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';
import { ComposerHarness } from '../../test/ComposerHarness.jsx';
import {
  accountList,
  fbPage,
  igAccount,
  setupComposerApi,
  withHealth,
} from '../../test/fixtures.js';
import { AccountOption } from './AccountOption.jsx';
import { AccountPresets } from './AccountPresets.jsx';
import { AccountSelector } from './AccountSelector.jsx';
import { PlatformFilter } from './PlatformFilter.jsx';
import { SavePresetDialog } from './SavePresetDialog.jsx';

const PRESETS_KEY = 'sh-composer-presets:v1:u1:w1';
const PRESETS_PATH = '/workspaces/w1/account-presets';

/* ------------------------------------------------------------------ harness */

function ConnectedSelector({ state, dispatch, accounts, ...props }) {
  const presets = useAccountPresets({ workspaceId: 'w1', userId: 'u1' });
  return (
    <AccountSelector
      accounts={accounts}
      selectedIds={state.selectedAccountIds}
      onToggle={(id) => dispatch(composerActions.toggleAccount(id))}
      onSelect={(ids) => dispatch(composerActions.selectAccounts(ids))}
      onDeselect={(ids) => dispatch(composerActions.deselectAccounts(ids))}
      onSetSelected={(ids) => dispatch(composerActions.setSelectedAccounts(ids))}
      status="ready"
      presets={presets}
      accountsHref="/w/acme/accounts"
      {...props}
    />
  );
}

/** Renders the selector wired to the real composer reducer and the real presets hook. */
function renderSelector({
  accounts = normalizeAccounts(accountList()),
  selected = [],
  ...props
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let latest = null;
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ComposerHarness
          initial={{ selectedAccountIds: selected }}
          onState={(state) => {
            latest = state;
          }}
        >
          {({ state, dispatch }) => (
            <ConnectedSelector state={state} dispatch={dispatch} accounts={accounts} {...props} />
          )}
        </ComposerHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, selectedIds: () => latest.selectedAccountIds };
}

const checkbox = (name) => screen.getByRole('checkbox', { name });

async function openPresets(user) {
  await user.click(screen.getByRole('button', { name: 'Presets' }));
  return screen.getByRole('menu');
}

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------ account list */

describe('AccountSelector — choosing accounts', () => {
  it('lists accounts by platform with their details and any attention reasons', () => {
    renderSelector();

    const pages = screen.getByRole('group', { name: /Facebook Pages/ });
    const instagram = screen.getByRole('group', { name: /Instagram accounts/ });
    expect(within(pages).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(instagram).getAllByRole('checkbox')).toHaveLength(2);

    expect(checkbox('Acme Store (Facebook)')).toHaveAccessibleDescription('Facebook Page · Retail');
    expect(checkbox('Acme Instagram (Instagram)')).toHaveAccessibleDescription(
      '@acme · Business account · Linked to Acme Store',
    );
    expect(checkbox('Acme Studio (Instagram)')).toHaveAccessibleDescription(
      /Needs attention.*Missing permission: instagram_content_publish/,
    );
    // Problem accounts stay selectable; healthy accounts get no "ready" badge.
    expect(checkbox('Acme Studio (Instagram)')).toBeEnabled();
    expect(screen.getAllByText('Needs attention')).toHaveLength(1);
    expect(screen.queryByText(/ready/i)).not.toBeInTheDocument();
  });

  it('toggles accounts and summarises the selection', async () => {
    const user = userEvent.setup();
    const { selectedIds } = renderSelector();
    expect(screen.getByText('Choose one or more accounts for this post.')).toBeInTheDocument();

    await user.click(checkbox('Acme Store (Facebook)'));
    await user.click(screen.getByText('Acme Instagram'));
    expect(checkbox('Acme Store (Facebook)')).toBeChecked();
    expect(checkbox('Acme Instagram (Instagram)')).toBeChecked();
    expect(screen.getByText('2 of 4 accounts selected')).toBeInTheDocument();
    expect(selectedIds()).toEqual(['acc-fb-1', 'acc-ig-1']);

    await user.click(checkbox('Acme Store (Facebook)'));
    expect(selectedIds()).toEqual(['acc-ig-1']);
    expect(screen.getByText('1 of 4 accounts selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').every((box) => !box.checked)).toBe(true);
  });

  it('filters by platform with counts and keyboard arrows', async () => {
    const user = userEvent.setup();
    renderSelector();
    const group = screen.getByRole('radiogroup', { name: 'Filter accounts by platform' });
    expect(within(group).getByRole('radio', { name: 'All (4)' })).toBeChecked();

    await user.click(within(group).getByRole('radio', { name: 'Instagram (2)' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /Facebook/ })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(within(group).getByRole('radio', { name: 'Facebook (2)' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Facebook (2)' })).toHaveFocus();
    expect(screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent)).toEqual([
      expect.stringContaining('Acme Store'),
      expect.stringContaining('Acme Outlet'),
    ]);
  });

  it('searches names, @usernames and linked Pages, with a filtered-empty state', async () => {
    const user = userEvent.setup();
    renderSelector();
    const search = screen.getByRole('searchbox', { name: 'Search accounts' });

    await user.type(search, 'outlet');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(checkbox('Acme Outlet (Facebook)')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '@acme.studio');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(checkbox('Acme Studio (Instagram)')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);

    await user.type(search, 'zzz');
    expect(screen.getByRole('heading', { name: 'No accounts match “zzz”' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });

  it('offers to show all platforms when a platform has no accounts', async () => {
    const user = userEvent.setup();
    renderSelector({ accounts: normalizeAccounts([fbPage()]) });
    await user.click(screen.getByRole('radio', { name: 'Instagram (0)' }));
    expect(
      screen.getByRole('heading', { name: 'No Instagram accounts available to you' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all platforms' }));
    expect(screen.getByRole('radio', { name: 'All (1)' })).toBeChecked();
    expect(checkbox('Acme Store (Facebook)')).toBeInTheDocument();
  });

  it('selects and deselects only the accounts that are shown', async () => {
    const user = userEvent.setup();
    const { selectedIds } = renderSelector({ selected: ['acc-fb-1'] });

    await user.click(screen.getByRole('radio', { name: 'Instagram (2)' }));
    await user.click(screen.getByRole('button', { name: 'Select all shown (2)' }));
    expect(selectedIds()).toEqual(['acc-fb-1', 'acc-ig-1', 'acc-ig-2']);
    expect(screen.getByText('3 of 4 accounts selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deselect shown' }));
    expect(selectedIds()).toEqual(['acc-fb-1']);
    expect(screen.getByRole('button', { name: 'Select all shown (2)' })).toBeInTheDocument();
  });

  it('shows at most five avatars for the selection, then a count', () => {
    const pages = Array.from({ length: 7 }, (_, index) =>
      fbPage({ id: `acc-fb-${index}`, externalId: `${index}`, name: `Page ${index}` }),
    );
    renderSelector({
      accounts: normalizeAccounts(pages),
      selected: pages.map((page) => page.id),
    });
    expect(screen.getByText('7 of 7 accounts selected')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByTitle(/^Page 0, Page 1, .*Page 6$/)).toBeInTheDocument();
  });

  it('reports selected accounts that are no longer available and removes them', async () => {
    const user = userEvent.setup();
    const { selectedIds } = renderSelector({ selected: ['acc-fb-1', 'gone-1'] });
    expect(
      screen.getByText('1 selected account is no longer available to you and will be left out.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 4 accounts selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove from selection' }));
    expect(selectedIds()).toEqual(['acc-fb-1']);
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- states */

describe('AccountSelector — quick select by star and label', () => {
  const CLIENT = { id: 'l1', name: 'Client A', color: 'sky' };
  const labelled = () =>
    normalizeAccounts([
      fbPage({ labels: [CLIENT], starred: true }),
      fbPage({ id: 'acc-fb-2', externalId: '5002', name: 'Acme Outlet', category: 'Shopping' }),
      igAccount({ labels: [CLIENT] }),
    ]);

  it('adds a label’s accounts to the selection and removes them again, keeping the rest', async () => {
    const user = userEvent.setup();
    const { selectedIds } = renderSelector({ accounts: labelled(), selected: ['acc-fb-2'] });
    const group = screen.getByRole('group', { name: 'Quick select' });
    const client = within(group).getByRole('button', { name: /Client A/ });
    expect(client).toHaveAttribute('aria-pressed', 'false');

    await user.click(client);
    expect(selectedIds()).toEqual(['acc-fb-2', 'acc-fb-1', 'acc-ig-1']);
    expect(client).toHaveAttribute('aria-pressed', 'true');

    await user.click(client);
    expect(selectedIds()).toEqual(['acc-fb-2']);
  });

  it('selects the person’s starred accounts and shows labels and stars on the rows', async () => {
    const user = userEvent.setup();
    const { selectedIds } = renderSelector({ accounts: labelled() });
    await user.click(
      within(screen.getByRole('group', { name: 'Quick select' })).getByRole('button', {
        name: /Starred/,
      }),
    );
    expect(selectedIds()).toEqual(['acc-fb-1']);
    const row = checkbox('Acme Store (Facebook)').closest('label');
    expect(within(row).getByRole('img', { name: 'Starred' })).toBeInTheDocument();
    expect(within(row).getByText('Client A')).toBeInTheDocument();
  });

  it('shows no quick select when no account is starred or labelled', () => {
    renderSelector();
    expect(screen.queryByRole('group', { name: 'Quick select' })).not.toBeInTheDocument();
  });
});

describe('AccountSelector — loading, error and empty states', () => {
  it('shows four skeleton rows while accounts load', () => {
    renderSelector({ status: 'loading', accounts: [], selected: ['acc-fb-1'] });
    expect(screen.getAllByTestId('account-skeleton')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…');
    expect(screen.getByText('Loading your accounts…')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    // Selected ids are not reported missing while the list is still loading.
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });

  it('shows the load error with a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderSelector({ status: 'error', accounts: [], error: new Error('Network down'), onRetry });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your accounts");
    expect(alert).toHaveTextContent('Network down');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tells owners and admins to connect accounts', () => {
    renderSelector({ accounts: [], canManageAccounts: true });
    expect(
      screen.getByText(
        'Connect a Facebook Page or Instagram professional account to start composing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Social accounts' })).toHaveAttribute(
      'href',
      '/w/acme/accounts',
    );
  });

  it('tells editors that no accounts have been assigned to them', () => {
    renderSelector({ accounts: [], canManageAccounts: false });
    expect(
      screen.getByRole('heading', { name: 'No accounts assigned to you' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No social accounts have been assigned to you yet. Ask a workspace owner or admin to give you access.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Presets' })).not.toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- presets */

describe('AccountPresets — built-in presets', () => {
  it('replaces the selection with a built-in preset and confirms it', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    const { selectedIds } = renderSelector({ selected: ['acc-fb-1'] });

    const menu = await openPresets(user);
    expect(within(menu).getByRole('menuitem', { name: 'All accounts 4 accounts' })).toBeEnabled();
    expect(
      within(menu).getByRole('menuitem', { name: /^Accounts with publishing access 3 accounts/ }),
    ).toHaveAccessibleDescription('Connected accounts whose Meta permissions allow publishing');

    await user.click(within(menu).getByRole('menuitem', { name: /^All Instagram accounts/ }));
    expect(selectedIds()).toEqual(['acc-ig-1', 'acc-ig-2']);
    expect(success).toHaveBeenCalledWith('Selected 2 accounts', undefined);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Presets' })).toHaveFocus();
  });

  it('disables built-in presets that match no accounts and marks the current one', async () => {
    const user = userEvent.setup();
    renderSelector({ accounts: normalizeAccounts([fbPage()]), selected: ['acc-fb-1'] });
    const menu = await openPresets(user);
    expect(within(menu).getByRole('menuitem', { name: /^All Instagram accounts/ })).toBeDisabled();
    expect(
      within(menu).getByRole('menuitem', {
        name: 'All Facebook Pages 1 account, current selection',
      }),
    ).toBeEnabled();
  });

  it('supports keyboard navigation inside the menu', async () => {
    const user = userEvent.setup();
    renderSelector();
    const menu = await openPresets(user);
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: /^All Facebook Pages/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(
      within(menu).getByRole('menuitem', { name: /^Accounts with publishing access/ }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: /^All accounts/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(
      within(menu).getByRole('menuitem', { name: /^Accounts with publishing access/ }),
    ).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Presets' })).toHaveFocus();
  });

  it('closes when focus is tabbed out of the menu', async () => {
    const user = userEvent.setup();
    renderSelector();
    const menu = await openPresets(user);
    const enabled = within(menu)
      .getAllByRole('menuitem')
      .filter((item) => !item.disabled);
    for (let i = 0; i < enabled.length; i += 1) await user.tab();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all shown (4)' })).toHaveFocus();
  });

  it('offers only the built-in presets when no presets store is passed', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <AccountPresets
        accounts={normalizeAccounts(accountList())}
        selectedIds={['acc-fb-1']}
        onApply={onApply}
      />,
    );
    const menu = await openPresets(user);
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(BUILT_IN_PRESETS.length);
    expect(within(menu).queryByText('Your presets')).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /^All Facebook Pages/ }));
    expect(onApply).toHaveBeenCalledWith(['acc-fb-1', 'acc-fb-2']);
  });
});

describe('AccountPresets — presets saved in this browser', () => {
  it('saves the current selection in this browser and lists it', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    renderSelector({ selected: ['acc-fb-2', 'acc-ig-1'] });

    let menu = await openPresets(user);
    expect(within(menu).getByText('Saved in this browser')).toBeInTheDocument();
    expect(within(menu).getByText(/No saved presets yet/)).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Save current selection…' }));

    const dialog = screen.getByRole('dialog', { name: 'Save as preset' });
    expect(dialog).toHaveTextContent(CAPABILITY_MESSAGES.serverPresets);
    expect(dialog).toHaveAccessibleDescription(
      'Save the 2 accounts you selected so you can choose them again in one step.',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Preset name' }),
      'Retail team{Enter}',
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(success).toHaveBeenCalledWith('Saved “Retail team” in this browser');
    expect(JSON.parse(localStorage.getItem(PRESETS_KEY))).toEqual([
      {
        id: expect.stringMatching(/^preset_/),
        name: 'Retail team',
        socialAccountIds: ['acc-fb-2', 'acc-ig-1'],
        createdAt: expect.any(String),
      },
    ]);
    expect(screen.getByRole('button', { name: 'Presets' })).toHaveFocus();

    menu = await openPresets(user);
    expect(
      within(menu).getByRole('menuitem', { name: 'Retail team 2 accounts, current selection' }),
    ).toHaveAccessibleDescription('2 accounts');
  });

  it('applies a saved preset, skipping accounts that are no longer available', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([
        {
          id: 'preset_1',
          name: 'Weekend',
          socialAccountIds: ['acc-fb-2', 'gone', 'acc-ig-1'],
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ]),
    );
    const { selectedIds } = renderSelector({ selected: ['acc-fb-1'] });

    const menu = await openPresets(user);
    const item = within(menu).getByRole('menuitem', { name: 'Weekend 2 accounts' });
    expect(item).toHaveAccessibleDescription('2 of 3 accounts available to you');
    await user.click(item);

    expect(selectedIds()).toEqual(['acc-fb-2', 'acc-ig-1']);
    expect(success).toHaveBeenCalledWith('Selected 2 accounts', {
      description: '1 account in “Weekend” is no longer available to you.',
    });
  });

  it('deletes a saved preset after confirmation', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([{ id: 'preset_1', name: 'Weekend', socialAccountIds: ['acc-fb-1'] }]),
    );
    renderSelector();

    const menu = await openPresets(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete preset Weekend' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Weekend”?' });
    expect(dialog).toHaveTextContent("It's removed from this browser.");

    await user.click(within(dialog).getByRole('button', { name: 'Delete preset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem(PRESETS_KEY))).toEqual([]);
    expect(success).toHaveBeenCalledWith('Deleted “Weekend” from this browser');

    const reopened = await openPresets(user);
    expect(within(reopened).queryByRole('menuitem', { name: /Weekend/ })).not.toBeInTheDocument();
  });

  it('cannot save a preset before any account is selected', async () => {
    const user = userEvent.setup();
    renderSelector();
    const menu = await openPresets(user);
    const save = within(menu).getByRole('menuitem', { name: 'Save current selection…' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Select accounts first to save them as a preset.');
  });

  it('explains that presets cannot be saved when this browser blocks storage', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    renderSelector({ selected: ['acc-fb-1'] });
    const menu = await openPresets(user);
    expect(within(menu).getByText("Can't be saved in this browser")).toBeInTheDocument();
    expect(
      within(menu).getByText(
        "This browser doesn't let SocialHub store data, so presets can't be saved here.",
      ),
    ).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Save current selection…' })).toBeDisabled();
  });

  it('makes no network requests for presets while the presets API is off', async () => {
    const user = userEvent.setup();
    const mock = setupComposerApi();
    renderSelector({ selected: ['acc-fb-1'] });

    let menu = await openPresets(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Save current selection…' }));
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Solo{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    menu = await openPresets(user);
    await user.click(within(menu).getByRole('menuitem', { name: /^Solo/ }));

    expect(mock.fn).not.toHaveBeenCalled();
  });
});

describe('AccountPresets — presets shared with the workspace', () => {
  const launch = {
    id: 'p1',
    name: 'Launch',
    socialAccountIds: ['acc-fb-1', 'acc-ig-1'],
    createdBy: { id: 'u2', name: 'Grace Hopper' },
    createdAt: '2026-11-18T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.stubEnv('VITE_COMPOSER_SERVER_PRESETS', 'true');
  });

  it('lists, creates and deletes presets through the presets API', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    let items = [launch];
    const mock = setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items }),
        [`POST ${PRESETS_PATH}`]: ({ init }) => {
          const body = JSON.parse(init.body);
          const preset = { id: 'p2', ...body, createdBy: { id: 'u1', name: 'Ada Lovelace' } };
          items = [...items, preset];
          return jsonResponse(201, { preset });
        },
        [`DELETE ${PRESETS_PATH}/p1`]: () => {
          items = items.filter((p) => p.id !== 'p1');
          return new Response(null, { status: 204 });
        },
      },
    });
    renderSelector({ selected: ['acc-fb-2'] });

    let menu = await openPresets(user);
    expect(within(menu).getByText('Shared with this workspace')).toBeInTheDocument();
    const item = await within(menu).findByRole('menuitem', { name: 'Launch 2 accounts' });
    expect(item).toHaveAccessibleDescription('2 accounts · by Grace Hopper');
    expect(localStorage.getItem(PRESETS_KEY)).toBeNull();

    await user.click(within(menu).getByRole('menuitem', { name: 'Save current selection…' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as preset' });
    expect(dialog).toHaveTextContent('Shared with this workspace.');
    await user.type(within(dialog).getByRole('textbox', { name: 'Preset name' }), 'Outlet{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const post = mock.calls.find((call) => call.key === `POST ${PRESETS_PATH}`);
    expect(JSON.parse(post.init.body)).toEqual({ name: 'Outlet', socialAccountIds: ['acc-fb-2'] });
    expect(success).toHaveBeenCalledWith('Saved “Outlet” for this workspace');
    expect(localStorage.getItem(PRESETS_KEY)).toBeNull();

    menu = await openPresets(user);
    expect(
      await within(menu).findByRole('menuitem', { name: 'Outlet 1 account, current selection' }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete preset Launch' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete “Launch”?' });
    expect(confirm).toHaveTextContent("It's removed for everyone in this workspace.");
    await user.click(within(confirm).getByRole('button', { name: 'Delete preset' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.count(`DELETE ${PRESETS_PATH}/p1`)).toBe(1);
    expect(success).toHaveBeenCalledWith('Deleted “Launch”');
  });

  it('keeps the delete dialog open with the server error when deleting fails', async () => {
    const user = userEvent.setup();
    setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [launch] }),
        [`DELETE ${PRESETS_PATH}/p1`]: () =>
          apiError(403, 'FORBIDDEN', 'Only the person who created a preset can delete it.'),
      },
    });
    renderSelector();
    const menu = await openPresets(user);
    await user.click(await within(menu).findByRole('menuitem', { name: 'Delete preset Launch' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete “Launch”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete preset' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Only the person who created a preset can delete it.',
    );
    expect(screen.getByRole('dialog', { name: 'Delete “Launch”?' })).toBeInTheDocument();
  });

  it('reports success only after the server has answered', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, 'success');
    let answer;
    setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [] }),
        [`POST ${PRESETS_PATH}`]: ({ init }) =>
          new Promise((resolve) => {
            answer = () =>
              resolve(jsonResponse(201, { preset: { id: 'p9', ...JSON.parse(init.body) } }));
          }),
      },
    });
    renderSelector({ selected: ['acc-fb-1'] });
    const menu = await openPresets(user);
    await within(menu).findByText(/No saved presets yet/);
    await user.click(within(menu).getByRole('menuitem', { name: 'Save current selection…' }));
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Pending{Enter}');

    await waitFor(() => expect(answer).toBeTypeOf('function'));
    expect(screen.getByRole('button', { name: 'Save preset' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(success).not.toHaveBeenCalled();

    answer();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(success).toHaveBeenCalledWith('Saved “Pending” for this workspace');
  });

  it('shows a load error inside the menu and retries', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const mock = setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => {
          attempt += 1;
          return attempt === 1
            ? apiError(500, 'INTERNAL', 'Presets are temporarily unavailable.')
            : jsonResponse(200, { items: [launch] });
        },
      },
    });
    renderSelector();
    const menu = await openPresets(user);
    expect(await within(menu).findByRole('alert')).toHaveTextContent(
      'Presets are temporarily unavailable.',
    );

    await user.click(within(menu).getByRole('menuitem', { name: 'Try again' }));
    expect(await within(menu).findByRole('menuitem', { name: 'Launch 2 accounts' })).toBeEnabled();
    expect(mock.count(`GET ${PRESETS_PATH}`)).toBe(2);
  });
});

/* ------------------------------------------------------------ dialog alone */

describe('SavePresetDialog', () => {
  const renderDialog = (props = {}) => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue({ id: 'p1' });
    render(
      <SavePresetDialog
        open
        onClose={onClose}
        onSave={onSave}
        selectedCount={2}
        storage="device"
        {...props}
      />,
    );
    return { onClose, onSave: props.onSave ?? onSave };
  };

  it('requires a name of at most 40 characters and submits with Enter', async () => {
    const user = userEvent.setup();
    const { onClose, onSave } = renderDialog();
    const input = screen.getByRole('textbox', { name: 'Preset name' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxLength', '40');

    await user.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name for the preset.');
    expect(onSave).not.toHaveBeenCalled();

    await user.type(input, '  Spring  {Enter}');
    expect(onSave).toHaveBeenCalledWith('Spring');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows why saving failed and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new Error('A preset called “Spring” already exists. Choose a different name.'),
      );
    const { onClose } = renderDialog({ onSave });

    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Spring{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A preset called “Spring” already exists. Choose a different name.',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Preset name' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeEnabled();
  });

  it('shows a loading state until the save settles', async () => {
    const user = userEvent.setup();
    let finish;
    const onSave = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { onClose } = renderDialog({ onSave });

    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Spring{Enter}');
    const save = screen.getByRole('button', { name: 'Save preset' });
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(save).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish({ id: 'p1' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('counts characters and says where the preset is kept', async () => {
    const user = userEvent.setup();
    renderDialog({ storage: 'server' });
    expect(screen.getByText('0/40')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Launch');
    expect(screen.getByText('6/40')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Shared with this workspace. Everyone who composes here can apply it to the accounts they can access.',
    );
  });

  it('cannot save without a selection or when storage is blocked', () => {
    const { unmount } = render(
      <SavePresetDialog open onClose={() => {}} onSave={vi.fn()} selectedCount={0} />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Select at least one account to save a preset.',
    );
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeDisabled();
    unmount();

    render(
      <SavePresetDialog
        open
        onClose={() => {}}
        onSave={vi.fn()}
        selectedCount={1}
        storage="unavailable"
      />,
    );
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "This browser doesn't let SocialHub store data, so presets can't be saved here.",
    );
  });
});

/* ------------------------------------------------------------ small pieces */

describe('AccountOption', () => {
  it('flags Phase 3 health attention items while keeping the account selectable', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const account = normalizeAccount(
      withHealth(fbPage(), {
        needsAttention: true,
        attention: [{ code: 'TOKEN_EXPIRING', message: 'Access expires in 3 days.' }],
      }),
    );
    render(<AccountOption account={account} selected={false} onToggle={onToggle} />);

    const box = screen.getByRole('checkbox', { name: 'Acme Store (Facebook)' });
    expect(box).toHaveAccessibleDescription(
      'Facebook Page · Retail Needs attention Access expires in 3 days.',
    );
    await user.click(box);
    expect(onToggle).toHaveBeenCalledWith('acc-fb-1');
  });

  it('explains why a disconnected account needs attention', () => {
    const account = normalizeAccount(fbPage({ connectionStatus: 'DISCONNECTED' }));
    render(<AccountOption account={account} selected onToggle={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Acme Store (Facebook)' });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(
      screen.getByText('This account is disconnected. Reconnect it in Social accounts.'),
    ).toBeInTheDocument();
  });

  it('keeps a Page and an Instagram account with the same name distinct', () => {
    const [page, instagram] = normalizeAccounts([
      fbPage({ name: 'Acme' }),
      igAccount({ name: 'Acme', linkedPage: null }),
    ]);
    render(
      <>
        <AccountOption account={page} />
        <AccountOption account={instagram} />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'Acme (Facebook)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Acme (Instagram)' })).toBeInTheDocument();
  });
});

describe('PlatformFilter', () => {
  it('works without counts and reports the chosen platform', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PlatformFilter value="ALL" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Instagram' }));
    expect(onChange).toHaveBeenCalledWith('INSTAGRAM_ACCOUNT');
  });
});
