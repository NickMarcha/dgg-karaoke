import { useMemo } from 'react';

import { HighScoreEntity, SingSetup, Song } from '~/interfaces';
import { useSongStats } from '~/modules/songs/stats/hooks';

const MAX_SCORES = 5;

/** This browser's best scores for the song at this mode and difficulty, best first. */
export default function useHighScores(song: Song, singSetup: SingSetup): HighScoreEntity[] {
  const stats = useSongStats(song);

  return useMemo(
    () =>
      (stats?.scores ?? [])
        .filter(({ setup }) => setup.mode === singSetup.mode && setup.tolerance === singSetup.tolerance)
        .flatMap((score) =>
          score.scores.map((singleScore) => ({ ...singleScore, date: score.date, singSetupId: score.setup.id })),
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SCORES),
    [stats, singSetup],
  );
}
