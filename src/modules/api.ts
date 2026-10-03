/** Our own API (`server/`): the remote-mic relay and the song importer's proxy. */
const API_URL: string = import.meta.env.VITE_APP_API_URL;

export const apiUrl = (path: string) => new URL(path, API_URL).toString();

/** The relays serve only signed-in people, and nobody is signed in on this browser. */
export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in with destiny.gg first.');
  }
}

/**
 * A relay socket's address, with a ticket when signed in. The sockets go to the API directly, so
 * they carry none of the site's cookies; the ticket comes through the site's `/api` proxy, which does.
 */
export const apiSocketUrl = async (path: string) => {
  const url = new URL(path, API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  const response = await fetch('/api/socket-ticket', { method: 'POST' });
  if (response.status === 401) throw new SignInRequiredError();
  const { ticket } = response.ok ? ((await response.json()) as { ticket: string | null }) : { ticket: null };
  if (ticket) url.searchParams.set('ticket', ticket);

  return url.toString();
};
