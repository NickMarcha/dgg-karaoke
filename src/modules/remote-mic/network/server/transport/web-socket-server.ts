import { apiSocketUrl, SignInRequiredError } from '~/modules/api';
import { DirectLink, goesDirect } from '~/modules/remote-mic/network/direct-link';
import { NetworkMessages, NetworkRtcMessage } from '~/modules/remote-mic/network/messages';
import {
  SenderInterface,
  ServerTransport,
  transportCloseReason,
} from '~/modules/remote-mic/network/server/transport/interface';
import { getPingTime, pack, unpack } from '~/modules/remote-mic/network/utils';
import Listener from '~/modules/utils/listener';

export interface ForwardedMessage {
  t: 'forward';
  sender: string;
  payload: NetworkMessages;
}

/** A phone's welcome; `iceServers` is what it needs to reach its game directly. */
export interface WebsocketConnectedMessage {
  t: 'connected';
  iceServers: RTCIceServer[];
}

/** The game's welcome, with what it needs to answer its phones' direct links. */
interface WebsocketRegisteredMessage {
  t: 'registered';
  iceServers: RTCIceServer[];
}

interface WebsocketPongMessage {
  t: 'pong';
}

export type WebsocketMessage =
  | ForwardedMessage
  | WebsocketConnectedMessage
  | WebsocketRegisteredMessage
  | WebsocketPongMessage;

/** Closes a connection with when nobody is signed in and the relay needs somebody to be. */
export const SIGN_IN_REQUIRED_REASON = 'sign-in-required';

export class WebSocketServerTransport extends Listener<[NetworkMessages, SenderInterface]> implements ServerTransport {
  private connection: WebSocket | null = null;
  private iceServers: RTCIceServer[] = [];
  /** Each phone's direct link, by phone id. */
  private links = new Map<string, DirectLink>();
  /** Bumped by every connect and disconnect, so a ticket arriving after either opens nothing. */
  private attempt = 0;

  private sendEvent(event: NetworkMessages) {
    if (this.connection?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.connection?.send(pack(event));
  }

  public constructor() {
    super();
  }

  public connect(
    roomId: string,
    onConnect: () => void,
    onClose: (reason: transportCloseReason, originalEvent: CloseEvent) => void,
  ) {
    const attempt = ++this.attempt;
    apiSocketUrl('/remote-mic').then(
      (url) => {
        if (attempt === this.attempt) this.open(url, roomId, onConnect, onClose);
      },
      (error) => {
        if (attempt !== this.attempt) return;
        const reason = error instanceof SignInRequiredError ? SIGN_IN_REQUIRED_REASON : 'unreachable';
        onClose(reason, new CloseEvent('close', { reason }));
      },
    );
  }

  private open(
    url: string,
    roomId: string,
    onConnect: () => void,
    onClose: (reason: transportCloseReason, originalEvent: CloseEvent) => void,
  ) {
    this.connection = new WebSocket(url);
    this.connection.binaryType = 'arraybuffer';
    this.connection.onopen = () => {
      this.sendEvent({ t: 'register-room', id: roomId });
      onConnect();
      this.ping();

      this.connection?.addEventListener('message', (message) => {
        const payload: WebsocketMessage = unpack(message.data);

        if (payload.t === 'forward') {
          const { sender, payload: data } = payload;
          if (data.t === 'rtc') {
            this.handleSignal(sender, data);
            return;
          }
          if (!goesDirect(data)) console.log('received', payload);
          if (data.t === 'unregister') this.closeLink(sender);
          this.receive(sender, data);
        } else if (payload.t === 'registered') {
          this.iceServers = payload.iceServers;
        } else if (payload.t === 'pong') {
          this.onPong();
        } else {
          console.warn('Unknown message type', payload);
        }
      });
    };

    this.connection.onclose = (event) => {
      this.links.forEach((link) => link.close());
      this.links.clear();
      onClose(event.reason, event);
    };
  }

  private receive = (sender: string, data: NetworkMessages) => {
    this.onUpdate(data, new SenderWrapper(sender, this));
  };

  /** A phone offering a direct link replaces any it had; candidates go to the link it has. */
  private handleSignal(sender: string, signal: NetworkRtcMessage) {
    if (signal.description?.type === 'offer') {
      this.closeLink(sender);
      const link = DirectLink.answer(
        this.iceServers,
        (answer) => this.sendOverRelay(sender, answer),
        (data) => this.receive(sender, data),
      );
      if (link) this.links.set(sender, link);
    }
    this.links.get(sender)?.handleSignal(signal);
  }

  private closeLink(sender: string) {
    this.links.get(sender)?.close();
    this.links.delete(sender);
  }

  /** Over the phone's direct link when the message suits it and the link is open, else the relay. */
  public sendTo(peer: string, payload: NetworkMessages) {
    if (goesDirect(payload) && this.links.get(peer)?.send(payload)) return;
    this.sendOverRelay(peer, payload);
  }

  public isDirect = (peer: string) => this.links.get(peer)?.isOpen() ?? false;

  private sendOverRelay(peer: string, payload: NetworkMessages) {
    if (!goesDirect(payload) && payload.t !== 'rtc') console.log('sending', peer, payload);
    if (this.connection?.readyState === WebSocket.OPEN) {
      this.connection.send(pack({ t: 'forward', recipients: [peer], payload }));
    }
  }

  public disconnect = () => {
    this.attempt++;
    this.connection?.close();
  };

  // todo create a a util to share with Network Client
  private latency = 0;
  private pingStart = getPingTime();
  public pinging = false;
  private pingTimeout: ReturnType<typeof setTimeout> | null = null;

  private ping = () => {
    this.pinging = true;
    this.pingStart = getPingTime();

    this.sendEvent({ t: 'ping' });
  };
  private onPong = () => {
    if (!this.pinging) return;
    this.latency = getPingTime() - this.pingStart;
    this.pinging = false;

    if (this.pingTimeout) clearTimeout(this.pingTimeout);
    this.pingTimeout = setTimeout(this.ping, 5_000);
  };

  public getCurrentPing = () => {
    return this.pinging ? Math.max(this.latency, getPingTime() - this.pingStart) : this.latency;
  };

  public removePlayer(playerId: string) {
    this.closeLink(playerId);
    // This sends a transport-level control message to the relay server to disconnect the peer
    this.sendEvent({ t: 'remove-player', id: playerId });
  }
}

type callback = (data: NetworkMessages) => void;

/** One phone as the game sees it, whichever way its messages arrive. */
class SenderWrapper implements SenderInterface {
  private callbacksMap: Map<callback, (data: NetworkMessages, sender: SenderInterface) => void> = new Map();

  constructor(
    public peer: string,
    private transport: WebSocketServerTransport,
  ) {}

  public send = (payload: NetworkMessages) => this.transport.sendTo(this.peer, payload);

  public isDirect = () => this.transport.isDirect(this.peer);

  public on = (event: string, callback: callback) => {
    if (event !== 'data') return;
    const listener = (data: NetworkMessages, sender: SenderInterface) => {
      if (sender.peer === this.peer) callback(data);
    };
    this.callbacksMap.set(callback, listener);
    this.transport.addListener(listener);
  };

  public off = (event: string, callback: callback) => {
    if (event !== 'data') return;
    const listener = this.callbacksMap.get(callback);
    if (listener) this.transport.removeListener(listener);
    this.callbacksMap.delete(callback);
  };
}
