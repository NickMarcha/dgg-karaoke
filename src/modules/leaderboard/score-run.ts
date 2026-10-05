import { PlayerNote, Song } from '~/interfaces';
import { addFrequencyRecord } from '~/modules/game-engine/game-state/helpers/append-frequency-to-player-notes';
import calculateScore from '~/modules/game-engine/game-state/helpers/calculate-score';
import { DecodedFrequencyRecord } from '~/modules/leaderboard/notes-payload';
import convertTxtToSong from '~/modules/songs/utils/convert-txt-to-song';
import getSongBeatLength from '~/modules/songs/utils/get-song-beat-length';
import { processSong } from '~/modules/songs/utils/process-song/process-song';

export interface ScoredRun {
  trackIndex: number;
  /** Sung against both tracks merged into one, as every game but a two-singer one is. */
  mergedTrack: boolean;
  tolerance: number;
  records: DecodedFrequencyRecord[];
}

/** The song as the game plays it, from its txt file. */
export const songForScoring = (txt: string): Song => processSong(convertTxtToSong(txt));

/**
 * A run's score, from its pitch readings and the song, the way the game reaches it while singing.
 * Kept free of the browser and the game's state: the API runs it on every run put up.
 */
export function scoreRun(song: Song, run: ScoredRun): number {
  const track = run.mergedTrack ? song.mergedTrack : song.tracks[run.trackIndex];
  if (!track || !song.tracks[run.trackIndex]) return 0;
  const beatLength = getSongBeatLength(song);
  const playerNotes: PlayerNote[] = [];
  for (const record of run.records) addFrequencyRecord(playerNotes, track, record, beatLength, run.tolerance);
  return Math.round(calculateScore(playerNotes, song, run.trackIndex));
}
