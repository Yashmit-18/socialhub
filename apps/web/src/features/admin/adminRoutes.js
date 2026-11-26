import { createElement, lazy } from 'react';

// Every admin screen is its own chunk; nothing here is loaded until /admin is opened.
const AdminLayout = lazy(() => import('./AdminLayout.jsx'));
const AdminOverviewPage = lazy(() => import('./AdminOverviewPage.jsx'));
const AdminUsersPage = lazy(() => import('./AdminUsersPage.jsx'));
const AdminUserDetailPage = lazy(() => import('./AdminUserDetailPage.jsx'));
const AdminWorkspacesPage = lazy(() => import('./AdminWorkspacesPage.jsx'));
const AdminWorkspaceDetailPage = lazy(() => import('./AdminWorkspaceDetailPage.jsx'));
const AdminSystemPage = lazy(() => import('./AdminSystemPage.jsx'));
const AdminAuditPage = lazy(() => import('./AdminAuditPage.jsx'));

/** The operator console. It goes inside the RequireAuth block of App.jsx. */
export const adminRoute = {
  path: '/admin',
  element: createElement(AdminLayout),
  children: [
    { index: true, element: createElement(AdminOverviewPage) },
    { path: 'users', element: createElement(AdminUsersPage) },
    { path: 'users/:userId', element: createElement(AdminUserDetailPage) },
    { path: 'workspaces', element: createElement(AdminWorkspacesPage) },
    { path: 'workspaces/:workspaceId', element: createElement(AdminWorkspaceDetailPage) },
    { path: 'system', element: createElement(AdminSystemPage) },
    { path: 'audit', element: createElement(AdminAuditPage) },
  ],
};
