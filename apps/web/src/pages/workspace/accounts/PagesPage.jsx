import {
  META_PERMISSIONS,
  PAGE_PUBLISHING_TASK,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { DestinationTab, PermissionList } from '../../../components/accounts/DestinationTab.jsx';
import { FacebookIcon } from '../../../components/ui/Brand.jsx';

/* ------------------------------------------------------------------ Pages tab */

const PAGE_COLUMNS = [
  'account',
  'pageId',
  'identity',
  'followers',
  'createContent',
  'readiness',
  'status',
  'lastSync',
];
const PAGE_PROVIDERS = [SOCIAL_PROVIDERS.FACEBOOK_LOGIN];

const PAGE_COPY = {
  icon: FacebookIcon,
  one: 'Page',
  many: 'Pages',
  caption: 'Facebook Pages',
  searchPlaceholder: 'Search by Page name, ID or login',
  emptyTitle: 'No Facebook Pages yet',
  emptyConnect:
    'Connect a Facebook login to add the Pages it manages. One login can manage many Pages, and you choose which of them to add to this workspace.',
  emptyChoose:
    'Your Facebook logins have no Pages in this workspace yet. Open a login on the Logins tab to choose which of its Pages to add.',
  emptySetup:
    'Facebook Login is not configured on this server yet. Once a server administrator adds the Meta app credentials you can connect a login and add the Pages it manages.',
  emptyShared:
    'No Facebook Pages have been shared with you in this workspace yet. Workspace owners and admins decide who can access each Page.',
  filteredTitle: 'No Pages match these filters',
};

export default function PagesPage() {
  return (
    <DestinationTab
      platform={SOCIAL_PLATFORMS.FACEBOOK_PAGE}
      providers={PAGE_PROVIDERS}
      columns={PAGE_COLUMNS}
      copy={PAGE_COPY}
      legend={{
        [PUBLISHING_STATUS.READY]: (
          <>
            The Page’s login granted{' '}
            <PermissionList names={META_PERMISSIONS.FACEBOOK.PAGE_PUBLISHING} />{' '}
            <strong className="font-semibold">and</strong> has a Page role with the{' '}
            <PermissionList names={[PAGE_PUBLISHING_TASK]} /> task.
          </>
        ),
        [PUBLISHING_STATUS.RESTRICTED]: (
          <>
            A permission above was not granted, or the login’s Page role does not include{' '}
            <PermissionList names={[PAGE_PUBLISHING_TASK]} /> (or it has not been confirmed yet).
            Reconnect the login and allow the permissions, or ask a Page admin for a role that can
            create content, then refresh.
          </>
        ),
      }}
    />
  );
}
