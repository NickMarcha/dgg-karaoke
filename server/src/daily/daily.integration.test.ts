import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pack } from 'msgpackr';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dailySongs, users } from '../schema.js';
import { createTestApp, signedInAccount, site, sungRun } from '../test-support.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const pool = ['e2e-single-english-1995', 'e2e-new-english-1995', 'e2e-christmas-english-1995'];

/** `share` is how much of the song was sung on pitch: more scores more. */
function run(songId: string, share = 0.75, tolerance = 2) {
  return new Uint8Array(pack(sungRun({ songId, share, tolerance })));
}

interface Daily {
  day: string;
  songId: string | null;
  entries: { name: string; score: number }[];
}

describe.skipIf(!url)('song of the day', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database, { dailyPool: async () => pool });

  const daily = async () => (await (await app.request('/api/daily')).json()) as Daily;
  const submit = (cookie: string, body: Uint8Array<ArrayBuffer>) =>
    app.request('/api/leaderboard', {
      method: 'POST',
      headers: { origin: site.origin, 'content-type': 'application/msgpack', cookie },
      body,
    });

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    await database.delete(dailySongs);
    await database.delete(users);
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await database.delete(dailySongs);
    await database.delete(users);
    await database.$client.end();
  });

  it('picks one song from the pool for the day, and keeps it', async () => {
    const first = await daily();
    expect(first.day).toBe('2026-10-04');
    expect(pool).toContain(first.songId);
    expect((await daily()).songId).toBe(first.songId);
  });

  it("ranks the day's runs of the day's song, a singer's best, Medium and harder", async () => {
    const { songId } = await daily();
    const other = pool.find((id) => id !== songId)!;
    const first = await signedInAccount(database, 'First');
    const second = await signedInAccount(database, 'Second');
    const easy = await signedInAccount(database, 'Easy');

    const scoreOf = async (response: Response | Promise<Response>) =>
      ((await (await response).json()) as { score: number }).score;
    const best = await scoreOf(submit(first.cookie, run(songId!, 1)));
    await submit(first.cookie, run(songId!, 0.6));
    const secondBest = await scoreOf(submit(second.cookie, run(songId!, 0.75)));
    await submit(second.cookie, run(other, 1));
    await submit(easy.cookie, run(songId!, 1, 3));

    expect((await daily()).entries.map(({ name, score }) => [name, score])).toEqual([
      ['First', best],
      ['Second', secondBest],
    ]);
  });

  it('starts a new board on a new day', async () => {
    const { songId } = await daily();
    const singer = await signedInAccount(database, 'Singer');
    await submit(singer.cookie, run(songId!));

    vi.setSystemTime(new Date('2026-10-05T00:00:01Z'));
    const tomorrow = await daily();
    expect(tomorrow.day).toBe('2026-10-05');
    expect(tomorrow.entries).toEqual([]);
  });

  it("lets a moderator choose a day's song, and go back to the automatic one", async () => {
    const moderator = await signedInAccount(database, 'Helper', { role: 'moderator' });
    const singer = await signedInAccount(database, 'Singer');
    const choose = (cookie: string, songId: string) =>
      app.request('/api/moderation/daily/2026-10-04', {
        method: 'PUT',
        headers: { ...site, cookie },
        body: JSON.stringify({ songId }),
      });

    expect((await choose(singer.cookie, 'chosen-song')).status).toBe(403);
    expect((await choose(moderator.cookie, 'chosen-song')).status).toBe(200);
    expect((await daily()).songId).toBe('chosen-song');

    const days = (await (
      await app.request('/api/moderation/daily', { headers: { cookie: moderator.cookie } })
    ).json()) as { days: { day: string; songId: string; chosenBy: string | null }[] };
    expect(days.days[0]).toEqual({ day: '2026-10-04', songId: 'chosen-song', chosenBy: 'Helper' });

    await app.request('/api/moderation/daily/2026-10-04', {
      method: 'DELETE',
      headers: { ...site, cookie: moderator.cookie },
    });
    expect(pool).toContain((await daily()).songId);
  });
});
