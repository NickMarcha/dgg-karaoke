import { useEffect, useState } from 'react';

import { Song } from '~/interfaces';
import { LoadSongOptions, loadSongById } from '~/modules/songs/load-song';

/** The song, loaded and processed for playing; nothing while there is no id to load. */
export default function useSong(songId: string | null, options?: LoadSongOptions) {
  const [song, setSong] = useState<Song | null>(null);
  const sourceType = options?.sourceType;
  const sharedSongId = options?.sharedSongId;

  useEffect(() => {
    let active = true;
    setSong(null);
    if (!songId) return;

    loadSongById(songId, { sourceType, sharedSongId })
      .then((loaded) => {
        if (active) setSong(loaded);
      })
      .catch(() => {
        if (active) setSong(null);
      });

    return () => {
      active = false;
    };
  }, [songId, sharedSongId, sourceType]);

  return {
    data: song,
  };
}
