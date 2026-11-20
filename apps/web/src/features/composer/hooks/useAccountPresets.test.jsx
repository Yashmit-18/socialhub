import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../../lib/api.js';
import { apiError, jsonResponse } from '../../../test/fetchMock.js';
import { setupComposerApi } from '../test/fixtures.js';
import {
  PRESET_MESSAGES,
  PRESET_NAME_MAX,
  PRESET_STORAGE,
  accountPresetsQueryKey,
  normalizePresetName,
  useAccountPresets,
  validatePresetInput,
} from './useAccountPresets.js';

const KEY = 'sh-composer-presets:v1:u1:w1';
const PRESETS_PATH = '/workspaces/w1/account-presets';

const storedPresets = (key = KEY) => JSON.parse(localStorage.getItem(key) ?? 'null');

function renderPresets(initialProps = { workspaceId: 'w1', userId: 'u1' }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = renderHook((props) => useAccountPresets(props), { initialProps, wrapper });
  return { ...utils, queryClient };
}

const presetCalls = (mock) => mock.calls.filter((call) => call.key.includes('/account-presets'));

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('validatePresetInput', () => {
  it('trims and collapses whitespace and de-duplicates ids', () => {
    expect(validatePresetInput('  Spring   launch ', ['a', 'b', 'a', '', null])).toEqual({
      name: 'Spring launch',
      socialAccountIds: ['a', 'b'],
    });
    expect(normalizePresetName('\tWeekend\n brands ')).toBe('Weekend brands');
  });

  it('rejects empty, overlong and duplicate names, and empty account lists', () => {
    expect(() => validatePresetInput('   ', ['a'])).toThrow(PRESET_MESSAGES.nameRequired);
    expect(() => validatePresetInput('x'.repeat(PRESET_NAME_MAX + 1), ['a'])).toThrow(
      PRESET_MESSAGES.nameTooLong,
    );
    expect(validatePresetInput('x'.repeat(PRESET_NAME_MAX), ['a']).name).toHaveLength(40);
    expect(() => validatePresetInput('Retail', [])).toThrow(PRESET_MESSAGES.noAccounts);
    expect(() =>
      validatePresetInput('  rETAIL ', ['a'], [{ id: 'p1', name: 'Retail', socialAccountIds: [] }]),
    ).toThrow('A preset called “Retail” already exists. Choose a different name.');
  });
});

describe('useAccountPresets on this device (server presets flag off)', () => {
  it('starts empty, ready, and labelled as device storage', () => {
    const { result } = renderPresets();
    expect(result.current).toMatchObject({
      presets: [],
      storage: PRESET_STORAGE.DEVICE,
      status: 'ready',
      error: null,
      isMutating: false,
    });
  });

  it('saves a preset in localStorage under the person and workspace key', async () => {
    const { result } = renderPresets();
    let preset;
    await act(async () => {
      preset = await result.current.createPreset('  Retail   team ', [
        'acc-fb-1',
        'acc-ig-1',
        'acc-fb-1',
      ]);
    });

    expect(preset).toEqual({
      id: expect.stringMatching(/^preset_/),
      name: 'Retail team',
      socialAccountIds: ['acc-fb-1', 'acc-ig-1'],
      createdAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(preset.createdAt))).toBe(false);
    expect(storedPresets()).toEqual([preset]);
    expect(result.current.presets).toEqual([preset]);
  });

  it('reads presets saved earlier and ignores malformed entries', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'p1', name: 'Weekend', socialAccountIds: ['acc-fb-1'], createdAt: '2026-11-01' },
        { id: 'p2', name: 42, socialAccountIds: [] },
        { name: 'No id', socialAccountIds: [] },
      ]),
    );
    const { result } = renderPresets();
    expect(result.current.presets.map((p) => p.id)).toEqual(['p1']);
  });

  it('deletes a preset from this browser', async () => {
    const { result } = renderPresets();
    await act(async () => {
      await result.current.createPreset('One', ['acc-fb-1']);
      await result.current.createPreset('Two', ['acc-ig-1']);
    });
    const [first, second] = result.current.presets;

    await act(async () => {
      await result.current.deletePreset(first.id);
    });
    expect(result.current.presets).toEqual([second]);
    expect(storedPresets()).toEqual([second]);
  });

  it('rejects invalid names with a people-facing message and saves nothing', async () => {
    const { result } = renderPresets();
    await act(async () => {
      await result.current.createPreset('Retail', ['acc-fb-1']);
    });

    await expect(result.current.createPreset('  ', ['acc-fb-1'])).rejects.toThrow(
      PRESET_MESSAGES.nameRequired,
    );
    await expect(result.current.createPreset('r'.repeat(41), ['acc-fb-1'])).rejects.toThrow(
      PRESET_MESSAGES.nameTooLong,
    );
    await expect(result.current.createPreset('RETAIL', ['acc-ig-1'])).rejects.toThrow(
      /already exists/,
    );
    await expect(result.current.createPreset('Empty', [])).rejects.toThrow(
      PRESET_MESSAGES.noAccounts,
    );
    expect(storedPresets()).toHaveLength(1);
  });

  it('keeps presets another tab saved after this page loaded', async () => {
    const { result } = renderPresets();
    const fromOtherTab = { id: 'p-tab', name: 'Other tab', socialAccountIds: ['acc-fb-2'] };
    localStorage.setItem(KEY, JSON.stringify([fromOtherTab]));

    await act(async () => {
      await result.current.createPreset('This tab', ['acc-fb-1']);
    });
    expect(storedPresets().map((p) => p.name)).toEqual(['Other tab', 'This tab']);
    expect(result.current.presets.map((p) => p.name)).toEqual(['Other tab', 'This tab']);
    await expect(result.current.createPreset('other TAB', ['acc-ig-1'])).rejects.toThrow(
      /already exists/,
    );
  });

  it('keeps presets separate per person and workspace', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'a', name: 'W1', socialAccountIds: ['x'] }]));
    localStorage.setItem(
      'sh-composer-presets:v1:u1:w2',
      JSON.stringify([{ id: 'b', name: 'W2', socialAccountIds: ['y'] }]),
    );
    const { result, rerender } = renderPresets();
    expect(result.current.presets.map((p) => p.name)).toEqual(['W1']);

    rerender({ workspaceId: 'w2', userId: 'u1' });
    expect(result.current.presets.map((p) => p.name)).toEqual(['W2']);

    rerender({ workspaceId: 'w1', userId: 'u2' });
    expect(result.current.presets).toEqual([]);
  });

  it('reports unavailable storage when the browser blocks it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const { result } = renderPresets();
    expect(result.current.storage).toBe(PRESET_STORAGE.UNAVAILABLE);
    expect(result.current.presets).toEqual([]);
    await expect(result.current.createPreset('Retail', ['acc-fb-1'])).rejects.toThrow(
      PRESET_MESSAGES.storageUnavailable,
    );
    await expect(result.current.deletePreset('p1')).rejects.toThrow(
      PRESET_MESSAGES.storageUnavailable,
    );
  });

  it('explains when this browser storage is full', async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key.startsWith('sh-composer-presets')) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    });
    const { result } = renderPresets();
    expect(result.current.storage).toBe(PRESET_STORAGE.DEVICE);
    await expect(result.current.createPreset('Retail', ['acc-fb-1'])).rejects.toThrow(
      PRESET_MESSAGES.storageFull,
    );
    expect(result.current.presets).toEqual([]);
  });

  it('never calls the presets API', async () => {
    const mock = setupComposerApi();
    const { result } = renderPresets();
    await act(async () => {
      const preset = await result.current.createPreset('Retail', ['acc-fb-1']);
      await result.current.deletePreset(preset.id);
    });
    result.current.retry();
    expect(mock.fn).not.toHaveBeenCalled();
  });
});

describe('useAccountPresets shared with the workspace (server presets flag on)', () => {
  const serverPreset = (overrides = {}) => ({
    id: 'p1',
    name: 'Launch',
    socialAccountIds: ['acc-fb-1', 'acc-ig-1'],
    createdBy: { id: 'u2', name: 'Grace Hopper' },
    createdAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    vi.stubEnv('VITE_COMPOSER_SERVER_PRESETS', 'true');
  });

  it('loads the workspace presets from the API', async () => {
    const mock = setupComposerApi({
      routes: { [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [serverPreset()] }) },
    });
    const { result, queryClient } = renderPresets();
    expect(result.current).toMatchObject({ storage: PRESET_STORAGE.SERVER, status: 'loading' });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.presets).toEqual([
      {
        id: 'p1',
        name: 'Launch',
        socialAccountIds: ['acc-fb-1', 'acc-ig-1'],
        createdAt: '2026-11-18T10:00:00.000Z',
        createdBy: { id: 'u2', name: 'Grace Hopper' },
      },
    ]);
    expect(queryClient.getQueryData(accountPresetsQueryKey('w1'))).toEqual(result.current.presets);
    expect(mock.count(`GET ${PRESETS_PATH}`)).toBe(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('creates a preset on the server and refreshes the list', async () => {
    let created = false;
    const mock = setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () =>
          jsonResponse(200, {
            items: created ? [serverPreset(), serverPreset({ id: 'p2', name: 'Retail' })] : [],
          }),
        [`POST ${PRESETS_PATH}`]: () => {
          created = true;
          return jsonResponse(201, {
            preset: serverPreset({ id: 'p2', name: 'Retail', socialAccountIds: ['acc-fb-2'] }),
          });
        },
      },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let preset;
    await act(async () => {
      preset = await result.current.createPreset(' Retail ', ['acc-fb-2']);
    });

    const post = mock.calls.find((call) => call.key === `POST ${PRESETS_PATH}`);
    expect(JSON.parse(post.init.body)).toEqual({ name: 'Retail', socialAccountIds: ['acc-fb-2'] });
    expect(preset).toMatchObject({ id: 'p2', name: 'Retail', socialAccountIds: ['acc-fb-2'] });
    await waitFor(() => expect(mock.count(`GET ${PRESETS_PATH}`)).toBe(2));
    await waitFor(() => expect(result.current.presets).toHaveLength(2));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('deletes a preset on the server and refreshes the list', async () => {
    let deleted = false;
    const mock = setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () =>
          jsonResponse(200, { items: deleted ? [] : [serverPreset()] }),
        [`DELETE ${PRESETS_PATH}/p1`]: () => {
          deleted = true;
          return new Response(null, { status: 204 });
        },
      },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.presets).toHaveLength(1));

    await act(async () => {
      await result.current.deletePreset('p1');
    });
    expect(mock.count(`DELETE ${PRESETS_PATH}/p1`)).toBe(1);
    await waitFor(() => expect(result.current.presets).toEqual([]));
  });

  it('checks duplicate names against the loaded list without a request', async () => {
    const mock = setupComposerApi({
      routes: { [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [serverPreset()] }) },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await expect(result.current.createPreset('launch', ['acc-fb-1'])).rejects.toThrow(
      'A preset called “Launch” already exists. Choose a different name.',
    );
    expect(mock.count(`POST ${PRESETS_PATH}`)).toBe(0);
  });

  it('passes server errors through unchanged', async () => {
    setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [] }),
        [`POST ${PRESETS_PATH}`]: () =>
          apiError(403, 'FORBIDDEN', 'You cannot create presets in this workspace.'),
      },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let caught;
    await act(async () => {
      caught = await result.current.createPreset('Retail', ['acc-fb-1']).catch((err) => err);
    });
    expect(caught).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'You cannot create presets in this workspace.',
    });
    expect(result.current.presets).toEqual([]);
  });

  it('reports a failed load and retries on request', async () => {
    let attempt = 0;
    const mock = setupComposerApi({
      routes: {
        [`GET ${PRESETS_PATH}`]: () => {
          attempt += 1;
          return attempt === 1
            ? apiError(500, 'INTERNAL', 'Presets are temporarily unavailable.')
            : jsonResponse(200, { items: [serverPreset()] });
        },
      },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('Presets are temporarily unavailable.');
    expect(result.current.presets).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.presets.map((p) => p.name)).toEqual(['Launch']);
    expect(mock.count(`GET ${PRESETS_PATH}`)).toBe(2);
  });

  it('only sends requests to the presets endpoints it documents', async () => {
    const mock = setupComposerApi({
      routes: { [`GET ${PRESETS_PATH}`]: () => jsonResponse(200, { items: [] }) },
    });
    const { result } = renderPresets();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(presetCalls(mock).map((call) => call.key)).toEqual([`GET ${PRESETS_PATH}`]);
  });
});
