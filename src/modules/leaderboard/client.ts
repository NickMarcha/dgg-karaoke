import { pack } from 'msgpackr';

import { readJson } from '~/modules/api';
import { RunRecording } from '~/modules/leaderboard/recording-take';
import { BoardEntry, BoardResponse, LeaderboardSubmission, SongBoardResponse } from '~/modules/leaderboard/types';

/** Through the site's `/api` proxy, so a submission carries the session cookie. */
export const LEADERBOARD_URL = '/api/leaderboard';
const SONG_LEADERBOARD_URL = '/api/leaderboard/song';

/** A run as the game hands it round: what is sent, and the score and song it shows the singer. */
export type SubmitScoreInput = Omit<LeaderboardSubmission, 'recording' | 'recordingType' | 'recordingOffsetMs'> & {
  score: number;
  artist: string;
  title: string;
};

/** Puts a run on the board as the signed-in account, with the singer's recording if given. Says whether the API took it. */
export async function submitScore(input: SubmitScoreInput, recording?: RunRecording | null): Promise<boolean> {
  try {
    const { score, artist, title, ...run } = input;
    const submission: LeaderboardSubmission = {
      ...run,
      ...(recording
        ? { recording: recording.data, recordingType: recording.type, recordingOffsetMs: recording.offsetMs }
        : {}),
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

/** The SWR key is the URL, so the verified-only board is a fetch of its own. */
export const fetchBoard = async (url: string = LEADERBOARD_URL): Promise<BoardResponse> => {
  const response = await fetch(url);

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

/** One run on the board in full, for its page. */
export interface RunDetails extends BoardEntry {
  recording: { type: string; offsetMs: number } | null;
  vouches: number;
  reports: number;
  /** How the signed-in viewer flagged it, if they did. */
  myFlag: 'vouch' | 'report' | null;
  isOwn: boolean;
}

export const runUrl = (id: string) => `/api/leaderboard/runs/${id}`;

export const fetchRun = async (url: string) => readJson<RunDetails>(await fetch(url));

/** The signed-in player vouching for someone else's recorded run, reporting it, or neither. */
export const flagRun = async (id: string, kind: 'vouch' | 'report' | null) =>
  readJson(
    await fetch(`${runUrl(id)}/flag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    }),
  );
