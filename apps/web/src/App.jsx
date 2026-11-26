import { lazy, Suspense } from 'react';
import { Outlet, createBrowserRouter } from 'react-router';
import { GuestOnly, RequireAuth } from './components/auth/RouteGuards.jsx';
import { WorkspaceLayout } from './components/layout/WorkspaceLayout.jsx';
import { PageLoader } from './components/ui/Feedback.jsx';
// The operator console (platform admins only); its pages load only when /admin is opened.
import { adminRoute } from './features/admin/adminRoutes.js';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordResetPages.jsx';
import { LegacyConnectionRedirect } from './pages/workspace/accounts/redirects.jsx';
// `/` shows the public landing page to guests and redirects signed-in users to a workspace.
import { HomeRoute, LandingPage } from './pages/landing/HomeRoute.jsx';
// Public legal pages are static HTML (crawler-readable); these short routes forward to them.
import { LegalRedirect } from './pages/legal/LegalRedirect.jsx';
import { LEGAL_LINKS } from './pages/legal/legalLinks.js';

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
const AllAccountsPage = lazy(() => import('./pages/workspace/accounts/AllAccountsPage.jsx'));
const PagesPage = lazy(() => import('./pages/workspace/accounts/PagesPage.jsx'));
const InstagramPage = lazy(() => import('./pages/workspace/accounts/InstagramPage.jsx'));
const AccountDetailPage = lazy(() => import('./pages/workspace/accounts/AccountDetailPage.jsx'));
const AccessPage = lazy(() => import('./pages/workspace/accounts/AccessPage.jsx'));
// Universal Post Composer (Phase 4 frontend; publishing is not implemented).
const ComposerPage = lazy(() => import('./features/composer/ComposerPage.jsx'));
// Facebook Group distribution (Phase 6): manual sharing tasks, shares and the group directory.
const GroupsLayout = lazy(() => import('./features/groups/GroupsLayout.jsx'));
const GroupTasksPage = lazy(() => import('./features/groups/TasksPage.jsx'));
const GroupSharesPage = lazy(() => import('./features/groups/SharesPage.jsx'));
const GroupShareDetailPage = lazy(() => import('./features/groups/ShareDetailPage.jsx'));
const GroupDirectoryPage = lazy(() => import('./features/groups/DirectoryPage.jsx'));
const PublishingPage = lazy(() => import('./features/publishing/PublishingPage.jsx'));
const AnalyticsPage = lazy(() => import('./features/analytics/AnalyticsPage.jsx'));
const MetaOAuthResultPage = lazy(() => import('./pages/MetaOAuthResultPage.jsx'));
const TeamPage = lazy(() => import('./pages/workspace/TeamPage.jsx'));
const ActivityPage = lazy(() => import('./pages/workspace/ActivityPage.jsx'));
const SettingsPage = lazy(() => import('./pages/workspace/SettingsPage.jsx'));
const AccountPage = lazy(() => import('./pages/account/AccountPage.jsx'));

// The not-found page lives in its own file (the admin area shows it too); still exported here.
export { NotFoundPage };

function Suspended() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
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
      { path: '/', element: <HomeRoute /> },
      { path: '/welcome', element: <LandingPage /> },
      // Public for everyone, signed in or not.
      ...LEGAL_LINKS.map(({ alias, path, title }) => ({
        path: alias,
        element: <LegalRedirect to={path} title={title} />,
      })),
      {
        element: <RequireAuth />,
        children: [
          { path: '/onboarding', element: <OnboardingPage /> },
          { path: '/account', element: <AccountPage /> },
          adminRoute,
          { path: '/oauth/meta/result', element: <MetaOAuthResultPage /> },
          {
            path: '/w/:slug',
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'compose', element: <ComposerPage /> },
              {
                path: 'groups',
                element: <GroupsLayout />,
                children: [
                  { index: true, element: <GroupTasksPage /> },
                  { path: 'shares', element: <GroupSharesPage /> },
                  { path: 'shares/:shareId', element: <GroupShareDetailPage /> },
                  { path: 'directory', element: <GroupDirectoryPage /> },
                ],
              },
              { path: 'publishing', element: <PublishingPage /> },
              { path: 'analytics', element: <AnalyticsPage /> },
              {
                path: 'accounts',
                element: <AccountsLayout />,
                children: [
                  { index: true, element: <AccountsOverviewPage /> },
                  { path: 'all', element: <AllAccountsPage /> },
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
