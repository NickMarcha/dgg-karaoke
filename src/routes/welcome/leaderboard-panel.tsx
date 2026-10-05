import { useState } from 'react';
import useSWR from 'swr';

import { Selector } from '~/modules/elements/akui/selector';
import { fetchBoard, LEADERBOARD_URL } from '~/modules/leaderboard/client';
import LeaderboardRow from '~/modules/leaderboard/leaderboard-row';
import ScoreboardPanel from '~/modules/scoreboard/scoreboard-panel';
import { cn } from '~/utils/cn';

/**
 * The global board, from `GET /api/leaderboard`. Deliberately
 * skipped by `useKeyboardNav`: making 50 rows keyboard-traversable would add a navigation sink that
 * TV users hit by accident, so on a TV this is a display of the top 10 and nothing more.
 */
function LeaderboardPanel({ className, listClassName }: { className?: string; listClassName?: string }) {
  const [verified, setVerified] = useState(false);
  const { data, error, isLoading } = useSWR(verified ? `${LEADERBOARD_URL}?verified=1` : LEADERBOARD_URL, fetchBoard, {
    revalidateOnFocus: false,
  });

  return (
    // Same box the main menu sits in, so the panel reads as part of it rather than a bolted-on
    // widget — and the same `ScoreboardPanel` the post-game boards use, so a board looks like a board
    <ScoreboardPanel
      className={cn('p-4 sm:p-6', className)}
      // Passed through so a caller can trade the shared five-row list height for one of its own —
      // the tiled menu's rail is as tall as the screen and would otherwise stop a long way short.
      listClassName={listClassName}
      title="Global leaderboard"
      subtitle={verified ? 'Verified runs from the last 14 days' : 'Highest scores from the last 14 days'}
      action={
        // Mouse only, like the rows: a TV has no use for the switch and would trip over it
        <Selector value={verified ? 'verified' : 'all'} onChange={(value) => setVerified(value === 'verified')}>
          {(['all', 'verified'] as const).map((value) => (
            <Selector.Item
              key={value}
              value={value}
              size="mini"
              className="px-3 text-sm"
              aria-pressed={verified === (value === 'verified')}
              data-test={`leaderboard-filter-${value}`}>
              {value === 'all' ? 'All' : 'Verified only'}
            </Selector.Item>
          ))}
        </Selector>
      }
      isLoading={isLoading}
      error={error}
      isEmpty={data?.entries.length === 0}
      emptyMessage={verified ? 'No verified runs yet' : 'No results yet'}
      data-test="leaderboard-panel">
      {data?.entries.map((entry, index) => (
        <LeaderboardRow key={`${entry.songId}-${entry.name}-${index}`} entry={entry} position={index + 1} />
      ))}
    </ScoreboardPanel>
  );
}

export default LeaderboardPanel;
