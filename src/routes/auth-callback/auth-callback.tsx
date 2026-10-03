import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';

import { completeSignIn, takeSignInReturnTo } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import MenuWithLogo from '~/modules/elements/menu-with-logo';
import { NavButton } from '~/modules/elements/nav-controls';
import useKeyboardNav from '~/modules/hooks/use-keyboard-nav';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';

/** Where destiny.gg sends the browser back to, registered with destiny.gg as the redirect. */
function AuthCallback() {
  const navigate = useSmoothNavigate();
  const { register } = useKeyboardNav({ title: 'Sign in' });
  const [error, setError] = useState<string | null>(null);
  // A code works once, and development's strict mode runs effects twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    // Out of the address bar before anything else, so the code stays out of history and analytics.
    window.history.replaceState(null, '', window.location.pathname);

    if (!code || !state) {
      setError('That sign-in link was incomplete. Try signing in again.');
      return;
    }
    completeSignIn(code, state).then(
      () => navigate(takeSignInReturnTo().slice(1)),
      (failure: Error) => setError(failure.message),
    );
  }, [navigate]);

  return (
    <MenuWithLogo>
      <Helmet>
        <title>Signing in | DGG Karaoke</title>
      </Helmet>
      <Menu.Header>Sign in</Menu.Header>
      <Typography data-test="sign-in-status">{error ?? 'Finishing your destiny.gg sign-in…'}</Typography>
      {error && (
        <NavButton nav={register} name="back" variant="back" onClick={() => navigate('menu/')}>
          Return to Main Menu
        </NavButton>
      )}
    </MenuWithLogo>
  );
}

export default AuthCallback;
