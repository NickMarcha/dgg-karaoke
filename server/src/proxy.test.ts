import { describe, expect, it } from 'vitest';

import { fetchThroughProxy, ProxyRefused, proxyTarget } from './proxy.js';

describe('proxyTarget', () => {
  it('accepts the two song sites', () => {
    expect(proxyTarget('https://ultrastar-es.org/en/canciones?x=1').hostname).toBe('ultrastar-es.org');
    expect(proxyTarget('http://usdb.animux.de/index.php?link=detail&id=1').hostname).toBe('usdb.animux.de');
  });

  it.each([
    'https://example.com/',
    'https://ultrastar-es.org.evil.test/',
    'file:///etc/passwd',
    'not a url',
    undefined,
  ])('refuses %s', (url) => {
    expect(() => proxyTarget(url)).toThrow(ProxyRefused);
  });
});

describe('fetchThroughProxy', () => {
  const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

  it('follows a redirect that stays on the allow list', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: URL) => {
      seen.push(url.toString());
      return seen.length === 1 ? redirectTo('https://ultrastar-es.org/en/') : new Response('ok');
    }) as typeof fetch;
    const response = await fetchThroughProxy(new URL('http://ultrastar-es.org/'), fetchImpl);
    expect(await response.text()).toBe('ok');
    expect(seen).toEqual(['http://ultrastar-es.org/', 'https://ultrastar-es.org/en/']);
  });

  it('refuses a redirect off the allow list', async () => {
    const fetchImpl = (async () => redirectTo('http://169.254.169.254/latest')) as typeof fetch;
    await expect(fetchThroughProxy(new URL('https://usdb.animux.de/'), fetchImpl)).rejects.toThrow(ProxyRefused);
  });
});
