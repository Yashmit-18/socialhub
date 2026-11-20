import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { Toaster } from 'sonner';
import { RequireAuth } from '../../../components/auth/RouteGuards.jsx';
import { WorkspaceLayout } from '../../../components/layout/WorkspaceLayout.jsx';
import { AuthProvider } from '../../../context/AuthContext.jsx';
import ComposerPage from '../ComposerPage.jsx';

/**
 * Renders the composer inside the real auth guard + workspace layout (as App.jsx mounts it at
 * /w/:slug/compose), with a fresh query cache. Stub routes stand in for neighbouring pages so
 * navigation can be asserted without depending on other features.
 */
export function renderComposer(path = '/w/acme/compose') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routes = [
    {
      element: <RequireAuth />,
      children: [
        {
          path: '/w/:slug',
          element: <WorkspaceLayout />,
          children: [
            { index: true, element: <p>Workspace overview</p> },
            { path: 'compose', element: <ComposerPage /> },
            { path: 'accounts', element: <p>Social accounts page</p> },
            { path: 'team', element: <p>Team page</p> },
          ],
        },
      ],
    },
    { path: '/login', element: <p>Login page</p> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
