/** Our own API (`server/`): the remote-mic relay and the song importer's proxy. */
const API_URL: string = import.meta.env.VITE_APP_API_URL;

export const apiUrl = (path: string) => new URL(path, API_URL).toString();

export const apiSocketUrl = (path: string) => {
  const url = new URL(path, API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};
