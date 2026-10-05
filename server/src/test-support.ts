import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PlayerNote } from '~/interfaces';
import { addFrequencyRecord } from '~/modules/game-engine/game-state/helpers/append-frequency-to-player-notes';
import { encodeNotesPayload } from '~/modules/leaderboard/notes-payload';
import { songForScoring } from '~/modules/leaderboard/score-run';
import getSongBeatLength from '~/modules/songs/utils/get-song-beat-length';
import isNotesSection from '~/modules/songs/utils/is-notes-section';
import pitchToFrequency from '~/modules/utils/pitch-to-frequency';

import { createApp } from './app.js';
import { Auth } from './auth.js';
import type { Database } from './db.js';
import { parseEnv } from './env.js';
import { Charts } from './leaderboard/charts.js';
import { OnlineDirectory } from './online/directory.js';
import { PostgresRoomStore } from './online/room-store.js';
import { sessions, type UserRole, users } from './schema.js';
import { SocketTickets } from './socket-tickets.js';
import { Songs } from './songs/songs.js';

/** The e2e specs' songs, which the tests sing: the site's files, as far as the API can tell. */
const songFile = (songId: string) => new URL(`../../tests/fixtures/songs/${songId}.txt`, import.meta.url);
export const SUNG_SONG_ID = 'e2e-single-english-1995';

const testCharts = (database: Database) =>
  new Charts({
    siteOrigin: 'http://site.test',
    publishedTxt: (songId) => new Songs(database).publishedTxt(songId),
    fetchImpl: async (input) => {
      const songId = decodeURIComponent(String(input).match(/\/songs\/(.+)\.txt$/)?.[1] ?? '');
      try {
        return new Response(readFileSync(songFile(songId), 'utf-8'), { headers: { 'content-type': 'text/plain' } });
      } catch {
        return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
      }
    },
  });

/**
 * A run of a fixture song as the game packs it: the first `share` of its notes sung on pitch, a
 * reading every 20 ms, so a bigger share scores more. The API puts the score on it.
 */
export function sungRun({ songId = SUNG_SONG_ID, share = 1, tolerance = 2 } = {}) {
  const song = songForScoring(readFileSync(songFile(songId), 'utf-8'));
  const beatLength = getSongBeatLength(song);
  const notes = song.mergedTrack.sections.filter(isNotesSection).flatMap((section) => section.notes);
  const playerNotes: PlayerNote[] = [];
  for (const note of notes.slice(0, Math.round(notes.length * share))) {
    for (let ms = note.start * beatLength; ms < (note.start + note.length) * beatLength; ms += 20) {
      const record = { timestamp: ms, frequency: pitchToFrequency(note.pitch) };
      addFrequencyRecord(playerNotes, song.mergedTrack, record, beatLength, tolerance);
    }
  }
  return {
    songId,
    tolerance,
    mode: 'REGULAR',
    trackIndex: 0,
    mergedTrack: true,
    inputLag: 180,
    notes: encodeNotesPayload(playerNotes),
  };
}

/** For the integration tests: the API's routes over a real database, served to `app.request`. */
export function createTestApp(database: Database, { dailyPool = async () => [] as string[] } = {}) {
  const env = parseEnv({
    DATABASE_URL: 'postgresql://unused',
    APP_ORIGIN: 'http://localhost:3000',
    DGG_CLIENT_ID: 'client',
    DGG_CLIENT_SECRET: 'secret',
    DGG_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  });
  return createApp({
    appOrigins: ['http://localhost:3000'],
    auth: new Auth({ database, env }),
    secureCookies: false,
    signInRequired: true,
    tickets: new SocketTickets(),
    database,
    directory: new OnlineDirectory(new PostgresRoomStore(database)),
    dailyPool,
    charts: testCharts(database),
  });
}

/** The headers of a request from the site itself. */
export const site = { origin: 'http://localhost:3000', 'content-type': 'application/json' };

/** A user who has signed in, and the cookie their browser holds. */
export async function signedInAccount(
  database: Database,
  username: string,
  { role = 'singer', flair = null }: { role?: UserRole; flair?: string | null } = {},
) {
  const [user] = await database
    .insert(users)
    .values({ dggUserId: username, username, role, flair, dggStatus: 'Active' })
    .returning({ id: users.id });
  const token = `token-${username}`;
  await database.insert(sessions).values({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    userId: user!.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user!.id, cookie: `dgg_karaoke_session=${token}` };
}
