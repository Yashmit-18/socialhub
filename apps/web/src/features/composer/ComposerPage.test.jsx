import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import { installObjectUrlMock, makeFile } from './test/browserMocks.js';
import { accountList, setupComposerApi } from './test/fixtures.js';
import { renderComposer } from './test/renderComposer.jsx';

// jsdom cannot decode media; the inspector is the browser boundary.
vi.mock('./services/mediaInspector.js', () => ({
  INSPECTION_TIMEOUT_MS: 15000,
  inspectMediaFile: vi.fn(async (file) =>
    file.type.startsWith('video/')
      ? { width: 1080, height: 1920, durationSec: 12 }
      : { width: 1080, height: 1350, durationSec: null },
  ),
}));

const DRAFT_KEY = 'sh-composer-draft:v1:u1:w1';
let objectUrls;

/** Every request except reads and the session refresh — the composer must make none by default. */
const writes = (mock) =>
  mock.calls.filter((c) => !c.key.startsWith('GET ') && c.key !== 'POST /auth/refresh');

const previewPanel = () => document.getElementById('composer-panel-preview');
const captionBox = () => screen.getByRole('textbox', { name: /^caption/i });

async function selectAccounts(...names) {
  for (const name of names) {
    await userEvent.click(await screen.findByRole('checkbox', { name: new RegExp(name) }));
  }
}

beforeEach(() => {
  setAccessToken(null);
  objectUrls = installObjectUrlMock();
});

afterEach(() => {
  objectUrls.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('access and states', () => {
  it('tells viewers they cannot create posts and loads no accounts', async () => {
    const mock = setupComposerApi({ role: 'VIEWER' });
    renderComposer();
    expect(await screen.findByText("You can't create posts in this workspace")).toBeInTheDocument();
    expect(mock.count('GET /workspaces/w1/social-accounts')).toBe(0);
  });

  it('explains to editors that no accounts have been assigned to them', async () => {
    setupComposerApi({ role: 'EDITOR', accounts: [] });
    renderComposer();
    expect(
      await screen.findByText(/No social accounts have been assigned to you yet/),
    ).toBeInTheDocument();
  });

  it('offers admins a way to connect accounts when there are none', async () => {
    setupComposerApi({ role: 'ADMIN', accounts: [] });
    renderComposer();
    await screen.findByText(/Connect a Facebook Page or Instagram professional account/);
    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/w/acme/accounts');
    expect(links.length).toBeGreaterThan(0);
  });

  it('shows a retryable error when accounts fail to load', async () => {
    let fail = true;
    setupComposerApi({
      routes: {
        'GET /workspaces/w1/social-accounts': () =>
          fail
            ? apiError(500, 'INTERNAL_ERROR', 'Accounts are temporarily unavailable')
            : jsonResponse(200, { items: accountList() }),
      },
    });
    renderComposer();
    // Shown by the account picker and by the readiness check, which can't run without accounts.
    expect(
      (await screen.findAllByText('Accounts are temporarily unavailable')).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.click(screen.getAllByRole('button', { name: /try again/i })[0]);
    expect(await screen.findByRole('checkbox', { name: /Acme Store/ })).toBeInTheDocument();
    expect(screen.queryByText('Accounts are temporarily unavailable')).toBeNull();
  });
});

describe('publishing is never simulated', () => {
  it('keeps Publish disabled, explains why, and sends nothing while composing', async () => {
    const mock = setupComposerApi();
    renderComposer();
    await selectAccounts('Acme Store');
    await userEvent.type(captionBox(), 'Hello world');

    const publish = screen.getByRole('button', { name: /^publish/i });
    expect(publish).toBeDisabled();
    expect(screen.getAllByText(/Publishing isn.t available yet/).length).toBeGreaterThan(0);
    await userEvent.click(publish);

    expect(screen.queryByText(/post (was )?published/i)).toBeNull();
    expect(writes(mock)).toEqual([]);
  });

  it('labels the preview as not published', async () => {
    setupComposerApi();
    renderComposer();
    await selectAccounts('Acme Store');
    await userEvent.type(captionBox(), 'Preview me');
    expect(within(previewPanel()).getAllByText(/not published/i).length).toBeGreaterThan(0);
  });
});

describe('composing for several platforms', () => {
  it('previews the composed caption with hashtags and flags Instagram’s media requirement', async () => {
    setupComposerApi();
    renderComposer();
    await selectAccounts('Acme Store', 'Acme Instagram');
    await userEvent.type(captionBox(), 'Summer sale starts today');
    await userEvent.type(screen.getByRole('textbox', { name: /hashtag/i }), 'summer{Enter}');

    const preview = within(previewPanel());
    expect(preview.getAllByText(/Summer sale starts today/).length).toBeGreaterThan(0);
    expect(preview.getAllByText(/#summer/).length).toBeGreaterThan(0);
    expect(
      preview.getAllByText(/Instagram posts need at least one photo or video/).length,
    ).toBeGreaterThan(0);
  });

  it('customizes the caption for Instagram without changing Facebook’s', async () => {
    setupComposerApi();
    renderComposer();
    await selectAccounts('Acme Store', 'Acme Instagram');
    await userEvent.type(captionBox(), 'Shared text');

    await userEvent.click(screen.getByRole('tab', { name: /instagram/i }));
    await userEvent.click(screen.getByRole('button', { name: /customize for instagram/i }));
    const igBox = screen.getByRole('textbox', { name: /instagram/i });
    await userEvent.clear(igBox);
    await userEvent.type(igBox, 'Only on Instagram');

    const preview = within(previewPanel());
    await userEvent.click(preview.getByRole('button', { name: /Acme Instagram/ }));
    expect(preview.getAllByText(/Only on Instagram/).length).toBeGreaterThan(0);
    await userEvent.click(preview.getByRole('button', { name: /Acme Store/ }));
    expect(preview.getAllByText(/Shared text/).length).toBeGreaterThan(0);
    expect(preview.queryByText(/Only on Instagram/)).toBeNull();
  });

  it('filters accounts by platform and search', async () => {
    setupComposerApi();
    renderComposer();
    await screen.findByRole('checkbox', { name: /Acme Store/ });

    await userEvent.click(screen.getByRole('radio', { name: /instagram/i }));
    expect(screen.queryByRole('checkbox', { name: /Acme Store/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Acme Instagram/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /^all/i }));
    await userEvent.type(screen.getByRole('searchbox', { name: /search accounts/i }), 'outlet');
    expect(screen.getByRole('checkbox', { name: /Acme Outlet/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Acme Store/ })).toBeNull();
  });
});

describe('media', () => {
  it('adds a picked image, previews it, and frees its object URL when removed', async () => {
    setupComposerApi();
    const { container } = renderComposer();
    await selectAccounts('Acme Instagram');

    const input = container.ownerDocument.querySelector('input[type="file"]');
    await userEvent.upload(input, makeFile('beach.jpg', 'image/jpeg', 200_000));

    const remove = await screen.findByRole('button', { name: 'Remove beach.jpg' });
    expect(objectUrls.created).toHaveLength(1);
    expect(screen.queryByText(/Instagram posts need at least one photo or video/)).toBeNull();

    await userEvent.click(remove);
    expect(objectUrls.revoked).toContain(objectUrls.created[0]);
  });

  it('rejects files no destination accepts, with a conversion hint', async () => {
    setupComposerApi();
    const { container } = renderComposer();
    await screen.findByRole('checkbox', { name: /Acme Store/ });
    const input = container.ownerDocument.querySelector('input[type="file"]');
    await userEvent.upload(input, makeFile('photo.webp', 'image/webp', 50_000), {
      applyAccept: false,
    });
    expect(await screen.findByText(/photo\.webp is a WebP image/)).toBeInTheDocument();
  });
});

describe('drafts', () => {
  it('autosaves in this browser and offers to restore the draft later', async () => {
    setupComposerApi();
    const first = renderComposer();
    await selectAccounts('Acme Store');
    await userEvent.type(captionBox(), 'Remember me');
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toContain('Remember me'), {
      timeout: 3000,
    });
    first.unmount();

    renderComposer();
    await userEvent.click(await screen.findByRole('button', { name: /restore/i }));
    expect(captionBox()).toHaveValue('Remember me');
  });

  it('saves team drafts through the content API when that capability is enabled', async () => {
    vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true');
    const mock = setupComposerApi({
      routes: {
        'POST /workspaces/w1/content-packages': ({ init }) =>
          jsonResponse(201, {
            contentPackage: {
              id: 'cp1',
              status: 'DRAFT',
              version: 1,
              ...JSON.parse(init.body),
              media: [],
              updatedAt: '2026-11-20T10:00:00.000Z',
            },
          }),
        'GET /workspaces/w1/content-packages': () =>
          jsonResponse(200, { items: [], nextCursor: null }),
      },
    });
    renderComposer();
    await selectAccounts('Acme Store');
    await userEvent.type(captionBox(), 'Team draft');
    await userEvent.click(screen.getByRole('button', { name: /^save draft$/i }));

    await waitFor(() => expect(mock.count('POST /workspaces/w1/content-packages')).toBe(1));
    const call = mock.calls.find((c) => c.key === 'POST /workspaces/w1/content-packages');
    expect(JSON.parse(call.init.body)).toEqual({
      caption: 'Team draft',
      platformCaptions: {},
      hashtags: [],
      hashtagPlacement: 'CAPTION',
      keywords: [],
      firstComment: '',
      media: [],
      targetAccountIds: ['acc-fb-1'],
    });
    expect(await screen.findAllByText(/saved to team drafts/i)).not.toHaveLength(0);
  });
});

describe('app integration', () => {
  it('is mounted at /w/:slug/compose in the real route table, with a sidebar link', async () => {
    setupComposerApi({ role: 'EDITOR' });
    renderApp('/w/acme/compose');
    expect(await screen.findByRole('heading', { name: 'Create post' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Create post' });
    expect(links.some((a) => a.getAttribute('href') === '/w/acme/compose')).toBe(true);
  });

  it('hides the sidebar link from viewers', async () => {
    setupComposerApi({ role: 'VIEWER' });
    renderApp('/w/acme/team');
    await screen.findAllByRole('link', { name: 'Team' });
    expect(screen.queryByRole('link', { name: 'Create post' })).toBeNull();
  });
});

describe('layout', () => {
  it('switches between the editor and the preview on small screens', async () => {
    setupComposerApi();
    renderComposer();
    await screen.findByRole('checkbox', { name: /Acme Store/ });
    const compose = document.getElementById('composer-panel-compose');
    expect(previewPanel()).toHaveClass('hidden');

    await userEvent.click(screen.getByRole('tab', { name: /^preview/i }));
    expect(compose).toHaveClass('hidden');
    expect(previewPanel()).not.toHaveClass('hidden');
  });
});
