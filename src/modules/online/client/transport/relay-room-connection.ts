import { apiSocketUrl } from '~/modules/api';
import { OnlineJoinOutcome, OnlineRoomConnection, RoomMembership } from '~/modules/online/client/transport/interface';
import { OnlineMessages } from '~/modules/online/protocol/types';
import { getMembershipSecret, setMembershipSecret } from '~/modules/online/signaling/membership-secret';
import { JoinRoomResponse, PromoteHostResponse } from '~/modules/online/signaling/protocol';

/** A directory call the relay has not answered in this long has failed; the caller retries or reconnects. */
const REQUEST_TIMEOUT_MS = 10_000;

type RelayFrame =
  | { t: 'welcome'; sessionId: string }
  | { t: 'reply'; id: number; result?: unknown; error?: string }
  | { t: 'message'; slot: number | null; payload: OnlineMessages }
  | { t: 'slot-closed'; slot: number };

/**
 * This browser's connection to a room, over one WebSocket to the API's online relay
 * (server/src/online/relay.ts).
 *
 * The relay enforces the channel rules the Cloudflare SFU used to: the room broadcast is the host's
 * alone, and a slot is a private pipe between the host and the one member holding it. Routing
 * follows the directory, so a host change needs nothing from this side beyond knowing about it:
 * `rewire` only updates who this browser believes is hosting.
 *
 * Nothing here knows what the messages mean; the host runtime and `OnlineClient` sit on top.
 */
export class RelayRoomConnection implements OnlineRoomConnection {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private membership: RoomMembership | null = null;
  private closedOnPurpose = false;

  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private messageListeners = new Set<(message: OnlineMessages, slot: number | null) => void>();
  private slotClosedListeners = new Set<(slot: number) => void>();
  private lostListeners = new Set<() => void>();

  public constructor(
    private readonly roomCode: string,
    private readonly participantId: string,
  ) {}

  public getMembership = () => this.membership;
  public getSessionId = () => this.sessionId;
  public isConnected = () => this.socket?.readyState === WebSocket.OPEN && this.membership !== null;

  public onLost = (listener: () => void) => {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  };

  public join = async ({ create = false } = {}): Promise<OnlineJoinOutcome> => {
    await this.open();
    const result = await this.request<JoinRoomResponse>({
      t: 'join',
      code: this.roomCode,
      participantId: this.participantId,
      create,
      // Absent on a first join; on every later one it proves the membership is ours
      secret: getMembershipSecret(this.roomCode),
    });
    if (!result.ok) {
      this.close();
      return { ok: false, reason: result.reason };
    }
    setMembershipSecret(this.roomCode, result.secret);
    this.membership = {
      isHost: result.isHost,
      hostSessionId: result.hostSessionId,
      epoch: result.epoch,
      slot: result.slot,
    };
    return { ok: true, membership: this.membership };
  };

  /** The relay routes by the directory, so following a new host is only a change of belief here. */
  public rewire = async (membership: RoomMembership) => {
    this.membership = membership;
  };

  public promote = () => {
    const membership = this.membership;
    if (!membership) return Promise.reject(new Error('Not in a room'));
    return this.request<PromoteHostResponse>({
      t: 'promote',
      fromEpoch: membership.epoch,
      // The epoch is public in room state, so on its own it proves nothing
      secret: getMembershipSecret(this.roomCode) ?? '',
    });
  };

  // Best-effort, all three: a missed keepalive costs nothing against a 30-minute expiry, and a closing
  // tab may never get its leave out, which is why the host also hears when a slot's socket closes.
  public keepalive = () => this.request({ t: 'keepalive' }).catch(() => undefined);

  public leave = () => this.request({ t: 'leave', participantId: this.participantId }).catch(() => undefined);

  public releaseSlot = (participantId: string, ban = false) =>
    this.request({ t: 'leave', participantId, ban }).catch(() => undefined);

  /** Host: one send the relay delivers to everyone else in the room. */
  public broadcast = (message: OnlineMessages) => this.send({ t: 'broadcast', payload: message });

  /** Host: down a participant's slot. Client: up its own, the only one the relay lets it write. */
  public sendToSlot = (slot: number, message: OnlineMessages) => this.send({ t: 'slot', slot, payload: message });

  public onMessage = (listener: (message: OnlineMessages, slot: number | null) => void) => {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  };

  public onSlotClosed = (listener: (slot: number) => void) => {
    this.slotClosedListeners.add(listener);
    return () => this.slotClosedListeners.delete(listener);
  };

  public close = () => {
    this.closedOnPurpose = true;
    this.socket?.close();
    this.socket = null;
    this.membership = null;
    this.messageListeners.clear();
    this.slotClosedListeners.clear();
    this.lostListeners.clear();
    this.failPending('Connection closed');
  };

  private open = () =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(apiSocketUrl('/online'));
      this.socket = socket;
      let welcomed = false;

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        let frame: RelayFrame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (frame.t === 'welcome') {
          this.sessionId = frame.sessionId;
          welcomed = true;
          resolve();
        } else if (frame.t === 'reply') {
          const request = this.pending.get(frame.id);
          this.pending.delete(frame.id);
          if (frame.error) request?.reject(new Error(frame.error));
          else request?.resolve(frame.result);
        } else if (frame.t === 'message') {
          this.messageListeners.forEach((listener) => listener(frame.payload, frame.slot));
        } else if (frame.t === 'slot-closed') {
          this.slotClosedListeners.forEach((listener) => listener(frame.slot));
        }
      });

      socket.addEventListener('close', () => {
        if (!welcomed) reject(new Error('Could not reach the online relay'));
        this.failPending('Connection lost');
        if (this.socket === socket && !this.closedOnPurpose) this.lostListeners.forEach((listener) => listener());
      });
    });

  private request = <T = unknown>(message: object): Promise<T> => {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The online relay did not answer'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ ...message, id }));
    });
  };

  private send = (message: object) => {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  };

  private failPending = (reason: string) => {
    this.pending.forEach((request) => request.reject(new Error(reason)));
    this.pending.clear();
  };
}
