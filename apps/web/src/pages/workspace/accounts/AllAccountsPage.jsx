import { SOCIAL_PROVIDERS } from '@socialhub/shared';
import { Layers } from 'lucide-react';
import { DestinationTab } from '../../../components/accounts/DestinationTab.jsx';

const COLUMNS = ['account', 'platform', 'identity', 'followers', 'readiness', 'status', 'lastSync'];
const PROVIDERS = [
  SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
  SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN,
  SOCIAL_PROVIDERS.INSTAGRAM_LOGIN,
];

const COPY = {
  icon: Layers,
  one: 'account',
  many: 'accounts',
  caption: 'All social accounts',
  searchPlaceholder: 'Search name, @username, ID or label',
  emptyTitle: 'No social accounts yet',
  emptyConnect:
    'Connect a Facebook login to add the Pages it manages and their linked Instagram accounts, or connect an Instagram professional account directly (no Facebook Page needed).',
  emptyChoose:
    'Your connected logins have no accounts in this workspace yet. Open a login on the Logins tab to choose which of its Pages and Instagram accounts to add.',
  emptySetup:
    'Meta logins are not configured on this server yet. Once a server administrator adds the Meta app credentials you can connect logins and add their accounts.',
  emptyShared:
    'No social accounts have been shared with you in this workspace yet. Workspace owners and admins decide who can access each account.',
  filteredTitle: 'No accounts match these filters',
};

/**
 * All accounts tab: every Facebook Page and Instagram account of the workspace in one table,
 * so labels, stars, refresh, team access, removal and export work across both platforms.
 */
export default function AllAccountsPage() {
  return <DestinationTab providers={PROVIDERS} columns={COLUMNS} copy={COPY} />;
}
