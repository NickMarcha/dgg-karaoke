import { createHash } from 'node:crypto';

import { createApp } from './app.js';
import { Auth } from './auth.js';
import type { Database } from './db.js';
import { parseEnv } from './env.js';
import { OnlineDirectory } from './online/directory.js';
import { PostgresRoomStore } from './online/room-store.js';
import { sessions, type UserRole, users } from './schema.js';
import { SocketTickets } from './socket-tickets.js';

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
