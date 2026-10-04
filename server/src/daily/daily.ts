import { createHash } from 'node:crypto';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import { GLOBAL_BOARD_SIZE, MAX_GLOBAL_BOARD_TOLERANCE } from '../leaderboard/rules.js';
import type { Submission } from '../leaderboard/submission.js';
import { dailyRuns, dailySongs, users } from '../schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead the moderators' schedule looks. */
const SCHEDULE_DAYS = 14;

/** A UTC day as `YYYY-MM-DD`, the form the database stores and the routes take. */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * The song of the day and its board. A day's song is picked the first time anyone asks for it,
 * from the site's popular songs by a hash of the date, and stored so it never changes under the
 * people singing it; a moderator can choose another for any day.
 */
export class Daily {
  constructor(
    private readonly database: Database,
    /** Song ids to pick from, in any order. */
    private readonly pool: () => Promise<string[]>,
  ) {}

  public today = () => dayOf(Date.now());

  public async songFor(day: string): Promise<string | null> {
    const stored = await this.stored(day);
    if (stored) return stored;

    const ids = [...new Set(await this.pool())].sort();
    if (!ids.length) return null;
    const pick = ids[parseInt(createHash('sha256').update(day).digest('hex').slice(0, 8), 16) % ids.length]!;
    await this.database.insert(dailySongs).values({ day, songId: pick }).onConflictDoNothing();
    return (await this.stored(day)) ?? pick;
  }

  /** The day's best runs of its song, Medium and harder, as the main menu ranks. */
  public async board(day: string) {
    const songId = await this.songFor(day);
    const entries = songId
      ? await this.database
          .select({
            name: users.username,
            flair: users.flair,
            score: dailyRuns.score,
            tolerance: dailyRuns.tolerance,
            createdAt: sql<number>`(extract(epoch from ${dailyRuns.createdAt}) * 1000)::bigint`.mapWith(Number),
          })
          .from(dailyRuns)
          .innerJoin(users, eq(dailyRuns.userId, users.id))
          .where(and(eq(dailyRuns.day, day), eq(dailyRuns.songId, songId)))
          .orderBy(desc(dailyRuns.score), asc(dailyRuns.createdAt))
          .limit(GLOBAL_BOARD_SIZE)
      : [];
    return { day, songId, entries };
  }

  /** Counts a run toward today's board if it is today's song at a difficulty the board ranks. */
  public async record(userId: string, run: Submission) {
    if (run.tolerance > MAX_GLOBAL_BOARD_TOLERANCE) return;
    const day = this.today();
    if (run.songId !== (await this.songFor(day))) return;

    await this.database
      .insert(dailyRuns)
      .values({ day, songId: run.songId, userId, score: run.score, tolerance: run.tolerance, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [dailyRuns.day, dailyRuns.songId, dailyRuns.userId],
        set: { score: run.score, tolerance: run.tolerance, createdAt: new Date() },
        setWhere: sql`excluded.score > ${dailyRuns.score}`,
      });
  }

  /** The coming fortnight from today, each day's song and who chose it (null for the automatic pick). */
  public async schedule() {
    const start = Date.now();
    const days = Array.from({ length: SCHEDULE_DAYS }, (_, index) => dayOf(start + index * DAY_MS));
    for (const day of days) await this.songFor(day);

    const rows = await this.database
      .select({ day: dailySongs.day, songId: dailySongs.songId, chosenBy: users.username })
      .from(dailySongs)
      .leftJoin(users, eq(dailySongs.chosenBy, users.id))
      .where(sql`${dailySongs.day} between ${days[0]} and ${days.at(-1)}`)
      .orderBy(asc(dailySongs.day));
    return rows;
  }

  public async choose(day: string, songId: string, moderatorId: string) {
    await this.database
      .insert(dailySongs)
      .values({ day, songId, chosenBy: moderatorId })
      .onConflictDoUpdate({ target: dailySongs.day, set: { songId, chosenBy: moderatorId } });
  }

  /** Back to the automatic pick, made again when the day is next asked for. */
  public async clear(day: string) {
    await this.database.delete(dailySongs).where(eq(dailySongs.day, day));
  }

  private async stored(day: string) {
    const [row] = await this.database
      .select({ songId: dailySongs.songId })
      .from(dailySongs)
      .where(eq(dailySongs.day, day));
    return row?.songId ?? null;
  }
}

/**
 * The site's popular songs, from its own `most-popular-songs.json` (song ids by language). Read again
 * at most once an hour; a failure keeps the last list, so a day already picked is never affected.
 */
export function popularSongPool(siteOrigin: string, fetchImpl: typeof fetch = fetch) {
  let cached: { ids: string[]; at: number } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.ids;
    try {
      const response = await fetchImpl(new URL('/most-popular-songs.json', siteOrigin), {
        signal: AbortSignal.timeout(8000),
      });
      const byLanguage = (await response.json()) as Record<string, string[]>;
      cached = { ids: Object.values(byLanguage).flat(), at: Date.now() };
    } catch (error) {
      console.warn('Could not read the popular songs', error);
    }
    return cached?.ids ?? [];
  };
}
