import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import useSWR from 'swr';

import { flairClass, signIn, useAccount } from '~/modules/account/account';

import '~/modules/account/flairs.css';
import { Chip } from '~/modules/elements/akui/chip';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import MenuWithLogo from '~/modules/elements/menu-with-logo';
import NoPrerender from '~/modules/elements/no-prerender';
import VideoPlayer, { VideoPlayerRef, VideoState } from '~/modules/elements/video-player';
import useBackgroundMusic from '~/modules/hooks/use-background-music';
import useQueryParam from '~/modules/hooks/use-query-param';
import useViewportSize from '~/modules/hooks/use-viewport-size';
import { fetchRun, flagRun, runUrl } from '~/modules/leaderboard/client';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import useSongIndex from '~/modules/songs/hooks/use-song-index';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';
import { cn } from '~/utils/cn';

/** The recording is nudged back into step with the video once it drifts further than this. */
const DRIFT_SECONDS = 0.15;
const SYNC_INTERVAL_MS = 250;

/**
 * One run on the board: who sang what and how well, and for a recorded run, their voice played
 * against the song's video, in step. Other signed-in players can vouch for it or report it here.
 */
function RunPage() {
  useBackgroundMusic(false);
  const id = useQueryParam('id');
  const { account } = useAccount();
  const { data: run, error, mutate } = useSWR(id ? runUrl(id) : null, fetchRun, { revalidateOnFocus: false });
  const { data: songs } = useSongIndex();
  const song = run ? songs.find((candidate) => candidate.id === run.songId) : undefined;
  const { width } = useViewportSize();
  // The menu's own width, less its padding
  const videoWidth = Math.min(width - 64, 640);

  const player = useRef<VideoPlayerRef>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [videoState, setVideoState] = useState(VideoState.UNSTARTED);
  const offsetMs = run?.recording?.offsetMs ?? 0;

  // Held in memory rather than streamed: the browser seeks a recording only where it can fetch any
  // part of it, and keeping it in step with the video is all seeking
  const { data: voiceUrl } = useSWR(
    run?.recording ? `${runUrl(run.id)}/recording` : null,
    async (url: string) => URL.createObjectURL(await (await fetch(url)).blob()),
    { revalidateOnFocus: false },
  );
  useEffect(
    () => () => {
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    },
    [voiceUrl],
  );

  // Keeps the voice where the video says it should be, and silent while the video is not playing
  useEffect(() => {
    if (videoState !== VideoState.PLAYING) {
      audio.current?.pause();
      return;
    }
    const interval = setInterval(async () => {
      const voice = audio.current;
      if (!voice || !player.current) return;
      const expected = ((await player.current.getCurrentTime()) * 1000 - offsetMs) / 1000;
      if (expected < 0 || expected > voice.duration) {
        voice.pause();
      } else if (voice.paused || Math.abs(voice.currentTime - expected) > DRIFT_SECONDS) {
        voice.currentTime = expected;
        void voice.play();
      }
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [videoState, offsetMs]);

  const playFromStart = () => {
    player.current?.seekTo(offsetMs / 1000);
    player.current?.playVideo();
  };

  const flag = async (kind: 'vouch' | 'report') => {
    if (!run) return;
    await flagRun(run.id, run.myFlag === kind ? null : kind);
    await mutate();
  };

  return (
    <MenuWithLogo>
      <Helmet>
        <title>{run ? `${run.name} — ${run.artist} — ${run.title}` : 'Run'} | DGG Karaoke</title>
      </Helmet>
      <NoPrerender>
        {error && <Menu.HelpText>This run is not on the board any more.</Menu.HelpText>}
        {run && (
          <div className="flex flex-col gap-4" data-test="run-page">
            <div className="flex flex-wrap items-center gap-2">
              <Typography className={cn('text-xl font-bold', flairClass(run))}>{run.name}</Typography>
              {run.status === 'recorded' && <Chip variant="blue">Recorded</Chip>}
              {run.status === 'verified' && <Chip variant="green">Verified</Chip>}
            </div>
            <Typography>
              {run.artist} — {run.title} · {difficultyName(run.tolerance)} ·{' '}
              <strong className="text-active">
                <ScoreText score={run.score} />
              </strong>{' '}
              points
            </Typography>

            {run.recording && song ? (
              <>
                <VideoPlayer
                  ref={player}
                  video={song.video}
                  width={videoWidth}
                  height={Math.round((videoWidth * 9) / 16)}
                  volume={50}
                  onStateChange={setVideoState}
                />
                <audio ref={audio} src={voiceUrl} preload="auto" data-test="run-recording" />
                <Menu.Button size="small" onClick={playFromStart} data-test="run-play">
                  Play from where they started singing
                </Menu.Button>
                <Menu.HelpText>
                  The video plays with the song; the voice is {run.name}&apos;s, as they sang it.
                </Menu.HelpText>
              </>
            ) : (
              <Menu.HelpText>
                {run.recording
                  ? 'This browser does not have the song to play it against.'
                  : 'This run has no recording.'}
              </Menu.HelpText>
            )}

            {run.recording && (
              <div className="flex flex-col gap-2" data-test="run-flags">
                <Menu.HelpText>
                  {run.vouches} vouched · {run.reports} reported
                </Menu.HelpText>
                {run.isOwn ? (
                  <Menu.HelpText>This is your run.</Menu.HelpText>
                ) : account ? (
                  <div className="flex gap-2">
                    <Menu.Button size="small" onClick={() => flag('vouch')} data-test="run-vouch">
                      {run.myFlag === 'vouch' ? 'Vouched — take it back' : 'Vouch: sounds right'}
                    </Menu.Button>
                    <Menu.Button size="small" onClick={() => flag('report')} data-test="run-report">
                      {run.myFlag === 'report' ? 'Reported — take it back' : 'Report it'}
                    </Menu.Button>
                  </div>
                ) : (
                  <Menu.Button size="small" onClick={signIn}>
                    Sign in to vouch for it or report it
                  </Menu.Button>
                )}
              </div>
            )}
          </div>
        )}
      </NoPrerender>
    </MenuWithLogo>
  );
}

export default RunPage;
