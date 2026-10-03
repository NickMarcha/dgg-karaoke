import { createHash } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { Auth } from './auth.js';
import { parseEnv } from './env.js';
import { OnlineDirectory } from './online/directory.js';
import { PostgresRoomStore } from './online/room-store.js';
import { sessions, type UserRole, users } from './schema.js';
import { SocketTickets } from './socket-tickets.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const env = parseEnv({
  DATABASE_URL: 'postgresql://unused',
  APP_ORIGIN: 'http://localhost:3000',
  DGG_CLIENT_ID: 'client',
  DGG_CLIENT_SECRET: 'secret',
  DGG_REDIRECT_URI: 'http://localhost:3000/auth/callback',
});

const site = { origin: 'http://localhost:3000', 'content-type': 'application/json' };

describe.skipIf(!url)('admin routes', () => {
  const database = drizzle({ connection: url! });
  const app = createApp({
    appOrigins: ['http://localhost:3000'],
    auth: new Auth({ database, env }),
    secureCookies: false,
    signInRequired: true,
    tickets: new SocketTickets(),
    database,
    directory: new OnlineDirectory(new PostgresRoomStore(database)),
  });

  /** A user who has signed in, and the cookie their browser holds. */
  async function account(username: string, role: UserRole = 'singer') {
    const [user] = await database
      .insert(users)
      .values({ dggUserId: username, username, role, dggStatus: 'Active' })
      .returning({ id: users.id });
    const token = `token-${username}`;
    await database.insert(sessions).values({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: user!.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { id: user!.id, cookie: `dgg_karaoke_session=${token}` };
  }

  const setRole = (cookie: string, id: string, role: string) =>
    app.request(`/api/admin/users/${id}/role`, {
      method: 'POST',
      headers: { ...site, cookie },
      body: JSON.stringify({ role }),
    });

  const usernames = async (response: Response) =>
    ((await response.json()) as { users: { username: string }[] }).users.map((user) => user.username);

  let admin: Awaited<ReturnType<typeof account>>;

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.delete(users);
    admin = await account('Boss', 'admin');
  });

  afterAll(async () => {
    await database.delete(users);
    await database.$client.end();
  });

  it('lists the staff when nothing is searched for', async () => {
    await account('Helper', 'moderator');
    await account('Singer');

    const response = await app.request('/api/admin/users', { headers: { cookie: admin.cookie } });
    expect(await usernames(response)).toEqual(['Boss', 'Helper']);
  });

  it('finds people by part of their name, whatever the case', async () => {
    await account('StrawWaffle');
    await account('Waffler');
    await account('Pancake');

    const response = await app.request('/api/admin/users?query=waff', { headers: { cookie: admin.cookie } });
    expect(await usernames(response)).toEqual(['StrawWaffle', 'Waffler']);
  });

  it('takes a search for the characters typed, not as a pattern', async () => {
    await account('a_b');
    await account('axb');

    const response = await app.request('/api/admin/users?query=a_b', { headers: { cookie: admin.cookie } });
    expect(await usernames(response)).toEqual(['a_b']);
  });

  it('makes somebody a moderator, and a singer again', async () => {
    const singer = await account('Singer');

    const promoted = await setRole(admin.cookie, singer.id, 'moderator');
    expect(await promoted.json()).toEqual({ user: expect.objectContaining({ username: 'Singer', role: 'moderator' }) });

    await setRole(admin.cookie, singer.id, 'singer');
    const me = await app.request('/api/me', { headers: { cookie: singer.cookie } });
    expect(await me.json()).toEqual(expect.objectContaining({ user: expect.objectContaining({ role: 'singer' }) }));
  });

  // Admins come from ADMIN_DGG_USERNAMES, which every sign-in re-asserts
  it('neither makes nor unmakes an admin', async () => {
    const other = await account('OtherBoss', 'admin');
    const singer = await account('Singer');

    expect((await setRole(admin.cookie, other.id, 'singer')).status).toBe(409);
    expect((await setRole(admin.cookie, singer.id, 'admin')).status).toBe(400);
  });

  it('answers 404 for somebody who has never signed in', async () => {
    const response = await setRole(admin.cookie, '00000000-0000-0000-0000-000000000000', 'moderator');
    expect(response.status).toBe(404);
  });

  it('is for admins only', async () => {
    const moderator = await account('Helper', 'moderator');
    const singer = await account('Singer');

    expect((await app.request('/api/admin/users')).status).toBe(401);
    expect((await app.request('/api/admin/users', { headers: { cookie: moderator.cookie } })).status).toBe(403);
    expect((await setRole(singer.cookie, singer.id, 'moderator')).status).toBe(403);
  });
});
