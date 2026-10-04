import { useState } from 'react';

import { useAccount } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';
import Modal from '~/modules/elements/modal';
import { submitScore, SubmitScoreInput } from '~/modules/leaderboard/client';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { reachesGlobalBoard } from '~/modules/leaderboard/qualifies';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';

interface Props {
  /** A run good enough for a board, sung by whoever is signed in on this browser. */
  run: SubmitScoreInput | null;
  onClose: () => void;
}

/**
 * Asks to put one singer's own run up, where that singer has the browser to themselves: a phone used
 * as a microphone, or an online room. Only for a signed-in account, which is who the run goes up as.
 */
export default function RunShareModal({ run, onClose }: Props) {
  const { account } = useAccount();
  const [status, setStatus] = useState<'asking' | 'submitting' | 'submitted' | 'failed'>('asking');

  const share = async () => {
    if (!run) return;
    setStatus('submitting');
    setStatus((await submitScore(run)) ? 'submitted' : 'failed');
  };

  const board = run
    ? reachesGlobalBoard(run.tolerance)
      ? 'the global leaderboard'
      : `this song's ${difficultyName(run.tolerance)} leaderboard`
    : '';

  return (
    <Modal open={run !== null && !!account} onClose={onClose} withPortal>
      <Menu modal data-test="run-share-prompt">
        <Menu.Header>Leaderboard</Menu.Header>
        {run && (
          <Menu.HelpText>
            <strong className="text-active">
              <ScoreText score={run.score} />
            </strong>{' '}
            points on {run.artist} — {run.title} is good enough for {board}.
          </Menu.HelpText>
        )}
        {account && status === 'asking' && (
          <>
            <Menu.HelpText>
              Put it up as <strong className="text-active">{account.username}</strong>?
            </Menu.HelpText>
            <Menu.Button size="small" onClick={share} data-test="run-share-submit">
              Put it up
            </Menu.Button>
          </>
        )}
        {status === 'submitting' && <Menu.HelpText>Putting it up…</Menu.HelpText>}
        {status === 'submitted' && (
          <Menu.HelpText data-test="run-share-status">
            On {board}. Only your best run of each song is kept.
          </Menu.HelpText>
        )}
        {status === 'failed' && <Menu.HelpText>It could not go up. The server did not take it.</Menu.HelpText>}
        <Menu.Button size="small" onClick={onClose} data-test="run-share-close">
          {account && status === 'asking' ? 'Not this time' : 'Close'}
        </Menu.Button>
      </Menu>
    </Modal>
  );
}
