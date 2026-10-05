import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { GAME_MODE, SingSetup, Song } from '~/interfaces';
import { Menu } from '~/modules/elements/akui/menu';
import VideoPlayer, { VideoPlayerRef, VideoState } from '~/modules/elements/video-player';
import CanvasDrawing from '~/modules/game-engine/drawing/index';
import GameState from '~/modules/game-engine/game-state/game-state';
import { fetchRunNotes, RunDetails, runUrl } from '~/modules/leaderboard/client';
import { DecodedFrequencyRecord } from '~/modules/leaderboard/notes-payload';
import { PlayerNumber } from '~/modules/players/player-number';
import useSong from '~/modules/songs/hooks/use-song';
import getSongFirstNoteMs from '~/modules/songs/utils/get-song-first-note-ms';
import Lyrics from '~/routes/game/singing/game-overlay/components/lyrics';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';

/** The voice is nudged back into step with the video once it drifts further than this. */
const DRIFT_SECONDS = 0.15;
const FRAME_MS = 1000 / 60;
/** A replay without a recording starts this long before the first note. */
const LEAD_IN_MS = 2_000;
/** The canvas is drawn at the game's resolution and scaled down, so notes look as they do in the game. */
const CANVAS_WIDTH = 1920;
const REPLAY_PLAYER: PlayerNumber = 0;
const replayPlayers = (): PlayerNumber[] => [REPLAY_PLAYER];

/**
 * The song as the run was sung: the merged track, or one singer's own track of a duet, as the only
 * track, so the replay draws one lane and scores it as the game did.
 */
function replaySong(song: Song, run: Pick<RunDetails, 'mergedTrack' | 'trackIndex'>): Song {
  if (run.mergedTrack) return song;
  const track = song.tracks[run.trackIndex] ?? song.tracks[0]!;
  return { ...song, tracks: [track], mergedTrack: track };
}

/**
 * Feeds a run's readings into the game's own state as the video reaches them, so the game's renderer
 * draws them and its scoring counts them: what the singer saw, and the score the board holds. Going
 * back in the video starts the run again from its first reading.
 */
class Replay {
  private fed = 0;

  public constructor(
    private song: Song,
    private singSetup: SingSetup,
    private records: DecodedFrequencyRecord[],
  ) {
    this.restart();
  }

  public advance = (videoMs: number) => {
    const songMs = videoMs - this.song.gap;
    if (this.fed > 0 && this.records[this.fed - 1]!.timestamp > songMs + 500) this.restart();
    GameState.setCurrentTime(videoMs);
    this.feed(songMs);
  };

  /** The video is over: the rest of the run counts, so the replay ends on the run's whole score. */
  public finish = () => this.feed(Infinity);

  private feed = (untilSongMs: number) => {
    const player = GameState.getPlayer(REPLAY_PLAYER)!;
    while (this.fed < this.records.length && this.records[this.fed]!.timestamp <= untilSongMs) {
      const { timestamp, frequency } = this.records[this.fed]!;
      player.updatePlayerNotes(timestamp, frequency);
      this.fed++;
    }
  };

  private restart = () => {
    GameState.setSong(this.song);
    GameState.setSingSetup(this.singSetup);
    this.fed = 0;
  };
}

interface Props {
  run: RunDetails;
  width: number;
  /** The singer's voice, in memory, when the run was recorded. */
  voiceUrl?: string;
}

/** A run drawn over its song by the game's own renderer, with the singer's voice when it was recorded. */
export default function RunReplay({ run, width, voiceUrl }: Props) {
  'use no memo'; // The score and lyrics read GameState while rendering, which changes every frame
  const { data: loaded } = useSong(run.songId);
  const { data: records, error } = useSWR(`${runUrl(run.id)}/notes`, fetchRunNotes, { revalidateOnFocus: false });
  const height = Math.round((width * 9) / 16);

  const player = useRef<VideoPlayerRef>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lyrics = useRef<HTMLDivElement>(null);
  const replay = useRef<Replay | null>(null);
  const [videoState, setVideoState] = useState(VideoState.UNSTARTED);
  const [, setFrame] = useState(0);

  // Kept across a refetch of the run (a vouch), which would otherwise start the replay over
  const { mergedTrack, trackIndex } = run;
  const song = useMemo(
    () => (loaded ? replaySong(loaded, { mergedTrack, trackIndex }) : null),
    [loaded, mergedTrack, trackIndex],
  );
  const offsetMs = run.recording?.offsetMs ?? (song ? Math.max(0, getSongFirstNoteMs(song) - LEAD_IN_MS) : 0);

  useEffect(() => {
    if (!song || !records) return;
    const singSetup = {
      id: `replay-${run.id}`,
      mode: GAME_MODE.DUEL,
      tolerance: run.tolerance,
      players: [{ number: REPLAY_PLAYER, track: 0 }],
    } as SingSetup;
    replay.current = new Replay(song, singSetup, records);
    return () => {
      replay.current = null;
      GameState.resetSingSetup();
    };
  }, [song, records, run.id, run.tolerance]);

  useEffect(() => {
    if (!canvas.current || !lyrics.current || !records || !song) return;
    const scale = canvas.current.height / canvas.current.offsetHeight;
    const drawer = new CanvasDrawing(canvas.current, lyrics.current.offsetHeight * scale, 1, replayPlayers);
    drawer.start();
    return () => drawer.end();
  }, [records, song, width]);

  // Each frame: the run up to where the video is, and the voice kept where the video says it should be
  useEffect(() => {
    if (videoState === VideoState.ENDED) {
      replay.current?.finish();
      setFrame(Infinity);
    }
    if (videoState !== VideoState.PLAYING) {
      audio.current?.pause();
      return;
    }
    const interval = setInterval(async () => {
      if (!player.current) return;
      const videoMs = (await player.current.getCurrentTime()) * 1000;
      replay.current?.advance(videoMs);
      setFrame(videoMs);

      const voice = audio.current;
      if (!voice || !voiceUrl) return;
      const expected = (videoMs - offsetMs) / 1000;
      if (expected < 0 || expected > voice.duration) {
        voice.pause();
      } else if (voice.paused || Math.abs(voice.currentTime - expected) > DRIFT_SECONDS) {
        voice.currentTime = expected;
        void voice.play();
      }
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [videoState, offsetMs, voiceUrl]);

  if (error) return <Menu.HelpText>This run&apos;s notes could not be loaded.</Menu.HelpText>;
  if (!song || !records) return <Menu.HelpText>Loading the run…</Menu.HelpText>;

  const playFromStart = () => {
    player.current?.seekTo(offsetMs / 1000);
    player.current?.playVideo();
  };
  const playerState = GameState.getPlayer(REPLAY_PLAYER);

  return (
    <div className="flex flex-col gap-2" data-test="run-replay">
      <div className="relative overflow-hidden" style={{ width, height }}>
        <VideoPlayer
          ref={player}
          video={song.video}
          width={width}
          height={height}
          volume={song.manualVolume}
          startAt={song.videoGap ?? 0}
          onStateChange={setVideoState}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col bg-black/20 font-bold">
          <canvas
            ref={canvas}
            width={CANVAS_WIDTH}
            height={Math.round(CANVAS_WIDTH * (height / width))}
            className="absolute inset-0 h-full w-full"
          />
          <div className="stroke-text typography z-10 flex flex-1 items-center justify-end pr-3 text-xl">
            <span data-test="run-replay-score" data-score={Math.round(playerState?.getScore() ?? 0)}>
              <ScoreText score={playerState?.getScore() ?? 0} />
            </span>
          </div>
          <div className="z-10 py-2 text-sm" ref={lyrics}>
            {playerState && (
              <Lyrics
                player={{ number: REPLAY_PLAYER }}
                bottom
                effectsEnabled={false}
                showStatusForAllPlayers={false}
              />
            )}
          </div>
        </div>
      </div>
      {voiceUrl && <audio ref={audio} src={voiceUrl} preload="auto" data-test="run-recording" />}
      <Menu.Button size="small" onClick={playFromStart} data-test="run-play">
        {run.recording ? 'Play from where they started singing' : 'Play from the first note'}
      </Menu.Button>
    </div>
  );
}
