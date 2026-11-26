import { DISCOVERY_STATES, PERMISSIONS, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { useMutation } from '@tanstack/react-query';
import { Check, Loader2, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AccountPicture } from '../../components/accounts/AccountBadges.jsx';
import { PageHeader } from '../../components/layout/AppShell.jsx';
import { BackLink } from '../../components/ui/BackLink.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Callout } from '../../components/ui/Callout.jsx';
import { Card, CardFooter, CardHeader } from '../../components/ui/Card.jsx';
import {
  EmptyState,
  ErrorState,
  RestrictedState,
  Skeleton,
} from '../../components/ui/Feedback.jsx';
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
          className="h-4 w-4 shrink-0 checkbox"
          checked={checked}
          disabled={locked}
          onChange={onToggle}
          aria-label={`Add ${candidate.name}`}
        />
        <AccountPicture account={candidate} size="sm" />
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
      <RestrictedState
        title="Restricted"
        description="Only workspace owners and admins can add social accounts."
      />
    );
  }
  // The page frame stays while Meta is asked: the way back, the status and the list's shape.
  if (isPending) {
    return (
      <>
        <BackLink to={accountsUrl}>Logins</BackLink>
        <p role="status" className="mb-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Asking Meta which accounts this login manages…
        </p>
        <Card aria-hidden="true" className="divide-y divide-slate-100 dark:divide-white/5">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-8 w-8 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
          ))}
        </Card>
      </>
    );
  }

  if (error) {
    const reconnect = error.code === 'META_RECONNECT_REQUIRED';
    return (
      <>
        <BackLink to={accountsUrl}>Logins</BackLink>
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
      <PageHeader
        back={{ to: accountsUrl, label: 'Logins' }}
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
            <Callout key={w} tone="warning">
              {w}
            </Callout>
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
              <p className="border-t border-slate-100 px-5 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase sm:px-6 dark:border-white/5 dark:text-slate-400">
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
          {/* Sticks to the window's bottom while the list is long, with the count beside it. */}
          <CardFooter className="sticky bottom-0 z-10 bg-[color-mix(in_oklab,var(--color-slate-50)_60%,white)] dark:bg-[color-mix(in_oklab,white_2%,var(--color-slate-900))]">
            <p className="mr-auto text-xs text-muted" aria-live="polite">
              {selected.size} selected
            </p>
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
