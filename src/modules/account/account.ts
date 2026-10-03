import useSWR, { mutate } from 'swr';

/**
 * Sign-in with destiny.gg. The site proxies `/api` to the API (netlify.toml, and the Vite servers
 * locally), so the session cookie is first-party: browsers that block third-party cookies still
 * keep it.
 */
export interface Account {
  id: string;
  username: string;
  role: 'singer' | 'admin';
  /** The destiny.gg flair the name is coloured by, a class in `flairs.css`. */
  flair: string | null;
}

const ME_URL = '/api/me';

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

/** The signed-in account, `null` when signed out, `undefined` while that is not known yet. */
export function useAccount() {
  const { data, mutate } = useSWR(
    ME_URL,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new AccountError('Could not check who is signed in.');
      return ((await response.json()) as { user: Account | null }).user;
    },
    { revalidateOnFocus: false },
  );

  return {
    account: data,
    signOut: async () => {
      await postJson('/api/auth/logout');
      await mutate(null, { revalidate: false });
    },
  };
}

/** Leaves for destiny.gg, which comes back to `/auth/callback`. */
export function signIn() {
  window.location.assign('/api/auth/login');
}

/** Hands the code destiny.gg sent back to the API, which sets the session cookie. */
export async function completeSignIn(code: string, state: string) {
  await postJson('/api/auth/callback', { code, state });
  await mutate(ME_URL);
}

export function flairClass(account: Pick<Account, 'flair'>) {
  return account.flair ? `flair-${account.flair}` : undefined;
}
