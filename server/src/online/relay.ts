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
 * The channel rules are the SFU's: the room broadcast is the host's alone, and a slot is a private
 * pipe between the host and the one member holding it. A socket replaced by a rejoin keeps its
 * connection but no longer receives or sends anything, because routing follows each member's
 * current session in the directory.
 */

export interface OnlinePeer {
  sessionId: string;
  send(message: object): void;
}

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
]);

type Incoming = z.infer<typeof incoming>;

interface Binding {
  code: string;
  participantId: string;
}

export class OnlineRelay {
  private peers = new Map<string, OnlinePeer>();
  private bindings = new Map<string, Binding>();

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
    const state = this.directory.peek(binding.code);
    const member = state?.members.find((entry) => entry.sessionId === peer.sessionId);
    // Only a member's current socket counts; one replaced by a rejoin closing tells nobody anything
    if (!state || !member || state.hostSessionId === peer.sessionId) return;
    this.hostOf(state)?.send({ t: 'slot-closed', slot: member.slot });
  }

  private async request(peer: OnlinePeer, message: Exclude<Incoming, { t: 'broadcast' | 'slot' }>) {
    if (message.t === 'join') {
      const joined = await this.directory.join(
        message.code,
        message.participantId,
        peer.sessionId,
        message.create ?? false,
        message.secret,
      );
      if (joined.ok) this.bindings.set(peer.sessionId, { code: message.code, participantId: message.participantId });
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
}
