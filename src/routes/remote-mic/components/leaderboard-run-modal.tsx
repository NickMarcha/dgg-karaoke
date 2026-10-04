import { useState } from 'react';

import { useAccount } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';
import Modal from '~/modules/elements/modal';
import { submitScore, SubmitScoreInput } from '~/modules/leaderboard/client';
import { difficultyName } from '~/modules/leaderboard/difficulty';
import { reachesGlobalBoard } from '~/modules/leaderboard/qualifies';
import { useClientHandler } from '~/modules/remote-mic/network/client/hooks/use-client-handler';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';

/**
 * The phone's own leaderboard prompt. The game hands over this singer's run when it is good enough
 * for a board, and the phone, signed in as the singer, asks and puts it up under their name.
 */
export default function LeaderboardRunModal() {
  const { account } = useAccount();
  const [run, setRun] = useState<SubmitScoreInput | null>(null);
  const [status, setStatus] = useState<'asking' | 'submitting' | 'submitted' | 'failed'>('asking');

  useClientHandler('leaderboardRun', (next) => {
    setRun(next);
    setStatus('asking');
  });

  const close = () => setRun(null);
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
    <Modal open={run !== null} onClose={close} withPortal>
      <Menu modal data-test="phone-leaderboard-prompt">
        <Menu.Header>Leaderboard</Menu.Header>
        {run && (
          <Menu.HelpText>
            <strong className="text-active">
              <ScoreText score={run.score} />
            </strong>{' '}
            points on {run.artist} — {run.title} is good enough for {board}.
          </Menu.HelpText>
        )}
        {!account && <Menu.HelpText>Sign in with destiny.gg on this phone to put your scores up.</Menu.HelpText>}
        {account && status === 'asking' && (
          <>
            <Menu.HelpText>
              Put it up as <strong className="text-active">{account.username}</strong>?
            </Menu.HelpText>
            <Menu.Button size="small" onClick={share} data-test="phone-leaderboard-submit">
              Put it up
            </Menu.Button>
          </>
        )}
        {status === 'submitting' && <Menu.HelpText>Putting it up…</Menu.HelpText>}
        {status === 'submitted' && (
          <Menu.HelpText data-test="phone-leaderboard-status">
            On {board}. Only your best run of each song is kept.
          </Menu.HelpText>
        )}
        {status === 'failed' && <Menu.HelpText>It could not go up. The server did not take it.</Menu.HelpText>}
        <Menu.Button size="small" onClick={close} data-test="phone-leaderboard-close">
          {account && status === 'asking' ? 'Not this time' : 'Close'}
        </Menu.Button>
      </Menu>
    </Modal>
  );
}
