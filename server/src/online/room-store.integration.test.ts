import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { onlineRooms } from '../schema.js';
import { OnlineDirectory } from './directory.js';
import { PostgresRoomStore } from './room-store.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('PostgresRoomStore', () => {
  const database = drizzle({ connection: url! });
  const store = new PostgresRoomStore(database);

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
    await database.delete(onlineRooms);
  });

  afterAll(async () => {
    await database.delete(onlineRooms);
    await database.$client.end();
  });

  it('brings a room back after a restart, secrets included', async () => {
    const before = new OnlineDirectory(store);
    await before.join('3room', 'host', 's1', true);
    const singer = await before.join('3room', 'singer', 's2', false);

    const after = new OnlineDirectory(store);
    const rejoin = await after.join('3room', 'singer', 's2-new', false, singer.ok ? singer.secret : undefined);

    expect(rejoin).toMatchObject({ ok: true, slot: 1, hostSessionId: 's1' });
  });

  it('updates a room in place rather than adding rows', async () => {
    const directory = new OnlineDirectory(store);
    await directory.join('4room', 'host', 's1', true);
    await directory.keepalive('4room');
    const rows = await database.select().from(onlineRooms);
    expect(rows.filter((row) => row.code === '4room')).toHaveLength(1);
  });

  it('expires only rooms idle past the cut-off', async () => {
    await database.delete(onlineRooms);
    let time = Date.now();
    const directory = new OnlineDirectory(store, () => time);
    await directory.join('5old', 'host', 's1', true);
    time += 60_000;
    await directory.join('5new', 'host', 's1', true);

    expect(await store.expire(time - 30_000)).toEqual(['5old']);
    expect(await store.load('5new')).not.toBeNull();
  });
});
