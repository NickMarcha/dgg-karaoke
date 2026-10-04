import { readJson } from '~/modules/api';

/** A row of the song of the day's board: who, and how well, on that day. */
export interface DailyEntry {
  name: string;
  flair: string | null;
  score: number;
  tolerance: number;
  createdAt: number;
}

/** Body of `GET /api/daily`: today's song (UTC), or none when the API could not pick one. */
export interface DailyBoard {
  day: string;
  songId: string | null;
  entries: DailyEntry[];
}

export const DAILY_URL = '/api/daily';

export const fetchDaily = async () => readJson<DailyBoard>(await fetch(DAILY_URL));
