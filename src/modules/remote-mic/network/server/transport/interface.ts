import { NetworkMessages } from '~/modules/remote-mic/network/messages';
import Listener from '~/modules/utils/listener';

export interface SenderInterface {
  peer: string;

  send(payload: NetworkMessages): void;

  on(event: string, callback: (data: NetworkMessages) => void): void;

  off(event: string, callback: (data: NetworkMessages) => void): void;

  /** Whether this phone's readings reach the game over its direct link rather than the relay. */
  isDirect(): boolean;
}

export type transportCloseReason = string;
export type transportErrorReason = string;

export interface ServerTransport extends Listener<[NetworkMessages, SenderInterface]> {
  connect(
    roomId: string,
    onConnect: () => void,
    onClose: (reason: transportCloseReason, originalEvent: unknown) => void,
  ): void;

  disconnect(): void;

  getCurrentPing(): number;

  removePlayer(playerId: string): void;
}
