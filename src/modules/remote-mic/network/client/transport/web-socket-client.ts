import { apiSocketUrl, SignInRequiredError } from '~/modules/api';
import { transportCloseReason, transportErrorReason } from '~/modules/remote-mic/network/client/network-client';
import { ClientTransport } from '~/modules/remote-mic/network/client/transport/interface';
import { NetworkMessages } from '~/modules/remote-mic/network/messages';
import {
  ForwardedMessage,
  SIGN_IN_REQUIRED_REASON,
} from '~/modules/remote-mic/network/server/transport/web-socket-server';
import { pack, unpack } from '~/modules/remote-mic/network/utils';
import Listener from '~/modules/utils/listener';

export class WebSocketClientTransport extends Listener<[NetworkMessages]> implements ClientTransport {
  private connection: WebSocket | null = null;
  private roomId: string | null = null;
  /** Bumped by every connect and close, so a ticket arriving after either opens nothing. */
  private attempt = 0;

  public connect(
    clientId: string,
    roomId: string,
    onConnect: () => void,
    onClose: (reason: transportCloseReason, originalEvent: Event) => void,
    onError: (error: transportErrorReason, originalEvent: Event) => void,
  ): void {
    this.roomId = roomId;
    const attempt = ++this.attempt;
    apiSocketUrl('/remote-mic').then(
      (url) => {
        if (attempt === this.attempt) this.open(url, clientId, roomId, onConnect, onClose, onError);
      },
      (error) => {
        if (attempt !== this.attempt) return;
        this.clearAllListeners();
        const reason = error instanceof SignInRequiredError ? SIGN_IN_REQUIRED_REASON : 'unreachable';
        onClose(reason, new CloseEvent('close', { reason }));
      },
    );
  }

  private open(
    url: string,
    clientId: string,
    roomId: string,
    onConnect: () => void,
    onClose: (reason: transportCloseReason, originalEvent: Event) => void,
    onError: (error: transportErrorReason, originalEvent: Event) => void,
  ) {
    this.connection = new WebSocket(url);
    this.connection.binaryType = 'arraybuffer';

    this.connection.onopen = () => {
      this.connection?.send(pack({ t: 'register-player', id: clientId, roomId: roomId }));
    };

    this.connection.onmessage = (message) => {
      const data = unpack<ForwardedMessage>(message.data);
      if (data.t === 'forward') {
        this.onUpdate(data.payload);
      } else if (data.t === 'connected') {
        onConnect();
      }
    };

    this.connection.onclose = (event) => {
      let reason = 'unknown';
      try {
        reason = JSON.parse(event.reason)?.error;
      } catch (e) {
        console.info('could not parse close reason', event, e);
      }
      this.clearAllListeners();
      onClose(reason, event);
    };

    this.connection.onerror = (event) => {
      this.clearAllListeners();
      onError('error', event);
    };
  }

  public sendEvent(event: NetworkMessages) {
    this.connection?.send(pack({ t: 'forward', recipients: [this.roomId], payload: event }));
  }

  // readyState >=2 means that the connection is closing or closed
  public isConnected = () => (this.connection?.readyState ?? Infinity) < 2;

  public close = () => {
    this.attempt++;
    this.connection?.close();
  };
}
