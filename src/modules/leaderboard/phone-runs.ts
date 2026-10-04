import { SingSetup, Song } from '~/interfaces';
import { qualifiesForLeaderboard } from '~/modules/leaderboard/qualifies';
import { buildRun } from '~/modules/leaderboard/run';
import PlayersManager from '~/modules/players/players-manager';
import RemoteMicServer from '~/modules/remote-mic/network/server';

/**
 * Hands each phone singer their run of the song just sung, when it is good enough for a board. The
 * phone is signed in as its singer, so it asks them and puts it up; this computer's account never does.
 */
export function sendPhoneRuns(song: Song, singSetup: SingSetup) {
  PlayersManager.getPlayers()
    .filter((player) => player.input.source === 'Remote Microphone')
    .forEach((player) => {
      const micId = player.input.deviceId;
      const run = buildRun(song, singSetup, player.number);
      if (micId && qualifiesForLeaderboard(run.score, singSetup.tolerance)) {
        RemoteMicServer.callClient(micId, 'leaderboardRun', run);
      }
    });
}
