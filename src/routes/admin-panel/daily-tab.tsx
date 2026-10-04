import dayjs from 'dayjs';
import { useState } from 'react';
import useSWR from 'swr';

import { readJson } from '~/modules/api';
import { Button } from '~/modules/elements/akui/button';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import { Input } from '~/modules/elements/input';
import useSongIndex from '~/modules/songs/hooks/use-song-index';

interface ScheduledDay {
  day: string;
  songId: string;
  /** The moderator who chose it; null for the automatic pick. */
  chosenBy: string | null;
}

const SCHEDULE_URL = '/api/moderation/daily';
const SEARCH_RESULTS = 6;

/** The song of the day for the coming fortnight (UTC days): the automatic pick, or one a moderator chose. */
export default function DailyTab() {
  const { data: songs } = useSongIndex();
  const { data, mutate } = useSWR(
    SCHEDULE_URL,
    async (url: string) => (await readJson<{ days: ScheduledDay[] }>(await fetch(url))).days,
    { revalidateOnFocus: false },
  );
  const [changing, setChanging] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameOf = (songId: string) => {
    const song = songs.find((candidate) => candidate.id === songId);
    return song ? `${song.artist} — ${song.title}` : songId;
  };
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? songs.filter((song) => words.every((word) => song.search.includes(word))).slice(0, SEARCH_RESULTS)
    : [];

  const change = async (day: string, request: RequestInit) => {
    setError(null);
    try {
      const response = await fetch(`${SCHEDULE_URL}/${day}`, request);
      if (!response.ok) await readJson(response);
      setChanging(null);
      setQuery('');
      await mutate();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const choose = (day: string, songId: string) =>
    change(day, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ songId }) });

  return (
    <>
      <Menu.HelpText>
        Each day&apos;s song is picked from the popular songs unless a moderator chooses one. Days are in UTC.
      </Menu.HelpText>
      {error && <Typography className="text-danger">{error}</Typography>}
      <ul className="flex flex-col gap-2" data-test="admin-daily-list">
        {data?.map((entry) => (
          <li
            key={entry.day}
            className="flex flex-col gap-2 rounded-xl bg-black/40 px-4 py-2"
            data-test="admin-daily-day">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <Typography className="truncate font-bold">{nameOf(entry.songId)}</Typography>
                <Typography className="text-sm">
                  {dayjs(entry.day).format('ddd D MMM')} ·{' '}
                  {entry.chosenBy ? `chosen by ${entry.chosenBy}` : 'automatic'}
                </Typography>
              </div>
              {entry.chosenBy && (
                <Button size="small" fullWidth={false} onClick={() => change(entry.day, { method: 'DELETE' })}>
                  Use automatic
                </Button>
              )}
              <Button
                size="small"
                fullWidth={false}
                onClick={() => setChanging(changing === entry.day ? null : entry.day)}
                data-test="admin-daily-change">
                Change
              </Button>
            </div>
            {changing === entry.day && (
              <div className="flex flex-col gap-2">
                <Input
                  focused={false}
                  label="Song"
                  value={query}
                  onChange={setQuery}
                  placeholder="An artist or title"
                  data-test="admin-daily-search"
                />
                {matches.map((song) => (
                  <Button
                    key={song.id}
                    size="small"
                    onClick={() => choose(entry.day, song.id)}
                    data-test="admin-daily-pick">
                    {song.artist} — {song.title}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
