import {
  META_PERMISSIONS,
  PAGE_PUBLISHING_TASK,
  PUBLISHING_STATUS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { Info } from 'lucide-react';
import { InstagramIcon } from '../../../components/ui/Brand.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { DestinationTab, PermissionList } from './PagesPage.jsx';

const COLUMNS = [
  'account',
  'instagramType',
  'linkedPage',
  'identity',
  'readiness',
  'status',
  'lastSync',
];
// Instagram accounts arrive through a Facebook Page (Facebook Login) or directly (Instagram Login).
const PROVIDERS = [SOCIAL_PROVIDERS.FACEBOOK_LOGIN, SOCIAL_PROVIDERS.INSTAGRAM_LOGIN];

const COPY = {
  icon: InstagramIcon,
  one: 'Instagram account',
  many: 'Instagram accounts',
  caption: 'Instagram accounts',
  searchPlaceholder: 'Search by name, @username, ID or login',
  emptyTitle: 'No Instagram accounts yet',
  emptyConnect:
    'Connect a Facebook login to add the Instagram accounts linked to your Pages, or connect an Instagram professional account directly with Instagram Login.',
  emptyChoose:
    'Your connected logins have no Instagram accounts in this workspace yet. Open a login on the Logins tab to choose which of its accounts to add.',
  emptySetup:
    'Instagram connections are not configured on this server yet. Once a server administrator adds the Meta app credentials you can connect accounts through Facebook Login or Instagram Login.',
  emptyShared:
    'No Instagram accounts have been shared with you in this workspace yet. Workspace owners and admins decide who can access each account.',
  filteredTitle: 'No Instagram accounts match these filters',
};

function ProfessionalAccountsNote() {
  return (
    <p className="flex items-start gap-2.5 rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/[0.07] dark:text-sky-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden="true" />
      <span>
        Only Instagram professional accounts (Business or Creator) can be connected — through a
        Facebook Page (Facebook Login) or directly (Instagram Login). Personal accounts are not
        supported.
      </span>
    </p>
  );
}

/**
 * Instagram tab: every Instagram professional account of the workspace, whichever login it came
 * through. A login is reconnected one at a time (OAuth), from the row or the Logins tab.
 */
export default function InstagramPage() {
  const { workspace } = useWorkspace();
  // The API leaves `linkedPage.id` empty when the Page is not in this workspace or not shared
  // with the member, so a link is only offered where the Page can be opened.
  const pageHrefFor = (linkedPage) => `/w/${workspace.slug}/accounts/a/${linkedPage.id}`;

  return (
    <DestinationTab
      platform={SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT}
      providers={PROVIDERS}
      columns={COLUMNS}
      copy={COPY}
      pageHrefFor={pageHrefFor}
      note={<ProfessionalAccountsNote />}
      legend={{
        [PUBLISHING_STATUS.READY]: (
          <>
            Through Facebook Login: the login granted{' '}
            <PermissionList names={META_PERMISSIONS.FACEBOOK.INSTAGRAM_PUBLISHING} />{' '}
            <strong className="font-semibold">and</strong> has a role with the{' '}
            <PermissionList names={[PAGE_PUBLISHING_TASK]} /> task on the linked Facebook Page.
            Through Instagram Login: the account granted{' '}
            <PermissionList names={META_PERMISSIONS.INSTAGRAM.PUBLISHING} />.
          </>
        ),
        [PUBLISHING_STATUS.RESTRICTED]: (
          <>
            A permission above was not granted or, for Facebook Login, the role on the linked Page
            does not include <PermissionList names={[PAGE_PUBLISHING_TASK]} /> (or it has not been
            confirmed yet). Reconnect the login and allow the permissions, or ask a Page admin for a
            role that can create content, then refresh.
          </>
        ),
      }}
    />
  );
}
