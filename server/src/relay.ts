import { pack, unpack } from 'msgpackr';

/**
 * The remote-microphone relay. A game (the host) opens a room under its game code, phones join it,
 * and the relay passes messages between them without reading what is inside. The protocol is the
 * one the frontend's WebSocket transport already speaks (`src/modules/remote-mic/network`):
 *
 *   host  -> relay  { t: 'register-room', id }
 *   phone -> relay  { t: 'register-player', id, roomId }      relay -> phone { t: 'connected' }
 *   host  -> relay  { t: 'forward', recipients, payload }      relay -> phone { t: 'forward', sender: roomId, payload }
 *   phone -> relay  { t: 'forward', recipients, payload }      relay -> host  { t: 'forward', sender: phoneId, payload }
 *   host  -> relay  { t: 'ping' }                              relay -> host  { t: 'pong' }
 *   host  -> relay  { t: 'remove-player', id }                 the phone is closed with `player-removed`
 *   a phone's socket closes                                    relay -> host  { t: 'forward', sender: phoneId, payload: { t: 'unregister' } }
 *
 * The last line is the relay speaking for the phone: a phone that reloads or loses signal never sends
 * `unregister` itself, and the game shows that singer as gone the moment it arrives.
 *
 * A room lives exactly as long as its host's socket. When the host goes, its phones are closed too and
 * retry on their own until the host is back, so a host reload never leaves phones attached to nothing.
 */

export interface Peer {
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

/** Close reasons the phone and the game understand; the phone parses `{ error }` out of the reason. */
export const CloseReason = {
  gameNotFound: 'game-not-found',
  hostLeft: 'host-left',
  playerRemoved: 'player-removed',
  /** The same phone id joined again; the older socket takes a new id (another tab on that phone). */
  unavailableId: 'unavailable-id',
  /** Another game already holds this code; the game picks a new one. */
  roomTaken: 'room-taken',
  badMessage: 'bad-message',
} as const;

const CLOSE_CODE = 4000;

interface Room {
  host: Peer;
  players: Map<string, Peer>;
}

type Role = { kind: 'host'; roomId: string } | { kind: 'player'; roomId: string; playerId: string };

type Incoming =
  | { t: 'register-room'; id: string }
  | { t: 'register-player'; id: string; roomId: string }
  | { t: 'forward'; recipients?: unknown; payload: unknown }
  | { t: 'remove-player'; id: string }
  | { t: 'ping' };

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function closeWith(peer: Peer, reason: string) {
  peer.close(CLOSE_CODE, JSON.stringify({ error: reason }));
}

export class Relay {
  private rooms = new Map<string, Room>();
  private roles = new Map<Peer, Role>();

  public roomCount() {
    return this.rooms.size;
  }

  public receive(peer: Peer, data: Uint8Array) {
    let message: Incoming;
    try {
      message = unpack(data);
    } catch {
      closeWith(peer, CloseReason.badMessage);
      return;
    }
    if (typeof message !== 'object' || message === null) return;

    const role = this.roles.get(peer);
    if (!role) {
      if (message.t === 'register-room') this.registerRoom(peer, message.id);
      else if (message.t === 'register-player') this.registerPlayer(peer, message.id, message.roomId);
      return;
    }

    if (role.kind === 'host') this.fromHost(peer, role.roomId, message);
    else this.fromPlayer(role, message);
  }

  public disconnect(peer: Peer) {
    const role = this.roles.get(peer);
    this.roles.delete(peer);
    if (!role) return;
    const room = this.rooms.get(role.roomId);
    if (!room) return;

    if (role.kind === 'host') {
      if (room.host !== peer) return;
      this.rooms.delete(role.roomId);
      for (const player of room.players.values()) {
        this.roles.delete(player);
        closeWith(player, CloseReason.hostLeft);
      }
    } else if (room.players.get(role.playerId) === peer) {
      room.players.delete(role.playerId);
      room.host.send(pack({ t: 'forward', sender: role.playerId, payload: { t: 'unregister' } }));
    }
  }

  private registerRoom(peer: Peer, roomId: unknown) {
    if (typeof roomId !== 'string' || !ID_PATTERN.test(roomId)) return closeWith(peer, CloseReason.badMessage);
    if (this.rooms.has(roomId)) return closeWith(peer, CloseReason.roomTaken);
    this.rooms.set(roomId, { host: peer, players: new Map() });
    this.roles.set(peer, { kind: 'host', roomId });
  }

  private registerPlayer(peer: Peer, playerId: unknown, roomId: unknown) {
    if (typeof playerId !== 'string' || typeof roomId !== 'string' || !ID_PATTERN.test(playerId)) {
      return closeWith(peer, CloseReason.badMessage);
    }
    const room = this.rooms.get(roomId.toLowerCase());
    if (!room) return closeWith(peer, CloseReason.gameNotFound);

    const previous = room.players.get(playerId);
    if (previous) {
      this.roles.delete(previous);
      closeWith(previous, CloseReason.unavailableId);
    }
    room.players.set(playerId, peer);
    this.roles.set(peer, { kind: 'player', roomId: roomId.toLowerCase(), playerId });
    peer.send(pack({ t: 'connected' }));
  }

  private fromHost(peer: Peer, roomId: string, message: Incoming) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (message.t === 'ping') {
      peer.send(pack({ t: 'pong' }));
    } else if (message.t === 'forward' && Array.isArray(message.recipients)) {
      const packed = pack({ t: 'forward', sender: roomId, payload: message.payload });
      for (const recipient of message.recipients) {
        if (typeof recipient === 'string') room.players.get(recipient)?.send(packed);
      }
    } else if (message.t === 'remove-player' && typeof message.id === 'string') {
      const player = room.players.get(message.id);
      if (!player) return;
      room.players.delete(message.id);
      this.roles.delete(player);
      closeWith(player, CloseReason.playerRemoved);
    }
  }

  private fromPlayer(role: Extract<Role, { kind: 'player' }>, message: Incoming) {
    if (message.t !== 'forward') return;
    this.rooms.get(role.roomId)?.host.send(pack({ t: 'forward', sender: role.playerId, payload: message.payload }));
  }
}
