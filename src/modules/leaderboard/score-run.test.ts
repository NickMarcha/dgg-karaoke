import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GAME_MODE, SingSetup } from '~/interfaces';
import GameState from '~/modules/game-engine/game-state/game-state';
import { decodeNotesPayload, encodeNotesPayload } from '~/modules/leaderboard/notes-payload';
import getSongBeatLength from '~/modules/songs/utils/get-song-beat-length';
import isNotesSection from '~/modules/songs/utils/is-notes-section';
import pitchToFrequency from '~/modules/utils/pitch-to-frequency';

import { scoreRun, songForScoring } from './score-run';

const song = songForScoring(readFileSync('./tests/fixtures/songs/e2e-multitrack-polish-1994.txt', 'utf-8'));

/** A singer who wavers, drifts off pitch, breathes and misses notes: readings every 23 ms or so. */
function sing(playerCount: number, tolerance: number) {
  const singSetup = {
    id: 'setup',
    mode: GAME_MODE.DUEL,
    tolerance,
    players: Array.from({ length: playerCount }, (_, number) => ({ number, track: number % 2 })),
  } as SingSetup;
  GameState.setSong(song);
  GameState.setSingSetup(singSetup);
  const player = GameState.getPlayer(0)!;
  const track = player.getTrack();
  const beatLength = getSongBeatLength(song);
  const notes = track.sections.filter(isNotesSection).flatMap((section) => section.notes);
  const end = (notes.at(-1)!.start + notes.at(-1)!.length + 4) * beatLength;

  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let timestamp = -200; timestamp < end; timestamp += 20 + random() * 6) {
    const note = notes.find(
      (candidate) =>
        candidate.start * beatLength <= timestamp + 60 &&
        (candidate.start + candidate.length) * beatLength >= timestamp - 60,
    );
    const roll = random();
    const pitch = note ? note.pitch + (roll < 0.15 ? 3 : roll < 0.25 ? -2 : 0) : 60;
    const frequency = roll > 0.9 ? 0 : pitchToFrequency(pitch) * (1 + (random() - 0.5) * 0.02);
    player.updatePlayerNotes(timestamp, frequency);
  }
  return { player, mergedTrack: GameState.isMergedTrack() };
}

describe('scoreRun', () => {
  it.each([
    ['alone, on the merged track, on Medium', 1, 2],
    ['in a duet, on their own track, on Hard', 2, 1],
    ['in a group of three, on Easy', 3, 3],
  ])('gives the score the game gave a singer %s, from the notes the game packed', (_, playerCount, tolerance) => {
    const { player, mergedTrack } = sing(playerCount, tolerance);
    const gameScore = Math.round(player.getScore());
    const records = decodeNotesPayload(encodeNotesPayload(player.getPlayerNotes()));

    expect(gameScore).toBeGreaterThan(0);
    expect(scoreRun(song, { trackIndex: player.getTrackIndex(), mergedTrack, tolerance, records })).toBe(gameScore);
  });

  it('scores a run against the track it was not sung on as something else', () => {
    const { player } = sing(2, 2);
    const records = decodeNotesPayload(encodeNotesPayload(player.getPlayerNotes()));

    const sung = scoreRun(song, { trackIndex: 0, mergedTrack: false, tolerance: 2, records });
    expect(scoreRun(song, { trackIndex: 1, mergedTrack: false, tolerance: 2, records })).not.toBe(sung);
  });
});
