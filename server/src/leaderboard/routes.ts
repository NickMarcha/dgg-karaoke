import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { scoreRun } from '~/modules/leaderboard/score-run';

import type { SessionUser } from '../auth.js';
import type { Daily } from '../daily/daily.js';
import type { Database } from '../db.js';
import { runStatus } from '../schema.js';
import type { Charts } from './charts.js';
import { Leaderboard } from './leaderboard.js';
import { MAX_ID_LENGTH, MAX_SUBMISSION_BYTES, MAX_SUBMITTED_TOLERANCE, QUALIFYING_SCORE } from './rules.js';
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
  charts: Charts;
}

/** `/api/leaderboard`: the boards are public, putting a run on one takes a signed-in account. */
export function leaderboardRoutes({ database, signedInUser, daily, charts }: Deps) {
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
      const song = await charts.get(run.songId).catch(() => undefined);
      if (song === undefined) return context.json({ error: 'The song could not be read to score the run.' }, 503);
      if (!song) throw new SubmissionRefused('There is no such song to score the run against.');

      // The score is the API's own, from the notes against the song: what the game says counts for nothing
      const score = scoreRun(song, run);
      if (score < QUALIFYING_SCORE) throw new SubmissionRefused(`That run scores ${score}, short of the board.`);
      const scored = { ...run, score, artist: song.artist, title: song.title, songLastUpdate: song.lastUpdate ?? null };
      const improved = await leaderboard.submit(user.id, scored);
      // Today's board counts a run that is not the singer's best of all time too
      await daily.record(user.id, scored);
      return context.json({ improved, score }, 201);
    } catch (error) {
      if (error instanceof SubmissionRefused) return context.json({ error: error.message }, 400);
      throw error;
    }
  });

  const verified = (context: Context) => context.req.query('verified') === '1';
  const runId = (context: Context) => z.uuid().safeParse(context.req.param('id'));
  const noSuchRun = (context: Context) => context.json({ error: 'No such run.' }, 404);

  routes.get('/', async (context) => context.json({ entries: await leaderboard.global(verified(context)) }));

  routes.get('/runs/:id', async (context) => {
    const id = runId(context);
    const viewer = await signedInUser(context);
    const run = id.success ? await leaderboard.run(id.data, viewer?.id ?? null) : null;
    return run ? context.json(run) : noSuchRun(context);
  });

  routes.get('/runs/:id/recording', async (context) => {
    const id = runId(context);
    const recording = id.success ? await leaderboard.recording(id.data) : null;
    if (!recording) return noSuchRun(context);
    return context.body(new Uint8Array(recording.audio), 200, {
      'content-type': recording.type,
      'cache-control': 'public, max-age=3600',
    });
  });

  routes.post('/runs/:id/flag', async (context) => {
    const user = await signedInUser(context);
    if (!user) return context.json({ error: 'Sign in with destiny.gg to vouch for or report a run.' }, 401);
    const id = runId(context);
    const body = z
      .object({ kind: z.enum(['vouch', 'report']).nullable() })
      .safeParse(await context.req.json().catch(() => null));
    if (!id.success || !body.success) return context.json({ error: 'Vouch, report, or neither.' }, 400);
    const outcome = await leaderboard.flag(id.data, user.id, body.data.kind);
    if (outcome === 'not-found') return noSuchRun(context);
    if (outcome === 'own') return context.json({ error: 'Not your own run.' }, 403);
    if (outcome === 'not-recorded') return context.json({ error: 'That run has no recording to judge.' }, 409);
    return context.json({ ok: true });
  });

  routes.get('/song', async (context) => {
    const query = songQuery.safeParse(context.req.query());
    if (!query.success) return context.json({ error: 'A song and a difficulty, please.' }, 400);
    const { songId, tolerance, score } = query.data;
    return context.json(await leaderboard.song(songId, tolerance, score ?? null, verified(context)));
  });

  return routes;
}

/** `/api/moderation/leaderboard`, behind the moderator check in `app.ts`: finding and removing rows. */
export function leaderboardModerationRoutes(database: Database) {
  const leaderboard = new Leaderboard(database);
  const routes = new Hono();

  routes.get('/', async (context) => {
    const status = runStatus.enumValues.find((value) => value === context.req.query('status'));
    return context.json({ rows: await leaderboard.recent(context.req.query('query')?.trim(), status) });
  });

  routes.post('/:id/verify', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    const outcome = id.success ? await leaderboard.verify(id.data) : 'not-found';
    if (outcome === 'not-found') return context.json({ error: 'No such row.' }, 404);
    if (outcome === 'not-recorded') return context.json({ error: 'Only a recorded run can be verified.' }, 409);
    return context.json({ ok: true });
  });

  routes.delete('/:id', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success || !(await leaderboard.remove(id.data))) return context.json({ error: 'No such row.' }, 404);
    return context.body(null, 204);
  });

  return routes;
}
