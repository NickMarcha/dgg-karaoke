/** What the API's leaderboard routes (`server/src/leaderboard/`) take and answer. */

/** Body of `POST /api/leaderboard`, msgpack-packed. Whose run it is comes from the session. */
export interface LeaderboardSubmission {
  songId: string;
  artist: string;
  title: string;
  songLastUpdate: string | null;
  score: number;
  tolerance: number;
  mode: string;
  trackIndex: number;
  inputLag: number;
  /** sha-256 hex over the packed notes bytes concatenated with the score. */
  notesHash: string;
  notes: Uint8Array;
}

/** One public row of the board: the singer's destiny.gg name and the flair it is coloured by. */
export interface BoardEntry {
  name: string;
  flair: string | null;
  score: number;
  artist: string;
  title: string;
  songId: string;
  tolerance: number;
  /** epoch ms; the client renders the relative date so a cached response cannot go stale */
  createdAt: number;
}

/** Body of `GET /api/leaderboard`. */
export interface BoardResponse {
  entries: BoardEntry[];
}

/**
 * Body of `GET /api/leaderboard/song`. One song at one difficulty; the vocal track is deliberately not
 * part of the split — the two tracks of a duet are ranked together.
 */
export interface SongBoardResponse {
  /**
   * A window of the board rather than its top: when the caller sends a score, the rows either side
   * of where it lands, so the player can see themselves among their neighbours instead of only
   * among people they will never catch.
   */
  entries: BoardEntry[];
  /** Every row for this song and difficulty, including the ones outside the window. */
  total: number;
  /** 1-based rank of `entries[0]`, so the window can be numbered without counting from the top. */
  startPosition: number;
  /**
   * 1-based rank the `score` query parameter would take on this board, ties losing to the rows
   * already there. `null` when the caller sent no score.
   */
  position: number | null;
}
