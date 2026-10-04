import styled from '@emotion/styled';
import { Button, IconButton } from '@mui/material';
import { Helmet } from 'react-helmet';
import { Link } from 'wouter';

import { Icon } from '~/modules/elements/akui/icon';
import { useBackground } from '~/modules/elements/background-context';
import NoPrerender from '~/modules/elements/no-prerender';
import useBackgroundMusic from '~/modules/hooks/use-background-music';
import useQueryParam from '~/modules/hooks/use-query-param';
import { buildUrl } from '~/modules/hooks/use-smooth-navigate';
import useSongIndex from '~/modules/songs/hooks/use-song-index';
import SongDao from '~/modules/songs/songs-service';
import convertSongToTxt from '~/modules/songs/utils/convert-song-to-txt';
import SongsTable from '~/routes/edit/components/songs-table';
import MySubmissions from '~/routes/edit/my-submissions';
import SubmitSongModal from '~/routes/edit/submit-song-modal';

export default function SongList() {
  useBackground(false);
  useBackgroundMusic(false);
  const { data, reload } = useSongIndex(true);
  // Set by the editor on the way here after a save: the song to offer for submission
  const submit = useQueryParam('submit');
  const songId = useQueryParam('id');

  if (!data) return <>Loading</>;

  return (
    <>
      <Helmet>
        <title>Song List | DGG Karaoke</title>
      </Helmet>
      <NoPrerender>
        <Container>
          {submit && <SubmitSongModal songId={submit} />}

          <div className="grid grid-cols-12 items-center gap-y-4">
            <div className="col-span-3 flex items-center justify-start">
              <Link to="menu/" asChild>
                <Button data-test="main-menu-link">Return to main menu</Button>
              </Link>
            </div>
            <div className="col-span-6 flex items-center justify-center">
              <h4 className="text-lg">{data.length} songs</h4>
            </div>
            <div className="col-span-3 flex items-center justify-end">
              <Link to="convert/" asChild>
                <Button data-test="convert-song" variant={'contained'}>
                  Import UltraStar .TXT
                </Button>
              </Link>
            </div>
            <div className="col-span-12">
              <SongsTable
                globalFilter={songId}
                data={data}
                renderRowActions={({ row }) => (
                  <>
                    <Link to={buildUrl(`edit/song/`, { song: row.original.id, id: null })} asChild>
                      <IconButton title="Edit the song" data-test="edit-song" data-song={row.original.id}>
                        <Icon icon="ic:baseline-edit" />
                      </IconButton>
                    </Link>
                    <IconButton
                      title="Download .txt file"
                      onClick={async () => {
                        const songData = await SongDao.get(row.original.id);
                        const txt = convertSongToTxt(songData);

                        const anchor = document.createElement('a');
                        anchor.href = `data:plain/text;charset=utf-8,${encodeURIComponent(txt)}`;
                        anchor.download = `${SongDao.generateSongFile(songData)}.txt`;
                        document.body.appendChild(anchor);
                        anchor.click();
                        document.body.removeChild(anchor);
                      }}
                      data-test="download-song"
                      data-song={row.original.id}>
                      <Icon icon="ic:baseline-download" />
                    </IconButton>
                    {!row.original.isDeleted && (
                      <IconButton
                        title="Hide the song"
                        onClick={async () => {
                          await SongDao.softDeleteSong(row.original.id);
                          reload();
                        }}
                        data-test="hide-song"
                        data-song={row.original.id}>
                        <Icon icon="ic:baseline-visibility" />
                      </IconButton>
                    )}
                    {row.original.isDeleted && (
                      <IconButton
                        title="Restore the song"
                        onClick={async () => {
                          await SongDao.restoreSong(row.original.id);
                          reload();
                        }}
                        data-test="restore-song"
                        data-song={row.original.id}>
                        <Icon icon="ic:baseline-visibility-off" />
                      </IconButton>
                    )}
                    <IconButton
                      className={!row.original.local ? 'cursor-default! opacity-50' : ''}
                      title="Delete the song"
                      onClick={async () => {
                        const proceed = global.confirm(`Are you sure you want to delete this song?`);

                        if (proceed) {
                          await SongDao.deleteSong(row.original.id);
                          reload();
                        }
                      }}
                      data-test="delete-song"
                      data-song={row.original.id}>
                      <Icon icon="ic:baseline-delete" />
                    </IconButton>
                  </>
                )}
              />
            </div>
            <div className="col-span-12">
              <MySubmissions />
            </div>
          </div>
        </Container>
      </NoPrerender>
    </>
  );
}

const Container = styled.div`
  margin: 0 auto;
  height: 100%;
  width: 1260px;
  background: white;
  padding: 60px 20px 0 20px;
`;
