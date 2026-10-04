import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { flairClass } from '~/modules/account/account';

import '~/modules/account/flairs.css';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { BoardEntry } from '~/modules/leaderboard/types';
import ScoreboardRow from '~/modules/scoreboard/scoreboard-row';

// The leaderboards are the only screens that render a relative date
dayjs.extend(relativeTime);

interface Props {
  entry: BoardEntry;
  position: number;
  /** Off for a board that is already one song and one difficulty — both would be the same on every row. */
  withSongDetails?: boolean;
  highlighted?: boolean;
  scrollIntoView?: boolean;
  'data-test'?: string;
}

/** A {@link ScoreboardRow} built from a board row: the name in its destiny.gg flair, the date relative. */
function LeaderboardRow({
  entry,
  position,
  withSongDetails = true,
  highlighted,
  scrollIntoView,
  'data-test': dataTest = 'leaderboard-row',
}: Props) {
  return (
    <ScoreboardRow
      position={position}
      score={entry.score}
      highlighted={highlighted}
      scrollIntoView={scrollIntoView}
      data-test={dataTest}
      name={<span className={flairClass(entry)}>{entry.name}</span>}
      subtitle={withSongDetails ? `${entry.artist} — ${entry.title}` : undefined}
      meta={[withSongDetails ? difficultyName(entry.tolerance) : null, dayjs(entry.createdAt).fromNow()]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

export default LeaderboardRow;
