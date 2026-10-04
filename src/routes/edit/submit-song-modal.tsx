import { useState } from 'react';
import { mutate } from 'swr';

import { useAccount } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';
import Modal from '~/modules/elements/modal';
import { MY_SONGS_URL, submitSong } from '~/modules/songs/community';
import useSong from '~/modules/songs/hooks/use-song';

interface Props {
  /** The song just saved in the editor. */
  songId: string;
}

/**
 * Asked after every save in the editor, while signed in: whether to send the song to DGG Karaoke.
 * A moderator checks it first; until then others can find and play it as an unverified song.
 */
export default function SubmitSongModal({ songId }: Props) {
  const { account } = useAccount();
  const song = useSong(songId);
  const [state, setState] = useState<'asking' | 'sending' | 'sent' | 'closed'>('asking');
  const [error, setError] = useState<string | null>(null);

  const close = () => setState('closed');
  const submit = async () => {
    if (!song.data) return;
    setState('sending');
    setError(null);
    try {
      await submitSong(song.data);
      await mutate(MY_SONGS_URL);
      setState('sent');
    } catch (failure) {
      setError((failure as Error).message);
      setState('asking');
    }
  };

  return (
    <Modal open={!!account && !!song.data && state !== 'closed'} onClose={close} withPortal>
      <Menu modal data-test="submit-song-prompt">
        <Menu.Header>Submit this song?</Menu.Header>
        {state === 'sent' ? (
          <Menu.HelpText data-test="submit-song-sent">
            Sent. A moderator checks it before it joins everyone&apos;s song list; until then others can find it as an
            unverified song. Its status is under your songs below.
          </Menu.HelpText>
        ) : (
          <Menu.HelpText>
            Send <strong className="text-active">{song.data && `${song.data.artist} — ${song.data.title}`}</strong> to
            DGG Karaoke as {account?.username}? A moderator checks it before it joins everyone&apos;s song list.
          </Menu.HelpText>
        )}
        {error && <Menu.HelpText className="text-danger">{error}</Menu.HelpText>}
        {state !== 'sent' && (
          <Menu.Button size="small" onClick={submit} disabled={state === 'sending'} data-test="submit-song">
            {state === 'sending' ? 'Sending…' : 'Submit'}
          </Menu.Button>
        )}
        <Menu.Button size="small" onClick={close} data-test="submit-song-close">
          {state === 'sent' ? 'Close' : 'Keep it to myself'}
        </Menu.Button>
      </Menu>
    </Modal>
  );
}
