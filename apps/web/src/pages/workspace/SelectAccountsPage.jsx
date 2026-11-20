import { DISCOVERY_STATES, PERMISSIONS, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../../components/ui/Brand.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardFooter, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useInvalidateAccounts } from '../../hooks/useAccountActions.js';
import { useStartAuthorization } from '../../hooks/useStartAuthorization.js';
import { api } from '../../lib/api.js';
import { useDiscovery, useSocialConnections } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';

const keyOf = (c) => `${c.platform}:${c.externalId}`;

function stateBadge(candidate) {
  switch (candidate.state) {
    case DISCOVERY_STATES.CONNECTED_HERE:
      return <Badge tone="success">Already added</Badge>;
    case DISCOVERY_STATES.CONNECTED_VIA_OTHER:
      return (
        <Badge tone="neutral">
          Added via {candidate.connectedVia?.displayName ?? 'another login'}
        </Badge>
      );
    case DISCOVERY_STATES.RECLAIMABLE:
      return <Badge tone="warning">Will move to this login</Badge>;
    default:
      return null;
  }
}

function CandidateRow({ candidate, checked, onToggle }) {
  const locked =
    candidate.state === DISCOVERY_STATES.CONNECTED_VIA_OTHER ||
    candidate.state === DISCOVERY_STATES.CONNECTED_HERE ||
    !candidate.hasAccessToken;
  const isFacebook = candidate.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
  return (
    <li>
      <label
        className={cn(
          'flex items-center gap-4 px-5 py-3.5 sm:px-6',
          locked
            ? 'cursor-not-allowed opacity-75'
            : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]',
        )}
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
          checked={checked}
          disabled={locked}
          onChange={onToggle}
          aria-label={`Add ${candidate.name}`}
        />
        {candidate.pictureUrl ? (
          <img
            src={candidate.pictureUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white',
              isFacebook ? 'bg-[#1877F2]' : 'bg-gradient-to-br from-fuchsia-500 to-amber-400',
            )}
          >
            {isFacebook ? (
              <FacebookIcon className="h-4 w-4" />
            ) : (
              <InstagramIcon className="h-4 w-4" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{candidate.name}</span>
          <span className="block truncate text-xs text-muted">
            {isFacebook
              ? (candidate.category ?? 'Facebook Page')
              : candidate.username
                ? `@${candidate.username}`
                : 'Instagram account'}
            {candidate.linkedPage && ` · linked to ${candidate.linkedPage.name}`}
          </span>
          {candidate.publishing?.status === 'RESTRICTED' && (
            <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
              {candidate.publishing.reason}
            </span>
          )}
          {!candidate.hasAccessToken && (
            <span className="mt-0.5 block text-xs text-rose-600 dark:text-rose-400">
              Meta did not grant access to this account for this login.
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {stateBadge(candidate)}
          {locked && candidate.state === DISCOVERY_STATES.CONNECTED_VIA_OTHER && (
            <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          )}
        </span>
      </label>
    </li>
  );
}

export default function SelectAccountsPage() {
  const { connectionId } = useParams();
  const { workspace, can } = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, error, refetch, isFetching } = useDiscovery(workspace.id, connectionId);
  const start = useStartAuthorization(workspace.id);
  const [selected, setSelected] = useState(() => new Set());
  // Back/Cancel return to the Logins tab; after adding, the login's page lists what was added.
  const accountsUrl = `/w/${workspace.slug}/accounts/logins`;
  const loginUrl = `${accountsUrl}/${connectionId}`;
  const invalidate = useInvalidateAccounts(workspace.id);

  const submit = useMutation({
    mutationFn: (accounts) =>
      api.post(`/workspaces/${workspace.id}/social-connections/${connectionId}/accounts`, {
        accounts,
      }),
    onSuccess: async (result) => {
      await invalidate();
      const added = result.added.length + result.relinked.length;
      if (added > 0)
        toast.success(`${added} account${added === 1 ? '' : 's'} added to ${workspace.name}`);
      for (const skipped of result.skipped) toast.warning(skipped.message);
      navigate(loginUrl);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!can(PERMISSIONS.SOCIAL_CONNECTIONS_MANAGE)) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Restricted"
          description="Only workspace owners and admins can add social accounts."
        />
      </Card>
    );
  }
  if (isPending) return <PageLoader label="Asking Meta which accounts this login manages…" />;

  if (error) {
    const reconnect = error.code === 'META_RECONNECT_REQUIRED';
    return (
      <>
        <BackLink to={accountsUrl} />
        <Card>
          <ErrorState
            title={
              reconnect ? 'This login needs to be reconnected' : 'Could not load accounts from Meta'
            }
            error={error}
            onRetry={reconnect ? undefined : refetch}
          />
          {reconnect && <ReconnectFooter start={start} connectionId={connectionId} />}
        </Card>
      </>
    );
  }

  const { connection, candidates, warnings } = data;
  const selectable = candidates.filter(
    (c) =>
      c.hasAccessToken &&
      (c.state === DISCOVERY_STATES.NEW || c.state === DISCOVERY_STATES.RECLAIMABLE),
  );
  const toggle = (c) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyOf(c))) next.delete(keyOf(c));
      else next.add(keyOf(c));
      return next;
    });
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(keyOf(c)));
  const groups = [
    ['Facebook Pages', candidates.filter((c) => c.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE)],
    [
      'Instagram accounts',
      candidates.filter((c) => c.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT),
    ],
  ].filter(([, list]) => list.length > 0);

  return (
    <>
      <BackLink to={accountsUrl} />
      <PageHeader
        title="Choose accounts to add"
        description={`Accounts that ${connection.displayName ?? 'this login'} can manage. Only the ones you select are added to ${workspace.name}.`}
        actions={
          <Button variant="secondary" loading={isFetching} onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh from Meta
          </Button>
        }
      />

      {warnings.length > 0 && (
        <div className="mb-6 space-y-2" role="status">
          {warnings.map((w) => (
            <p
              key={w}
              className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {w}
            </p>
          ))}
        </div>
      )}

      {candidates.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to add"
            description="Meta did not return any eligible accounts for this login."
          />
          <ReconnectFooter
            start={start}
            connectionId={connectionId}
            label="Reconnect and choose Pages again"
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${candidates.length} account${candidates.length === 1 ? '' : 's'} found`}
            description={`${selected.size} selected`}
            action={
              selectable.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(selectable.map(keyOf)))
                  }
                >
                  {allSelected ? 'Clear selection' : 'Select all available'}
                </Button>
              )
            }
          />
          {groups.map(([title, list]) => (
            <div key={title} className="mt-4">
              <p className="border-t border-slate-100 px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:px-6 dark:border-white/5">
                {title}
              </p>
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {list.map((c) => (
                  <CandidateRow
                    key={keyOf(c)}
                    candidate={c}
                    checked={selected.has(keyOf(c)) || c.state === DISCOVERY_STATES.CONNECTED_HERE}
                    onToggle={() => toggle(c)}
                  />
                ))}
              </ul>
            </div>
          ))}
          <CardFooter>
            <Button variant="secondary" onClick={() => navigate(accountsUrl)}>
              Cancel
            </Button>
            <Button
              disabled={selected.size === 0}
              loading={submit.isPending}
              onClick={() =>
                submit.mutate(
                  candidates
                    .filter((c) => selected.has(keyOf(c)))
                    .map(({ platform, externalId }) => ({ platform, externalId })),
                )
              }
            >
              <Check className="h-4 w-4" aria-hidden="true" /> Add {selected.size || ''} account
              {selected.size === 1 ? '' : 's'}
            </Button>
          </CardFooter>
        </Card>
      )}
    </>
  );
}

function BackLink({ to }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-slate-900 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Logins
    </Link>
  );
}

function ReconnectFooter({ start, connectionId, label = 'Reconnect' }) {
  const { workspace } = useWorkspace();
  const { data: connections } = useSocialConnections(workspace.id);
  const connection = connections?.find((c) => c.id === connectionId);
  return (
    <CardFooter>
      <Button
        disabled={!connection}
        loading={start.isPending}
        onClick={() => start.mutate({ provider: connection.provider, connectionId })}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> {label}
      </Button>
    </CardFooter>
  );
}
