import { useMemo, useState } from 'react';

import { SingSetup, Song } from '~/interfaces';
import { useAccount } from '~/modules/account/account';
import GameState from '~/modules/game-engine/game-state/game-state';
import InputManager from '~/modules/game-engine/input/input-manager';
import { submitScore } from '~/modules/leaderboard/client';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { encodeNotesPayload } from '~/modules/leaderboard/notes-payload';
import { hasLeaderboard, qualifiesForLeaderboard, reachesGlobalBoard } from '~/modules/leaderboard/qualifies';
import { PlayerNumber } from '~/modules/players/player-number';
import PlayersManager from '~/modules/players/players-manager';

/**
 * What the high-scores step shows below the local scores:
 *
 * - `sign-in` — a score is good enough, but nobody is signed in to put it up as.
 * - `declined` — the player said not this time; a way back into the prompt.
 * - `shared` — a score went up, or is going up, or failed to.
 * - `null` — the prompt is up, or no score qualifies.
 */
export type LeaderboardPanelState = 'sign-in' | 'declined' | 'shared' | null;

export interface Singer {
  number: PlayerNumber;
  name: string;
  score: number;
}

interface Params {
  song: Song;
  singSetup: SingSetup;
}

export default function useLeaderboardPostGame({ song, singSetup }: Params) {
  const { account } = useAccount();

  const { singers, localSingerCount, topScore } = useMemo(() => {
    const players = PlayersManager.getPlayers().map((player) => ({
      number: player.number,
      name: player.getName(),
      score: GameState.getPlayerScore(player.number),
      // A phone's singer is signed in on the phone, and puts their own run up from there
      onThisComputer: player.input.source !== 'Remote Microphone',
    }));
    const local = players.filter((player) => player.onThisComputer);

    return {
      singers: local
        .filter((player) => qualifiesForLeaderboard(player.score, singSetup.tolerance))
        .sort((first, second) => second.score - first.score),
      localSingerCount: local.length,
      topScore: Math.max(0, ...players.map((player) => player.score)),
    };
  }, [singSetup.tolerance]);

  const qualifies = singers.length > 0;
  const [isPromptAnswered, setIsPromptAnswered] = useState(false);
  const isModalOpen = qualifies && !!account && !isPromptAnswered;

  const [shared, setShared] = useState<Singer | null>(null);
  const [status, setStatus] = useState<'submitting' | 'submitted' | 'failed'>('submitting');

  /** Puts the chosen singer's run up as the signed-in account, there and then. */
  const share = async (singer: Singer) => {
    setIsPromptAnswered(true);
    setShared(singer);
    setStatus('submitting');

    const playerState = GameState.getPlayer(singer.number);
    const ok = await submitScore({
      songId: song.id,
      artist: song.artist,
      title: song.title,
      songLastUpdate: song.lastUpdate ?? null,
      score: singer.score,
      tolerance: GameState.getTolerance(),
      mode: singSetup.mode,
      trackIndex: playerState?.getTrackIndex() ?? 0,
      inputLag: InputManager.getPlayerInputLag(singer.number),
      notes: encodeNotesPayload(playerState?.getPlayerNotes() ?? []),
    });
    setStatus(ok ? 'submitted' : 'failed');
  };

  const decline = () => setIsPromptAnswered(true);
  const reopen = () => setIsPromptAnswered(false);

  const panel: LeaderboardPanelState = (() => {
    if (!qualifies || isModalOpen) return null;
    if (!account) return account === null ? 'sign-in' : null;
    return shared ? 'shared' : 'declined';
  })();

  return {
    /** Difficulty alone, without the score threshold: whether this run has a board to be shown. */
    hasLeaderboard: hasLeaderboard(singSetup.tolerance),
    /**
     * Whether the score would also land on the global board, or only on this song's own. Easy is
     * ranked per song and nowhere else, and the post-game copy has to say so.
     */
    reachesGlobalBoard: reachesGlobalBoard(singSetup.tolerance),
    /** "Easy", "Medium", "Hard" — the copy names the board the score is going on. */
    difficulty: difficultyName(singSetup.tolerance),
    /** The name a shared run goes up under. */
    accountName: account?.username ?? null,
    /** The singers on this computer whose score is good enough, best first. */
    singers,
    /** More than one person sang here, so the prompt asks which of them is signed in. */
    asksWhichSinger: localSingerCount > 1,
    /** The score the song's board places: the one shared, else the game's best. */
    score: Math.round(shared?.score ?? topScore),
    shared,
    status,
    panel,
    isModalOpen,
    share,
    decline,
    reopen,
  };
}

export type LeaderboardPostGame = ReturnType<typeof useLeaderboardPostGame>;
