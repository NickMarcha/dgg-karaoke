import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ONLINE_ROOM_CODE_LENGTH } from '~/modules/online/protocol/consts';
import { ONLINE_SLOT_COUNT, P2P_ROOM_CODE_LEADS, P2P_ROOM_CODE_PATTERN } from '~/modules/online/signaling/protocol';
import { ONLINE_MAX_PLAYERS } from '~/modules/players/player-number';

describe('online protocol', () => {
  it('has exactly one slot per possible singer', () => {
    // Fewer slots than players would make a room reject a singer the room logic would have accepted
    expect(ONLINE_SLOT_COUNT).toBe(ONLINE_MAX_PLAYERS);
  });

  it('holds room codes to the same length as every room code, and to exactly the marks the app uses', () => {
    const letters = 'k'.repeat(ONLINE_ROOM_CODE_LENGTH - 1);
    for (const lead of P2P_ROOM_CODE_LEADS) expect(`${lead}${letters}`).toMatch(P2P_ROOM_CODE_PATTERN);
    for (const lead of '01abz') expect(`${lead}${letters}`).not.toMatch(P2P_ROOM_CODE_PATTERN);
    expect(`2${letters}k`).not.toMatch(P2P_ROOM_CODE_PATTERN);
  });

  it('agrees with the server about slots and codes', () => {
    // The server is a separate package that cannot import these, so its source is read instead
    const directory = readFileSync('server/src/online/directory.ts', 'utf-8');
    expect(directory).toContain(`export const ONLINE_SLOT_COUNT = ${ONLINE_SLOT_COUNT};`);
    expect(directory).toContain(`export const ROOM_CODE_PATTERN = ${P2P_ROOM_CODE_PATTERN};`);
  });
});
