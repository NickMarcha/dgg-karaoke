import { cn } from '~/utils/cn';

interface Props {
  code: string;
  className?: string;
}

/** A room/game code, one letter per span so it reads as separate characters to be copied down or
 * spelled out rather than as a word. Digits take the accent, so a 5 is never read as an S. */
export default function RoomCode({ code, className, ...props }: Props) {
  return (
    <strong className={cn('subtle-focus inline-flex gap-3 rounded-md px-3 py-1 uppercase', className)} {...props}>
      {code.split('').map((character, index) => (
        <span key={index} className={/\d/.test(character) ? 'text-active' : 'text-default'}>
          {character}
        </span>
      ))}
    </strong>
  );
}
