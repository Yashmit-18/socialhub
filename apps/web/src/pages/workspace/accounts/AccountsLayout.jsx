import { PERMISSIONS } from '@socialhub/shared';
import { Suspense, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ConnectButtons } from '../../../components/accounts/ConnectButtons.jsx';
import { MetaSetupNotice } from '../../../components/accounts/MetaSetupNotice.jsx';
import { PageHeader } from '../../../components/layout/AppShell.jsx';
import { PageLoader } from '../../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useActiveIndicator } from '../../../hooks/useActiveIndicator.js';
import { useStartAuthorization } from '../../../hooks/useStartAuthorization.js';
import { useAccountSummary, useMetaIntegration } from '../../../lib/queries.js';
import { cn } from '../../../lib/utils.js';

/**
 * Shell of the Social accounts section: header (with Connect buttons for members who manage
 * logins), section tabs, and the Meta setup-required notice. Tabs a role cannot use are not
 * shown; the API enforces the same rules on every request.
 */
export default function AccountsLayout() {
  const { workspace, can } = useWorkspace();
  const canManage = can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const canManageMembers = can(PERMISSIONS.MEMBERS_MANAGE);
  const summary = useAccountSummary(workspace.id);
  const integration = useMetaIntegration();
  const start = useStartAuthorization(workspace.id);
  const base = `/w/${workspace.slug}/accounts`;
  const counts = summary.data;
  const { pathname } = useLocation();
  const tabsRef = useRef(null);
  const underlineRef = useRef(null);
  useActiveIndicator(tabsRef, underlineRef, pathname, 'x');

  const tabs = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/all`, label: 'All accounts', count: counts?.accounts.total },
    canManage && { to: `${base}/logins`, label: 'Logins', count: counts?.connections?.total },
    { to: `${base}/pages`, label: 'Facebook Pages', count: counts?.accounts.facebookPages },
    { to: `${base}/instagram`, label: 'Instagram', count: counts?.accounts.instagramAccounts },
    canManageMembers && { to: `${base}/access`, label: 'Team access' },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Social accounts"
        description={
          canManage
            ? 'Facebook logins, the Pages they manage and Instagram professional accounts, connected through official Meta logins.'
            : 'The Facebook Pages and Instagram accounts you have been given access to in this workspace.'
        }
        actions={canManage && <ConnectButtons integration={integration.data} start={start} />}
      />

      <nav
        aria-label="Social account sections"
        className="-mt-3 mb-6 overflow-x-auto border-b border-slate-200/80 dark:border-white/10"
      >
        <ul ref={tabsRef} className="relative flex min-w-max gap-1">
          <li
            ref={underlineRef}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500 opacity-0 shadow-[0_0_12px_rgb(139_92_246/0.7)] data-[ready]:transition-[transform,width,opacity] data-[ready]:duration-500 data-[ready]:ease-out-expo"
          />
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'relative isolate -mb-px inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors duration-200',
                    'after:absolute after:inset-x-1.5 after:top-1 after:bottom-1.5 after:-z-10 after:rounded-lg after:transition-colors',
                    isActive
                      ? 'text-brand-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 hover:after:bg-slate-900/[0.04] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:after:bg-white/[0.04]',
                  )
                }
              >
                {tab.label}
                {tab.count !== undefined && tab.count !== null && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums dark:bg-white/10 dark:text-slate-300">
                    {tab.count}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {canManage && <MetaSetupNotice integration={integration.data} className="mb-6" />}

      {/* Tab pages are code-split: keep the header and tabs visible while one loads. */}
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </>
  );
}
