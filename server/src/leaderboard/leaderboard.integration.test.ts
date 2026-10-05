import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pack } from 'msgpackr';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { leaderboardNotes, leaderboardRecords, users } from '../schema.js';
import { createTestApp, signedInAccount, SUNG_SONG_ID, sungRun } from '../test-support.js';
import { QUALIFYING_SCORE } from './rules.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const site = { origin: 'http://localhost:3000', 'content-type': 'application/msgpack' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** How much of the song is sung on pitch: each scores more than the one before, all on the board. */
const WORST = 0.5;
const MIDDLING = 0.75;
const BEST = 1;

function submission(overrides: Record<string, unknown> = {}, share = MIDDLING) {
  const tolerance = (overrides.tolerance as number | undefined) ?? 2;
  return { ...sungRun({ share, tolerance }), ...overrides };
}

interface Entry {
  name: string;
  flair: string | null;
  score: number;
  artist: string;
  title: string;
}

interface SongBoard {
  entries: Entry[];
  total: number;
  startPosition: number;
  position: number | null;
}

describe.skipIf(!url)('leaderboard routes', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database);
  const account = async (username: string, flair: string | null = null) =>
    (await signedInAccount(database, username, { flair })).cookie;

  const submit = (cookie: string | null, body: unknown) =>
    app.request('/api/leaderboard', {
      method: 'POST',
      headers: cookie ? { ...site, cookie } : site,
      body: new Uint8Array(pack(body)),
    });

  const board = async () => ((await (await app.request('/api/leaderboard')).json()) as { entries: Entry[] }).entries;
  const songBoard = async (query: string) =>
    (await (await app.request(`/api/leaderboard/song?${query}`)).json()) as SongBoard;

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.delete(users);
  });

  afterAll(async () => {
    await database.delete(users);
    await database.$client.end();
  });

  it('puts a signed-in singer on the board under their destiny.gg name, with the score the API works out', async () => {
    const cookie = await account('Singer', 'flair13');

    const response = await submit(cookie, submission());
    expect(response.status).toBe(201);
    const { score } = (await response.json()) as { score: number };
    expect(score).toBeGreaterThanOrEqual(QUALIFYING_SCORE);
    expect(await board()).toEqual([
      expect.objectContaining({ name: 'Singer', flair: 'flair13', score, artist: 'Test', title: 'E2E' }),
    ]);
  });

  it('scores a run from its notes, whatever the game says the score and the song were', async () => {
    const cookie = await account('Singer');
    await submit(cookie, { ...submission({}, BEST), score: 1, title: 'Edited' });
    const everyNote = (await board())[0]!;
    expect(everyNote.title).toBe('E2E');

    await database.delete(leaderboardRecords);
    await submit(cookie, { ...submission({}, WORST), score: 3_500_000 });
    expect((await board())[0]!.score).toBeLessThan(everyNote.score);
  });

  it('keeps the run that produced the score', async () => {
    const cookie = await account('Singer');
    const run = submission();
    await submit(cookie, run);

    const [stored] = await database.select().from(leaderboardNotes);
    expect(new Uint8Array(stored!.notes)).toEqual(new Uint8Array(run.notes));
  });

  it("serves a run's notes and how it was sung, for its replay", async () => {
    const run = submission();
    await submit(await account('Singer'), run);
    const id = (await database.select().from(leaderboardRecords))[0]!.id;

    const details = await (await app.request(`/api/leaderboard/runs/${id}`)).json();
    expect(details).toEqual(expect.objectContaining({ trackIndex: 0, mergedTrack: true, tolerance: 2 }));
    const notes = await app.request(`/api/leaderboard/runs/${id}/notes`);
    expect(new Uint8Array(await notes.arrayBuffer())).toEqual(new Uint8Array(run.notes));
    expect((await app.request(`/api/leaderboard/runs/${crypto.randomUUID()}/notes`)).status).toBe(404);
  });

  it('takes no score from somebody who is not signed in', async () => {
    expect((await submit(null, submission())).status).toBe(401);
  });

  it('keeps one row per singer, song and difficulty: the best', async () => {
    const cookie = await account('Singer');
    const best = (await (await submit(cookie, submission({}, BEST))).json()) as { score: number };
    await submit(cookie, submission({}, WORST));
    await submit(cookie, submission({ tolerance: 1 }, WORST));

    const rows = await database.select().from(leaderboardRecords);
    expect(rows.map((row) => row.tolerance).sort()).toEqual([1, 2]);
    expect(rows.find((row) => row.tolerance === 2)!.score).toBe(best.score);
  });

  it('refuses what cannot be a sung run', async () => {
    const cookie = await account('Singer');

    const refused = [
      // A quarter of the song does not reach the board
      submission({}, 0.25),
      submission({ tolerance: 4 }),
      submission({ songId: 'no-such-song' }),
      submission({ notes: new Uint8Array(pack([1, 2, 3])) }),
      submission({ notes: new Uint8Array(pack(Array.from({ length: 150 }, () => 'x'))) }),
      submission({ mergedTrack: undefined }),
      { songId: SUNG_SONG_ID },
    ];
    for (const body of refused) expect((await submit(cookie, body)).status).toBe(400);
    expect(await database.select().from(leaderboardRecords)).toEqual([]);
  });

  it('ranks the main menu over the last fortnight, Medium and harder', async () => {
    await submit(await account('Hard'), submission({ tolerance: 1 }, MIDDLING));
    await submit(await account('Medium'), submission({}, WORST));
    await submit(await account('Easy'), submission({ tolerance: 3 }, BEST));
    await submit(await account('Old'), submission({}, BEST));
    await database
      .update(leaderboardRecords)
      .set({ createdAt: new Date(Date.now() - 15 * DAY_MS) })
      .where(eq(leaderboardRecords.score, (await board())[0]!.score));

    expect((await board()).map((entry) => entry.name)).toEqual(['Hard', 'Medium']);
  });

  it('refuses notes or a request larger than any song produces', async () => {
    const cookie = await account('Singer');
    const hugeNotes = submission({ notes: new Uint8Array(300 * 1024) });
    expect((await submit(cookie, hugeNotes)).status).toBe(400);

    const hugeRequest = submission({ recording: new Uint8Array(11 * 1024 * 1024) });
    expect((await submit(cookie, hugeRequest)).status).toBe(413);
  });

  it("ranks a song's board by difficulty, all time, around the score asked about", async () => {
    const singers = [
      ['First', BEST],
      ['Second', MIDDLING],
      ['Third', WORST],
    ] as const;
    for (const [name, share] of singers) await submit(await account(name), submission({}, share));
    await submit(await account('Other'), submission({ tolerance: 1 }, BEST));

    const top = await songBoard(`songId=${SUNG_SONG_ID}&tolerance=2`);
    expect(top).toEqual(expect.objectContaining({ total: 3, startPosition: 1, position: null }));
    expect(top.entries.map((entry) => entry.name)).toEqual(['First', 'Second', 'Third']);

    // A tie loses to the rows already there
    const placed = await songBoard(`songId=${SUNG_SONG_ID}&tolerance=2&score=${top.entries[1]!.score}`);
    expect(placed.position).toBe(3);
  });
});
