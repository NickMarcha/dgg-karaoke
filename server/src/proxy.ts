/**
 * The song importer reads song pages from these two sites, which send no CORS headers. Only their
 * pages pass through, with none of the caller's headers, so the route cannot be turned into an open
 * proxy or carry a visitor's cookies anywhere.
 */
export const PROXY_HOSTS = new Set(['ultrastar-es.org', 'usdb.animux.de']);

const MAX_REDIRECTS = 3;

export class ProxyRefused extends Error {}

export function proxyTarget(raw: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new ProxyRefused('Not a URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !PROXY_HOSTS.has(url.hostname)) {
    throw new ProxyRefused('Host not allowed');
  }
  return url;
}

/** Follows redirects by hand so that each hop is checked against the allow list, not just the first. */
export async function fetchThroughProxy(target: URL, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    url = proxyTarget(new URL(location, url).toString());
  }
  throw new ProxyRefused('Too many redirects');
}
