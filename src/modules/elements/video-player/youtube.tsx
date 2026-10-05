import { ForwardedRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import YouTube from 'react-youtube';
import { ValuesType } from 'utility-types';

import { seconds } from '~/interfaces';
import { VideoState } from '~/modules/elements/video-player/video-state';
import usePlayerVolume from '~/modules/hooks/use-player-volume';
import useUnstuckYouTubePlayer from '~/modules/hooks/use-unstuck-you-tube-player';

const stateMap = {
  [YouTube.PlayerState.UNSTARTED]: VideoState.UNSTARTED,
  [YouTube.PlayerState.ENDED]: VideoState.ENDED,
  [YouTube.PlayerState.PLAYING]: VideoState.PLAYING,
  [YouTube.PlayerState.PAUSED]: VideoState.PAUSED,
  [YouTube.PlayerState.BUFFERING]: VideoState.BUFFERING,
  [YouTube.PlayerState.CUED]: VideoState.CUED,
} as const;

/** How long after playback starts the captions module is unloaded again, once a second. */
const CAPTIONS_WATCH_MS = 10_000;

interface Props {
  video: string;
  autoplay?: boolean;
  controls?: boolean;
  disablekb?: boolean;
  volume?: number;
  startAt?: number;
  onStateChange?: (state: VideoState) => void;
  /** The player finished its API handshake. Commands sent before this (loadVideoById, playVideo…)
   * are posted to an iframe that isn't listening yet and are dropped, silently and for good. */
  onReady?: () => void;
  width: number;
  height: number;
  ref?: ForwardedRef<VideoPlayerRef>;
}

export interface LoadVideByIdOpts {
  videoId: string;
  startSeconds: number;
  endSeconds: number;
}

export interface VideoPlayerRef {
  getStatus: () => ValuesType<typeof stateMap>;
  seekTo: (time: seconds) => void;
  setPlaybackSpeed: (speed: number) => void;
  setVolume: (newVolume: number) => void;
  getCurrentTime: () => Promise<seconds>;
  loadVideoById: (opts: LoadVideByIdOpts) => void;
  setSize: (w: number, h: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getDuration: () => Promise<number>;
}

export default function YoutubeVideoPlayer({
  video,
  autoplay,
  startAt,
  controls,
  disablekb,
  volume,
  width,
  height,
  onStateChange,
  onReady,
  ref,
}: Props) {
  const player = useRef<YouTube | null>(null);
  // The YouTube player itself, from its events: the wrapper passes on no `unloadModule`
  const native = useRef<{ unloadModule?: (name: string) => void } | null>(null);
  const [currentStatus, setCurrentStatus] = useState(YouTube.PlayerState.UNSTARTED);

  const playerKey = useUnstuckYouTubePlayer(player, currentStatus);
  usePlayerVolume(player, volume);

  // Captions sit where the lyrics are read, and no player setting turns them off: a viewer's own
  // preference overrides `cc_load_policy`. Unloading the module does (undocumented, as dgg-radio
  // found), and it can load any time in the first seconds of playback, so it is unloaded repeatedly.
  useEffect(() => {
    if (currentStatus !== YouTube.PlayerState.PLAYING) return;
    const hideCaptions = () => {
      try {
        native.current?.unloadModule?.('captions');
        native.current?.unloadModule?.('cc');
      } catch {
        // Not loaded yet; the next call catches it
      }
    };
    hideCaptions();
    const interval = setInterval(hideCaptions, 1_000);
    const stop = setTimeout(() => clearInterval(interval), CAPTIONS_WATCH_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [currentStatus, playerKey]);

  useImperativeHandle(ref, () => ({
    getStatus: () => stateMap[currentStatus],
    setSize: (w, h) => player.current?.getInternalPlayer()!.setSize(w, h),
    seekTo: (timeSec: seconds) => player.current?.getInternalPlayer()!.seekTo(timeSec, true),
    setPlaybackSpeed: (speed: number) => player.current?.getInternalPlayer()!.setPlaybackRate(Number(speed)),
    setVolume: (newVolume: number) => player.current?.getInternalPlayer()!.setVolume(newVolume),
    getCurrentTime: () => player.current?.getInternalPlayer?.()?.getCurrentTime?.() ?? Promise.resolve(0),
    loadVideoById: (opts) => player.current?.getInternalPlayer()!.loadVideoById(opts),
    playVideo: () => {
      // console.log('play');
      player.current?.getInternalPlayer()!.playVideo();
    },
    pauseVideo: () => {
      // console.log('paused');
      return player.current?.getInternalPlayer()!.pauseVideo();
    },
    getDuration: () => player.current?.getInternalPlayer?.()?.getDuration?.() ?? Promise.resolve(0),
  }));

  return (
    <YouTube
      title=" "
      key={`${video}-${playerKey}`}
      ref={player}
      videoId={video}
      opts={{
        width: width,
        height: height,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          fs: 0,
          controls: controls ? 1 : 0,
          start: startAt ?? 0,
          end: 0,
          disablekb: disablekb ? 1 : 0,
          modestbranding: 1,
          // Annotations sit where the lyrics are read; captions are unloaded above
          cc_load_policy: 0,
          iv_load_policy: 3,
        },
      }}
      onReady={(e) => {
        native.current = e.target;
        onReady?.();
      }}
      onPlaybackRateChange={(e) => {
        console.log('onPlaybackRateChange', e.data);
      }}
      onStateChange={(e) => {
        native.current = e.target;
        setCurrentStatus(e.data);
        onStateChange?.(stateMap[e.data]);
      }}
    />
  );
}
