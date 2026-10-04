import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

import { readJson } from '~/modules/api';
import { Button } from '~/modules/elements/akui/button';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import { Selector } from '~/modules/elements/akui/selector';
import { Input } from '~/modules/elements/input';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';
import {
  CommunitySong,
  CommunitySongStatus,
  moderationSongsUrl,
  publishSubmission,
  rejectSubmission,
} from '~/modules/songs/community';

dayjs.extend(relativeTime);

const views: { status: CommunitySongStatus; label: string }[] = [
  { status: 'submitted', label: 'Waiting' },
  { status: 'published', label: 'Published' },
  { status: 'rejected', label: 'Rejected' },
];

/**
 * The review queue for songs the community submitted. A moderator opens a song in the editor to
 * check or correct it, then publishes it to everyone's song list or rejects it with a reason the
 * submitter sees.
 */
export default function SongsTab() {
  const navigate = useSmoothNavigate();
  const [status, setStatus] = useState<CommunitySongStatus>('submitted');
  const [query, setQuery] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data } = useSWR(
    moderationSongsUrl(status, query.trim()),
    async (url: string) => (await readJson<{ songs: CommunitySong[] }>(await fetch(url))).songs,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setRejecting(null);
      setReason('');
      // Every list this tab has fetched: a song moves between them
      await mutate((key) => typeof key === 'string' && key.startsWith('/api/moderation/songs'));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <Selector value={status} onChange={(value) => setStatus(value as CommunitySongStatus)}>
        {views.map((view) => (
          <Selector.Item
            key={view.status}
            value={view.status}
            size="small"
            aria-pressed={status === view.status}
            data-test={`admin-songs-${view.status}`}>
            {view.label}
          </Selector.Item>
        ))}
      </Selector>
      {/* A mouse page: keyboard navigation would rebuild its order with every search result */}
      <Input
        focused={false}
        label="Find"
        value={query}
        onChange={setQuery}
        placeholder="An artist or title"
        data-test="admin-songs-search"
      />
      {error && <Typography className="text-danger">{error}</Typography>}
      {data?.length === 0 && <Menu.HelpText>No songs here.</Menu.HelpText>}
      <ul className="flex flex-col gap-2" data-test="admin-songs-list">
        {data?.map((song) => (
          <li key={song.id} className="flex flex-col gap-2 rounded-xl bg-black/40 px-4 py-2" data-test="admin-song">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <Typography className="truncate font-bold">
                  {song.artist} — {song.title}
                </Typography>
                <Typography className="truncate text-sm">
                  {song.submittedBy ?? 'A deleted account'} · {dayjs(song.updatedAt).fromNow()}
                  {song.rejectionReason && ` · ${song.rejectionReason}`}
                </Typography>
              </div>
              <Button
                size="small"
                fullWidth={false}
                onClick={() => navigate('edit/song/', { submission: song.id })}
                data-test="admin-song-open">
                Open
              </Button>
              {song.status !== 'published' && (
                <Button
                  size="small"
                  fullWidth={false}
                  onClick={() => act(() => publishSubmission(song.id))}
                  data-test="admin-song-publish">
                  Publish
                </Button>
              )}
              {song.status === 'submitted' && rejecting !== song.id && (
                <Button
                  size="small"
                  fullWidth={false}
                  onClick={() => setRejecting(song.id)}
                  data-test="admin-song-reject">
                  Reject
                </Button>
              )}
            </div>
            {rejecting === song.id && (
              <div className="flex items-end gap-2">
                <Input
                  focused={false}
                  className="flex-1"
                  label="Why"
                  value={reason}
                  onChange={setReason}
                  placeholder="What the singer should fix"
                  data-test="admin-song-reject-reason"
                />
                <Button size="small" fullWidth={false} onClick={() => setRejecting(null)}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  fullWidth={false}
                  disabled={!reason.trim()}
                  onClick={() => act(() => rejectSubmission(song.id, reason.trim()))}
                  data-test="admin-song-reject-confirm">
                  Reject
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
