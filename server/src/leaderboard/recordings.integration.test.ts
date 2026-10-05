import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pack } from 'msgpackr';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { leaderboardRecordings, users } from '../schema.js';
import { createTestApp, signedInAccount, site, sungRun } from '../test-support.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

/** `share` is how much of the song was sung on pitch: more scores more. */
function run({ share = 0.75, recording = false } = {}) {
  return new Uint8Array(
    pack({
      ...sungRun({ share }),
      ...(recording ? { recording: audio, recordingType: 'audio/webm;codecs=opus', recordingOffsetMs: 1500 } : {}),
    }),
  );
}

interface Entry {
  id: string;
  name: string;
  status: 'score' | 'recorded' | 'verified';
}

interface Run extends Entry {
  recording: { type: string; offsetMs: number } | null;
  vouches: number;
  reports: number;
  myFlag: 'vouch' | 'report' | null;
}

describe.skipIf(!url)('recorded and verified runs', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database);

  const json = async <T>(response: Response | Promise<Response>) => (await (await response).json()) as T;
  const submit = (cookie: string, body: Uint8Array<ArrayBuffer>) =>
    app.request('/api/leaderboard', {
      method: 'POST',
      headers: { origin: site.origin, 'content-type': 'application/msgpack', cookie },
      body,
    });
  const board = async (query = '') =>
    (await json<{ entries: Entry[] }>(app.request(`/api/leaderboard${query}`))).entries;
  const runOf = (id: string, cookie?: string) =>
    json<Run>(app.request(`/api/leaderboard/runs/${id}`, cookie ? { headers: { cookie } } : {}));
  const flag = (cookie: string, id: string, kind: 'vouch' | 'report' | null) =>
    app.request(`/api/leaderboard/runs/${id}/flag`, {
      method: 'POST',
      headers: { ...site, cookie },
      body: JSON.stringify({ kind }),
    });

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

  it('keeps a run sent with a recording as Recorded, and plays it back to anyone', async () => {
    const singer = await signedInAccount(database, 'Singer');
    await submit(singer.cookie, run({ recording: true }));

    const [entry] = await board();
    expect(entry).toEqual(expect.objectContaining({ name: 'Singer', status: 'recorded' }));
    expect(await runOf(entry!.id)).toEqual(
      expect.objectContaining({ recording: { type: 'audio/webm;codecs=opus', offsetMs: 1500 } }),
    );

    const playback = await app.request(`/api/leaderboard/runs/${entry!.id}/recording`);
    expect(playback.headers.get('content-type')).toBe('audio/webm;codecs=opus');
    expect(new Uint8Array(await playback.arrayBuffer())).toEqual(audio);
  });

  it('keeps a run sent without one as a plain Score', async () => {
    const singer = await signedInAccount(database, 'Singer');
    await submit(singer.cookie, run());

    const [entry] = await board();
    expect(entry!.status).toBe('score');
    expect((await runOf(entry!.id)).recording).toBeNull();
  });

  it('drops the recording of a run a better one replaces', async () => {
    const singer = await signedInAccount(database, 'Singer');
    await submit(singer.cookie, run({ recording: true }));
    await submit(singer.cookie, run({ share: 1 }));

    expect((await board())[0]!.status).toBe('score');
    expect(await database.select().from(leaderboardRecordings)).toEqual([]);
  });

  it("lets other players vouch for or report a recorded run, once each, and not the singer's own", async () => {
    const singer = await signedInAccount(database, 'Singer');
    const fan = await signedInAccount(database, 'Fan');
    const critic = await signedInAccount(database, 'Critic');
    await submit(singer.cookie, run({ recording: true }));
    const [{ id }] = (await board()) as [Entry];

    expect((await flag(singer.cookie, id, 'vouch')).status).toBe(403);
    await flag(fan.cookie, id, 'vouch');
    await flag(fan.cookie, id, 'vouch');
    await flag(critic.cookie, id, 'report');
    expect(await runOf(id, fan.cookie)).toEqual(expect.objectContaining({ vouches: 1, reports: 1, myFlag: 'vouch' }));

    await flag(fan.cookie, id, null);
    expect(await runOf(id)).toEqual(expect.objectContaining({ vouches: 0, reports: 1 }));
  });

  it('refuses a vouch for a run with nothing to listen to', async () => {
    const singer = await signedInAccount(database, 'Singer');
    const fan = await signedInAccount(database, 'Fan');
    await submit(singer.cookie, run());
    const [{ id }] = (await board()) as [Entry];

    expect((await flag(fan.cookie, id, 'vouch')).status).toBe(409);
  });

  it('lets a moderator verify a recorded run, and the boards filter to verified ones', async () => {
    const moderator = await signedInAccount(database, 'Helper', { role: 'moderator' });
    const recorded = await signedInAccount(database, 'Recorded');
    const plain = await signedInAccount(database, 'Plain');
    await submit(recorded.cookie, run({ recording: true }));
    await submit(plain.cookie, run({ share: 1 }));

    const queue = await json<{ rows: (Entry & { vouches: number; reports: number })[] }>(
      app.request('/api/moderation/leaderboard?status=recorded', { headers: { cookie: moderator.cookie } }),
    );
    expect(queue.rows.map((row) => row.name)).toEqual(['Recorded']);
    const id = queue.rows[0]!.id;

    const verified = await app.request(`/api/moderation/leaderboard/${id}/verify`, {
      method: 'POST',
      headers: { ...site, cookie: moderator.cookie },
    });
    expect(verified.status).toBe(200);
    expect((await board()).map((entry) => [entry.name, entry.status])).toEqual([
      ['Plain', 'score'],
      ['Recorded', 'verified'],
    ]);
    expect((await board('?verified=1')).map((entry) => entry.name)).toEqual(['Recorded']);

    const notRecorded = (await board()).find((entry) => entry.name === 'Plain')!.id;
    const refused = await app.request(`/api/moderation/leaderboard/${notRecorded}/verify`, {
      method: 'POST',
      headers: { ...site, cookie: moderator.cookie },
    });
    expect(refused.status).toBe(409);
  });
});
