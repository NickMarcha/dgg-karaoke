import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import type { SessionUser } from '../auth.js';
import type { Daily } from '../daily/daily.js';
import type { Database } from '../db.js';
import { Leaderboard } from './leaderboard.js';
import { MAX_ID_LENGTH, MAX_SUBMISSION_BYTES, MAX_SUBMITTED_TOLERANCE } from './rules.js';
import { readSubmission, SubmissionRefused } from './submission.js';

/** A song lasts minutes, so more runs than this in one from one account are not being sung. */
const SUBMISSIONS_PER_MINUTE = 6;

const songQuery = z.object({
  songId: z.string().min(1).max(MAX_ID_LENGTH),
  tolerance: z.coerce.number().int().min(1).max(MAX_SUBMITTED_TOLERANCE),
  score: z.coerce.number().int().optional(),
});

interface Deps {
  database: Database;
  signedInUser: (context: Context) => Promise<SessionUser | null>;
  daily: Daily;
}

/** `/api/leaderboard`: the boards are public, putting a run on one takes a signed-in account. */
export function leaderboardRoutes({ database, signedInUser, daily }: Deps) {
  const leaderboard = new Leaderboard(database);
  const recent = new Map<string, number[]>();
  const routes = new Hono();

  const limit = bodyLimit({
    maxSize: MAX_SUBMISSION_BYTES,
    onError: (context) => context.json({ error: 'That run is too large.' }, 413),
  });

  routes.post('/', limit, async (context) => {
    const user = await signedInUser(context);
    if (!user) return context.json({ error: 'Sign in with destiny.gg to put a score on the board.' }, 401);

    const now = Date.now();
    const times = (recent.get(user.id) ?? []).filter((time) => time > now - 60_000);
    if (times.length >= SUBMISSIONS_PER_MINUTE) return context.json({ error: 'Too many runs at once.' }, 429);

    try {
      const run = readSubmission(new Uint8Array(await context.req.arrayBuffer()));
      recent.set(user.id, [...times, now]);
      const improved = await leaderboard.submit(user.id, run);
      // Today's board counts a run that is not the singer's best of all time too
      await daily.record(user.id, run);
      return context.json({ improved }, 201);
    } catch (error) {
      if (error instanceof SubmissionRefused) return context.json({ error: error.message }, 400);
      throw error;
    }
  });

  routes.get('/', async (context) => context.json({ entries: await leaderboard.global() }));

  routes.get('/song', async (context) => {
    const query = songQuery.safeParse(context.req.query());
    if (!query.success) return context.json({ error: 'A song and a difficulty, please.' }, 400);
    const { songId, tolerance, score } = query.data;
    return context.json(await leaderboard.song(songId, tolerance, score ?? null));
  });

  return routes;
}

/** `/api/moderation/leaderboard`, behind the moderator check in `app.ts`: finding and removing rows. */
export function leaderboardModerationRoutes(database: Database) {
  const leaderboard = new Leaderboard(database);
  const routes = new Hono();

  routes.get('/', async (context) =>
    context.json({ rows: await leaderboard.recent(context.req.query('query')?.trim()) }),
  );

  routes.delete('/:id', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success || !(await leaderboard.remove(id.data))) return context.json({ error: 'No such row.' }, 404);
    return context.body(null, 204);
  });

  return routes;
}
