import { randomBytes } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import type { SessionUser } from '../auth.js';
import type { Database } from '../db.js';
import { streamKeys, users } from '../schema.js';

/** Who a stream key belongs to, while they may still stream. */
export interface Streamer {
  id: string;
  username: string;
}

export class StreamKeys {
  public constructor(private database: Database) {}

  public async keyOf(userId: string) {
    const [row] = await this.database
      .select({ key: streamKeys.key })
      .from(streamKeys)
      .where(eq(streamKeys.userId, userId));
    return row?.key ?? null;
  }

  /** A new key for the user, replacing their last one, whose link stops working. */
  public async renew(userId: string) {
    const key = randomBytes(24).toString('base64url');
    await this.database
      .insert(streamKeys)
      .values({ userId, key })
      .onConflictDoUpdate({ target: streamKeys.userId, set: { key, createdAt: new Date() } });
    return key;
  }

  /** The moderator or admin a key belongs to; nobody once they are neither. */
  public async streamerFor(key: string): Promise<Streamer | null> {
    const [row] = await this.database
      .select({ id: users.id, username: users.username })
      .from(streamKeys)
      .innerJoin(users, eq(streamKeys.userId, users.id))
      .where(and(eq(streamKeys.key, key), inArray(users.role, ['moderator', 'admin'])));
    return row ?? null;
  }
}

/** `/api/moderation/stream-key`: the signed-in moderator's OBS link key, and making a new one. */
export function streamKeyRoutes(keys: StreamKeys, signedInUser: (context: Context) => Promise<SessionUser | null>) {
  const routes = new Hono();
  routes.get('/', async (context) => {
    const user = (await signedInUser(context))!;
    return context.json({ key: await keys.keyOf(user.id) });
  });
  routes.post('/', async (context) => {
    const user = (await signedInUser(context))!;
    return context.json({ key: await keys.renew(user.id) });
  });
  return routes;
}
