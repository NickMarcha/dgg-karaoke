import { useEffect, useMemo, useRef, useState } from 'react';

import { DetailedScore, GAME_MODE, SingSetup, Song } from '~/interfaces';
import useViewportSize from '~/modules/hooks/use-viewport-size';
import { qualifiesForLeaderboard } from '~/modules/leaderboard/qualifies';
import { buildRun } from '~/modules/leaderboard/run';
import RunRecorder from '~/modules/leaderboard/run-recorder';
import RunShareModal from '~/modules/leaderboard/run-share-modal';
import { useIsOnlineHost } from '~/modules/online/client/hooks';
import { trackOnlineSongEnded } from '~/modules/online/client/online-analytics';
import OnlineClient from '~/modules/online/client/online-client';
import { OnlineRoomState } from '~/modules/online/protocol/types';
import PostGameView, { PlayerScore } from '~/routes/game/singing/post-game/post-game-view';
import LayoutGame from '~/routes/layout-game';

interface Props {
  roomState: OnlineRoomState;
  song: Song;
}

/** Animated result breakdown from the final room snapshots. No high-score step: online games are
 * not persisted to local high scores. This singer's own run can still go on the leaderboard. */
function OnlineResults({ roomState, song }: Props) {
  const { width, height } = useViewportSize();
  const isHost = useIsOnlineHost();

  // Host-only songEnded, fired once this results screen is reached.
  const endedTrackedRef = useRef(false);
  useEffect(() => {
    if (isHost && !endedTrackedRef.current) {
      endedTrackedRef.current = true;
      trackOnlineSongEnded(roomState, song);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per results mount, not on every roomState broadcast
  }, []);

  const singSetup = useMemo<SingSetup>(
    () => ({
      id: `online-${roomState.roomCode}-${roomState.chart?.hash ?? 'song'}`,
      players: (roomState.finalResults ?? []).map((result) => ({ number: result.playerNumber, track: 0 })),
      mode: GAME_MODE.DUEL,
      tolerance: roomState.tolerance,
    }),
    [roomState.roomCode, roomState.chart?.hash, roomState.tolerance, roomState.finalResults],
  );

  // This browser sang one part of the room, under its room player number; the run is its own
  const self = roomState.participants.find((participant) => participant.id === OnlineClient.getParticipantId());
  const [run, setRun] = useState(() => {
    if (!self) return null;
    const ownRun = buildRun(song, singSetup, self.playerNumber);
    return qualifiesForLeaderboard(ownRun.score, roomState.tolerance) ? ownRun : null;
  });
  const recording =
    self && RunRecorder.hasRecording(self.playerNumber) ? () => RunRecorder.recordingOf(self.playerNumber) : undefined;

  const players = useMemo<PlayerScore[]>(
    () =>
      (roomState.finalResults ?? []).map((result) => ({
        name: result.name,
        playerNumber: result.playerNumber,
        detailedScore: result.detailedScore as [DetailedScore, DetailedScore],
      })),
    [roomState.finalResults],
  );

  return (
    <LayoutGame>
      <PostGameView
        song={song}
        width={width}
        height={height}
        onClickSongSelection={() => OnlineClient.send.room.returnToLobby()}
        players={players}
        singSetup={singSetup}
        highScores={[]}
        highScoresEnabled={false}
        cameraEnabled={false}
        data-test="online-results"
      />
      <RunShareModal run={run} recording={recording} onClose={() => setRun(null)} />
    </LayoutGame>
  );
}

export default OnlineResults;
