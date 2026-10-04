import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { leaderboardNotes, leaderboardRecords, users } from '../schema.js';
import { createTestApp, signedInAccount, site } from '../test-support.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

interface Row {
  id: string;
  name: string;
  title: string;
}

describe.skipIf(!url)('leaderboard moderation', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database);

  /** A row straight in the table: these tests are about removing rows, not submitting them. */
  async function row(userId: string, title: string, score: number) {
    const [record] = await database
      .insert(leaderboardRecords)
      .values({
        userId,
        songId: title.toLowerCase(),
        artist: 'Artist',
        title,
        score,
        tolerance: 2,
        mode: 'REGULAR',
        trackIndex: 0,
        inputLag: 0,
        notesHash: 'hash',
      })
      .returning({ id: leaderboardRecords.id });
    await database.insert(leaderboardNotes).values({ recordId: record!.id, notes: Buffer.from([1]) });
    return record!.id;
  }

  const rows = async (cookie: string, query = '') =>
    (
      (await (await app.request(`/api/moderation/leaderboard?query=${query}`, { headers: { cookie } })).json()) as {
        rows: Row[];
      }
    ).rows;

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

  it('lets a moderator find rows by singer or song, newest first', async () => {
    const moderator = await signedInAccount(database, 'Helper', { role: 'moderator' });
    const singer = await signedInAccount(database, 'StrawWaffle');
    await row(singer.id, 'First Song', 1_100_000);
    await row(singer.id, 'Second Song', 1_200_000);

    expect((await rows(moderator.cookie)).map((entry) => entry.title)).toEqual(['Second Song', 'First Song']);
    expect((await rows(moderator.cookie, 'waffle')).length).toBe(2);
    expect((await rows(moderator.cookie, 'first')).map((entry) => entry.title)).toEqual(['First Song']);
  });

  it('lets a moderator remove a row, notes and all', async () => {
    const moderator = await signedInAccount(database, 'Helper', { role: 'moderator' });
    const singer = await signedInAccount(database, 'Singer');
    const id = await row(singer.id, 'Song', 1_100_000);

    const removed = await app.request(`/api/moderation/leaderboard/${id}`, {
      method: 'DELETE',
      headers: { ...site, cookie: moderator.cookie },
    });
    expect(removed.status).toBe(204);
    expect(await database.select().from(leaderboardRecords)).toEqual([]);
    expect(await database.select().from(leaderboardNotes)).toEqual([]);

    const again = await app.request(`/api/moderation/leaderboard/${id}`, {
      method: 'DELETE',
      headers: { ...site, cookie: moderator.cookie },
    });
    expect(again.status).toBe(404);
  });

  it('is for moderators and admins', async () => {
    const admin = await signedInAccount(database, 'Boss', { role: 'admin' });
    const singer = await signedInAccount(database, 'Singer');
    const id = await row(singer.id, 'Song', 1_100_000);

    expect((await app.request('/api/moderation/leaderboard', { headers: { cookie: admin.cookie } })).status).toBe(200);
    expect((await app.request('/api/moderation/leaderboard')).status).toBe(401);
    const bySinger = await app.request(`/api/moderation/leaderboard/${id}`, {
      method: 'DELETE',
      headers: { ...site, cookie: singer.cookie },
    });
    expect(bySinger.status).toBe(403);
  });
});
