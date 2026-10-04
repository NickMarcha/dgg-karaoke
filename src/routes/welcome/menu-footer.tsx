/**
 * The strip under the menu: where the game comes from, and the credits for the data and music it
 * uses. Nothing here is keyboard-navigable: they are read-only credits, and putting the links in
 * the arrow order would make the tiles harder to reach on a TV.
 *
 * Everything stays on the right: the bottom-left corner belongs to the floating keyboard help
 * (`help-view.tsx`), which would otherwise land on top of it.
 */
function MenuFooter() {
  return (
    <footer className="typography text-default/55 flex justify-end border-t border-white/10 pt-3 text-xs">
      {/* Its own view-transition target, so it doesn't slide across the screen on the way in and out
          of the menu. */}
      <div className="flex flex-col items-end gap-1 text-right [view-transition-name:background-music-credit]">
        <span data-test="fork-credit">
          DGG Karaoke is a fork of{' '}
          <a href="https://github.com/Asvarox/allkaraoke" target="_blank" rel="noreferrer">
            AllKaraoke by Asvarox
          </a>
          , under the MIT licence, run for the destiny.gg community.
        </span>
        <span>
          Bpm data and release year provided by{' '}
          <a target="_blank" href="https://getsongbpm.com/" rel="noreferrer">
            GetSongBPM
          </a>
        </span>
        <span>
          Music: black lover, instrumental only by{' '}
          <a
            href="https://soundcloud.com/tinyghoststudios/black-lover-instrumental-only"
            target="_blank"
            rel="noreferrer">
            Tiny Ghost Studios on SoundCloud
          </a>
        </span>
      </div>
    </footer>
  );
}

export default MenuFooter;
