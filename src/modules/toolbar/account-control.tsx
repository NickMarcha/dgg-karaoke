import { ComponentProps } from 'react';

import { flairClass, signIn, useAccount } from '~/modules/account/account';

import '~/modules/account/flairs.css';
import { Button } from '~/modules/elements/akui/button';
import { Icon } from '~/modules/elements/akui/icon';
import Typography from '~/modules/elements/akui/primitives/typography';
import { Tooltip } from '~/modules/elements/tooltip';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';
import { cn } from '~/utils/cn';

interface Props {
  size?: ComponentProps<typeof Button>['size'];
}

/** Who is signed in, or the way to sign in. Singing never needs it, so it stays out of the way. */
function AccountControl({ size }: Props) {
  const { account, signOut } = useAccount();
  const navigate = useSmoothNavigate();

  // Nothing until the API has answered, so the toolbar does not flash a sign-in button at a singer.
  if (account === undefined) return null;

  if (account === null) {
    return (
      <Tooltip title="Sign in with destiny.gg" place="bottom-end">
        <Button
          size={size}
          type="button"
          aria-label="Sign in with destiny.gg"
          onClick={signIn}
          data-test="sign-in"
          leftIcon={<Icon icon="ic:baseline-person" />}
        />
      </Tooltip>
    );
  }

  return (
    <>
      <Typography className={cn('hidden px-2 font-bold md:inline', flairClass(account))} data-test="signed-in-as">
        {account.username}
      </Typography>
      {account.role === 'admin' && (
        <Tooltip title="Admin" place="bottom-end">
          <Button
            size={size}
            type="button"
            aria-label="Admin"
            onClick={() => navigate('admin/')}
            data-test="admin-panel"
            leftIcon={<Icon icon="ic:baseline-admin-panel-settings" />}
          />
        </Tooltip>
      )}
      <Tooltip title="Sign out" place="bottom-end">
        <Button
          size={size}
          type="button"
          aria-label="Sign out"
          onClick={signOut}
          data-test="sign-out"
          leftIcon={<Icon icon="ic:baseline-logout" />}
        />
      </Tooltip>
    </>
  );
}

export default AccountControl;
