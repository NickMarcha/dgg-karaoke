import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useState } from 'react';
import useSWR from 'swr';

import { flairClass } from '~/modules/account/account';

import '~/modules/account/flairs.css';
import { readJson } from '~/modules/api';
import { Button } from '~/modules/elements/akui/button';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import { Input } from '~/modules/elements/input';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { BoardEntry } from '~/modules/leaderboard/types';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';
import { cn } from '~/utils/cn';

dayjs.extend(relativeTime);

interface Row extends BoardEntry {
  id: string;
}

const rowsUrl = (query: string) =>
  query ? `/api/moderation/leaderboard?${new URLSearchParams({ query })}` : '/api/moderation/leaderboard';

/** Moderators take down leaderboard rows that should not be there. Removing one also drops its run. */
export default function LeaderboardTab() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Removing cannot be undone, so it takes a second click on the same row
  const [confirming, setConfirming] = useState<string | null>(null);
  const trimmed = query.trim();
  const { data, mutate } = useSWR(
    rowsUrl(trimmed),
    async (url: string) => (await readJson<{ rows: Row[] }>(await fetch(url))).rows,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const remove = async (row: Row) => {
    setError(null);
    setConfirming(null);
    const response = await fetch(`/api/moderation/leaderboard/${row.id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) setError('The row could not be removed. Try again in a moment.');
    await mutate();
  };

  return (
    <>
      <Menu.HelpText>The newest rows on the boards. Removing one takes the run behind it too.</Menu.HelpText>
      {/* A mouse page: keyboard navigation would rebuild its order with every search result */}
      <Input
        focused={false}
        label="Find"
        value={query}
        onChange={setQuery}
        placeholder="A singer, artist or title"
        data-test="admin-leaderboard-search"
      />
      {error && <Typography className="text-danger">{error}</Typography>}
      {data?.length === 0 && <Menu.HelpText>No rows{trimmed ? ' match' : ' yet'}.</Menu.HelpText>}
      <ul className="flex flex-col gap-2" data-test="admin-leaderboard-list">
        {data?.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 rounded-xl bg-black/40 px-4 py-2"
            data-test="admin-leaderboard-row">
            <div className="flex min-w-0 flex-1 flex-col">
              <Typography className={cn('truncate font-bold', flairClass(row))}>{row.name}</Typography>
              <Typography className="truncate text-sm">
                {row.artist} — {row.title} · {difficultyName(row.tolerance)} · <ScoreText score={row.score} /> ·{' '}
                {dayjs(row.createdAt).fromNow()}
              </Typography>
            </div>
            {confirming === row.id ? (
              <>
                <Button size="small" fullWidth={false} onClick={() => setConfirming(null)}>
                  Keep
                </Button>
                <Button
                  size="small"
                  fullWidth={false}
                  className="text-danger"
                  onClick={() => remove(row)}
                  data-test="admin-leaderboard-confirm-remove">
                  Remove for good
                </Button>
              </>
            ) : (
              <Button
                size="small"
                fullWidth={false}
                onClick={() => setConfirming(row.id)}
                data-test="admin-leaderboard-remove">
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
