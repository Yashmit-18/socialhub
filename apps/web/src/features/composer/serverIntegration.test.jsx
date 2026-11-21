import {
  accountPresetSchema,
  contentPackageInputSchema,
  contentPackageUpdateSchema,
  mediaUploadRequestSchema,
} from '@socialhub/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse } from '../../test/fetchMock.js';
import { resumeLocalDrafts } from './services/localStore.js';
import { installObjectUrlMock, makeFile } from './test/browserMocks.js';
import { setupComposerApi } from './test/fixtures.js';
import { renderComposer } from './test/renderComposer.jsx';

/**
 * The composer against the implemented API (flags on). The server is still a fetch mock here,
 * but every request body is checked with the SAME schemas the API validates with
 * (packages/shared), so a body the composer sends is one the real API accepts.
 * The API itself is tested end to end in apps/api/test/{contentPackages,media,accountPresets}.
 */

vi.mock('./services/mediaInspector.js', () => ({
  INSPECTION_TIMEOUT_MS: 15000,
  inspectMediaFile: vi.fn(async () => ({ width: 1080, height: 1350, durationSec: null })),
}));

const DRAFT_KEY = 'sh-composer-draft:v1:u1:w1';
const PACKAGES = '/workspaces/w1/content-packages';
const ID = 'a'.repeat(24);
const ACCOUNT = 'b'.repeat(24);
const TIMEOUT = 20_000;

const captionBox = () => screen.getByRole('textbox', { name: /^caption/i });
const bodyOf = (call) => JSON.parse(call.init.body);
const callsTo = (mock, key) => mock.calls.filter((c) => c.key === key);

/** A server that stores one draft, like the real API: version check, 409 when stale. */
function draftServer({ onPatch } = {}) {
  const state = { version: 0, saved: null };
  const respond = (status) =>
    jsonResponse(status, {
      contentPackage: {
        id: ID,
        status: 'DRAFT',
        version: state.version,
        ...state.saved,
        media: [],
        updatedAt: new Date().toISOString(),
      },
    });
  return {
    state,
    routes: {
      [`POST ${PACKAGES}`]: ({ init }) => {
        state.saved = contentPackageInputSchema.parse(JSON.parse(init.body));
        state.version = 1;
        return respond(201);
      },
      [`PATCH ${PACKAGES}/${ID}`]: ({ init }) => {
        const override = onPatch?.();
        if (override) return override;
        const { version, ...input } = contentPackageUpdateSchema.parse(JSON.parse(init.body));
        if (version !== state.version) {
          return apiError(
            409,
            'CONFLICT',
            'Someone else saved this draft. Reload it to see their changes.',
          );
        }
        state.saved = input;
        state.version += 1;
        return respond(200);
      },
      [`GET ${PACKAGES}`]: () => jsonResponse(200, { items: [], nextCursor: null }),
    },
  };
}

const accounts = () => [
  {
    id: ACCOUNT,
    platform: 'FACEBOOK_PAGE',
    name: 'Acme Store',
    connectionStatus: 'ACTIVE',
    publishingStatus: 'READY',
  },
];

let objectUrls;
beforeEach(() => {
  setAccessToken(null);
  resumeLocalDrafts('u1');
  objectUrls = installObjectUrlMock();
});
afterEach(() => {
  objectUrls.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('team drafts on the real API contract', () => {
  beforeEach(() => vi.stubEnv('VITE_COMPOSER_SERVER_DRAFTS', 'true'));

  it(
    'saves a draft, then autosaves later edits with the version it last saw',
    async () => {
      const server = draftServer();
      const mock = setupComposerApi({ accounts: accounts(), routes: server.routes });
      renderComposer();
      await userEvent.click(await screen.findByRole('checkbox', { name: /Acme Store/ }));
      await userEvent.type(captionBox(), 'First');

      // Nothing is sent before the person saves: autosave never creates a draft by itself.
      expect(callsTo(mock, `POST ${PACKAGES}`)).toHaveLength(0);
      await userEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
      await waitFor(() => expect(server.state.version).toBe(1));
      expect(server.state.saved).toMatchObject({ caption: 'First', targetAccountIds: [ACCOUNT] });

      await userEvent.type(captionBox(), ' edit');
      await waitFor(() => expect(server.state.version).toBe(2), { timeout: 8000 });
      const patches = callsTo(mock, `PATCH ${PACKAGES}/${ID}`);
      expect(patches).toHaveLength(1); // one debounced save, not one per keystroke
      expect(bodyOf(patches[0])).toMatchObject({ caption: 'First edit', version: 1 });
      expect(await screen.findAllByText(/saved to team drafts/i)).not.toHaveLength(0);
      // The browser draft is still kept as a fallback.
      expect(localStorage.getItem(DRAFT_KEY)).toContain('First edit');
    },
    TIMEOUT,
  );

  it(
    'stops on a conflict, says so, and offers to keep this version as a new draft',
    async () => {
      const server = draftServer();
      const mock = setupComposerApi({ accounts: accounts(), routes: server.routes });
      renderComposer();
      await userEvent.type(await screen.findByRole('textbox', { name: /^caption/i }), 'Mine');
      await userEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
      await waitFor(() => expect(server.state.version).toBe(1));

      server.state.version = 5; // a teammate saved in the meantime
      await userEvent.type(captionBox(), ' v2');
      expect(
        await screen.findAllByText(/someone else changed this draft/i, undefined, {
          timeout: 8000,
        }),
      ).not.toHaveLength(0);
      expect(screen.queryByText(/saved to team drafts/i)).toBeNull();

      // No retry loop: the conflicting save is not sent again by itself.
      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(callsTo(mock, `PATCH ${PACKAGES}/${ID}`)).toHaveLength(1);
      expect(server.state.saved.caption).toBe('Mine');

      await userEvent.click(screen.getByRole('button', { name: 'Save as a new draft' }));
      await waitFor(() => expect(callsTo(mock, `POST ${PACKAGES}`)).toHaveLength(2));
      expect(bodyOf(callsTo(mock, `POST ${PACKAGES}`)[1]).caption).toBe('Mine v2');
    },
    TIMEOUT,
  );

  it(
    'shows the API’s field messages when a save is rejected',
    async () => {
      const mock = setupComposerApi({
        accounts: accounts(),
        routes: {
          [`POST ${PACKAGES}`]: () =>
            apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
              fields: {
                targetAccountIds:
                  'One or more selected accounts are not available to you in this workspace',
              },
            }),
        },
      });
      renderComposer();
      await userEvent.type(await screen.findByRole('textbox', { name: /^caption/i }), 'Hi');
      await userEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
      expect(await screen.findByText(/not available to you in this workspace/)).toBeInTheDocument();
      expect(screen.queryByText(/saved to team drafts/i)).toBeNull();
      expect(callsTo(mock, `POST ${PACKAGES}`)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'sends a save once when the button is pressed repeatedly',
    async () => {
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      const server = draftServer();
      const mock = setupComposerApi({
        accounts: accounts(),
        routes: {
          ...server.routes,
          [`POST ${PACKAGES}`]: async (ctx) => {
            await gate;
            return server.routes[`POST ${PACKAGES}`](ctx);
          },
        },
      });
      renderComposer();
      await userEvent.type(await screen.findByRole('textbox', { name: /^caption/i }), 'Once');
      const save = screen.getByRole('button', { name: /^save draft$/i });
      await userEvent.click(save);
      await waitFor(() => expect(save).toBeDisabled());
      await userEvent.click(save);
      release();
      await waitFor(() => expect(server.state.version).toBe(1));
      expect(callsTo(mock, `POST ${PACKAGES}`)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'keeps the work in the browser when the session expires during a save',
    async () => {
      let expired = false;
      const server = draftServer();
      setupComposerApi({
        accounts: accounts(),
        routes: {
          ...server.routes,
          'POST /auth/refresh': () =>
            expired
              ? apiError(401, 'UNAUTHENTICATED', 'Your session has ended')
              : jsonResponse(200, {
                  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
                  accessToken: 'access',
                }),
          [`POST ${PACKAGES}`]: () => apiError(401, 'TOKEN_EXPIRED', 'Token expired'),
        },
      });
      renderComposer();
      await userEvent.type(await screen.findByRole('textbox', { name: /^caption/i }), 'Keep me');
      await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toContain('Keep me'), {
        timeout: 3000,
      });
      expired = true;
      await userEvent.click(screen.getByRole('button', { name: /^save draft$/i }));

      // The person is sent to sign in; nothing claimed the draft was saved to the team…
      expect(await screen.findByText('Login page')).toBeInTheDocument();
      expect(server.state.version).toBe(0);
      // …and the text is still in this browser for when they come back.
      expect(localStorage.getItem(DRAFT_KEY)).toContain('Keep me');
    },
    TIMEOUT,
  );
});

describe('media upload and presets on the real API contract', () => {
  it(
    'asks for an upload slot with a body the API accepts, and reports a storage failure',
    async () => {
      vi.stubEnv('VITE_COMPOSER_MEDIA_UPLOAD', 'true');
      const mock = setupComposerApi({
        accounts: accounts(),
        routes: {
          'POST /workspaces/w1/media/uploads': () =>
            apiError(
              503,
              'STORAGE_NOT_CONFIGURED',
              'Media storage is not configured on this server, so files cannot be uploaded yet.',
            ),
        },
      });
      const { container } = renderComposer();
      await screen.findByRole('checkbox', { name: /Acme Store/ });
      const input = container.ownerDocument.querySelector('input[type="file"]');
      await userEvent.upload(input, makeFile('beach.jpg', 'image/jpeg', 200_000));

      expect(
        (await screen.findAllByText(/Media storage is not configured/)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText('Uploaded')).toBeNull();
      const [slot] = callsTo(mock, 'POST /workspaces/w1/media/uploads');
      expect(mediaUploadRequestSchema.safeParse(bodyOf(slot)).success).toBe(true);
      expect(bodyOf(slot)).toEqual({
        fileName: 'beach.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 200_000,
        kind: 'IMAGE',
      });
    },
    TIMEOUT,
  );

  it(
    'creates a shared preset with a body the API accepts',
    async () => {
      vi.stubEnv('VITE_COMPOSER_SERVER_PRESETS', 'true');
      const created = [];
      const mock = setupComposerApi({
        accounts: accounts(),
        routes: {
          'GET /workspaces/w1/account-presets': () => jsonResponse(200, { items: created }),
          'POST /workspaces/w1/account-presets': ({ init }) => {
            const input = accountPresetSchema.parse(JSON.parse(init.body));
            const preset = {
              id: 'c'.repeat(24),
              ...input,
              createdBy: { id: 'u1', name: 'Ada Lovelace' },
              createdAt: new Date().toISOString(),
            };
            created.push(preset);
            return jsonResponse(201, { preset });
          },
        },
      });
      renderComposer();
      await userEvent.click(await screen.findByRole('checkbox', { name: /Acme Store/ }));
      await userEvent.click(screen.getByRole('button', { name: /presets/i }));
      await userEvent.click(
        await screen.findByRole('menuitem', { name: /save current selection/i }),
      );
      await userEvent.type(await screen.findByRole('textbox', { name: /preset name/i }), 'Stores');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => expect(created).toHaveLength(1));
      expect(created[0]).toMatchObject({ name: 'Stores', socialAccountIds: [ACCOUNT] });
      expect(callsTo(mock, 'POST /workspaces/w1/account-presets')).toHaveLength(1);
    },
    TIMEOUT,
  );
});
