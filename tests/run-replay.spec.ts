import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { pack } from 'msgpackr';

import { PlayerNote } from '~/interfaces';
import { addFrequencyRecord } from '~/modules/game-engine/game-state/helpers/append-frequency-to-player-notes';
import { encodeNotesPayload } from '~/modules/leaderboard/notes-payload';
import { songForScoring } from '~/modules/leaderboard/score-run';
import getSongBeatLength from '~/modules/songs/utils/get-song-beat-length';
import isNotesSection from '~/modules/songs/utils/is-notes-section';
import pitchToFrequency from '~/modules/utils/pitch-to-frequency';

import { initTestMode, mockSongs, signIn } from './helpers';

const songId = 'e2e-single-english-1995';

/** A run of the song as the game packs it, every third note sung sharp so the replay has misses in it. */
function sungNotes() {
  const song = songForScoring(readFileSync(`./tests/fixtures/songs/${songId}.txt`, 'utf-8'));
  const beatLength = getSongBeatLength(song);
  const notes = song.mergedTrack.sections.filter(isNotesSection).flatMap((section) => section.notes);
  const playerNotes: PlayerNote[] = [];
  notes.forEach((note, index) => {
    const frequency = pitchToFrequency(index % 3 === 2 ? note.pitch + 3 : note.pitch);
    for (let ms = note.start * beatLength; ms < (note.start + note.length) * beatLength; ms += 20) {
      addFrequencyRecord(playerNotes, song.mergedTrack, { timestamp: ms, frequency }, beatLength, 2);
    }
  });
  return encodeNotesPayload(playerNotes);
}

test.describe('Run replay', () => {
  test.use({ serviceWorkers: 'block' });

  test("replays a run over its song, reaching the board's score", async ({ page, context, baseURL }) => {
    test.slow();
    await initTestMode({ page, context });
    await mockSongs({ page, context });
    await signIn({ context }, `E2E replay ${Math.random().toString(36).slice(2, 8)}`);
    await page.goto('/?e2e-test');

    const run = { songId, tolerance: 2, mode: 'REGULAR', trackIndex: 0, mergedTrack: true, inputLag: 0 };
    const submitted = await page.request.post('/api/leaderboard', {
      headers: { 'content-type': 'application/msgpack', origin: new URL(baseURL!).origin },
      data: Buffer.from(pack({ ...run, notes: sungNotes() })),
    });
    expect(submitted.status()).toBe(201);
    const { score } = (await submitted.json()) as { score: number };

    const board = await (await page.request.get(`/api/leaderboard/song?songId=${songId}&tolerance=2`)).json();
    const { id } = board.entries.find((entry: { score: number }) => entry.score === score);

    await page.goto(`/run/?id=${id}`);
    await expect(page.getByTestId('run-replay')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('run-play').click();

    // The game's own scoring, fed the stored notes as the video reaches them, lands on the board's score
    await expect(page.getByTestId('run-replay-score')).toHaveAttribute('data-score', String(score), {
      timeout: 30_000,
    });
  });
});
