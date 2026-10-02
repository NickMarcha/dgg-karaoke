import { MutableRefObject, useEffect } from 'react';
import YouTube from 'react-youtube';

import { MasterVolumeSetting, useSettingValue } from '~/routes/settings/settings-state';

export default function usePlayerVolume(playerRef: MutableRefObject<YouTube | null>, volume: number | undefined) {
  const [masterVolume] = useSettingValue(MasterVolumeSetting);
  useEffect(() => {
    playerRef.current?.getInternalPlayer()?.setVolume(Math.round((volume ?? 0.5) * masterVolume * 100));
  }, [playerRef, volume, masterVolume]);
}
