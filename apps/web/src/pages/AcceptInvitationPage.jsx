import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@socialhub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MailOpen } from 'lucide-react';
import { useParams, useNavigate } from 'react-router';
import { RoleBadge } from '../components/ui/Badge.jsx';
import { Logo } from '../components/ui/Brand.jsx';
import { Button, ButtonLink } from '../components/ui/Button.jsx';
import { FormError } from '../components/ui/Field.jsx';
import { PageLoader } from '../components/ui/Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { request } from '../lib/api.js';
import { keys } from '../lib/queries.js';
import { formatDate } from '../lib/utils.js';

function Shell({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div
        className="absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="surface p-7 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  const { token } = useParams();
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const here = `/invite/${encodeURIComponent(token)}`;

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      request(`/invitations/${encodeURIComponent(token)}`, { auth: false }).then(
        (d) => d.invitation,
      ),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      request(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    onSuccess: async ({ workspace }) => {
      await queryClient.invalidateQueries({ queryKey: keys.workspaces });
      navigate(`/w/${workspace.slug}`, { replace: true });
    },
  });

  if (preview.isPending || status === 'loading') return <PageLoader />;

  if (preview.error) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-lg font-semibold">This invitation link is not valid</h1>
          <p className="mt-1.5 text-sm text-muted">
            It may have been revoked or replaced by a newer invitation. Ask the person who invited
            you for a new link.
          </p>
          <ButtonLink to="/" variant="secondary" className="mt-6">
            Go to SocialHub
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const invitation = preview.data;
  const usable = invitation.status === 'PENDING';
  const emailMatches = user?.email === invitation.email;
  const qs = `redirect=${encodeURIComponent(here)}&email=${encodeURIComponent(invitation.email)}`;

  return (
    <Shell>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/25">
        <MailOpen className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">
        Join {invitation.workspace.name}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {invitation.invitedBy?.name ?? 'A teammate'} invited{' '}
        <strong className="text-slate-700 dark:text-slate-200">{invitation.email}</strong> to
        collaborate on SocialHub.
      </p>

      <div className="mt-6 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Your role</span>
          <RoleBadge role={invitation.role} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {ROLE_DESCRIPTIONS[invitation.role]}
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {!usable ? (
          <FormError
            message={`This invitation is ${invitation.status.toLowerCase()}. Ask for a new one.`}
          />
        ) : status === 'guest' ? (
          <>
            <ButtonLink to={`/register?${qs}`} size="lg" className="w-full">
              Create account to accept
            </ButtonLink>
            <ButtonLink to={`/login?${qs}`} variant="secondary" size="lg" className="w-full">
              I already have an account
            </ButtonLink>
          </>
        ) : emailMatches ? (
          <>
            <FormError message={accept.error?.message} />
            <Button
              size="lg"
              className="w-full"
              loading={accept.isPending}
              onClick={() => accept.mutate()}
            >
              Accept and join as {ROLE_LABELS[invitation.role]}
            </Button>
          </>
        ) : (
          <>
            <FormError
              message={`You're signed in as ${user.email}, but this invitation is for ${invitation.email}.`}
            />
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={async () => {
                await signOut();
                navigate(`/login?${qs}`);
              }}
            >
              Sign in with {invitation.email}
            </Button>
          </>
        )}
        {usable && (
          <p className="text-center text-xs text-muted">
            Expires {formatDate(invitation.expiresAt)}
          </p>
        )}
      </div>
    </Shell>
  );
}
