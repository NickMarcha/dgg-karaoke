import { randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * The online-mode room directory: who is in a room, which slot each of them holds, and who is
 * hosting. Ported from the Cloudflare Durable Object it replaces, rules unchanged.
 *
 * Trust model: a participant id proves nothing, because it is published to the whole room in
 * `room-state`. What a membership is held by is the secret minted here on its first join. Rejoining
 * a membership or promoting it requires that secret; removing somebody else requires being the
 * current host. The room logic's ban list in the host's browser remains the defence against a
 * griefer who simply joins legitimately.
 *
 * Kept in memory, where the relay reads it on every message, and written through to a store so a
 * restart of the API does not end the rooms in progress. Calls for one room run one at a time,
 * which is what makes the epoch check on `promote` a real compare-and-swap.
 */

/** Mirrors `ONLINE_SLOT_COUNT` in src/modules/online/signaling/protocol.ts. */
export const ONLINE_SLOT_COUNT = 6;
/** Mirrors `P2P_ROOM_CODE_PATTERN` in src/modules/online/signaling/protocol.ts. */
export const ROOM_CODE_PATTERN = /^[2-9][a-z]{4}$/;
/** A room is forgotten this long after the last call touching it; the host's keepalive holds a live one open. */
export const DIRECTORY_TTL_MS = 30 * 60 * 1_000;

export interface Member {
  participantId: string;
  sessionId: string;
  slot: number;
  secret: string;
}

export interface RoomState {
  created: boolean;
  bannedIds: string[];
  epoch: number;
  hostParticipantId: string | null;
  hostSessionId: string | null;
  members: Member[];
  lastActivityAt: number;
}

export interface RoomStore {
  load(code: string): Promise<RoomState | null>;
  save(code: string, state: RoomState): Promise<void>;
  /** Forgets rooms untouched since `before`, returning their codes. */
  expire(before: number): Promise<string[]>;
}

export type JoinRejectedReason = 'room-full' | 'not-found' | 'banned' | 'not-authorized';

export type JoinResult =
  | { ok: true; isHost: boolean; hostSessionId: string; epoch: number; slot: number; secret: string }
  | { ok: false; reason: JoinRejectedReason };

export type PromoteResult =
  | { ok: true; epoch: number }
  | {
      ok: false;
      reason: 'stale-epoch' | 'not-a-member' | 'not-authorized';
      epoch: number;
      hostSessionId: string | null;
    };

export interface RoomInfo {
  created: boolean;
  hostSessionId: string | null;
  epoch: number;
}

const emptyState = (now: number): RoomState => ({
  created: false,
  bannedIds: [],
  epoch: 0,
  hostParticipantId: null,
  hostSessionId: null,
  members: [],
  lastActivityAt: now,
});

/** A membership with no secret, or a wrong one, matches nothing. Compared in constant time. */
const secretMatches = (stored: string | undefined, presented: string | undefined): boolean => {
  if (!stored || !presented) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class OnlineDirectory {
  private rooms = new Map<string, RoomState>();
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: RoomStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** The room as the relay routes it, or undefined if nobody has joined it since this process started. */
  public peek = (code: string): RoomState | undefined => this.rooms.get(code);

  public info = (code: string): Promise<RoomInfo> =>
    this.withRoom(code, (state) => ({
      created: state.created,
      hostSessionId: state.hostSessionId,
      epoch: state.epoch,
    }));

  public join = (code: string, participantId: string, sessionId: string, create: boolean, secret?: string) =>
    this.withRoom(code, async (state): Promise<JoinResult> => {
      if (state.bannedIds.includes(participantId)) return { ok: false, reason: 'banned' };
      if (!state.created) {
        if (!create) return { ok: false, reason: 'not-found' };
        state.created = true;
      }

      // A rejoin keeps the slot it already owns, or a reconnecting singer would use a second one
      const existing = state.members.find((member) => member.participantId === participantId);
      if (existing) {
        // The secret is what makes this a rejoin rather than a takeover of somebody else's seat
        if (!secretMatches(existing.secret, secret)) return { ok: false, reason: 'not-authorized' };
        existing.sessionId = sessionId;
        if (state.hostParticipantId === participantId) {
          // The host is back on a new session; a new epoch tells everyone to follow it
          state.hostSessionId = sessionId;
          state.epoch += 1;
        }
      } else {
        const slot = freeSlot(state);
        if (slot === null) return { ok: false, reason: 'room-full' };
        state.members.push({ participantId, sessionId, slot, secret: randomUUID() });
      }

      if (state.hostParticipantId === null) {
        state.hostParticipantId = participantId;
        state.hostSessionId = sessionId;
        state.epoch += 1;
      }
      await this.persist(code, state);

      const member = state.members.find((entry) => entry.participantId === participantId)!;
      return {
        ok: true,
        isHost: state.hostParticipantId === participantId,
        hostSessionId: state.hostSessionId!,
        epoch: state.epoch,
        slot: member.slot,
        secret: member.secret,
      };
    });

  /**
   * Removes a participant, optionally banning them. Anyone may release their own slot; only the
   * current host may remove or ban somebody else.
   */
  public leave = (
    code: string,
    participantId: string,
    requestedBy: { participantId: string; sessionId: string },
    ban = false,
  ) =>
    this.withRoom(code, async (state) => {
      const requester = state.members.find(
        (member) => member.participantId === requestedBy.participantId && member.sessionId === requestedBy.sessionId,
      );
      if (!requester) return;
      const isHost = state.hostParticipantId === requester.participantId;
      const isSelf = requester.participantId === participantId;
      if (!isSelf && !isHost) return;
      if (ban && !isHost) return;

      const before = state.members.length;
      state.members = state.members.filter((member) => member.participantId !== participantId);
      // A ban is recorded even for somebody already gone: the point is that they cannot come back
      if (ban && !state.bannedIds.includes(participantId)) state.bannedIds.push(participantId);
      else if (state.members.length === before) return;
      electFallbackHost(state);
      await this.persist(code, state);
    });

  /**
   * A singer who watched the host go quiet takes over. `fromEpoch` is a compare-and-swap: of two
   * claims for the same stall, only the first wins, and the loser learns who did.
   */
  public promote = (code: string, participantId: string, sessionId: string, fromEpoch: number, secret?: string) =>
    this.withRoom(code, async (state): Promise<PromoteResult> => {
      const rejected = (reason: 'stale-epoch' | 'not-a-member' | 'not-authorized'): PromoteResult => ({
        ok: false,
        reason,
        epoch: state.epoch,
        hostSessionId: state.hostSessionId,
      });
      const member = state.members.find((entry) => entry.participantId === participantId);
      if (!member) return rejected('not-a-member');
      // Before the epoch: the epoch is public in room state and proves nothing on its own
      if (!secretMatches(member.secret, secret)) return rejected('not-authorized');
      if (fromEpoch !== state.epoch) return rejected('stale-epoch');

      // The outgoing host keeps its seat; it may only be a throttled background tab
      member.sessionId = sessionId;
      state.hostParticipantId = participantId;
      state.hostSessionId = sessionId;
      state.epoch += 1;
      await this.persist(code, state);
      return { ok: true, epoch: state.epoch };
    });

  /** Pushes the room's expiry out. The host calls it every few minutes. */
  public keepalive = (code: string) => this.withRoom(code, (state) => this.persist(code, state));

  /** Forgets rooms idle for longer than the TTL, in memory and in the store. */
  public expire = async () => {
    const codes = await this.store.expire(this.now() - DIRECTORY_TTL_MS);
    codes.forEach((code) => this.rooms.delete(code));
    for (const [code, state] of this.rooms) {
      if (state.lastActivityAt < this.now() - DIRECTORY_TTL_MS) this.rooms.delete(code);
    }
  };

  private persist = async (code: string, state: RoomState) => {
    state.lastActivityAt = this.now();
    await this.store.save(code, state);
  };

  private withRoom = <T>(code: string, operation: (state: RoomState) => T | Promise<T>): Promise<T> => {
    const run = async () => {
      let state = this.rooms.get(code);
      if (!state) {
        state = (await this.store.load(code)) ?? emptyState(this.now());
        this.rooms.set(code, state);
      }
      try {
        return await operation(state);
      } finally {
        // A code that was only looked up, or refused, is not kept: probing codes must not fill memory
        if (!state.created) this.rooms.delete(code);
      }
    };
    const previous = this.queues.get(code) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.queues.set(
      code,
      next.catch(() => undefined),
    );
    return next;
  };
}

const freeSlot = (state: RoomState): number | null => {
  const taken = new Set(state.members.map((member) => member.slot));
  for (let slot = 0; slot < ONLINE_SLOT_COUNT; slot++) {
    if (!taken.has(slot)) return slot;
  }
  return null;
};

/** If the host's seat is gone, the earliest remaining member hosts, so the room is never headless. */
const electFallbackHost = (state: RoomState) => {
  if (state.members.some((member) => member.participantId === state.hostParticipantId)) return;
  const next = state.members[0] ?? null;
  state.hostParticipantId = next?.participantId ?? null;
  state.hostSessionId = next?.sessionId ?? null;
  if (next) state.epoch += 1;
};

/** For tests and for running without a database. */
export class MemoryRoomStore implements RoomStore {
  private rows = new Map<string, RoomState>();
  public load = async (code: string) => structuredClone(this.rows.get(code) ?? null);
  public save = async (code: string, state: RoomState) => {
    this.rows.set(code, structuredClone(state));
  };
  public expire = async (before: number) => {
    const gone = [...this.rows].filter(([, state]) => state.lastActivityAt < before).map(([code]) => code);
    gone.forEach((code) => this.rows.delete(code));
    return gone;
  };
}
