import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { flairClass } from '~/modules/account/account';
import { Chip } from '~/modules/elements/akui/chip';

import '~/modules/account/flairs.css';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { BoardEntry } from '~/modules/leaderboard/types';
import ScoreboardRow from '~/modules/scoreboard/scoreboard-row';

// The leaderboards are the only screens that render a relative date
dayjs.extend(relativeTime);

interface Props {
  /** A row without an id has no page of its own: the run just sung, a song of the day's row. */
  entry: Omit<BoardEntry, 'id' | 'status'> & Partial<Pick<BoardEntry, 'id' | 'status'>>;
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
      name={
        <>
          {entry.id ? (
            // Its own tab, so following a run from the results does not lose them
            <a href={`/run/?id=${entry.id}`} target="_blank" rel="noreferrer" className={flairClass(entry)}>
              {entry.name}
            </a>
          ) : (
            <span className={flairClass(entry)}>{entry.name}</span>
          )}
          {entry.status === 'recorded' && <Chip variant="blue">Recorded</Chip>}
          {entry.status === 'verified' && <Chip variant="green">Verified</Chip>}
        </>
      }
      subtitle={withSongDetails ? `${entry.artist} — ${entry.title}` : undefined}
      meta={[withSongDetails ? difficultyName(entry.tolerance) : null, dayjs(entry.createdAt).fromNow()]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

export default LeaderboardRow;
