import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../../lib/api.js';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';
import { LEGAL_LINKS } from '../legal/legalLinks.js';

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };

const guest = (routes = {}) =>
  mockFetch({ 'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED'), ...routes });

/** The checklist item for a rule, read through its words (not its colour). */
const requirement = (label) =>
  within(screen.getByRole('list', { name: 'Password requirements' })).getByText(label);

const bodyOf = (mock, key) => JSON.parse(mock.calls.find((call) => call.key === key).init.body);

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe('sign-in page', () => {
  it('puts "Forgot password?" after the password field, names the tab and offers a theme switch', async () => {
    guest();
    renderApp('/login');
    const password = await screen.findByLabelText('Password');
    const forgot = screen.getByRole('link', { name: 'Forgot password?' });
    expect(
      password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(forgot).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(document.title).toBe('Sign in · SocialHub');
  });
});

describe('sign-up page', () => {
  it('links the legal pages once, as on the sign-in page', async () => {
    guest();
    renderApp('/register');
    const nav = await screen.findByRole('navigation', { name: 'Legal' });
    for (const { path, title } of LEGAL_LINKS) {
      expect(within(nav).getByRole('link', { name: title })).toHaveAttribute('href', path);
      expect(screen.getAllByRole('link', { name: title })).toHaveLength(1);
    }
    expect(document.title).toBe('Create your account · SocialHub');
  });

  it('ticks the password requirements in words while the person types', async () => {
    guest();
    renderApp('/register');
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAccessibleDescription(/8\+ characters: not met yet/);
    expect(requirement('A letter')).toHaveTextContent('A letter: not met yet');

    await userEvent.type(password, 'abc');
    expect(requirement('A letter')).toHaveTextContent('A letter: met');
    expect(requirement('A number')).toHaveTextContent('A number: not met yet');
    expect(requirement('8+ characters')).toHaveTextContent('8+ characters: not met yet');
    expect(screen.getByText('1 of 3 password requirements met')).toBeInTheDocument();

    await userEvent.type(password, '12345');
    for (const label of ['8+ characters', 'A letter', 'A number']) {
      expect(requirement(label)).toHaveTextContent(`${label}: met`);
    }
    expect(screen.getByText('3 of 3 password requirements met')).toBeInTheDocument();
  });

  it('shows the server message on the email field when the address is taken', async () => {
    guest({
      'POST /auth/register': () =>
        apiError(409, 'CONFLICT', 'An account with this email already exists', {
          fields: { email: 'An account with this email already exists' },
        }),
    });
    renderApp('/register');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists',
    );
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('creates the account and continues to the requested page', async () => {
    const mock = guest({
      'POST /auth/register': () => jsonResponse(201, { user, accessToken: 'access' }),
      'GET /workspaces': () => jsonResponse(200, { items: [] }),
    });
    const { router } = renderApp('/register?redirect=%2Fonboarding');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
    expect(bodyOf(mock, 'POST /auth/register')).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'abc12345',
    });
  });
});

describe('password reset pages', () => {
  it('sends the reset request and then shows the inbox notice', async () => {
    const mock = guest({ 'POST /auth/forgot-password': () => jsonResponse(200, { ok: true }) });
    renderApp('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(bodyOf(mock, 'POST /auth/forgot-password')).toEqual({ email: 'ada@example.com' });
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('explains an incomplete reset link and offers a new one', async () => {
    guest();
    renderApp('/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is incomplete.');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('refuses two different passwords without calling the API', async () => {
    const mock = guest();
    renderApp('/reset-password?token=t1');
    await userEvent.type(await screen.findByLabelText('New password'), 'abc12345');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'abc12346');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(mock.count('POST /auth/reset-password')).toBe(0);
  });

  it('updates the password with the token and points to sign-in', async () => {
    const mock = guest({ 'POST /auth/reset-password': () => jsonResponse(200, { ok: true }) });
    renderApp('/reset-password?token=t1');
    const password = await screen.findByLabelText('New password');
    expect(password).toHaveAccessibleDescription(/A number: not met yet/);
    await userEvent.type(password, 'abc12345');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(bodyOf(mock, 'POST /auth/reset-password')).toEqual({
      token: 't1',
      password: 'abc12345',
    });
  });
});
