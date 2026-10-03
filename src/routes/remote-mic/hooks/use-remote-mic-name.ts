import createPersistedState from 'use-persisted-state';

import { useAccountSingerName } from '~/modules/account/account';

const usePersistedName = createPersistedState<string>('remote_mic_name');

const generateDummyName = () => `Player #${Math.floor(1000 + Math.random() * 9000)}`;

// Shared across every mount of every component that calls this hook in the same page load, so the
// wizard and the top bar never disagree on the placeholder name of a not-yet-named mic
let cachedDummyName: string | null = null;

/** The phone's name: the destiny.gg one while sign-in is required, otherwise the one typed in. */
export default function useRemoteMicName() {
  const accountName = useAccountSingerName();
  const [storedName, setStoredName] = usePersistedName('');
  if (cachedDummyName === null) cachedDummyName = generateDummyName();

  if (accountName) return { name: accountName, hasStoredName: true, canRename: false, setName: () => undefined };
  return {
    name: storedName || cachedDummyName,
    hasStoredName: storedName !== '',
    canRename: true,
    setName: setStoredName,
  };
}
