/**
 * What a phone and its game need to find a direct route to each other: Cloudflare's STUN always, and
 * with a TURN key its relays for when no direct route exists. Every socket on the remote-mic relay is
 * handed the current set (`relay.ts`), so the credentials reach only people the relay lets in.
 */

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnKey {
  keyId: string;
  apiToken: string;
}

export const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

// Credentials live a day and are replaced every twelve hours, so any handed out last a session of at
// least twelve hours: TURN refuses to refresh an allocation once its credential has expired.
const TTL_SECONDS = 24 * 60 * 60;
const REFRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

export class IceServers {
  private current: IceServer[] = STUN_ONLY;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly key: TurnKey | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public get = () => this.current;

  /** Fetches the first credentials and keeps them fresh. Without a TURN key there is nothing to fetch. */
  public start = async () => {
    if (!this.key) return;
    try {
      this.current = await this.generate(this.key);
      this.timer = setTimeout(this.start, REFRESH_MS);
    } catch (error) {
      console.error('Could not generate TURN credentials', error instanceof Error ? error.message : error);
      this.timer = setTimeout(this.start, RETRY_MS);
    }
  };

  public stop = () => clearTimeout(this.timer);

  private async generate({ keyId, apiToken }: TurnKey): Promise<IceServer[]> {
    const response = await this.fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare answered ${response.status}`);
    const { iceServers } = (await response.json()) as { iceServers: Array<IceServer & { urls: string | string[] }> };
    // Browsers block port 53, and a candidate that can never connect only delays the ones that can
    return iceServers.map((server) => ({ ...server, urls: [server.urls].flat().filter((url) => !/:53\b/.test(url)) }));
  }
}
