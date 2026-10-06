import { afterEach, describe, expect, it, vi } from 'vitest';

import { IceServers, STUN_ONLY } from './ice-servers.js';

const key = { keyId: 'key-id', apiToken: 'api-token' };

function answering(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe('IceServers', () => {
  let servers: IceServers | undefined;
  afterEach(() => servers?.stop());

  it('offers only STUN without a TURN key', async () => {
    const fetchImpl = answering(201, {});
    servers = new IceServers(undefined, fetchImpl);
    await servers.start();
    expect(servers.get()).toEqual(STUN_ONLY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hands out the credentials Cloudflare generates, without the port browsers block', async () => {
    const fetchImpl = answering(201, {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'],
          username: 'user',
          credential: 'secret',
        },
      ],
    });
    servers = new IceServers(key, fetchImpl);
    await servers.start();

    expect(servers.get()).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'user', credential: 'secret' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer api-token' });
  });

  it('keeps offering STUN when Cloudflare refuses, and tries again', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = answering(401, {});
    servers = new IceServers(key, fetchImpl);
    await servers.start();
    expect(servers.get()).toEqual(STUN_ONLY);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
