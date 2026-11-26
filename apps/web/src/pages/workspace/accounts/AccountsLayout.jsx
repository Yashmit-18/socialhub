import { PERMISSIONS } from '@socialhub/shared';
import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ConnectButtons } from '../../../components/accounts/ConnectButtons.jsx';
import { MetaSetupNotice } from '../../../components/accounts/MetaSetupNotice.jsx';
import { PageHeader } from '../../../components/layout/AppShell.jsx';
import { PageLoader } from '../../../components/ui/Feedback.jsx';
import { TabNav } from '../../../components/ui/Tabs.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useStartAuthorization } from '../../../hooks/useStartAuthorization.js';
import { useAccountSummary, useMetaIntegration } from '../../../lib/queries.js';

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

  const tabs = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/all`, label: 'All accounts', count: counts?.accounts.total },
    canManage && { to: `${base}/logins`, label: 'Logins', count: counts?.connections?.total },
    { to: `${base}/pages`, label: 'Facebook Pages', count: counts?.accounts.facebookPages },
    { to: `${base}/instagram`, label: 'Instagram', count: counts?.accounts.instagramAccounts },
    canManageMembers && { to: `${base}/access`, label: 'Team access' },
  ].filter(Boolean);
  // The count pills widen the tabs when they arrive, so the strip is re-checked then too.
  const widths = tabs.map((tab) => tab.count ?? '').join();

  // On a phone the strip scrolls: keep the open tab in view (for example "Team access" reached
  // by a link). Instant, so it needs no reduced-motion branch; jsdom has no scrollIntoView.
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [pathname, widths]);

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

      <div ref={tabsRef}>
        <TabNav label="Social account sections" tabs={tabs} className="-mt-3 mb-6" />
      </div>

      {canManage && <MetaSetupNotice integration={integration.data} className="mb-6" />}

      {/* Tab pages are code-split: keep the header and tabs visible while one loads. */}
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </>
  );
}
