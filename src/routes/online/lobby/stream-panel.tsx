import { Menu } from '~/modules/elements/akui/menu';
import { RegisterFunc } from '~/modules/hooks/use-keyboard-nav';
import { useOnlineStreams } from '~/modules/online/client/hooks';
import OnlineClient from '~/modules/online/client/online-client';
import { OnlineParticipant } from '~/modules/online/protocol/types';
import { RoomStream } from '~/modules/online/streaming/types';

interface Props {
  participants: OnlineParticipant[];
  register: RegisterFunc;
}

/**
 * Who streams this room through their OBS link (docs/plans/stream-view.md). A singer asks to be on a
 * stream; the streamer sees each request under the asker's destiny.gg name and takes the people
 * they trust. Nobody's singing reaches a stream that has not accepted them.
 */
export default function StreamPanel({ participants, register }: Props) {
  const streams = useOnlineStreams();
  if (!streams.length) return null;
  const self = OnlineClient.getParticipantId();
  const nameOf = (participantId: string, username?: string | null) =>
    username ?? participants.find((participant) => participant.id === participantId)?.name ?? 'Someone';

  return (
    <div className="flex flex-col gap-2" data-test="online-stream-panel">
      {streams.map((stream) =>
        stream.streamerParticipantId === self ? (
          <StreamerControls key={stream.streamerId} stream={stream} nameOf={nameOf} register={register} />
        ) : (
          <SingerControls key={stream.streamerId} stream={stream} self={self} register={register} />
        ),
      )}
    </div>
  );
}

function StreamerControls({
  stream,
  nameOf,
  register,
}: {
  stream: RoomStream;
  nameOf: (participantId: string, username?: string | null) => string;
  register: RegisterFunc;
}) {
  return (
    <>
      <Menu.HelpText>
        You are streaming this room.{' '}
        {stream.onStream.length
          ? `On your stream with you: ${stream.onStream.map((id) => nameOf(id)).join(', ')}.`
          : 'Only you are on your stream.'}
      </Menu.HelpText>
      {stream.requests.map((request) => (
        <div
          key={request.participantId}
          className="flex flex-wrap items-center gap-2"
          data-test="online-stream-request">
          <Menu.HelpText className="flex-1">
            <strong className="text-active">{nameOf(request.participantId, request.username)}</strong> asks to be on
            your stream.
          </Menu.HelpText>
          <Menu.Button
            size="small"
            className="w-auto"
            {...register(`stream-accept-${request.participantId}`, () =>
              OnlineClient.answerStream(request.participantId, true),
            )}
            data-test="online-stream-accept">
            Accept
          </Menu.Button>
          <Menu.Button
            size="small"
            className="w-auto"
            {...register(`stream-decline-${request.participantId}`, () =>
              OnlineClient.answerStream(request.participantId, false),
            )}>
            Decline
          </Menu.Button>
        </div>
      ))}
      {stream.onStream.map((participantId) => (
        <Menu.Button
          key={participantId}
          size="small"
          {...register(`stream-remove-${participantId}`, () => OnlineClient.answerStream(participantId, false))}>
          Take {nameOf(participantId)} off your stream
        </Menu.Button>
      ))}
    </>
  );
}

function SingerControls({ stream, self, register }: { stream: RoomStream; self: string; register: RegisterFunc }) {
  const onStream = stream.onStream.includes(self);
  const asking = stream.requests.some((request) => request.participantId === self);

  return (
    <>
      <Menu.HelpText data-test="online-stream-status">
        <strong className="text-active">{stream.streamer}</strong> is streaming this room.{' '}
        {onStream
          ? 'You are on their stream: your singing is in it.'
          : asking
            ? `Waiting for ${stream.streamer} to answer.`
            : 'Ask to be on it, and your singing will be on their stream once they accept.'}
      </Menu.HelpText>
      <Menu.Button
        size="small"
        {...register(`stream-ask-${stream.streamerId}`, () =>
          OnlineClient.requestStream(stream.streamerId, !onStream && !asking),
        )}
        data-test="online-stream-ask">
        {onStream ? 'Leave their stream' : asking ? 'Take back my request' : `Ask to be on ${stream.streamer}'s stream`}
      </Menu.Button>
    </>
  );
}
