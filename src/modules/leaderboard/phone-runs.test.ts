import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_MODE, SingSetup, Song } from '~/interfaces';
import { QUALIFYING_SCORE } from '~/modules/leaderboard/consts';
import { decodeNotesPayload } from '~/modules/leaderboard/notes-payload';

import { sendPhoneRuns } from './phone-runs';

const game = vi.hoisted(() => ({
  players: [] as { number: number; input: { source: string; deviceId?: string } }[],
  states: new Map<number, { score: number; notes: unknown[] }>(),
  teamScore: 0,
  callClient: vi.fn(),
}));

vi.mock('~/modules/players/players-manager', () => ({ default: { getPlayers: () => game.players } }));
vi.mock('~/modules/remote-mic/network/server', () => ({ default: { callClient: game.callClient } }));
vi.mock('~/modules/game-engine/input/input-manager', () => ({ default: { getPlayerInputLag: () => 180 } }));
vi.mock('~/modules/game-engine/game-state/game-state', () => ({
  default: {
    getTolerance: () => 2,
    // What co-op shows: the team's average, which is nobody's own run
    getPlayerScore: () => game.teamScore,
    getPlayer: (number: number) => {
      const state = game.states.get(number);
      return state && { getScore: () => state.score, getPlayerNotes: () => state.notes, getTrackIndex: () => 0 };
    },
  },
}));

const song = { id: 'artist-title', artist: 'Artist', title: 'Title' } as Song;
const singSetup = { id: 'setup', mode: GAME_MODE.CO_OP, tolerance: 2, players: [] } as SingSetup;
const sung = [{ frequencyRecords: [{ timestamp: 1, frequency: 440 }] }];

describe('sendPhoneRuns', () => {
  beforeEach(() => {
    game.callClient.mockClear();
    game.players = [
      { number: 0, input: { source: 'Remote Microphone', deviceId: 'phone' } },
      { number: 1, input: { source: 'Microphone', deviceId: 'default' } },
    ];
    game.states.clear();
  });

  it("hands a phone its singer's own run when it is good enough", () => {
    game.states.set(0, { score: QUALIFYING_SCORE + 1, notes: sung });

    sendPhoneRuns(song, singSetup);

    expect(game.callClient).toHaveBeenCalledOnce();
    const [phone, method, run] = game.callClient.mock.calls[0]!;
    expect([phone, method, run.score]).toEqual(['phone', 'leaderboardRun', QUALIFYING_SCORE + 1]);
    expect(decodeNotesPayload(run.notes)).toHaveLength(1);
  });

  it("does not hand a phone the team's score for a run it did not sing", () => {
    game.states.set(0, { score: 0, notes: [] });
    game.states.set(1, { score: QUALIFYING_SCORE * 2, notes: sung });
    game.teamScore = QUALIFYING_SCORE;

    sendPhoneRuns(song, singSetup);

    expect(game.callClient).not.toHaveBeenCalled();
  });
});
