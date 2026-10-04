import { IconButton, Paper } from '@mui/material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Helmet } from 'react-helmet';
import useSWR from 'swr';
import { Link } from 'wouter';

import { Song } from '~/interfaces';
import { Icon } from '~/modules/elements/akui/icon';
import useBackgroundMusic from '~/modules/hooks/use-background-music';
import useQueryParam from '~/modules/hooks/use-query-param';
import { fetchSubmission } from '~/modules/songs/community';
import useSong from '~/modules/songs/hooks/use-song';
import SongDao from '~/modules/songs/songs-service';
import convertTxtToSong from '~/modules/songs/utils/convert-txt-to-song';
import { processSong } from '~/modules/songs/utils/process-song/process-song';
import { LazyConvert } from '~/routes/convert/convert';

dayjs.extend(relativeTime);

/** A community submission, as a moderator opens it from the admin page's queue. */
const useSubmission = (id: string | null) =>
  useSWR(id ? ['submission', id] : null, async ([, submissionId]) =>
    processSong({ ...convertTxtToSong((await fetchSubmission(submissionId)).txt), local: false }),
  );

export default function Edit() {
  const songId = useQueryParam('song');
  const submissionId = useQueryParam('submission');
  useBackgroundMusic(false);
  const librarySong = useSong(submissionId ? '' : (songId ?? ''));
  const submission = useSubmission(submissionId);
  const song: Song | null | undefined = submissionId ? submission.data : librarySong.data;

  if (submission.error) return <>{(submission.error as Error).message}</>;
  if (!song) return <>Loading</>;

  return (
    <Paper elevation={2} sx={{ minHeight: '100vh', maxWidth: '1260px', margin: '0 auto' }} className="pt-4 md:pt-8">
      <Helmet>
        <title>Edit Song | DGG Karaoke</title>
      </Helmet>
      <div className="flex items-center justify-between gap-1 px-2 text-[14px]">
        <Link to={submissionId ? 'admin/' : 'edit/list/'} asChild>
          <a>{submissionId ? 'Return to the review queue' : 'Return to the song list'}</a>
        </Link>
        <span data-test="edit-song-heading">
          <b>
            {song.artist} - {song.title}
          </b>
          {!submissionId && song.local && (
            <IconButton
              title="Delete the song"
              onClick={async () => {
                const proceed = global.confirm(`Are you sure you want to delete this song?`);

                if (proceed) await SongDao.deleteSong(song.id);
              }}
              data-test="delete-song">
              <Icon icon="ic:baseline-delete" />
            </IconButton>
          )}
        </span>
        <abbr title={song.lastUpdate}>
          Updated: <b>{song.lastUpdate ? dayjs(song.lastUpdate).fromNow() : '-'}</b>
        </abbr>
      </div>
      <LazyConvert key={submissionId ?? song.id} song={song} submissionId={submissionId ?? undefined} />
    </Paper>
  );
}
