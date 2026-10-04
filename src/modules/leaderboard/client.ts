import { pack } from 'msgpackr';

import { computeNotesHash } from '~/modules/leaderboard/notes-hash';
import { BoardResponse, LeaderboardSubmission, SongBoardResponse } from '~/modules/leaderboard/types';

/** Through the site's `/api` proxy, so a submission carries the session cookie. */
export const LEADERBOARD_URL = '/api/leaderboard';
const SONG_LEADERBOARD_URL = '/api/leaderboard/song';

export type SubmitScoreInput = Omit<LeaderboardSubmission, 'notesHash'>;

/** Puts a run on the board as the signed-in account. Says whether the API took it. */
export async function submitScore(input: SubmitScoreInput): Promise<boolean> {
  try {
    const score = Math.round(input.score);
    const submission: LeaderboardSubmission = {
      ...input,
      score,
      notesHash: await computeNotesHash(input.notes, score),
    };

    const response = await fetch(LEADERBOARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/msgpack' },
      // msgpackr types the return as node's Buffer; in the browser it is a plain Uint8Array
      body: pack(submission) as unknown as Uint8Array<ArrayBuffer>,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const fetchBoard = async (): Promise<BoardResponse> => {
  const response = await fetch(LEADERBOARD_URL);

  if (!response.ok) throw new Error(`Failed to load the leaderboard: ${response.status}`);

  return response.json();
};

interface SongBoardQuery {
  songId: string;
  tolerance: number;
  /** Ranked against the board without being on it — the response says where it would land. */
  score: number | null;
}

/**
 * The SWR key doubles as the request URL, so a different song, difficulty or score is a different
 * fetch on its own without a `useEffect` to invalidate anything.
 */
export const songBoardUrl = ({ songId, tolerance, score }: SongBoardQuery) => {
  const params = new URLSearchParams({ songId, tolerance: String(tolerance) });
  if (score !== null) params.set('score', String(Math.round(score)));

  return `${SONG_LEADERBOARD_URL}?${params.toString()}`;
};

export const fetchSongBoard = async (url: string): Promise<SongBoardResponse> => {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Failed to load the song leaderboard: ${response.status}`);

  return response.json();
};
