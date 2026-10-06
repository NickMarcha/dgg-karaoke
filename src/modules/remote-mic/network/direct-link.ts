import { NetworkMessages, NetworkRtcMessage } from '~/modules/remote-mic/network/messages';
import { pack, unpack } from '~/modules/remote-mic/network/utils';

/**
 * A WebRTC data channel straight from a phone to its game, so pitch readings cross the room's Wi-Fi
 * (or the nearest Cloudflare TURN relay) instead of travelling to the API and back. The relay socket
 * stays the session: it carries the offer, the answer and the candidates (`t: 'rtc'`), and everything
 * else. The phone offers once it has joined; the game answers.
 *
 * Only messages whose lateness costs more than their loss go this way. The channel is unordered and
 * never retransmits, so a lost reading is skipped rather than holding up the ones behind it. Until the
 * channel opens, or if it never does, the same messages go over the relay.
 */
const DIRECT_TYPES = new Set<NetworkMessages['t']>(['freq', 'ping', 'pong']);

export const goesDirect = (message: NetworkMessages) => DIRECT_TYPES.has(message.t);

export class DirectLink {
  private connection: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  // Signals are applied one at a time: a candidate cannot be added before the description it belongs to
  private signals = Promise.resolve();

  private constructor(
    iceServers: RTCIceServer[],
    private sendSignal: (signal: NetworkRtcMessage) => void,
    private onMessage: (message: NetworkMessages) => void,
  ) {
    this.connection = new RTCPeerConnection({ iceServers });
    this.connection.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ t: 'rtc', candidate: candidate.toJSON() });
    };
    this.connection.ondatachannel = ({ channel }) => this.attach(channel);
    this.connection.onconnectionstatechange = () => {
      if (this.connection.connectionState === 'failed') this.close();
    };
  }

  /** The phone's side. Null where the browser has no WebRTC, which leaves everything on the relay. */
  public static offer(
    iceServers: RTCIceServer[],
    sendSignal: (signal: NetworkRtcMessage) => void,
    onMessage: (message: NetworkMessages) => void,
  ) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const link = new DirectLink(iceServers, sendSignal, onMessage);
    link.attach(link.connection.createDataChannel('pitch', { ordered: false, maxRetransmits: 0 }));
    link.enqueue(async () => {
      await link.connection.setLocalDescription();
      link.sendSignal({ t: 'rtc', description: link.connection.localDescription!.toJSON() });
    });
    return link;
  }

  /** The game's side, made when a phone's offer arrives. */
  public static answer(
    iceServers: RTCIceServer[],
    sendSignal: (signal: NetworkRtcMessage) => void,
    onMessage: (message: NetworkMessages) => void,
  ) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    return new DirectLink(iceServers, sendSignal, onMessage);
  }

  public handleSignal = (signal: NetworkRtcMessage) =>
    this.enqueue(async () => {
      if (signal.description) {
        await this.connection.setRemoteDescription(signal.description);
        if (signal.description.type === 'offer') {
          await this.connection.setLocalDescription();
          this.sendSignal({ t: 'rtc', description: this.connection.localDescription!.toJSON() });
        }
      } else if (signal.candidate) {
        await this.connection.addIceCandidate(signal.candidate);
      }
    });

  public isOpen = () => this.channel?.readyState === 'open';

  /** Sends over the link if it is open; false means the caller should use the relay. */
  public send = (message: NetworkMessages) => {
    if (!this.isOpen()) return false;
    this.channel!.send(pack(message) as Uint8Array<ArrayBuffer>);
    return true;
  };

  public close = () => {
    this.channel?.close();
    this.connection.close();
  };

  private attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => console.info('Direct link open');
    channel.onmessage = (event) => this.onMessage(unpack<NetworkMessages>(new Uint8Array(event.data)));
  }

  private enqueue(step: () => Promise<void>) {
    this.signals = this.signals.then(step).catch((error) => console.warn('Direct link setup failed', error));
  }
}
