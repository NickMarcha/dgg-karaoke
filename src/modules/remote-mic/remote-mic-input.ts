import events from '~/modules/game-events/game-events';
import { PlayerNumber } from '~/modules/players/player-number';
import { NetworkMessages } from '~/modules/remote-mic/network/messages';
import { SenderInterface } from '~/modules/remote-mic/network/server/transport/interface';
import { getPingTime } from '~/modules/remote-mic/network/utils';
import { RemoteMicPermission } from '~/routes/settings/settings-state';

// Helper to send an rpc-call to a connected client (server-initiated call)
const sendRpcCall = (connection: SenderInterface, method: string, args: unknown[] = []) => {
  connection.send({ t: 'rpc-call', method, args } as NetworkMessages);
};

/**
 * A phone runs the same pitch detection as a microphone on this machine (`MicInput` allows 180 ms for
 * it) and then batches readings every 50 ms before sending, 25 ms late on average. The trip over the
 * network comes on top of that, from the measured ping.
 */
const PHONE_PROCESSING_LAG_MS = 180 + 25;
/** A ping slower than this is a stall, not the delay the singer is steadily hearing. */
const MAX_COUNTED_ROUND_TRIP_MS = 500;

class RemoteMicInput {
  private frequencies: number[] | number[][] = [0];
  private volumes = [0];

  private requestReadinessPromise: null | Promise<boolean> = null;

  public constructor(
    private connection: SenderInterface,
    private inputLag: number,
    private getNetworkDelay: () => number,
  ) {}

  getFrequencies = () => {
    const freqs = this.frequencies;

    return freqs;
  };

  clearFrequencies = () => {
    if (Array.isArray(this.frequencies[0])) {
      this.frequencies = [this.frequencies[0].at(-1)!];
    }
  };
  getVolumes = () => this.volumes;

  /** How late this phone's readings arrive: processing, network, plus the singer's own correction. */
  getInputLag = () => {
    return PHONE_PROCESSING_LAG_MS + this.getNetworkDelay() + this.inputLag;
  };

  setInputLag = (inputLag: number) => {
    this.inputLag = inputLag;
  };

  requestReadiness = () => {
    console.log('requestReadiness');
    if (!this.requestReadinessPromise) {
      this.requestReadinessPromise = new Promise<boolean>((resolve) => {
        const deviceId = this.connection.peer;

        const cleanup = () => {
          clearTimeout(timeoutId);
          events.readinessConfirmed.unsubscribe(handleReadinessConfirmed);
          events.remoteMicDisconnected.unsubscribe(handleDisconnect);
          this.requestReadinessPromise = null;
        };

        const handleReadinessConfirmed = (confirmedDeviceId: string) => {
          if (confirmedDeviceId === deviceId) {
            cleanup();
            resolve(true);
          }
        };

        const handleDisconnect = ({ id }: { id: string }) => {
          if (id === deviceId) {
            cleanup();
            resolve(false);
          }
        };

        const timeoutId = setTimeout(() => {
          cleanup();
          resolve(false);
        }, 30_000);

        events.readinessConfirmed.subscribe(handleReadinessConfirmed);
        events.remoteMicDisconnected.subscribe(handleDisconnect);

        sendRpcCall(this.connection, 'requestReadiness');
      });
    }
    return this.requestReadinessPromise!;
  };

  startMonitoring = async () => {
    this.connection?.off('data', this.handleRTCData);
    sendRpcCall(this.connection, 'startMonitor');

    this.connection?.on('data', this.handleRTCData);
  };

  stopMonitoring = async () => {
    sendRpcCall(this.connection, 'stopMonitor');

    this.connection?.off('data', this.handleRTCData);
  };

  private handleRTCData = (data: NetworkMessages) => {
    if (data.t === 'freq') {
      this.frequencies = [data[0], data[0]];
      this.volumes = [data[1], data[1]];
    }
  };
}

export class RemoteMic {
  private input: RemoteMicInput;
  private pingTime: number = 9999;
  private pingInterval: ReturnType<typeof setTimeout> | null = null;
  constructor(
    public id: string,
    public name: string,
    public connection: SenderInterface,
    lag: number,
  ) {
    this.input = new RemoteMicInput(connection, lag, this.getNetworkDelay);

    this.pingClient();
  }

  public getInput = () => this.input;

  public setPlayerNumber = (playerNumber: PlayerNumber | null) => {
    sendRpcCall(this.connection, 'setPlayerNumber', [playerNumber]);
  };

  public onDisconnect = () => {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
    }
  };

  public setPermission = (level: RemoteMicPermission) => {
    sendRpcCall(this.connection, 'setPermissions', [level]);
  };

  private isPinging = false;
  private latency: number = 9999;

  /** Round trips averaged over the last few pings, so one slow ping does not shift scoring mid-song. */
  private smoothedRoundTrip: number | null = null;

  public onPong = () => {
    this.latency = getPingTime() - this.pingTime;
    this.isPinging = false;
    const sample = Math.min(this.latency, MAX_COUNTED_ROUND_TRIP_MS);
    this.smoothedRoundTrip = this.smoothedRoundTrip === null ? sample : this.smoothedRoundTrip * 0.8 + sample * 0.2;

    this.pingClient();
  };

  private pingClient = () => {
    this.pingInterval = setTimeout(() => {
      this.pingTime = getPingTime();
      this.isPinging = true;
      this.connection.send({ t: 'ping' } as NetworkMessages);
    }, 1000);
  };

  public getLatency = () => (this.isPinging ? getPingTime() - this.pingTime : this.latency);

  /** One way, phone to game: half the round trip. Nothing until the first pong comes back. */
  public getNetworkDelay = () => Math.round((this.smoothedRoundTrip ?? 0) / 2);

  public getPingTime = () => this.pingTime;
}
