import useSWR, { mutate } from 'swr';

/**
 * Sign-in with destiny.gg. The site proxies `/api` to the API (netlify.toml, and the Vite servers
 * locally), so the session cookie is first-party: browsers that block third-party cookies still
 * keep it.
 */
export interface Account {
  id: string;
  username: string;
  role: 'singer' | 'moderator' | 'admin';
  /** The destiny.gg flair the name is coloured by, a class in `flairs.css`. */
  flair: string | null;
}

const ME_URL = '/api/me';
/** The page a sign-in started on, kept in this tab while destiny.gg has it. */
const RETURN_TO_KEY = 'sign-in-return-to';

export class AccountError extends Error {}

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const answer: { error?: string } | null = await response.json().catch(() => null);
    throw new AccountError(answer?.error ?? 'The server did not answer. Try again in a moment.');
  }
}

interface Me {
  user: Account | null;
  /** The API's `SIGN_IN_REQUIRED`: the relays serve only signed-in people, named by their account. */
  signInRequired: boolean;
}

/**
 * The signed-in account, `null` when signed out, `undefined` while that is not known yet, and
 * whether singing online or through a phone needs one.
 */
export function useAccount() {
  const { data, error, mutate } = useSWR(
    ME_URL,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new AccountError('Could not check who is signed in.');
      return (await response.json()) as Me;
    },
    { revalidateOnFocus: false },
  );

  return {
    account: data?.user,
    signInRequired: data?.signInRequired,
    failed: error !== undefined,
    signOut: async () => {
      await postJson('/api/auth/logout');
      await mutate((me) => (me ? { ...me, user: null } : me), { revalidate: false });
    },
  };
}

/** The name to sing under while sign-in is required, which is the account's; `null` when people type their own. */
export function useAccountSingerName() {
  const { account, signInRequired } = useAccount();
  return signInRequired && account ? account.username : null;
}

/** Leaves for destiny.gg, which comes back to `/auth/callback`, and from there to this page. */
export function signIn() {
  sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname + window.location.search);
  window.location.assign('/api/auth/login');
}

/** Where to go once signed in: the page the sign-in started on, if it was one of ours. */
export function takeSignInReturnTo() {
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  // Browsers read `/\` as `//`, the start of another site's address
  return returnTo && /^\/(?![/\\])/.test(returnTo) ? returnTo : '/menu/';
}

/** Hands the code destiny.gg sent back to the API, which sets the session cookie. */
export async function completeSignIn(code: string, state: string) {
  await postJson('/api/auth/callback', { code, state });
  await mutate(ME_URL);
}

export function flairClass(account: Pick<Account, 'flair'>) {
  return account.flair ? `flair-${account.flair}` : undefined;
}
