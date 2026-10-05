import { z } from 'zod';

import { type OnlineDirectory, ROOM_CODE_PATTERN, type RoomState } from './directory.js';

/**
 * Online mode's message plane, replacing the Cloudflare Realtime SFU. The room's authority runs in
 * the host's browser; this only carries its messages and the directory calls that decide who may
 * send what. Protocol, JSON over one socket per browser:
 *
 *   relay -> any    { t: 'welcome', sessionId }                         on connect
 *   any   -> relay  { t: 'join' | 'promote' | 'leave' | 'keepalive', id, ... }
 *   relay -> any    { t: 'reply', id, result } | { t: 'reply', id, error }
 *   host  -> relay  { t: 'broadcast', payload }        relay -> others  { t: 'message', slot: null, payload }
 *   host  -> relay  { t: 'slot', slot, payload }       relay -> owner   { t: 'message', slot, payload }
 *   owner -> relay  { t: 'slot', slot, payload }       relay -> host    { t: 'message', slot, payload }
 *   relay -> host   { t: 'slot-closed', slot }         a member's current socket closed
 *
 * Streaming (docs/plans/stream-view.md): a moderator's OBS source watches the room its owner sings
 * in. Members ask to be on a stream and the streamer answers; the relay passes a member's live
 * data only to the streams that accepted them, so a stream carries nobody the streamer did not.
 *
 *   relay -> members  { t: 'stream-state', streams }   who streams the room, and who is on or asking
 *   member -> relay   { t: 'stream-request', streamerId, ask }
 *   streamer -> relay { t: 'stream-answer', participantId, accept }
 *   member -> relay   { t: 'stream-data', payload }     relay -> watchers { t: 'stream-data', ... }
 *   relay -> watcher  { t: 'stream-room', code }        the room its owner is in now, or null
 *
 * The channel rules are the SFU's: the room broadcast is the host's alone, and a slot is a private
 * pipe between the host and the one member holding it. A socket replaced by a rejoin keeps its
 * connection but no longer receives or sends anything, because routing follows each member's
 * current session in the directory.
 */

export interface OnlinePeer {
  sessionId: string;
  /** The destiny.gg account the socket was opened with, when it was opened signed in. */
  user?: { id: string; username: string } | null;
  send(message: object): void;
}

/** An OBS source following the room its owner sings in. */
export interface StreamWatcher {
  streamer: { id: string; username: string };
  send(message: object): void;
}

/** One streamer's lists in one room: participants on their stream, and those asking to be. */
interface StreamLists {
  accepted: Set<string>;
  requested: Set<string>;
}

/** A singer sends a tenth of a second of pitch readings (and later voice) at a time. */
const MAX_STREAM_DATA_LENGTH = 64 * 1024;

const id = z.union([z.string().max(64), z.number()]);
const participantId = z.string().min(1).max(64);
const code = z.string().regex(ROOM_CODE_PATTERN);
const slot = z.number().int().min(0).max(63);

const incoming = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    id,
    code,
    participantId,
    create: z.boolean().optional(),
    secret: z.string().max(128).optional(),
  }),
  z.object({ t: z.literal('promote'), id, fromEpoch: z.number().int(), secret: z.string().max(128) }),
  z.object({ t: z.literal('leave'), id, participantId, ban: z.boolean().optional() }),
  z.object({ t: z.literal('keepalive'), id }),
  z.object({ t: z.literal('broadcast'), payload: z.unknown() }),
  z.object({ t: z.literal('slot'), slot, payload: z.unknown() }),
  z.object({ t: z.literal('stream-request'), streamerId: z.string().max(64), ask: z.boolean() }),
  z.object({ t: z.literal('stream-answer'), participantId, accept: z.boolean() }),
  z.object({ t: z.literal('stream-data'), payload: z.unknown() }),
]);

type Incoming = z.infer<typeof incoming>;

interface Binding {
  code: string;
  participantId: string;
}

export class OnlineRelay {
  private peers = new Map<string, OnlinePeer>();
  private bindings = new Map<string, Binding>();
  /** OBS sources, by the moderator they belong to. */
  private watchers = new Map<string, Set<StreamWatcher>>();
  /** Each signed-in user's current member socket: the room their stream follows. */
  private userRooms = new Map<string, { code: string; sessionId: string }>();
  /** Room code to streamer id to that streamer's lists. */
  private streams = new Map<string, Map<string, StreamLists>>();

  constructor(private readonly directory: OnlineDirectory) {}

  public connect(peer: OnlinePeer) {
    this.peers.set(peer.sessionId, peer);
    peer.send({ t: 'welcome', sessionId: peer.sessionId });
  }

  public async receive(peer: OnlinePeer, raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = incoming.safeParse(parsed);
    if (!result.success) return;
    const message = result.data;

    if (message.t === 'broadcast') return this.broadcast(peer, message.payload);
    if (message.t === 'slot') return this.toSlot(peer, message.slot, message.payload);
    if (message.t === 'stream-request') return this.streamRequest(peer, message.streamerId, message.ask);
    if (message.t === 'stream-answer') return this.streamAnswer(peer, message.participantId, message.accept);
    if (message.t === 'stream-data') {
      if (raw.length <= MAX_STREAM_DATA_LENGTH) this.streamData(peer, message.payload);
      return;
    }

    try {
      peer.send({ t: 'reply', id: message.id, result: await this.request(peer, message) });
    } catch (error) {
      console.error('Online directory call failed', error);
      peer.send({ t: 'reply', id: message.id, error: 'unavailable' });
    }
  }

  public disconnect(peer: OnlinePeer) {
    this.peers.delete(peer.sessionId);
    const binding = this.bindings.get(peer.sessionId);
    this.bindings.delete(peer.sessionId);
    if (!binding) return;
    if (peer.user && this.userRooms.get(peer.user.id)?.sessionId === peer.sessionId) {
      this.userRooms.delete(peer.user.id);
      this.tellWatchers(peer.user.id, null);
      this.publishStreams(binding.code);
    }
    const state = this.directory.peek(binding.code);
    const member = state?.members.find((entry) => entry.sessionId === peer.sessionId);
    // Only a member's current socket counts; one replaced by a rejoin closing tells nobody anything
    if (!state || !member || state.hostSessionId === peer.sessionId) return;
    this.hostOf(state)?.send({ t: 'slot-closed', slot: member.slot });
  }

  private async request(
    peer: OnlinePeer,
    message: Exclude<Incoming, { t: 'broadcast' | 'slot' | 'stream-request' | 'stream-answer' | 'stream-data' }>,
  ) {
    if (message.t === 'join') {
      const joined = await this.directory.join(
        message.code,
        message.participantId,
        peer.sessionId,
        message.create ?? false,
        message.secret,
      );
      if (joined.ok) {
        this.bindings.set(peer.sessionId, { code: message.code, participantId: message.participantId });
        this.joinedAs(peer, message.code);
      }
      return joined;
    }

    const binding = this.bindings.get(peer.sessionId);
    if (!binding) return { ok: false, reason: 'not-a-member' };
    if (message.t === 'promote') {
      return this.directory.promote(
        binding.code,
        binding.participantId,
        peer.sessionId,
        message.fromEpoch,
        message.secret,
      );
    }
    if (message.t === 'leave') {
      await this.directory.leave(
        binding.code,
        message.participantId,
        { participantId: binding.participantId, sessionId: peer.sessionId },
        message.ban,
      );
      this.streams.get(binding.code)?.forEach((lists) => {
        lists.accepted.delete(message.participantId);
        lists.requested.delete(message.participantId);
      });
      this.publishStreams(binding.code);
      return { ok: true };
    }
    await this.directory.keepalive(binding.code);
    return { ok: true };
  }

  private broadcast(peer: OnlinePeer, payload: unknown) {
    const state = this.roomOf(peer);
    if (!state || state.hostSessionId !== peer.sessionId) return;
    for (const member of state.members) {
      if (member.sessionId !== peer.sessionId)
        this.peers.get(member.sessionId)?.send({ t: 'message', slot: null, payload });
    }
  }

  private toSlot(peer: OnlinePeer, slot: number, payload: unknown) {
    const state = this.roomOf(peer);
    if (!state) return;
    if (state.hostSessionId === peer.sessionId) {
      const owner = state.members.find((member) => member.slot === slot);
      if (owner) this.peers.get(owner.sessionId)?.send({ t: 'message', slot, payload });
      return;
    }
    const sender = state.members.find((member) => member.sessionId === peer.sessionId);
    if (sender?.slot === slot) this.hostOf(state)?.send({ t: 'message', slot, payload });
  }

  private roomOf(peer: OnlinePeer): RoomState | undefined {
    const binding = this.bindings.get(peer.sessionId);
    return binding ? this.directory.peek(binding.code) : undefined;
  }

  private hostOf(state: RoomState) {
    return state.hostSessionId ? this.peers.get(state.hostSessionId) : undefined;
  }

  /** An OBS source opened with its owner's key: it follows them from room to room until it closes. */
  public watch(watcher: StreamWatcher) {
    const id = watcher.streamer.id;
    this.watchers.set(id, (this.watchers.get(id) ?? new Set()).add(watcher));
    const room = this.userRooms.get(id);
    watcher.send({ t: 'stream-room', code: room?.code ?? null });
    if (room) this.publishStreams(room.code);
  }

  public unwatch(watcher: StreamWatcher) {
    const id = watcher.streamer.id;
    this.watchers.get(id)?.delete(watcher);
    if (!this.watchers.get(id)?.size) this.watchers.delete(id);
    const room = this.userRooms.get(id);
    if (room) this.publishStreams(room.code);
  }

  private joinedAs(peer: OnlinePeer, code: string) {
    if (peer.user) {
      const previous = this.userRooms.get(peer.user.id);
      this.userRooms.set(peer.user.id, { code, sessionId: peer.sessionId });
      if (previous?.code !== code) {
        this.tellWatchers(peer.user.id, code);
        if (previous) this.publishStreams(previous.code);
      }
    }
    this.publishStreams(code);
  }

  private tellWatchers(userId: string, code: string | null) {
    this.watchers.get(userId)?.forEach((watcher) => watcher.send({ t: 'stream-room', code }));
  }

  /** The moderators whose OBS source is following this room. */
  private streamersIn(code: string) {
    return [...this.watchers.entries()].flatMap(([id, watchers]) => {
      const room = this.userRooms.get(id);
      if (room?.code !== code) return [];
      const [{ streamer }] = watchers;
      return [{ ...streamer, participantId: this.bindings.get(room.sessionId)?.participantId ?? null }];
    });
  }

  private listsOf(code: string, streamerId: string) {
    const room = this.streams.get(code) ?? new Map<string, StreamLists>();
    this.streams.set(code, room);
    const lists = room.get(streamerId) ?? { accepted: new Set<string>(), requested: new Set<string>() };
    room.set(streamerId, lists);
    return lists;
  }

  private usernameOf(state: RoomState, participantId: string) {
    const member = state.members.find((entry) => entry.participantId === participantId);
    return (member && this.peers.get(member.sessionId)?.user?.username) ?? null;
  }

  /** Every member hears who streams the room and who is on each stream or asking to be. */
  private publishStreams(code: string) {
    const state = this.directory.peek(code);
    if (!state) {
      this.streams.delete(code);
      return;
    }
    const streams = this.streamersIn(code).map((streamer) => {
      const lists = this.listsOf(code, streamer.id);
      return {
        streamerId: streamer.id,
        streamer: streamer.username,
        streamerParticipantId: streamer.participantId,
        onStream: [...lists.accepted],
        requests: [...lists.requested].map((id) => ({ participantId: id, username: this.usernameOf(state, id) })),
      };
    });
    for (const member of state.members) this.peers.get(member.sessionId)?.send({ t: 'stream-state', streams });
  }

  private streamRequest(peer: OnlinePeer, streamerId: string, ask: boolean) {
    const binding = this.bindings.get(peer.sessionId);
    if (!binding || !this.streamersIn(binding.code).some((streamer) => streamer.id === streamerId)) return;
    const lists = this.listsOf(binding.code, streamerId);
    if (ask && !lists.accepted.has(binding.participantId)) lists.requested.add(binding.participantId);
    if (!ask) {
      lists.requested.delete(binding.participantId);
      lists.accepted.delete(binding.participantId);
    }
    this.publishStreams(binding.code);
  }

  /** Only the streamer answers for their own stream, from the room they stream. */
  private streamAnswer(peer: OnlinePeer, participantId: string, accept: boolean) {
    const binding = this.bindings.get(peer.sessionId);
    if (!binding || !peer.user || this.userRooms.get(peer.user.id)?.sessionId !== peer.sessionId) return;
    if (!this.streamersIn(binding.code).some((streamer) => streamer.id === peer.user!.id)) return;
    const lists = this.listsOf(binding.code, peer.user.id);
    lists.requested.delete(participantId);
    if (accept) lists.accepted.add(participantId);
    else lists.accepted.delete(participantId);
    this.publishStreams(binding.code);
  }

  /** A member's live singing, to the streams that accepted them: a streamer is always on their own. */
  private streamData(peer: OnlinePeer, payload: unknown) {
    const binding = this.bindings.get(peer.sessionId);
    if (!binding || !this.roomOf(peer)?.members.some((member) => member.sessionId === peer.sessionId)) return;
    const message = {
      t: 'stream-data',
      participantId: binding.participantId,
      username: peer.user?.username ?? null,
      payload,
    };
    for (const streamer of this.streamersIn(binding.code)) {
      const own = streamer.participantId === binding.participantId;
      if (own || this.streams.get(binding.code)?.get(streamer.id)?.accepted.has(binding.participantId)) {
        this.watchers.get(streamer.id)?.forEach((watcher) => watcher.send(message));
      }
    }
  }
}
