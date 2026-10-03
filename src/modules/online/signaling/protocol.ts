/**
 * Shared contract between the browser and the online relay on our API (server/src/online/), which
 * carries the room's messages and keeps the room directory: who is in a room, which slot each of
 * them holds, and who hosts. The room itself runs in the host's browser.
 *
 * The server is a separate package and keeps its own copies of the constants below;
 * `protocol.test.ts` reads them out of its source so the two cannot drift.
 */

/** Rooms are capped at ONLINE_MAX_PLAYERS, one slot each. Kept in sync with it by a test. */
export const ONLINE_SLOT_COUNT = 6;

/**
 * The first character of a room code: a digit, left over from when the all-letter codes belonged to
 * the PartyKit room server this one replaced. 0 and 1 are left out, because they read as O and l,
 * and the code is read out across a room and typed on phones.
 */
export const P2P_ROOM_CODE_LEADS = '23456789';

/** A room code in full: a lead digit and four lowercase letters, five characters like every room
 * code (`ONLINE_ROOM_CODE_LENGTH`, kept in sync by a test). The directory refuses anything else. */
export const P2P_ROOM_CODE_PATTERN = /^[2-9][a-z]{4}$/;

/** How often the host tells the directory its room is still in use. The directory forgets a room
 * after 30 idle minutes, so a couple of missed beats are harmless. */
export const DIRECTORY_KEEPALIVE_MS = 5 * 60 * 1_000;

export type JoinRejectedReason = 'room-full' | 'not-found' | 'banned' | 'not-authorized';

/**
 * The directory's answer to a join. A participant id is not a credential: it is published to the
 * whole room in `room-state`. So the directory mints a secret on a membership's first join and wants
 * it on every later call acting on that membership.
 */
export type JoinRoomResponse =
  | {
      ok: true;
      /** True when this participant is the one that has to run the room logic. */
      isHost: boolean;
      /** The host's relay session. Equals the caller's own when `isHost`. */
      hostSessionId: string;
      /** Bumped on every host change; carried into a promotion claim so two singers reacting to
       * the same stall cannot both win. */
      epoch: number;
      /** The slot this participant owns for the lifetime of its membership. */
      slot: number;
      /** This membership's secret, minted on the first join and returned unchanged afterwards. */
      secret: string;
    }
  | { ok: false; reason: JoinRejectedReason };

/** A client that saw the host go quiet claims the role. Accepted only if its epoch is still current
 * and its secret matches; a rejection carries the winner's session, so the loser can follow it. */
export type PromoteHostResponse =
  | { ok: true; epoch: number }
  | {
      ok: false;
      reason: 'stale-epoch' | 'not-a-member' | 'not-authorized';
      epoch: number;
      hostSessionId: string | null;
    };

/** `GET /online/room/:code`, which lets the join screen check a code without claiming a slot. */
export interface RoomInfoResponse {
  created: boolean;
  hostSessionId: string | null;
  epoch: number;
}
