import { useState } from 'react';

import { SubmitScoreInput } from '~/modules/leaderboard/client';
import RunShareModal from '~/modules/leaderboard/run-share-modal';
import { useClientHandler } from '~/modules/remote-mic/network/client/hooks/use-client-handler';

/** The game hands this phone its singer's run after a song, when it is good enough for a board. */
export default function LeaderboardRunModal() {
  const [run, setRun] = useState<{ run: SubmitScoreInput; receivedAt: number } | null>(null);

  useClientHandler('leaderboardRun', (next) => setRun({ run: next, receivedAt: Date.now() }));

  // Keyed per run, so a new song's prompt starts asking again
  return <RunShareModal key={run?.receivedAt} run={run?.run ?? null} onClose={() => setRun(null)} />;
}
