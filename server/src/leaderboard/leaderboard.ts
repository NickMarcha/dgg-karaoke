import { and, asc, count, desc, eq, gt, gte, ilike, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import { containing } from '../like.js';
import { leaderboardNotes, leaderboardRecords, users } from '../schema.js';
import {
  GLOBAL_BOARD_SIZE,
  GLOBAL_BOARD_WINDOW_MS,
  MAX_GLOBAL_BOARD_TOLERANCE,
  SONG_BOARD_NEIGHBOURS,
  SONG_BOARD_SIZE,
} from './rules.js';
import type { Submission } from './submission.js';

/** A public row: who, what and when, nothing that identifies the account beyond its name. */
const entry = {
  name: users.username,
  flair: users.flair,
  score: leaderboardRecords.score,
  artist: leaderboardRecords.artist,
  title: leaderboardRecords.title,
  songId: leaderboardRecords.songId,
  tolerance: leaderboardRecords.tolerance,
  createdAt: sql<number>`(extract(epoch from ${leaderboardRecords.createdAt}) * 1000)::bigint`.mapWith(Number),
};

const MODERATION_PAGE_SIZE = 50;

/** Best first; a tie goes to whoever got there first. */
const ranking = [desc(leaderboardRecords.score), asc(leaderboardRecords.createdAt)];

export class Leaderboard {
  constructor(private readonly database: Database) {}

  /** Keeps the run if it beats the singer's best at this song and difficulty. Says whether it did. */
  public async submit(userId: string, run: Submission): Promise<boolean> {
    const { notes, ...record } = run;
    return this.database.transaction(async (transaction) => {
      const [kept] = await transaction
        .insert(leaderboardRecords)
        .values({ userId, ...record, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [leaderboardRecords.userId, leaderboardRecords.songId, leaderboardRecords.tolerance],
          set: { ...record, createdAt: new Date() },
          setWhere: sql`excluded.score > ${leaderboardRecords.score}`,
        })
        .returning({ id: leaderboardRecords.id });
      if (!kept) return false;

      await transaction
        .insert(leaderboardNotes)
        .values({ recordId: kept.id, notes: Buffer.from(notes) })
        .onConflictDoUpdate({ target: leaderboardNotes.recordId, set: { notes: Buffer.from(notes) } });
      return true;
    });
  }

  /** For moderators: the newest rows, or those whose singer, artist or title contains `query`. */
  public recent(query?: string) {
    const pattern = query ? containing(query) : null;
    return this.database
      .select({ id: leaderboardRecords.id, ...entry })
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(
        pattern
          ? or(
              ilike(users.username, pattern),
              ilike(leaderboardRecords.artist, pattern),
              ilike(leaderboardRecords.title, pattern),
            )
          : undefined,
      )
      .orderBy(desc(leaderboardRecords.createdAt))
      .limit(MODERATION_PAGE_SIZE);
  }

  /** Removes a row and the run behind it. Says whether there was one. */
  public async remove(id: string) {
    const removed = await this.database
      .delete(leaderboardRecords)
      .where(eq(leaderboardRecords.id, id))
      .returning({ id: leaderboardRecords.id });
    return removed.length > 0;
  }

  /** The main menu's board: every song, the last fortnight, Medium and harder. */
  public global() {
    return this.database
      .select(entry)
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(
        and(
          lte(leaderboardRecords.tolerance, MAX_GLOBAL_BOARD_TOLERANCE),
          gt(leaderboardRecords.createdAt, new Date(Date.now() - GLOBAL_BOARD_WINDOW_MS)),
        ),
      )
      .orderBy(...ranking)
      .limit(GLOBAL_BOARD_SIZE);
  }

  /**
   * One song at one difficulty, all time. Given a score, the rows either side of where it would land
   * (a tie behind the rows already there) and that position; otherwise the top of the board.
   */
  public async song(songId: string, tolerance: number, score: number | null) {
    const board = and(eq(leaderboardRecords.songId, songId), eq(leaderboardRecords.tolerance, tolerance));
    const countWhere = async (where: ReturnType<typeof and>) =>
      (await this.database.select({ value: count() }).from(leaderboardRecords).where(where))[0]?.value ?? 0;

    const total = await countWhere(board);
    const position = score === null ? null : (await countWhere(and(board, gte(leaderboardRecords.score, score)))) + 1;
    const offset = position === null ? 0 : Math.max(0, position - 1 - SONG_BOARD_NEIGHBOURS);

    const entries = await this.database
      .select(entry)
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(board)
      .orderBy(...ranking)
      .offset(offset)
      .limit(position === null ? SONG_BOARD_SIZE : SONG_BOARD_NEIGHBOURS * 2);

    return { entries, total, startPosition: offset + 1, position };
  }
}
