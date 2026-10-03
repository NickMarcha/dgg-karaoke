import { ReactNode } from 'react';

import { signIn, useAccount } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';

interface Props {
  children: ReactNode;
  /** Shown instead while sign-in is required and nobody is signed in. */
  fallback: ReactNode;
}

/**
 * What only signed-in people may use while the API requires sign-in: singing online and phones as
 * microphones, both of which go through its relays. Nothing until the API has said whether it does.
 */
export default function SignInGate({ children, fallback }: Props) {
  const { account, signInRequired, failed } = useAccount();

  // Unreachable, the relays are too; the screen underneath already says so in its own words
  if (failed) return children;
  if (signInRequired === undefined) return null;
  return signInRequired && !account ? fallback : children;
}

/** The plain fallback: why, and the button. */
export function SignInPrompt({ why, onSignIn = signIn }: { why: ReactNode; onSignIn?: () => void }) {
  return (
    <div className="flex flex-col gap-4" data-test="sign-in-required">
      <Menu.HelpText>{why}</Menu.HelpText>
      <Menu.Button onClick={onSignIn} data-test="sign-in-required-button">
        Sign in with destiny.gg
      </Menu.Button>
    </div>
  );
}
