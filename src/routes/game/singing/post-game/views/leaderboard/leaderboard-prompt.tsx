import { Checkbox } from '~/modules/elements/akui/checkbox';
import { Menu } from '~/modules/elements/akui/menu';
import Modal from '~/modules/elements/modal';
import useKeyboardNav from '~/modules/hooks/use-keyboard-nav';
import ScoreText from '~/routes/game/singing/game-overlay/components/score-text';
import { LeaderboardPostGame } from '~/routes/game/singing/post-game/views/leaderboard/use-leaderboard-post-game';

interface Props {
  leaderboard: LeaderboardPostGame;
}

/**
 * Asked after every game with a score good enough for a board, while somebody is signed in. With
 * one singer on this computer it asks whether to put that score up; with several, which of them is
 * the signed-in account, since only that person's run may go up under its name.
 *
 * Online games never reach here — the high-scores step is not rendered for them.
 */
function LeaderboardPrompt({ leaderboard }: Props) {
  const {
    isModalOpen,
    singers,
    asksWhichSinger,
    accountName,
    share,
    decline,
    reachesGlobalBoard,
    difficulty,
    canSendRecording,
    withRecording,
    setWithRecording,
  } = leaderboard;

  // The board the player is actually being offered. Naming the global one to somebody whose Easy
  // run will never appear there is the one thing this prompt must not do.
  const title = reachesGlobalBoard ? 'Global leaderboard' : 'Song leaderboard';
  const board = reachesGlobalBoard ? 'the global leaderboard' : `this song's ${difficulty} leaderboard`;

  // Exclusive, so the high-scores list underneath keeps its own registration order untouched —
  // in particular the `Select song` button stays last there.
  const { register } = useKeyboardNav({ enabled: isModalOpen, exclusive: true, onBackspace: decline, title });

  const [best] = singers;

  return (
    <Modal open={isModalOpen} onClose={decline} withPortal level="nested">
      <Menu spacing="tight" modal data-test="leaderboard-prompt">
        <Menu.Header>{title}</Menu.Header>
        {asksWhichSinger ? (
          <Menu.HelpText>
            Good enough for {board}. Which singer were you, <strong className="text-active">{accountName}</strong>? Only
            your own score goes up under your name.
          </Menu.HelpText>
        ) : (
          <Menu.HelpText>
            <strong className="text-active" data-test="leaderboard-prompt-score">
              <ScoreText score={best?.score ?? 0} />
            </strong>{' '}
            points is good enough for {board}. Put it up as <strong className="text-active">{accountName}</strong>?
          </Menu.HelpText>
        )}

        {canSendRecording && (
          <Checkbox
            {...register('leaderboard-with-recording', () => setWithRecording(!withRecording))}
            size="small"
            checked={withRecording}
            data-test="leaderboard-with-recording">
            Send my recording too: anyone can play it back
          </Checkbox>
        )}
        <Menu.ButtonGroup className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Menu.Button
            size="small"
            className="sm:w-auto sm:min-w-40"
            data-test="leaderboard-decline"
            {...register('leaderboard-decline', decline, undefined, false, {
              control: { type: 'button', label: 'Not this time', variant: 'back' },
            })}>
            {asksWhichSinger ? 'None of them' : 'Not this time'}
          </Menu.Button>
          {asksWhichSinger ? (
            singers.map((singer) => (
              <Menu.Button
                key={singer.number}
                size="small"
                className="sm:w-auto sm:min-w-40"
                data-test={`leaderboard-singer-${singer.number}`}
                {...register(`leaderboard-singer-${singer.number}`, () => share(singer), undefined, false, {
                  control: { type: 'button', label: singer.name },
                })}>
                {singer.name} · <ScoreText score={singer.score} />
              </Menu.Button>
            ))
          ) : (
            <Menu.Button
              size="small"
              className="sm:w-auto sm:min-w-40"
              data-test="leaderboard-submit"
              {...register('leaderboard-submit', () => best && share(best), undefined, false, {
                control: { type: 'button', label: 'Put it up' },
              })}>
              Put it up
            </Menu.Button>
          )}
        </Menu.ButtonGroup>
      </Menu>
    </Modal>
  );
}

export default LeaderboardPrompt;
