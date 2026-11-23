// Publishing mode card (Settings). MOCKED FRONTEND TESTS: the SocialHub API is mocked with
// fetch; nothing here talks to a real server or to Meta. The API side is tested in
// apps/api/test/publishing.mode.test.js.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../../context/WorkspaceContext.jsx';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { PublishingModeSettings } from './PublishingModeSettings.jsx';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const WS = 'ws1';
const STATUS = `GET /workspaces/${WS}/publishing/status`;
const MODE = `PUT /workspaces/${WS}/publishing/mode`;

const workspace = (role) => ({
  id: WS,
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

const status = (overrides = {}) => ({
  mode: 'SIMULATED',
  workspaceMode: 'SIMULATED',
  liveAvailable: true,
  canPublish: true,
  reason: null,
  message: null,
  queue: { status: 'READY' },
  worker: { status: 'RUNNING' },
  storage: { publicUrls: true },
  ...overrides,
});

function setup({ role = 'OWNER', current = status(), routes = {} } = {}) {
  let latest = current;
  const mock = mockFetch({
    [STATUS]: () => jsonResponse(200, latest),
    [MODE]: ({ init }) => {
      const body = JSON.parse(init.body);
      latest = status({
        mode: body.mode === 'LIVE' ? 'LIVE' : 'SIMULATED',
        workspaceMode: body.mode,
      });
      return jsonResponse(200, latest);
    },
    ...routes,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider workspace={workspace(role)}>
        <PublishingModeSettings />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return mock;
}

beforeEach(() => {
  setAccessToken('test-token');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('publishing mode card', () => {
  it('shows simulation by default and cannot switch when the server does not offer real publishing', async () => {
    setup({ current: status({ liveAvailable: false }) });
    expect(await screen.findByText(/This server only offers simulation/)).toBeInTheDocument();
    expect(screen.getByText('Simulation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch on real publishing/ })).toBeDisabled();
    expect(screen.getByText('Not available on this server.')).toBeInTheDocument();
  });

  it('switches on real publishing only with the acknowledgement and the password', async () => {
    const mock = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Switch on real publishing/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch on real publishing?' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Switch on real publishing' }),
    );
    expect(
      await within(dialog).findByText('Confirm that posts will be published to the real accounts'),
    ).toBeInTheDocument();
    expect(mock.count(MODE)).toBe(0);

    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.type(
      within(dialog).getByLabelText('Confirm with your password'),
      'Secret-pass-123',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Switch on real publishing' }),
    );
    await waitFor(() => expect(mock.count(MODE)).toBe(1));
    const sent = JSON.parse(mock.calls.find((c) => c.key === MODE).init.body);
    expect(sent).toEqual({
      mode: 'LIVE',
      password: 'Secret-pass-123',
      acknowledgeRealPublishing: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Real publishing is on for this workspace');
    expect(await screen.findByText('Real publishing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch back to simulation/ })).toBeInTheDocument();
  });

  it('shows a wrong password next to the field', async () => {
    setup({
      routes: {
        [MODE]: () =>
          apiError(422, 'VALIDATION_ERROR', 'Invalid', {
            fields: { password: 'Password is incorrect' },
          }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Switch on real publishing/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.type(
      within(dialog).getByLabelText('Confirm with your password'),
      'wrong-one-123',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Switch on real publishing' }),
    );
    expect(await within(dialog).findByText('Password is incorrect')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('switches back to simulation with a confirmation and no password', async () => {
    const mock = setup({ current: status({ mode: 'LIVE', workspaceMode: 'LIVE' }) });
    expect(await screen.findByText(/published to the real Facebook Pages/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Switch back to simulation/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch back to simulation?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to simulation' }));
    await waitFor(() => expect(mock.count(MODE)).toBe(1));
    expect(JSON.parse(mock.calls.find((c) => c.key === MODE).init.body)).toEqual({
      mode: 'SIMULATED',
    });
    expect(await screen.findByText('Simulation')).toBeInTheDocument();
  });

  it('explains when the workspace chose real publishing but the server stopped offering it', async () => {
    setup({ current: status({ mode: 'SIMULATED', workspaceMode: 'LIVE', liveAvailable: false }) });
    expect(
      await screen.findByText(/switched on for this workspace, but this server does not offer it/),
    ).toBeInTheDocument();
  });

  it('editors and viewers see the mode but cannot change it', async () => {
    for (const role of ['EDITOR', 'VIEWER']) {
      setup({ role });
      expect(await screen.findAllByText(/Posts are simulated/)).not.toHaveLength(0);
      expect(screen.queryByRole('button', { name: /Switch on real publishing/ })).toBeNull();
      document.body.innerHTML = '';
    }
  });
});
