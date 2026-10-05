import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';

import { GAME_MODE, SingSetup, Song } from '~/interfaces';
import { apiBareSocketUrl } from '~/modules/api';
import VideoPlayer, { VideoPlayerRef, VideoState } from '~/modules/elements/video-player';
import CanvasDrawing from '~/modules/game-engine/drawing/index';
import styles from '~/modules/game-engine/drawing/styles';
import GameState from '~/modules/game-engine/game-state/game-state';
import useBackgroundMusic from '~/modules/hooks/use-background-music';
import useQueryParam from '~/modules/hooks/use-query-param';
import useViewportSize from '~/modules/hooks/use-viewport-size';
import { ReceivedStreamPacket } from '~/modules/online/streaming/types';
import { PlayerNumber } from '~/modules/players/player-number';
import useSong from '~/modules/songs/hooks/use-song';
import Lyrics from '~/routes/game/singing/game-overlay/components/lyrics';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';
import { StreamFeed } from '~/routes/stream/stream-feed';

/** How far behind the singers the stream plays: room for every singer's packets to arrive. */
const DEFAULT_DELAY_MS = 600;
const FRAME_MS = 1000 / 60;
/** The video is put back where it belongs once it is this far off; smaller drifts are left alone. */
const SEEK_THRESHOLD_MS = 1_000;
const RECONNECT_MS = 3_000;
const CANVAS_WIDTH = 1920;

/** Every singer sang the merged track online, so each lane is the merged track. */
const streamSong = (song: Song): Song => ({ ...song, tracks: song.tracks.map(() => song.mergedTrack) });

/**
 * A moderator's OBS browser source (docs/plans/stream-view.md): the online room they sing in, with
 * the song's video and every singer on their stream, each lane and score placed by the singers' own
 * video time and played a fixed delay behind them. The source carries no cookie; the key in its link
 * says whose stream it is.
 */
function StreamView() {
  'use no memo'; // Scores and lyrics read GameState and the feed while rendering, every frame
  useBackgroundMusic(false);
  const key = useQueryParam('key');
  const delayMs = Number(useQueryParam('delay')) || DEFAULT_DELAY_MS;
  const { width, height } = useViewportSize();

  const feed = useMemo(() => new StreamFeed(), []);
  const [connection, setConnection] = useState<'connecting' | 'refused' | 'waiting' | 'in-room'>('connecting');
  const [songId, setSongId] = useState<string | null>(null);
  const [, setFrame] = useState(0);
  const songIdRef = useRef(songId);
  songIdRef.current = songId;

  // The relay says which room the owner is in, and passes on the singing of everyone on their stream
  useEffect(() => {
    if (!key) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const open = () => {
      const url = new URL(apiBareSocketUrl('/stream'));
      url.searchParams.set('key', key);
      socket = new WebSocket(url);
      let opened = false;
      socket.onopen = () => (opened = true);
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as
          | { t: 'stream-room'; code: string | null }
          | ({ t: 'stream-data' } & ReceivedStreamPacket);
        if (message.t === 'stream-room') {
          feed.reset();
          setSongId(null);
          setConnection(message.code ? 'in-room' : 'waiting');
        } else if (message.t === 'stream-data') {
          feed.receive(message);
          if (feed.songId !== songIdRef.current) setSongId(feed.songId);
        }
      };
      socket.onclose = () => {
        if (closed) return;
        // A key that was never accepted will not be accepted on a retry either
        if (!opened) setConnection('refused');
        retry = setTimeout(open, RECONNECT_MS);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [key, feed]);

  const { data: loaded } = useSong(songId);
  const song = useMemo(() => (loaded && loaded.id === songId ? streamSong(loaded) : null), [loaded, songId]);

  const player = useRef<VideoPlayerRef>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lyrics = useRef<HTMLDivElement>(null);
  const [videoState, setVideoState] = useState(VideoState.UNSTARTED);
  const singerNumbers = useRef<PlayerNumber[]>([]);

  useEffect(() => {
    if (!canvas.current || !lyrics.current || !song) return;
    const scale = canvas.current.height / canvas.current.offsetHeight;
    const drawer = new CanvasDrawing(
      canvas.current,
      lyrics.current.offsetHeight * scale,
      1,
      () => singerNumbers.current,
    );
    drawer.start();
    return () => drawer.end();
  }, [song, width, height]);

  // Each frame: keep the video a delay behind the singers, and draw everyone up to where it is
  useEffect(() => {
    if (!song) return;
    let version = -1;
    const fed = new Map<string, number>();
    let busy = false;
    const interval = setInterval(async () => {
      if (busy || !player.current) return;
      busy = true;
      try {
        const live = feed.liveVideoTimeMs();
        const videoMs = (await player.current.getCurrentTime()) * 1000;
        const status = player.current.getStatus();
        if (live === null) {
          if (status === VideoState.PLAYING) player.current.pauseVideo();
        } else {
          const target = live - delayMs;
          if (status !== VideoState.PLAYING && status !== VideoState.BUFFERING && target > 0) {
            player.current.seekTo(target / 1000);
            player.current.playVideo();
          } else if (Math.abs(videoMs - target) > SEEK_THRESHOLD_MS) {
            player.current.seekTo(target / 1000);
          }
        }

        const singers = feed.getSingers();
        if (feed.version !== version) {
          version = feed.version;
          fed.clear();
          singerNumbers.current = singers.map((singer) => singer.playerNumber);
          GameState.setSong(song);
          GameState.setSingSetup({
            id: `stream-${feed.songId}-${version}`,
            mode: GAME_MODE.DUEL,
            tolerance: 2,
            players: singers.map((singer) => ({ number: singer.playerNumber, track: 0 })),
          } as SingSetup);
        }
        GameState.setCurrentTime(videoMs);
        const songMs = videoMs - song.gap;
        for (const singer of singers) {
          const state = GameState.getPlayer(singer.playerNumber);
          let index = fed.get(singer.participantId) ?? 0;
          while (state && index < singer.readings.length && singer.readings[index]![0] <= songMs) {
            const [timestamp, frequency] = singer.readings[index]!;
            state.updatePlayerNotes(timestamp, frequency);
            index++;
          }
          fed.set(singer.participantId, index);
        }
        setFrame(videoMs);
      } finally {
        busy = false;
      }
    }, FRAME_MS);
    return () => {
      clearInterval(interval);
      GameState.resetSingSetup();
    };
  }, [song, feed, delayMs]);

  const videoMs = GameState.getCurrentTime(false);
  const singers = song ? feed.getSingers() : [];

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" data-test="stream-view">
      <Helmet>
        <title>Stream | DGG Karaoke</title>
      </Helmet>
      {song && (
        <>
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
            <div className="stroke-text typography z-10 flex flex-1 flex-col items-end justify-around pr-6 text-3xl">
              {singers.map((singer) => (
                <span
                  key={singer.participantId}
                  className="text-right"
                  style={{ color: styles.colors.players[singer.playerNumber].text }}
                  data-test="stream-singer">
                  <span className="block text-xl">{singer.name}</span>
                  <ScoreText score={feed.scoreAt(singer, videoMs)} />
                </span>
              ))}
            </div>
            <div className="z-10 py-4" ref={lyrics}>
              {/* Once the game has the singer: the feed knows them a frame before the game is set up */}
              {singers.length > 0 &&
                GameState.getPlayer(singers[0]!.playerNumber) &&
                videoState !== VideoState.UNSTARTED && (
                  <Lyrics
                    player={{ number: singers[0]!.playerNumber }}
                    bottom
                    effectsEnabled={false}
                    showStatusForAllPlayers={false}
                  />
                )}
            </div>
          </div>
        </>
      )}
      {!song && (
        <p className="typography absolute bottom-4 left-4 text-sm text-white/60" data-test="stream-status">
          {!key || connection === 'refused'
            ? 'This stream link does not work: copy it again from the admin page.'
            : connection === 'connecting'
              ? 'Connecting…'
              : connection === 'waiting'
                ? 'Waiting for you to join an online room.'
                : 'Waiting for a song.'}
        </p>
      )}
    </div>
  );
}

export default StreamView;
