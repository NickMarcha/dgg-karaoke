import { SingSetup, Song } from '~/interfaces';
import GameState from '~/modules/game-engine/game-state/game-state';
import InputManager from '~/modules/game-engine/input/input-manager';
import { SubmitScoreInput } from '~/modules/leaderboard/client';
import { encodeNotesPayload } from '~/modules/leaderboard/notes-payload';
import { PlayerNumber } from '~/modules/players/player-number';

/**
 * One player's run of the song just sung, as the board takes it. Built on the computer that ran the
 * game, which holds every singer's notes, phones' included: a phone gets its own run handed over.
 */
export function buildRun(song: Song, singSetup: SingSetup, playerNumber: PlayerNumber): SubmitScoreInput {
  const playerState = GameState.getPlayer(playerNumber);

  return {
    songId: song.id,
    artist: song.artist,
    title: song.title,
    songLastUpdate: song.lastUpdate ?? null,
    score: Math.round(GameState.getPlayerScore(playerNumber)),
    tolerance: GameState.getTolerance(),
    mode: singSetup.mode,
    trackIndex: playerState?.getTrackIndex() ?? 0,
    inputLag: InputManager.getPlayerInputLag(playerNumber),
    notes: encodeNotesPayload(playerState?.getPlayerNotes() ?? []),
  };
}
