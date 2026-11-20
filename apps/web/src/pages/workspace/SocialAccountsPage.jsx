import {
  CONNECTION_STATUS,
  PERMISSIONS,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Link2,
  ListChecks,
  MoreHorizontal,
  Plug,
  RefreshCw,
  Settings2,
  Share2,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useStartAuthorization } from '../../hooks/useStartAuthorization.js';
import { api } from '../../lib/api.js';
import { CONNECTION_TONE, PROVIDER_LABELS, PUBLISHING_TONE, daysUntil } from '../../lib/meta.js';
import {
  keys,
  useMetaIntegration,
  useSocialAccounts,
  useSocialConnections,
} from '../../lib/queries.js';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';

function StatusBadge({ map, value }) {
  const [tone, label] = map[value] ?? ['neutral', value];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

function PlatformMark({ platform, size = 'h-10 w-10' }) {
  const isFacebook =
    platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE || platform === SOCIAL_PROVIDERS.FACEBOOK_LOGIN;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl text-white',
        size,
        isFacebook
          ? 'bg-[#1877F2]'
          : 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400',
      )}
    >
      {isFacebook ? <FacebookIcon /> : <InstagramIcon />}
    </span>
  );
}

function useInvalidateSocial(workspaceId) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.socialAccounts(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.socialConnections(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.activity(workspaceId) }),
    ]);
}

/* ------------------------------------------------------------------ connections */

function expiryText(connection) {
  if (connection.status !== CONNECTION_STATUS.ACTIVE) return null;
  if (connection.expiringSoonAt) {
    const days = daysUntil(connection.expiringSoonAt);
    return {
      warn: true,
      text: `Access expires in ${days} day${days === 1 ? '' : 's'} — reconnect to renew`,
    };
  }
  if (connection.tokenExpiresAt)
    return { warn: false, text: `Token valid until ${formatDate(connection.tokenExpiresAt)}` };
  return { warn: false, text: 'Long-lived access' };
}

function ConnectionRow({ connection, onReconnect, reconnecting }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const invalidate = useInvalidateSocial(workspace.id);
  const [confirm, setConfirm] = useState(null);
  const base = `/workspaces/${workspace.id}/social-connections/${connection.id}`;
  const active = connection.status === CONNECTION_STATUS.ACTIVE;
  const expiry = expiryText(connection);
  const missingRequired = connection.missingScopes?.required ?? [];
  const missingPublishing = connection.missingScopes?.publishing ?? [];

  const sync = useMutation({
    mutationFn: () => api.post(`${base}/sync`),
    onSuccess: async (data) => {
      await invalidate();
      if (data.connection.status === CONNECTION_STATUS.ACTIVE) {
        toast.success(`${connection.displayName} synced`);
      } else {
        toast.warning(data.connection.statusReason ?? 'This connection needs to be reconnected');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const disconnect = useMutation({
    mutationFn: () => api.post(`${base}/disconnect`),
    onSuccess: async () => {
      await invalidate();
      setConfirm(null);
      toast.success(`${connection.displayName} disconnected`);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(base),
    onSuccess: async (data) => {
      await invalidate();
      setConfirm(null);
      toast.success(
        `${connection.displayName} removed${data.accountsRemoved ? ` with ${data.accountsRemoved} account${data.accountsRemoved === 1 ? '' : 's'}` : ''}`,
      );
    },
  });

  const pending = confirm === 'disconnect' ? disconnect : remove;

  return (
    <li className="px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="relative">
          <Avatar name={connection.displayName ?? '?'} seed={connection.id} size="md" />
          <span className="absolute -bottom-1 -right-1">
            <PlatformMark
              platform={connection.provider}
              size="h-5 w-5 [&_svg]:h-3 [&_svg]:w-3 rounded-md ring-2 ring-white dark:ring-slate-900"
            />
          </span>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <p className="truncate text-sm font-semibold">
            {connection.displayName ?? 'Unnamed login'}
          </p>
          <p className="truncate text-xs text-muted">
            {PROVIDER_LABELS[connection.provider]} login · {connection.accountCount} account
            {connection.accountCount === 1 ? '' : 's'}
            {connection.connectedBy && ` · connected by ${connection.connectedBy.name}`}
            {connection.lastSyncedAt && ` · synced ${timeAgo(connection.lastSyncedAt)}`}
          </p>
        </div>
        <StatusBadge map={CONNECTION_TONE} value={connection.status} />
        <div className="flex items-center gap-1">
          {active ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/w/${workspace.slug}/accounts/connections/${connection.id}`)}
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Choose accounts
            </Button>
          ) : (
            <Button size="sm" loading={reconnecting} onClick={() => onReconnect(connection)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reconnect
            </Button>
          )}
          <Menu
            trigger={({ toggle, props }) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                {...props}
                aria-label={`Actions for ${connection.displayName}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          >
            {(close) => (
              <>
                {active && (
                  <MenuItem
                    icon={RefreshCw}
                    disabled={sync.isPending}
                    onClick={() => {
                      close();
                      sync.mutate();
                    }}
                  >
                    Sync now
                  </MenuItem>
                )}
                <MenuItem
                  icon={Settings2}
                  onClick={() => {
                    close();
                    onReconnect(connection);
                  }}
                >
                  Reconnect / update permissions
                </MenuItem>
                <MenuSeparator />
                {connection.status !== CONNECTION_STATUS.DISCONNECTED && (
                  <MenuItem
                    icon={Unplug}
                    danger
                    onClick={() => {
                      close();
                      setConfirm('disconnect');
                    }}
                  >
                    Disconnect
                  </MenuItem>
                )}
                <MenuItem
                  icon={Trash2}
                  danger
                  onClick={() => {
                    close();
                    setConfirm('remove');
                  }}
                >
                  Remove with its accounts
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="mt-2 space-y-1 pl-14 text-xs">
        {!active && connection.statusReason && (
          <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {connection.statusReason}
          </p>
        )}
        {active && expiry && (
          <p className={expiry.warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}>
            {expiry.text}
          </p>
        )}
        {missingRequired.length > 0 && (
          <p className="text-rose-600 dark:text-rose-400">
            Required permission not granted: {missingRequired.join(', ')}. Reconnect and allow it.
          </p>
        )}
        {active && missingRequired.length === 0 && missingPublishing.length > 0 && (
          <p className="text-muted">
            Not granted (needed for publishing later): {missingPublishing.join(', ')}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm === 'disconnect'
            ? `Disconnect ${connection.displayName}?`
            : `Remove ${connection.displayName}?`
        }
        description={
          confirm === 'disconnect'
            ? 'Its access tokens are erased and its accounts stop working until you reconnect. The accounts stay listed.'
            : 'The connection and every account added through it are removed from this workspace.'
        }
        confirmLabel={confirm === 'disconnect' ? 'Disconnect' : 'Remove'}
        loading={pending.isPending}
        error={pending.error}
        onConfirm={() => pending.mutate()}
        onClose={() => {
          disconnect.reset();
          remove.reset();
          setConfirm(null);
        }}
      />
    </li>
  );
}

/* --------------------------------------------------------------------- accounts */

function AccountRow({ account, canManage }) {
  const { workspace } = useWorkspace();
  const invalidate = useInvalidateSocial(workspace.id);
  const [confirming, setConfirming] = useState(false);
  const isFacebook = account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
  const remove = useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspace.id}/social-accounts/${account.id}`),
    onSuccess: async () => {
      await invalidate();
      setConfirming(false);
      toast.success(`${account.name} removed from the workspace`);
    },
  });
  const reason =
    account.connectionStatus !== CONNECTION_STATUS.ACTIVE
      ? account.connectionStatusReason
      : account.publishingStatusReason;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
      {account.pictureUrl ? (
        <img
          src={account.pictureUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-xl object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <PlatformMark platform={account.platform} />
      )}
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-semibold">{account.name}</p>
        <p className="truncate text-xs text-muted">
          {isFacebook
            ? `Facebook Page${account.category ? ` · ${account.category}` : ''}`
            : `Instagram ${account.instagramAccountType === 'CREATOR' ? 'creator' : account.instagramAccountType === 'BUSINESS' ? 'business' : 'professional'} account`}
          {account.username && ` · @${account.username}`}
          {account.connection?.displayName && ` · via ${account.connection.displayName}`}
        </p>
        {reason && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{reason}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge map={CONNECTION_TONE} value={account.connectionStatus} />
        {account.connectionStatus === CONNECTION_STATUS.ACTIVE && (
          <StatusBadge map={PUBLISHING_TONE} value={account.publishingStatus} />
        )}
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${account.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Remove ${account.name}?`}
        description="It is removed from this workspace and from every member's account access. The login it came from stays connected."
        confirmLabel="Remove account"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          remove.reset();
          setConfirming(false);
        }}
      />
    </li>
  );
}

/* ------------------------------------------------------------------------- page */

function ConnectButtons({ integration, start }) {
  const busy = start.isPending ? start.variables?.provider : null;
  return (
    <>
      {integration?.instagram.configured && (
        <Button
          variant="secondary"
          loading={busy === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN}
          onClick={() => start.mutate({ provider: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN })}
        >
          <InstagramIcon className="h-4 w-4" /> Connect Instagram
        </Button>
      )}
      {integration?.facebook.configured && (
        <Button
          loading={busy === SOCIAL_PROVIDERS.FACEBOOK_LOGIN}
          onClick={() => start.mutate({ provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN })}
        >
          <FacebookIcon className="h-4 w-4" /> Connect Facebook
        </Button>
      )}
    </>
  );
}

export default function SocialAccountsPage() {
  const { workspace, can } = useWorkspace();
  const canManage = can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE);
  const accounts = useSocialAccounts(workspace.id);
  const connections = useSocialConnections(workspace.id, { enabled: canManage });
  const integration = useMetaIntegration();
  const start = useStartAuthorization(workspace.id);

  if (accounts.isPending || (canManage && (connections.isPending || integration.isPending)))
    return <PageLoader />;

  const configured = Boolean(
    integration.data?.facebook.configured || integration.data?.instagram.configured,
  );
  const items = accounts.data ?? [];
  const pages = items.filter((a) => a.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE);
  const instagram = items.filter((a) => a.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT);
  const connectionList = connections.data ?? [];
  const reconnect = (connection) =>
    start.mutate({ provider: connection.provider, connectionId: connection.id });

  return (
    <>
      <PageHeader
        title="Social accounts"
        description="Facebook Pages and Instagram professional accounts connected to this workspace through official Meta logins."
        actions={
          canManage && configured && <ConnectButtons integration={integration.data} start={start} />
        }
      />

      {canManage && !configured && (
        <Card className="mb-6 border-amber-200/80 dark:border-amber-500/20">
          <CardHeader
            icon={Plug}
            title="Meta integration is not configured"
            description="A server administrator must add the Meta app credentials (META_APP_ID / META_APP_SECRET, and INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET for Instagram Login) before accounts can be connected."
          />
          <CardBody className="pt-3 text-xs text-muted">
            See README → “Meta integration” for the Meta Developer dashboard setup.
          </CardBody>
        </Card>
      )}

      {canManage && connectionList.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            icon={Link2}
            title="Connected logins"
            description="Each Facebook or Instagram login is a separate connection. Adding one never affects another."
          />
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
            {connectionList.map((c) => (
              <ConnectionRow
                key={c.id}
                connection={c}
                onReconnect={reconnect}
                reconnecting={start.isPending && start.variables?.connectionId === c.id}
              />
            ))}
          </ul>
        </Card>
      )}

      {accounts.error ? (
        <Card>
          <ErrorState error={accounts.error} onRetry={accounts.refetch} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Share2}
            title="No social accounts yet"
            description={
              !canManage
                ? 'No accounts have been shared with you in this workspace yet. Workspace admins manage connections and decide who can access each account.'
                : !configured
                  ? 'Once the Meta integration is configured you can connect Facebook Pages and Instagram professional accounts here.'
                  : connectionList.length > 0
                    ? 'Choose which Pages and Instagram accounts to add from your connected logins.'
                    : 'Connect a Facebook login to add the Pages it manages and their linked Instagram accounts, or connect an Instagram professional account directly.'
            }
            action={
              canManage && configured && connectionList.length === 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <ConnectButtons integration={integration.data} start={start} />
                </div>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {[
            ['Facebook Pages', pages],
            ['Instagram accounts', instagram],
          ]
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <Card key={title}>
                <CardHeader
                  title={title}
                  description={`${list.length} in this workspace${canManage ? '' : ' that you can access'}`}
                />
                <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
                  {list.map((a) => (
                    <AccountRow key={a.id} account={a} canManage={canManage} />
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
