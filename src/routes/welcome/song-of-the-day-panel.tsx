import useSWR from 'swr';

import { Menu } from '~/modules/elements/akui/menu';
import { RegisterFunc } from '~/modules/hooks/use-keyboard-nav';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';
import { DAILY_URL, fetchDaily } from '~/modules/leaderboard/daily';
import LeaderboardRow from '~/modules/leaderboard/leaderboard-row';
import ScoreboardPanel from '~/modules/scoreboard/scoreboard-panel';
import useSongIndex from '~/modules/songs/hooks/use-song-index';
import { cn } from '~/utils/cn';

interface Props {
  register: RegisterFunc;
  className?: string;
  listClassName?: string;
}

/**
 * The song everyone is asked to sing today (UTC), with that day's board: each singer's best run of
 * it today at Medium or harder. The API picks the song; this browser's song list names it, and a
 * song it does not have hides the panel.
 */
function SongOfTheDayPanel({ register, className, listClassName }: Props) {
  const navigate = useSmoothNavigate();
  const { data: songs } = useSongIndex();
  const { data, error, isLoading } = useSWR(DAILY_URL, fetchDaily, { revalidateOnFocus: false });
  const song = data?.songId ? songs.find((candidate) => candidate.id === data.songId) : undefined;

  if (error || (data && !song)) return null;

  return (
    <ScoreboardPanel
      className={cn('p-4 sm:p-6', className)}
      listClassName={listClassName}
      title="Song of the day"
      subtitle={song ? `${song.artist} — ${song.title} · today's best, Medium and harder` : ' '}
      action={
        song && (
          <Menu.Button
            size="small"
            {...register('song-of-the-day', () => navigate('game/', { song: song.id }))}
            data-test="song-of-the-day-sing">
            Sing it
          </Menu.Button>
        )
      }
      isLoading={isLoading || !song}
      isEmpty={data?.entries.length === 0}
      emptyMessage="Nobody has sung it yet today"
      data-test="song-of-the-day-panel">
      {song &&
        data?.entries.map((entry, index) => (
          <LeaderboardRow
            key={`${entry.name}-${index}`}
            entry={{ ...entry, songId: song.id, artist: song.artist, title: song.title }}
            position={index + 1}
            withSongDetails={false}
            data-test="song-of-the-day-row"
          />
        ))}
    </ScoreboardPanel>
  );
}

export default SongOfTheDayPanel;
