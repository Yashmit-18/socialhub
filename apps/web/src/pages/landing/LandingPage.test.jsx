import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiError, jsonResponse, mockFetch } from '../../test/fetchMock.js';
import { renderApp } from '../../test/renderApp.jsx';

// The page is lazy-loaded. Importing it up front keeps the cold transform (slow under a
// loaded parallel run) out of the first test's 4 s find timeout.
beforeAll(() => import('./LandingPage.jsx'));

const user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const guest = () => mockFetch({ 'POST /auth/refresh': () => apiError(401, 'UNAUTHENTICATED') });
const signedIn = () =>
  mockFetch({
    'POST /auth/refresh': () => jsonResponse(200, { user, accessToken: 'access' }),
    'GET /workspaces': () => jsonResponse(200, { items: [] }),
  });

// The whole app renders first (session check, then the route): the first render of a test
// file can take over a second when every suite runs in parallel, so the default 1 s
// `findBy` wait made this test fail now and then (seen 2026-11-23, 1,076 ms).
const hero = () =>
  screen.findByRole('heading', { level: 1, name: /One calm workspace/i }, { timeout: 5000 });

describe('landing page', () => {
  it('is what signed-out visitors see at /', async () => {
    guest();
    const { router } = renderApp('/');
    expect(await hero()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(document.title).toMatch(/SocialHub/);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: /Create your workspace/ })[0]).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('still sends signed-in users from / to their workspace or onboarding', async () => {
    signedIn();
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('is public at /welcome and offers signed-in users their dashboard', async () => {
    signedIn();
    renderApp('/welcome');
    expect(await hero()).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Open dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(header).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('explains every area of the app in the product tour', async () => {
    guest();
    renderApp('/');
    await hero();
    const tablist = screen.getByRole('tablist', { name: 'SocialHub pages' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Social accounts',
      'Create post',
      'Team',
      'Activity',
      'Settings',
      'Your account',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(tabs[3]);
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: /Invite people/ })).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[4]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[4]).toHaveFocus();
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: /audit trail/ }),
    ).toBeInTheDocument();
  });

  it('links the public legal pages from the footer', async () => {
    guest();
    renderApp('/');
    await hero();
    const legal = within(screen.getByRole('contentinfo')).getByRole('navigation', {
      name: 'Legal',
    });
    expect(within(legal).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy.html',
    );
    expect(within(legal).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms.html',
    );
    expect(within(legal).getByRole('link', { name: 'Data Deletion Instructions' })).toHaveAttribute(
      'href',
      '/data-deletion.html',
    );
  });

  it('switches between light and dark mode and remembers the choice', async () => {
    guest();
    renderApp('/');
    await hero();
    const html = document.documentElement;
    const toggle = within(screen.getByRole('banner')).getByRole('switch', { name: 'Dark mode' });
    // No saved preference and a light OS theme (the test matchMedia never matches).
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(html).not.toHaveClass('dark');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(html).toHaveClass('dark');
    // The same key the app's theme toggle uses, so the choice carries over after sign-in.
    expect(localStorage.getItem('sh-theme')).toBe('dark');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(html).not.toHaveClass('dark');
    expect(localStorage.getItem('sh-theme')).toBe('light');
  });

  it('follows a saved dark preference on first render', async () => {
    localStorage.setItem('sh-theme', 'dark');
    guest();
    renderApp('/');
    await hero();
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(document.documentElement).toHaveClass('dark');
    document.documentElement.classList.remove('dark');
  });

  it('is honest about what publishing does today', async () => {
    guest();
    renderApp('/');
    await hero();
    const roadmap = screen.getByRole('region', { name: /What’s ready, and what’s next/ });
    const publishing = within(roadmap).getByRole('heading', { name: 'Publishing & scheduling' });
    // Ready for Facebook Pages only: Instagram is not claimed as verified.
    expect(publishing.closest('div')).toHaveTextContent('Ready for Facebook Pages');
    expect(publishing.closest('div')).toHaveTextContent(
      /Instagram publishing built, not yet verified/,
    );
    const groups = within(roadmap).getByRole('heading', { name: 'Facebook Group sharing' });
    expect(groups.closest('div')).toHaveTextContent('Ready');
    // Real posts are always confirmed, and public access still waits for Meta's App Review.
    expect(screen.getByText(/Until Meta approves SocialHub’s App Review/)).toBeInTheDocument();
    expect(screen.queryByText(/Publish button stays disabled/)).toBeNull();
  });
});
