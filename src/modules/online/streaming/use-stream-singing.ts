import { useEffect, useEffectEvent } from 'react';

import GameState from '~/modules/game-engine/game-state/game-state';
import { useOnlineStreams } from '~/modules/online/client/hooks';
import OnlineClient from '~/modules/online/client/online-client';
import { PlayerNumber } from '~/modules/players/player-number';

/** Ten packets a second: a lane on the stream moves as smoothly as the game draws it. */
const PACKET_MS = 100;

interface Params {
  songId: string;
  playerNumber: PlayerNumber;
  name: string;
  /** The singer's video, raw: the stream view places everything by it. */
  getVideoTimeMs: () => Promise<number> | undefined;
  active: boolean;
}

/**
 * Sends this singer's singing to the streams following the room, while they are on one: the pitch
 * readings since the last packet and the score, stamped with the singer's video time. The relay
 * only passes it to streams that accepted this singer, and sends nothing on while nobody has.
 */
export default function useStreamSinging({ songId, playerNumber, name, getVideoTimeMs, active }: Params) {
  const streams = useOnlineStreams();
  const self = OnlineClient.getParticipantId();
  const onStream = streams.some((stream) => stream.streamerParticipantId === self || stream.onStream.includes(self));

  const readVideoTime = useEffectEvent(() => getVideoTimeMs());

  useEffect(() => {
    if (!active || !onStream) return;
    // Live from here on: a stream joined mid-song shows the singing from when it joined
    let sent = GameState.getPlayer(playerNumber)?.getPlayerFrequencies().length ?? 0;
    const interval = setInterval(async () => {
      const videoTimeMs = await readVideoTime();
      const player = GameState.getPlayer(playerNumber);
      if (videoTimeMs === undefined || !player) return;
      const records = player.getPlayerFrequencies();
      // A restart starts the readings over
      if (records.length < sent) sent = 0;
      const readings = records.slice(sent).map(({ timestamp, frequency }): [number, number] => [timestamp, frequency]);
      sent = records.length;
      OnlineClient.sendStreamData({
        songId,
        playerNumber,
        name,
        videoTimeMs,
        score: Math.round(player.getScore()),
        readings,
      });
    }, PACKET_MS);
    return () => clearInterval(interval);
  }, [active, onStream, songId, playerNumber, name]);
}
