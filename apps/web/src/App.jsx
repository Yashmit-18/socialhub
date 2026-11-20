import { lazy, Suspense } from 'react';
import { Link, Outlet, createBrowserRouter } from 'react-router';
import { GuestOnly, RequireAuth } from './components/auth/RouteGuards.jsx';
import { RootRedirect, WorkspaceLayout } from './components/layout/WorkspaceLayout.jsx';
import { PageLoader } from './components/ui/Feedback.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordResetPages.jsx';
import { LegacyConnectionRedirect } from './pages/workspace/accounts/redirects.jsx';

// Authenticated areas are code-split so the sign-in page loads fast.
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.jsx'));
const AcceptInvitationPage = lazy(() => import('./pages/AcceptInvitationPage.jsx'));
const OverviewPage = lazy(() => import('./pages/workspace/OverviewPage.jsx'));
const SelectAccountsPage = lazy(() => import('./pages/workspace/SelectAccountsPage.jsx'));
// Social account management (Phase 3).
const AccountsLayout = lazy(() => import('./pages/workspace/accounts/AccountsLayout.jsx'));
const AccountsOverviewPage = lazy(
  () => import('./pages/workspace/accounts/AccountsOverviewPage.jsx'),
);
const LoginsPage = lazy(() => import('./pages/workspace/accounts/LoginsPage.jsx'));
const ConnectionDetailPage = lazy(
  () => import('./pages/workspace/accounts/ConnectionDetailPage.jsx'),
);
const PagesPage = lazy(() => import('./pages/workspace/accounts/PagesPage.jsx'));
const InstagramPage = lazy(() => import('./pages/workspace/accounts/InstagramPage.jsx'));
const AccountDetailPage = lazy(() => import('./pages/workspace/accounts/AccountDetailPage.jsx'));
const AccessPage = lazy(() => import('./pages/workspace/accounts/AccessPage.jsx'));
// Universal Post Composer (Phase 4 frontend; publishing is not implemented).
const ComposerPage = lazy(() => import('./features/composer/ComposerPage.jsx'));
const MetaOAuthResultPage = lazy(() => import('./pages/MetaOAuthResultPage.jsx'));
const TeamPage = lazy(() => import('./pages/workspace/TeamPage.jsx'));
const ActivityPage = lazy(() => import('./pages/workspace/ActivityPage.jsx'));
const SettingsPage = lazy(() => import('./pages/workspace/SettingsPage.jsx'));
const AccountPage = lazy(() => import('./pages/account/AccountPage.jsx'));

function Suspended() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="bg-gradient-to-br from-brand-500 to-fuchsia-500 bg-clip-text text-6xl font-bold text-transparent">
        404
      </p>
      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-1.5 text-sm text-muted">
        The page you are looking for does not exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-6 text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
      >
        Back to SocialHub
      </Link>
    </div>
  );
}

export const routes = [
  {
    element: <Suspended />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/invite/:token', element: <AcceptInvitationPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <RootRedirect /> },
          { path: '/onboarding', element: <OnboardingPage /> },
          { path: '/account', element: <AccountPage /> },
          { path: '/oauth/meta/result', element: <MetaOAuthResultPage /> },
          {
            path: '/w/:slug',
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'compose', element: <ComposerPage /> },
              {
                path: 'accounts',
                element: <AccountsLayout />,
                children: [
                  { index: true, element: <AccountsOverviewPage /> },
                  { path: 'logins', element: <LoginsPage /> },
                  { path: 'pages', element: <PagesPage /> },
                  { path: 'instagram', element: <InstagramPage /> },
                  { path: 'access', element: <AccessPage /> },
                ],
              },
              // Detail pages and the selection flow sit outside the tabbed layout.
              { path: 'accounts/logins/:connectionId', element: <ConnectionDetailPage /> },
              { path: 'accounts/logins/:connectionId/select', element: <SelectAccountsPage /> },
              { path: 'accounts/a/:accountId', element: <AccountDetailPage /> },
              { path: 'accounts/connections/:connectionId', element: <LegacyConnectionRedirect /> },
              { path: 'team', element: <TeamPage /> },
              { path: 'activity', element: <ActivityPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
