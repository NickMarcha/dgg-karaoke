import { useState } from 'react';

import { SubmitScoreInput } from '~/modules/leaderboard/client';
import PhoneRecorder from '~/modules/leaderboard/phone-recorder';
import { RunRecording } from '~/modules/leaderboard/recording-take';
import RunShareModal from '~/modules/leaderboard/run-share-modal';
import { useClientHandler } from '~/modules/remote-mic/network/client/hooks/use-client-handler';

interface Received {
  run: SubmitScoreInput;
  recording?: () => Promise<RunRecording | null>;
  receivedAt: number;
}

/** The game hands this phone its singer's run after a song, when it is good enough for a board. */
export default function LeaderboardRunModal() {
  const [received, setReceived] = useState<Received | null>(null);

  useClientHandler('leaderboardRun', (run, recordingOffsetMs) =>
    setReceived({
      run,
      recording: recordingOffsetMs === null ? undefined : PhoneRecorder.recordingAt(recordingOffsetMs),
      receivedAt: Date.now(),
    }),
  );

  // Keyed per run, so a new song's prompt starts asking again
  return (
    <RunShareModal
      key={received?.receivedAt}
      run={received?.run ?? null}
      recording={received?.recording}
      onClose={() => setReceived(null)}
    />
  );
}
