import { SOCIAL_PROVIDERS } from '@socialhub/shared';
import { useState } from 'react';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';
import { Button } from '../ui/Button.jsx';

const VIA_FACEBOOK_HINT =
  'Connects through Facebook Login: Instagram Business or Creator accounts linked to your Facebook Pages are offered after Meta’s consent screen.';

/**
 * "Connect Instagram" / "Connect Facebook" buttons for the logins the server is configured
 * for. `start` is the useStartAuthorization() mutation; each click starts a real Meta OAuth
 * round-trip (the browser is sent to Meta's consent dialog). Renders nothing when neither
 * login is configured — the setup notice explains why.
 *
 * Instagram is offered whenever the place offers it (`integration.instagram` is present):
 * through Instagram Login when that is configured, otherwise through Facebook Login, which
 * asks for instagram_basic and instagram_content_publish and finds the Instagram professional
 * accounts linked to the person's Pages. Places that only offer Pages pass no `instagram`.
 */
export function ConnectButtons({ integration, start, size = 'md' }) {
  const [clicked, setClicked] = useState(null);
  const instagramDirect = Boolean(integration?.instagram?.configured);
  // Facebook Login only finds Instagram accounts when it asks for instagram_basic. The server
  // reports its scopes (null with a login configuration, whose permissions it cannot see).
  const facebookScopes = integration?.facebook?.scopes;
  const facebookAsksInstagram =
    !Array.isArray(facebookScopes) || facebookScopes.includes('instagram_basic');
  const instagramViaFacebook =
    !instagramDirect &&
    Boolean(integration?.instagram) &&
    Boolean(integration?.facebook?.configured) &&
    facebookAsksInstagram;
  const busy = start.isPending && !start.variables?.connectionId ? clicked : null;
  const connect = (which, provider) => {
    setClicked(which);
    start.mutate({ provider });
  };
  return (
    <>
      {(instagramDirect || instagramViaFacebook) && (
        <Button
          variant="secondary"
          size={size}
          loading={busy === 'instagram'}
          disabled={start.isPending}
          title={instagramViaFacebook ? VIA_FACEBOOK_HINT : undefined}
          onClick={() =>
            connect(
              'instagram',
              instagramDirect ? SOCIAL_PROVIDERS.INSTAGRAM_LOGIN : SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
            )
          }
        >
          <InstagramIcon className="h-4 w-4" /> Connect Instagram
        </Button>
      )}
      {integration?.facebook?.configured && (
        <Button
          size={size}
          loading={busy === 'facebook'}
          disabled={start.isPending}
          onClick={() => connect('facebook', SOCIAL_PROVIDERS.FACEBOOK_LOGIN)}
        >
          <FacebookIcon className="h-4 w-4" /> Connect Facebook
        </Button>
      )}
    </>
  );
}
