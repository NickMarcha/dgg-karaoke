// The API keeps its own copy of these in server/src/leaderboard/rules.ts; rules-in-sync.test.ts
// checks the two agree.
import { MAX_POINTS } from '~/consts';

/**
 * A score qualifies for the leaderboard prompt at 1,000,000 — expressed as a share of MAX_POINTS so
 * it cannot drift if the scoring formula's ceiling ever changes.
 */
export const QUALIFYING_SCORE_RATIO = 2 / 7;

export const QUALIFYING_SCORE = MAX_POINTS * QUALIFYING_SCORE_RATIO;

/**
 * Pitch tolerance on a sing setup: 1 = Hard, 2 = Medium, 3 = Easy, 4+ the dev-only debug widths.
 *
 * Two different limits hang off it, because the two boards rank different things:
 *
 * - {@link MAX_SUBMITTED_TOLERANCE} — the easiest run that may be stored at all. The per-song boards
 *   are split by difficulty, so an Easy run is only ever ranked against other Easy runs of the same
 *   song and there is nothing incomparable about it. The debug widths above Easy are not a shipped
 *   difficulty and get no board.
 * - {@link MAX_GLOBAL_BOARD_TOLERANCE} — the easiest run that reaches the single global board on the
 *   main menu. That board mixes every song and every difficulty into one ranking, and each step
 *   widens the pitch window the scoring uses, so an Easy run reaches the qualifying score for
 *   singing that would not come close on Medium. Those rows would not be comparable.
 */
export const MAX_SUBMITTED_TOLERANCE = 3;

export const MAX_GLOBAL_BOARD_TOLERANCE = 2;

/**
 * How many rows `GET /api/leaderboard/song` returns when the caller asks about no particular score —
 * just the top of the board.
 */
export const SONG_BOARD_SIZE = 20;

/**
 * How many rows either side of the caller's score the per-song board returns. The player's own row
 * goes between the two halves, so the list they see is `2 * SONG_BOARD_NEIGHBOURS + 1` rows long.
 */
export const SONG_BOARD_NEIGHBOURS = 25;

export { MAX_POINTS };
