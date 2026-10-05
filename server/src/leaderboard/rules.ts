/**
 * The leaderboard's numbers. The site has its own copy in `src/modules/leaderboard/consts.ts`, and `src/modules/leaderboard/rules-in-sync.test.ts` fails if the
 * two drift apart.
 */

/** The game's highest possible score (`MAX_POINTS` in `src/consts.ts`). */
export const MAX_POINTS = 3_500_000;

/** The lowest score that may go on a board: 1,000,000. */
export const QUALIFYING_SCORE = (MAX_POINTS * 2) / 7;

/** Pitch tolerance: 1 is Hard, 2 Medium, 3 Easy; wider ones are dev-only and get no board. */
export const MAX_SUBMITTED_TOLERANCE = 3;

/** The main menu ranks every song together, so it leaves out Easy, whose scores come cheaper. */
export const MAX_GLOBAL_BOARD_TOLERANCE = 2;

export const GLOBAL_BOARD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const GLOBAL_BOARD_SIZE = 50;

/** A song's board without a score to place: its top rows. */
export const SONG_BOARD_SIZE = 20;
/** A song's board around a score: this many rows either side of where it lands. */
export const SONG_BOARD_NEIGHBOURS = 25;

/** A whole submission: the run, and the recording that may come with it. */
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
export const MAX_NOTES_BYTES = 256 * 1024;
/** Opus voice runs to well under a megabyte for a long song. */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** No song length to check against, so these only rule out an empty or absurd run. */
export const MIN_NOTES_RECORDS = 100;
export const MAX_NOTES_RECORDS = 200_000;

export const MAX_SONG_TEXT_LENGTH = 200;
export const MAX_ID_LENGTH = 128;
