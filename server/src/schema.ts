import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The online-mode room directory (src/online/directory.ts): who is in each room, which slot they
 * hold and who hosts. Held in memory while the API runs and written through here, so a deploy
 * restarting the API does not end every room in progress.
 */
export const onlineRooms = pgTable('online_rooms', {
  code: text('code').primaryKey(),
  state: jsonb('state').notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
});
