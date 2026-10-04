import amazin from '~/assets/emotes/AMAZIN.png';
import { cn } from '~/utils/cn';

/**
 * The site's logo: destiny.gg's AMAZIN emote, its Halloween 2026 version, downloaded from the
 * destiny.gg CDN. It is a strip of 45 frames that destiny.gg's `emotes.css` steps through twice; this
 * loops it. One em tall, so a caller sizes it by font size.
 */
export default function Amazin({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="AMAZIN"
      // 32 pixels tall at the source, so scaled up it stays sharp rather than smudged
      className={cn(
        'animate-amazin inline-block h-[1em] w-[1.65625em] shrink-0 [image-rendering:pixelated]',
        className,
      )}
      style={{ backgroundImage: `url(${amazin})` }}
    />
  );
}
