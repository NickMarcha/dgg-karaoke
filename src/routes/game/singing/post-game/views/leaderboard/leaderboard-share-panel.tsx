import { Menu } from '~/modules/elements/akui/menu';
import Box from '~/modules/elements/akui/primitives/box';
import { RegisterFunc } from '~/modules/hooks/use-keyboard-nav';
import { QUALIFYING_SCORE } from '~/modules/leaderboard/consts';
import { LeaderboardPostGame } from '~/routes/game/singing/post-game/views/leaderboard/use-leaderboard-post-game';

interface Props {
  register: RegisterFunc;
  leaderboard: LeaderboardPostGame;
}

/** `Box` centres its children; the panel stacks them full width instead. The border is what reads as
 * an edge against this screen — `Box`'s own fill is faint here on purpose, matching the score rows
 * above it. */
const panelClassName = 'mt-2 w-full items-stretch justify-start gap-2 border border-white/10 p-3';
const rowClassName = 'flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between';

/**
 * Under the local high scores once the prompt is out of the way: what became of this score, or the
 * way back to the prompt. Registers into the high-scores navigation, between the score renames and
 * the button that moves on, matching where it is on screen.
 */
function LeaderboardSharePanel({ register, leaderboard }: Props) {
  const { panel, reachesGlobalBoard, difficulty, accountName, status, reopen } = leaderboard;
  const board = reachesGlobalBoard ? 'the global leaderboard' : `this song's ${difficulty} leaderboard`;

  if (panel === null) return null;

  if (panel === 'below') {
    return (
      <Box className={panelClassName} data-test="leaderboard-below-panel">
        <Menu.HelpText>
          Scores of {QUALIFYING_SCORE.toLocaleString()} points or more can go on {board}
          {accountName ? '' : ', once you sign in with destiny.gg'}.
        </Menu.HelpText>
      </Box>
    );
  }

  if (panel === 'shared') {
    return (
      <Box className={panelClassName} data-test="leaderboard-share-panel">
        <Menu.HelpText data-test="leaderboard-share-status">
          {status === 'submitting' && `Putting this score on ${board}…`}
          {status === 'submitted' && `On ${board} as ${accountName}. Only your best run of each song is kept.`}
          {status === 'failed' && `This score could not go on ${board}. The server did not take it.`}
        </Menu.HelpText>
      </Box>
    );
  }

  // Signing in leaves the page, and this game's result with it, so the way in is for the next song
  const signInPanel = panel === 'sign-in';

  return (
    <Box className={panelClassName} data-test={signInPanel ? 'leaderboard-sign-in-panel' : 'leaderboard-opt-in-panel'}>
      <div className={rowClassName}>
        <Menu.HelpText>
          {signInPanel
            ? `This score is good enough for ${board}. Sign in with destiny.gg before your next song to put scores up.`
            : `This score is good enough for ${board}.`}
        </Menu.HelpText>
        {!signInPanel && (
          <Menu.Button
            size="small"
            className="shrink-0 sm:w-auto sm:min-w-60"
            data-test="leaderboard-open-prompt"
            {...register('leaderboard-open-prompt', reopen, undefined, false, {
              control: { type: 'button', label: 'Share this score' },
            })}>
            Share this score
          </Menu.Button>
        )}
      </div>
    </Box>
  );
}

export default LeaderboardSharePanel;
