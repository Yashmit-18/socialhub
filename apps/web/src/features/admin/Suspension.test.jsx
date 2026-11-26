import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import { EDDIE_ID, MALLORY_ID, adminApi, userDetail, userView } from './adminFixtures.js';

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

const PASSWORD = 'correct horse battery';
const REASON = 'Posted the same link to 40 Pages within one hour.';

/**
 * The console with one person whose state the POSTs change, so a successful action shows up
 * when the page reads the person again. `answer(kind, body)` may replace the POST's answer.
 */
function withPerson(userId, { suspended = false, answer } = {}) {
  const state = { suspended, posts: [] };
  const api = adminApi({
    routes: {
      [`GET /admin/users/${userId}`]: () =>
        jsonResponse(
          200,
          userDetail({
            suspended: state.suspended,
            user: {
              id: userId,
              ...(userId === MALLORY_ID
                ? { name: 'Mallory Marsh', email: 'mallory@example.com' }
                : {}),
            },
          }),
        ),
      [`POST /admin/users/${userId}/suspend`]: ({ init }) => {
        const body = JSON.parse(init.body);
        state.posts.push(body);
        const custom = answer?.('suspend', body);
        if (custom) return custom;
        if (body.password !== PASSWORD) {
          return apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
            fields: { password: 'Password is incorrect' },
          });
        }
        state.suspended = true;
        return jsonResponse(200, {
          user: userView({ id: userId, status: 'DISABLED' }),
          result: { sessionsEnded: 2, resetLinkCleared: false },
        });
      },
      [`POST /admin/users/${userId}/reactivate`]: ({ init }) => {
        const body = JSON.parse(init.body);
        state.posts.push(body);
        const custom = answer?.('reactivate', body);
        if (custom) return custom;
        if (body.password !== PASSWORD) {
          return apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid', {
            fields: { password: 'Password is incorrect' },
          });
        }
        state.suspended = false;
        return jsonResponse(200, { user: userView({ id: userId }) });
      },
    },
  });
  return { api, state, detailReads: () => api.count(`GET /admin/users/${userId}`) };
}

async function openDialog(buttonName, dialogName) {
  await userEvent.click(await screen.findByRole('button', { name: buttonName }));
  const dialog = await screen.findByRole('dialog', { name: dialogName });
  const submit = within(dialog).getByRole('button', { name: buttonName });
  // The numbers are read again when the dialog opens; confirming waits for them.
  await waitFor(() => expect(submit).toBeEnabled());
  return { dialog, submit };
}

describe('suspending an account', () => {
  it('shows the impact, checks the fields, and needs the right password', async () => {
    const { state, detailReads } = withPerson(EDDIE_ID);
    renderApp(`/admin/users/${EDDIE_ID}`);
    await screen.findByRole('heading', { name: 'Eddie Editor', level: 1 });
    const readsBefore = detailReads();
    const { dialog, submit } = await openDialog('Suspend account', 'Suspend Eddie Editor?');
    expect(detailReads()).toBeGreaterThan(readsBefore);

    const impact = within(dialog).getByRole('region', { name: 'What will happen' });
    expect(
      within(impact).getByText('They are signed out everywhere. 2 open sessions end.'),
    ).toBeInTheDocument();
    expect(
      within(impact).getByText(
        '3 scheduled posts will not be sent while the account is suspended (5 deliveries, 2 of them real).',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'A delivery is one post going to one Facebook Page or Instagram account.',
      ),
    ).toBeInTheDocument();

    // Nothing filled in: both fields explain what they need, and nothing is sent.
    await userEvent.click(submit);
    expect(
      await within(dialog).findByText('Write at least 10 characters, so the reason is clear later'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Password is required')).toBeInTheDocument();
    expect(state.posts).toEqual([]);

    // A wrong password comes back under the password field; the dialog stays open.
    await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), 'nope');
    await userEvent.click(submit);
    expect(await within(dialog).findByText('Password is incorrect')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Confirm with your password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(state.posts).toEqual([{ reason: REASON, password: 'nope' }]);
  });

  it('suspends, closes the dialog and shows the account as suspended', async () => {
    const { state, detailReads } = withPerson(EDDIE_ID);
    renderApp(`/admin/users/${EDDIE_ID}`);
    const { dialog, submit } = await openDialog('Suspend account', 'Suspend Eddie Editor?');
    await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), PASSWORD);
    const readsBefore = detailReads();
    await userEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.posts).toEqual([{ reason: REASON, password: PASSWORD }]);
    expect(await screen.findByText('This account is suspended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate account' })).toBeInTheDocument();
    expect(detailReads()).toBeGreaterThan(readsBefore);
  });

  it.each([
    [
      'ALREADY_SUSPENDED',
      'This account is already suspended.',
      /already suspended, probably by another platform admin a moment ago/,
    ],
    ['SELF', 'You cannot suspend your own account.', /You cannot suspend your own account/],
    [
      'TARGET_IS_PLATFORM_ADMIN',
      'This person is a platform admin.',
      /platform admins cannot be suspended. Remove their admin access on the server first/,
    ],
  ])(
    'explains a refusal (%s) in plain words and refreshes the page',
    async (reason, message, text) => {
      const { detailReads } = withPerson(EDDIE_ID, {
        answer: () => apiError(409, 'CONFLICT', message, { reason }),
      });
      renderApp(`/admin/users/${EDDIE_ID}`);
      const { dialog, submit } = await openDialog('Suspend account', 'Suspend Eddie Editor?');
      await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
      await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), PASSWORD);
      const readsBefore = detailReads();
      await userEvent.click(submit);

      const alert = await within(dialog).findByText(text);
      expect(alert).toHaveAttribute('role', 'alert');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await waitFor(() => expect(detailReads()).toBeGreaterThan(readsBefore));
    },
  );

  it('passes on the wait message when there were too many attempts', async () => {
    withPerson(EDDIE_ID, {
      answer: () =>
        apiError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Please wait a few minutes and try again.',
        ),
    });
    renderApp(`/admin/users/${EDDIE_ID}`);
    const { dialog, submit } = await openDialog('Suspend account', 'Suspend Eddie Editor?');
    await userEvent.type(within(dialog).getByLabelText('Reason'), REASON);
    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), PASSWORD);
    await userEvent.click(submit);
    expect(
      await within(dialog).findByText(
        'Too many attempts. Please wait a few minutes and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('can be cancelled without sending anything', async () => {
    const { state } = withPerson(EDDIE_ID);
    renderApp(`/admin/users/${EDDIE_ID}`);
    const { dialog } = await openDialog('Suspend account', 'Suspend Eddie Editor?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.posts).toEqual([]);
  });
});

describe('reactivating an account', () => {
  it('says what it does not undo, sends a note only when written, and restores the page', async () => {
    const { state } = withPerson(MALLORY_ID, { suspended: true });
    renderApp(`/admin/users/${MALLORY_ID}`);
    const { dialog, submit } = await openDialog('Reactivate account', 'Reactivate Mallory Marsh?');
    expect(
      within(dialog).getByText(
        'Sessions that were ended are not restored. They have to sign in again.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        '3 scheduled posts are still waiting and will go out at their times.',
      ),
    ).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), 'nope');
    await userEvent.click(submit);
    expect(await within(dialog).findByText('Password is incorrect')).toBeInTheDocument();
    expect(state.posts).toEqual([{ password: 'nope' }]);

    await userEvent.type(within(dialog).getByLabelText('Note'), 'Spoke to them on the phone.');
    await userEvent.clear(within(dialog).getByLabelText('Confirm with your password'));
    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), PASSWORD);
    await userEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.posts.at(-1)).toEqual({ note: 'Spoke to them on the phone.', password: PASSWORD });
    expect(await screen.findByRole('button', { name: 'Suspend account' })).toBeInTheDocument();
    expect(screen.queryByText('This account is suspended.')).not.toBeInTheDocument();
  });

  it('explains when the account was reactivated by someone else first', async () => {
    withPerson(MALLORY_ID, {
      suspended: true,
      answer: () =>
        apiError(409, 'CONFLICT', 'This account is not suspended.', { reason: 'NOT_SUSPENDED' }),
    });
    renderApp(`/admin/users/${MALLORY_ID}`);
    const { dialog, submit } = await openDialog('Reactivate account', 'Reactivate Mallory Marsh?');
    await userEvent.type(within(dialog).getByLabelText('Confirm with your password'), PASSWORD);
    await userEvent.click(submit);
    expect(
      await within(dialog).findByText(
        /not suspended any more, probably because another platform admin/,
      ),
    ).toBeInTheDocument();
  });
});
