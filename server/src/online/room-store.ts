import { eq, lt } from 'drizzle-orm';

import type { Database } from '../db.js';
import { onlineRooms } from '../schema.js';
import type { RoomState, RoomStore } from './directory.js';

/** The directory's rooms in Postgres, one row per room code. */
export class PostgresRoomStore implements RoomStore {
  constructor(private readonly database: Database) {}

  public load = async (code: string): Promise<RoomState | null> => {
    const [row] = await this.database.select().from(onlineRooms).where(eq(onlineRooms.code, code));
    return (row?.state as RoomState | undefined) ?? null;
  };

  public save = async (code: string, state: RoomState) => {
    const lastActivityAt = new Date(state.lastActivityAt);
    await this.database
      .insert(onlineRooms)
      .values({ code, state, lastActivityAt })
      .onConflictDoUpdate({ target: onlineRooms.code, set: { state, lastActivityAt } });
  };

  public expire = async (before: number) => {
    const gone = await this.database
      .delete(onlineRooms)
      .where(lt(onlineRooms.lastActivityAt, new Date(before)))
      .returning({ code: onlineRooms.code });
    return gone.map((row) => row.code);
  };
}
