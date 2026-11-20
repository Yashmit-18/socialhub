import { SOCIAL_PROVIDERS } from '@socialhub/shared';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';
import { Button } from '../ui/Button.jsx';

/**
 * "Connect Facebook" / "Connect Instagram" buttons for the logins the server is configured
 * for. `start` is the useStartAuthorization() mutation; each click starts a real Meta OAuth
 * round-trip (the browser is sent to Meta's consent dialog). Renders nothing when neither
 * login is configured — the setup notice explains why.
 */
export function ConnectButtons({ integration, start, size = 'md' }) {
  const busy = start.isPending && !start.variables?.connectionId ? start.variables?.provider : null;
  return (
    <>
      {integration?.instagram?.configured && (
        <Button
          variant="secondary"
          size={size}
          loading={busy === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN}
          disabled={start.isPending}
          onClick={() => start.mutate({ provider: SOCIAL_PROVIDERS.INSTAGRAM_LOGIN })}
        >
          <InstagramIcon className="h-4 w-4" /> Connect Instagram
        </Button>
      )}
      {integration?.facebook?.configured && (
        <Button
          size={size}
          loading={busy === SOCIAL_PROVIDERS.FACEBOOK_LOGIN}
          disabled={start.isPending}
          onClick={() => start.mutate({ provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN })}
        >
          <FacebookIcon className="h-4 w-4" /> Connect Facebook
        </Button>
      )}
    </>
  );
}
