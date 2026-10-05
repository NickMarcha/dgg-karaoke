import { OnlineMessages } from '~/modules/online/protocol/types';
import { JoinRejectedReason } from '~/modules/online/signaling/protocol';
import { RoomStream, StreamPacket } from '~/modules/online/streaming/types';

/** Where this browser sits in a room: which side of the wiring it is on, whose channels it should
 * be subscribed to, and which slot is its own. */
export interface RoomMembership {
  isHost: boolean;
  hostSessionId: string;
  /** Bumped by the directory on every host change; carried into a promotion claim. */
  epoch: number;
  slot: number;
}

export type OnlineJoinOutcome =
  // The reason is the directory's, passed through unchanged — restating the union here let the two
  // drift, and a reason the transport did not know about stopped compiling rather than reaching the
  // caller that has to act on it.
  { ok: true; membership: RoomMembership } | { ok: false; reason: JoinRejectedReason };

/**
 * The room's channels, as the host runtime and the client transport use them. `RelayRoomConnection`
 * is the real implementation; depending on the shape rather than the class is what lets the host
 * be driven by an in-memory fabric in tests.
 */
export interface OnlineRoomChannels {
  broadcast(message: OnlineMessages): void;
  sendToSlot(slot: number, message: OnlineMessages): void;
  onMessage(listener: (message: OnlineMessages, slot: number | null) => void): () => void;
  onSlotClosed(listener: (slot: number) => void): () => void;
  getMembership(): RoomMembership | null;
  getSessionId(): string | null;
  isConnected(): boolean;
  keepalive(): Promise<unknown>;
  leave(): Promise<unknown>;
  /** Frees somebody else's slot in the directory. Only the host calls this — it is the only side
   * that can tell that a participant is gone for good rather than momentarily quiet. `ban` marks
   * a kick, which also stops them re-claiming a slot. */
  releaseSlot(participantId: string, ban?: boolean): Promise<unknown>;
}

/**
 * A full connection to a room: the directory dance (claim a slot, learn who hosts, take over) plus
 * the channels the messages travel on.
 *
 * `RelayRoomConnection` is the real implementation; the host runtime's tests drive an in-memory
 * fabric instead.
 */
export interface OnlineRoomConnection extends OnlineRoomChannels {
  join(options?: { create?: boolean }): Promise<OnlineJoinOutcome>;
  /** Re-points at a different host without giving up this browser's own membership. */
  rewire(membership: RoomMembership): Promise<void>;
  promote(): Promise<{ ok: boolean; epoch: number; hostSessionId?: string | null }>;
  /** Fires when the connection is unrecoverable — the caller re-joins from scratch. */
  onLost(listener: () => void): () => void;
  close(): void;
  /** Streaming the room (docs/plans/stream-view.md): the relay's word on who streams it, and asking,
   * answering and sending this singer's singing to the streams that accepted them. */
  onStreamState(listener: (streams: RoomStream[]) => void): () => void;
  requestStream(streamerId: string, ask: boolean): void;
  answerStream(participantId: string, accept: boolean): void;
  sendStreamData(payload: StreamPacket): void;
}

/** One connected participant, from the host's side. Structurally satisfies the RPC core's
 * `RpcSenderInterface`, so `RpcServer` can reply to it without knowing anything about the relay. */
export interface OnlinePeerSender {
  /** The participant id, bound to this slot by the peer's `hello`. */
  peer: string;
  send(payload: unknown): void;
}

/** What the host runtime needs from the wire: a broadcast that the relay fans out, a private pipe
 * per participant, and notice when one of them goes away. */
export interface OnlineHostTransport {
  /** One send, delivered to everyone in the room, so the host's uplink does not grow with the
   * number of singers. */
  broadcast(message: OnlineMessages): void;
  getPeer(participantId: string): OnlinePeerSender | undefined;
  getPeers(): OnlinePeerSender[];
  /** Drops a participant's slot — used by the room logic's `disconnect` (a kick). */
  removePeer(participantId: string): void;
  addListener(listener: (message: OnlineMessages, sender: OnlinePeerSender) => void): void;
  removeListener(listener: (message: OnlineMessages, sender: OnlinePeerSender) => void): void;
  /** Fires when a peer's channel closes, so the room logic can start its reconnect grace window. */
  onPeerLost(listener: (participantId: string) => void): () => void;
  close(): void;
}

/** What `OnlineClient` needs from the wire. Deliberately the same shape the WebSocket transport
 * had, so the RPC proxy and subscription manager did not have to learn anything new. */
export interface OnlineClientTransport {
  isConnected(): boolean;
  sendEvent(message: unknown): void;
  addListener(listener: (message: OnlineMessages) => void): unknown;
  removeListener(listener: (message: OnlineMessages) => void): void;
  clearAllListeners(): void;
  close(): void;
}
