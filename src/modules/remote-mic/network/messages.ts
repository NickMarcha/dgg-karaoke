import { Params } from '~/modules/hooks/use-keyboard';
import { RpcMessages } from '~/modules/network/rpc/types';
import { SubscriptionChannels } from '~/modules/remote-mic/network/client/subscriptions';

export interface NetworkRegisterMessage {
  t: 'register';
  id: string;
  name: string;
  silent: boolean;
  lag: number;
}

export interface NetworkUnregisterMessage {
  t: 'unregister';
}

export interface NetworkRegisterRoomMessage {
  t: 'register-room';
  id: string;
}

export interface NetworkNewFrequencyMessage {
  t: 'freq';
  0: number[]; // frequencies
  1: number; // volume
}

export type keyStrokes = keyof Params;

/** The game's pings carry when they left, and the phone's pong echoes it. */
export interface NetworkPingMessageEvent {
  t: 'ping';
  0?: number;
}
export interface NetworkPongMessageEvent {
  t: 'pong';
  0?: number;
}

export interface NetworkRemovePlayerMessage {
  t: 'remove-player';
  id: string;
}

/** Sets up the direct link between a phone and its game (`direct-link.ts`). */
export interface NetworkRtcMessage {
  t: 'rtc';
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type NetworkMessages =
  | NetworkRtcMessage
  | NetworkRegisterMessage
  | NetworkUnregisterMessage
  | NetworkRegisterRoomMessage
  | NetworkNewFrequencyMessage
  | NetworkPingMessageEvent
  | NetworkPongMessageEvent
  | NetworkRemovePlayerMessage
  | RpcMessages<SubscriptionChannels>;
