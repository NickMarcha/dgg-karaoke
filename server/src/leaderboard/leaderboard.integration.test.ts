import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pack } from 'msgpackr';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { leaderboardNotes, leaderboardRecords, users } from '../schema.js';
import { createTestApp, signedInAccount } from '../test-support.js';
import { QUALIFYING_SCORE } from './rules.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const site = { origin: 'http://localhost:3000', 'content-type': 'application/msgpack' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a sung run packs into: one record per frequency sample, here a steady hum. */
const notes = new Uint8Array(pack(Array.from({ length: 150 }, () => 1)));
const tooFewNotes = new Uint8Array(pack([1, 2, 3]));
const hash = (bytes: Uint8Array, score: number) =>
  createHash('sha256').update(bytes).update(String(score)).digest('hex');

function submission(overrides: Record<string, unknown> = {}) {
  const score = (overrides.score as number | undefined) ?? QUALIFYING_SCORE + 100;
  return {
    songId: 'artist-title',
    artist: 'Artist',
    title: 'Title',
    songLastUpdate: null,
    score,
    tolerance: 2,
    mode: 'REGULAR',
    trackIndex: 0,
    inputLag: 180,
    notes,
    notesHash: hash(notes, score),
    ...overrides,
  };
}

interface Entry {
  name: string;
  flair: string | null;
  score: number;
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

  it('puts a signed-in singer on the board under their destiny.gg name', async () => {
    const cookie = await account('Singer', 'flair13');

    expect((await submit(cookie, submission())).status).toBe(201);
    expect(await board()).toEqual([
      expect.objectContaining({ name: 'Singer', flair: 'flair13', score: QUALIFYING_SCORE + 100 }),
    ]);
  });

  it('keeps the run that produced the score', async () => {
    const cookie = await account('Singer');
    await submit(cookie, submission());

    const [stored] = await database.select().from(leaderboardNotes);
    expect(new Uint8Array(stored!.notes)).toEqual(notes);
  });

  it('takes no score from somebody who is not signed in', async () => {
    expect((await submit(null, submission())).status).toBe(401);
  });

  it('keeps one row per singer, song and difficulty: the best', async () => {
    const cookie = await account('Singer');
    await submit(cookie, submission({ score: QUALIFYING_SCORE + 500 }));
    await submit(cookie, submission({ score: QUALIFYING_SCORE + 100 }));
    await submit(cookie, submission({ score: QUALIFYING_SCORE + 100, tolerance: 1 }));

    const rows = await database.select().from(leaderboardRecords);
    expect(rows.map((row) => [row.tolerance, row.score]).sort()).toEqual([
      [1, QUALIFYING_SCORE + 100],
      [2, QUALIFYING_SCORE + 500],
    ]);
  });

  it('refuses what cannot be a sung run', async () => {
    const cookie = await account('Singer');

    const refused = [
      submission({ score: QUALIFYING_SCORE - 1 }),
      submission({ score: 3_500_001 }),
      submission({ score: QUALIFYING_SCORE + 0.5 }),
      submission({ tolerance: 4 }),
      submission({ notesHash: 'edited' }),
      submission({ notes: tooFewNotes, notesHash: hash(tooFewNotes, QUALIFYING_SCORE + 100) }),
      submission({ title: 'x'.repeat(201) }),
      { score: QUALIFYING_SCORE + 100 },
    ];
    for (const body of refused) expect((await submit(cookie, body)).status).toBe(400);
    expect(await database.select().from(leaderboardRecords)).toEqual([]);
  });

  it('ranks the main menu over the last fortnight, Medium and harder', async () => {
    await submit(await account('Hard'), submission({ score: QUALIFYING_SCORE + 300, tolerance: 1 }));
    await submit(await account('Medium'), submission({ score: QUALIFYING_SCORE + 200 }));
    await submit(await account('Easy'), submission({ score: QUALIFYING_SCORE + 900, tolerance: 3 }));
    await submit(await account('Old'), submission({ score: QUALIFYING_SCORE + 800 }));
    await database
      .update(leaderboardRecords)
      .set({ createdAt: new Date(Date.now() - 15 * DAY_MS) })
      .where(eq(leaderboardRecords.score, QUALIFYING_SCORE + 800));

    expect((await board()).map((entry) => entry.name)).toEqual(['Hard', 'Medium']);
  });

  it('refuses a run larger than any song produces', async () => {
    const cookie = await account('Singer');
    const huge = new Uint8Array(300 * 1024);
    expect(
      (await submit(cookie, submission({ notes: huge, notesHash: hash(huge, QUALIFYING_SCORE + 100) }))).status,
    ).toBe(413);
  });

  it("ranks a song's board by difficulty, all time, around the score asked about", async () => {
    for (const [index, name] of ['First', 'Second', 'Third'].entries()) {
      await submit(await account(name), submission({ score: QUALIFYING_SCORE + 300 - index * 100 }));
    }
    await submit(await account('Other'), submission({ score: QUALIFYING_SCORE + 900, tolerance: 1 }));

    const top = await songBoard('songId=artist-title&tolerance=2');
    expect(top).toEqual(expect.objectContaining({ total: 3, startPosition: 1, position: null }));
    expect(top.entries.map((entry) => entry.name)).toEqual(['First', 'Second', 'Third']);

    // A tie loses to the rows already there
    const placed = await songBoard(`songId=artist-title&tolerance=2&score=${QUALIFYING_SCORE + 200}`);
    expect(placed.position).toBe(3);
  });
});
