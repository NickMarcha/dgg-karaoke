import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { users } from '../schema.js';
import { createTestApp, signedInAccount, site } from '../test-support.js';
import { StreamKeys } from './stream-keys.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('stream keys', () => {
  const database = drizzle({ connection: url! });
  const app = createTestApp(database);
  const keys = new StreamKeys(database);

  const key = async (cookie: string, method = 'GET') => {
    const response = await app.request('/api/moderation/stream-key', { method, headers: { ...site, cookie } });
    return response.ok ? ((await response.json()) as { key: string | null }).key : response.status;
  };

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

  it("gives a moderator a link of their own, which says whose stream it is until it's replaced", async () => {
    const mod = await signedInAccount(database, 'Moderator', { role: 'moderator' });
    expect(await key(mod.cookie)).toBeNull();

    const first = (await key(mod.cookie, 'POST')) as string;
    expect(await key(mod.cookie)).toBe(first);
    expect(await keys.streamerFor(first)).toEqual({ id: mod.id, username: 'Moderator' });

    const second = await key(mod.cookie, 'POST');
    expect(second).not.toBe(first);
    expect(await keys.streamerFor(first)).toBeNull();
  });

  it('is for moderators and admins only, and stops working when they no longer are', async () => {
    const singer = await signedInAccount(database, 'Singer');
    expect(await key(singer.cookie)).toBe(403);

    const mod = await signedInAccount(database, 'Moderator', { role: 'moderator' });
    const link = (await key(mod.cookie, 'POST')) as string;
    await database.update(users).set({ role: 'singer' }).where(eq(users.id, mod.id));
    expect(await keys.streamerFor(link)).toBeNull();
  });
});
