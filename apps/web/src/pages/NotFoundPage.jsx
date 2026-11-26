import { ButtonLink } from '../components/ui/Button.jsx';
import { CenteredShell } from '../components/ui/CenteredShell.jsx';
import { BrokenLinkArt } from '../components/ui/illustrations.jsx';

/**
 * Any address that does not exist. Also what a person who is not a platform admin sees at
 * /admin, so the operator console looks like it is not there.
 */
export function NotFoundPage() {
  return (
    <CenteredShell card={false}>
      <div className="flex animate-scale-in flex-col items-center text-center">
        <BrokenLinkArt className="h-24 w-40" />
        <p className="mt-6 text-sm font-semibold text-brand-600 dark:text-brand-300">404</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
          Page not found
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          The page you are looking for does not exist or has moved.
        </p>
        <ButtonLink to="/" className="mt-7">
          Back to SocialHub
        </ButtonLink>
      </div>
    </CenteredShell>
  );
}
