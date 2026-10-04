import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { communitySongs, users } from '../schema.js';
import { createTestApp, signedInAccount, site } from '../test-support.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const txt = (title = 'Title') => `#ARTIST:Artist\n#TITLE:${title}\n#BPM:100\n: 0 4 60 la\nE\n`;
const song = (title = 'Title') => ({
  txt: txt(title),
  preview: { id: `artist-${title.toLowerCase()}`, artist: 'Artist', title, language: ['English'] },
});

interface Listed {
  id: string;
  songId: string;
  status: string;
  rejectionReason: string | null;
}

describe.skipIf(!url)('community songs', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database);

  const json = async <T>(response: Response | Promise<Response>) => (await (await response).json()) as T;
  const post = (path: string, cookie: string | null, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: cookie ? { ...site, cookie } : site,
      body: JSON.stringify(body),
    });
  const submit = async (cookie: string, title = 'Title') =>
    (await json<{ id: string }>(post('/api/songs', cookie, song(title)))).id;

  let singer: Awaited<ReturnType<typeof signedInAccount>>;
  let moderator: Awaited<ReturnType<typeof signedInAccount>>;

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.delete(communitySongs);
    await database.delete(users);
    singer = await signedInAccount(database, 'Singer');
    moderator = await signedInAccount(database, 'Helper', { role: 'moderator' });
  });

  afterAll(async () => {
    await database.delete(communitySongs);
    await database.delete(users);
    await database.$client.end();
  });

  it('takes a song from somebody signed in, and only from them', async () => {
    expect((await post('/api/songs', null, song())).status).toBe(401);
    expect((await post('/api/songs', singer.cookie, song())).status).toBe(201);

    const mine = await json<{ songs: Listed[] }>(
      app.request('/api/songs/mine', { headers: { cookie: singer.cookie } }),
    );
    expect(mine.songs).toEqual([expect.objectContaining({ songId: 'artist-title', status: 'submitted' })]);
  });

  it('refuses what is not a song', async () => {
    const refused = [
      { txt: 'no headers', preview: song().preview },
      { txt: txt(), preview: { id: 'Not An Id', artist: 'Artist', title: 'Title' } },
      { txt: 'x'.repeat(600 * 1024), preview: song().preview },
      { txt: txt() },
    ];
    for (const body of refused) expect((await post('/api/songs', singer.cookie, body)).status).toBe(400);
  });

  it('replaces a submission of the same song that is still waiting, rather than queueing another', async () => {
    const first = await submit(singer.cookie);
    const second = await submit(singer.cookie);

    expect(second).toBe(first);
    expect(await database.select().from(communitySongs)).toHaveLength(1);
  });

  it('lets anyone find and play a waiting song as unverified', async () => {
    const id = await submit(singer.cookie, 'Waiting');

    const found = await json<{ sharedSongId: string; artist: string }[]>(
      app.request('/api/songs/unverified?query=wait'),
    );
    expect(found).toEqual([expect.objectContaining({ sharedSongId: id, songId: 'artist-waiting' })]);

    const loaded = await json<{ songTxt: string }>(app.request(`/api/songs/unverified/${id}`));
    expect(loaded.songTxt).toBe(txt('Waiting'));
  });

  it("puts a published song in everyone's song list, and a newer version replaces it", async () => {
    const first = await submit(singer.cookie);
    await post(`/api/moderation/songs/${first}/publish`, moderator.cookie, {});

    const index = await json<{ id: string }[]>(app.request('/api/songs/index'));
    expect(index.map((entry) => entry.id)).toEqual(['artist-title']);
    expect(await (await app.request('/api/songs/published/artist-title')).text()).toBe(txt());
    expect(await json<unknown[]>(app.request('/api/songs/unverified?query=title'))).toEqual([]);

    const newer = await submit(moderator.cookie);
    await post(`/api/moderation/songs/${newer}/publish`, moderator.cookie, {});
    const statuses = await database
      .select({ id: communitySongs.id, status: communitySongs.status })
      .from(communitySongs);
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: first, status: 'archived' },
        { id: newer, status: 'published' },
      ]),
    );
  });

  it('tells the submitter why a song was rejected', async () => {
    const id = await submit(singer.cookie);
    expect((await post(`/api/moderation/songs/${id}/reject`, moderator.cookie, { reason: '' })).status).toBe(400);
    await post(`/api/moderation/songs/${id}/reject`, moderator.cookie, { reason: 'The lyrics are out of sync.' });

    const mine = await json<{ songs: Listed[] }>(
      app.request('/api/songs/mine', { headers: { cookie: singer.cookie } }),
    );
    expect(mine.songs).toEqual([
      expect.objectContaining({ status: 'rejected', rejectionReason: 'The lyrics are out of sync.' }),
    ]);
  });

  it('lets a moderator read and correct a song before it goes out', async () => {
    const id = await submit(singer.cookie);

    const queue = await json<{ songs: Listed[] }>(
      app.request('/api/moderation/songs?status=submitted', { headers: { cookie: moderator.cookie } }),
    );
    expect(queue.songs.map((entry) => entry.id)).toEqual([id]);

    const corrected = await app.request(`/api/moderation/songs/${id}`, {
      method: 'PUT',
      headers: { ...site, cookie: moderator.cookie },
      body: JSON.stringify(song('Corrected')),
    });
    expect(corrected.status).toBe(200);
    const loaded = await json<{ txt: string; songId: string }>(
      app.request(`/api/moderation/songs/${id}`, { headers: { cookie: moderator.cookie } }),
    );
    expect(loaded).toEqual(expect.objectContaining({ txt: txt('Corrected'), songId: 'artist-corrected' }));
  });

  it('keeps reviewing to moderators', async () => {
    const id = await submit(singer.cookie);

    expect((await post(`/api/moderation/songs/${id}/publish`, singer.cookie, {})).status).toBe(403);
    expect((await app.request('/api/moderation/songs', { headers: { cookie: singer.cookie } })).status).toBe(403);
  });
});
