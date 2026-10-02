# Handoff

One rolling file. Update it at the end of a session rather than adding another.
Session narrative belongs in git history; what belongs here is the state of the
project, what is waiting on a person, and the things that are true but not
visible in the code.

Last updated 2026-10-02.

## Where things stand

Layer 0 of `docs/plans/dgg-karaoke.md` is done: the fork exists, runs locally,
and carries the three game fixes (captions, previews, master volume). Nothing is
deployed and nothing should be until layer 1, because `.env` still points at
allkaraoke's servers.

- GitHub: `NickMarcha/dgg-karaoke`, public, a fork of `Asvarox/allkaraoke`,
  default branch renamed to `main`. Locally `upstream` points at allkaraoke.
- The local clone is blobless (`--filter=blob:none`): upstream's history is
  about 2.5 GB, mostly old screenshots, and file contents from old commits are
  fetched only when something asks for them. That is also why the repository is
  a GitHub fork rather than a fresh repo: a push of the full history would have
  exceeded GitHub's 2 GB push limit.
- Upstream's GitHub Actions are removed. They deployed to Cloudflare and GitHub
  Pages with allkaraoke's secrets and ran on `master`. The husky pre-commit hook
  still runs format, lint, type-check, the changed unit tests and knip.

`pnpm type-check` is clean and `pnpm test --watch=false` passes 474 with 1
skipped, the same skip upstream has. `pnpm lint` reports only warnings that were
there before. `oxfmt --check src` flags `src/routes/landing-page/song-stats.json`,
which is upstream's and outside what their CI checked.

`pnpm start` serves on `http://localhost:3000`. The Cloudflare Vite plugin runs
upstream's Worker inside the dev server, so the leaderboard and online mode
work locally against local storage.

## Checked, and how

With Playwright driving the installed Chrome (`channel: 'chrome'`; Playwright's
own browsers are not downloaded):

- Settings shows *Volume* and *Song previews*; the volume row steps and wraps to
  0%; the toolbar slider renders; mute and unmute store `0` and restore `1`.
- With *When opened*, the song list stayed silent while moving between songs,
  played once a song was opened, and stopped when it was closed.
- The YouTube iframe URL carries `cc_load_policy=0&iv_load_policy=3`.

## Not checked

- **Whether captions stay off for a viewer whose YouTube account always shows
  them.** That is the case that motivated the fix, and it needs a signed-in
  browser with that preference on.
- **"While browsing" playing at all.** Headless Chrome played no preview in
  that mode, and neither did upstream's unchanged code, so it is the headless
  autoplay policy rather than a regression. Not seen in a real browser.
- **What anything sounds like.** The volume scaling was verified as stored
  values and code paths, not by ear.

## Waiting on a person

1. **The open questions at the end of the plan**: the licence, song lyrics,
   which destiny.gg OAuth application, and whether online mode is wanted.
2. **A look at the three fixes in a real browser**, especially captions.

## True but not visible in the code

- **The repository is LF, and this machine's git is not.** The global
  `core.autocrlf=true` checked everything out as CRLF and the formatter then
  rejected every file. This clone has `core.autocrlf false` and `core.eol lf`;
  any new clone needs the same before its first checkout.
- **Every remote-mic transport runs on allkaraoke's hosts**, including the raw
  WebSocket relay, whose server code is not in the repository. Phones as
  microphones is how a party plays, so the relay is part of layer 1 rather than
  something to drop.
- **A row in a keyboard-navigated menu has to re-render with its menu.** The
  navigation order is rebuilt from whatever registers during a render, so a row
  that re-renders on its own jumps to the front of the list. That is why the
  pause menus read the master volume themselves and pass it to `InGameVolume`,
  the same as `InGameInputLag`.
- **The toolbar's volume slider gives focus back as soon as it is released.**
  The game's menus ignore keys while an input has focus, so a slider that kept
  focus would leave the arrow keys dead.
- **`cloneNode` does not copy an audio element's volume.** Overlapping sound
  effects played at full volume upstream; `sound-manager.ts` now copies it.

## Suggested skills

- **`using-tailwind`** before touching anything visual. It is upstream's design
  language, and the retheme in layer 2 is a change to it, so the skill is also
  the thing to update when the tokens move.
- **`writing-unit-tests`** and **`e2e-playwright`** for this codebase's test
  conventions. The first still describes the Cloudflare Worker tests, which go
  away in layer 1.
- **`tdd`** for the API in layer 1, test-first against a real Postgres as in
  DGG Radio.
- **`research`** for destiny.gg OAuth details or anything about OBS browser
  sources that needs primary sources. It writes to `docs/research/`.
- **`diagnosing-bugs`** for anything broken.
- **`unslop`** on anything written for a person to read, this file included.
- **`grill-me`** before starting layer 5, whose design has real choices in it.

## Next

Layer 1 in the plan: the API in `server/`, the remote-mic relay and the import
proxy, then the first deploy. DGG Radio's `server/`, `compose.yaml`,
`Dockerfile`, `src/server/env.ts` and `docs/deployment.md` are the templates.
