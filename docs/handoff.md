# Handoff

One rolling file. Update it at the end of a session rather than adding another.
Session narrative belongs in git history; what belongs here is the state of the
project, what is waiting on a person, and the things that are true but not
visible in the code.

Last updated 2026-10-03.

## Where things stand

Layers 0, 1 and 1b of `docs/plans/dgg-karaoke.md` are done. The site is live at
`https://dgg-karaoke.netlify.app` with a Beta badge, and the API at
`https://karaoke-api.nickmarcha.com`. A real phone has joined a game and sung
through the relay. `docs/deployment.md` describes how both halves deploy.

- The API (`server/`) is its own npm package: Hono, Drizzle, Postgres,
  migrations at startup, `/health`, the remote-mic relay at `/remote-mic` and
  the song importer's proxy at `/proxy`, and online mode at `/online` (room
  relay plus directory, the directory's one table `online_rooms`).
- Nothing talks to allkaraoke's servers any more. PeerJS, PartyKit, the
  Cloudflare Worker, the Realtime SFU, wrangler and the fake SFU are gone. The
  global leaderboard, shared songs and the admin page are hidden, not deleted,
  until their layers rebuild them on our API.
- GitHub: `NickMarcha/dgg-karaoke`, public, a fork of `Asvarox/allkaraoke`,
  default branch `main`. Locally `upstream` points at allkaraoke.

`pnpm type-check`, `pnpm lint`, `pnpm knip` and `pnpm test --watch=false` pass.
`server/` has its own `npm test` (23 tests) and `npm run type-check`; the
pre-commit hook runs both when `server/` changes.

## Checked, and how

- The remote-mic e2e specs (`remote-mics-*`, `remote-song-list`) run against the
  API's local test stack, which Playwright starts itself. They pass.
- Through the live tunnel: `/health`, CORS only for the site's origin, the
  proxy allow list, a game and a phone exchanging messages (145 ms round
  trip), and a foreign origin's socket refused with 403.
- In a real browser on the live site: the game opens its socket, a phone joins
  by code.
- On a real phone, by the user: one song sung with the phone as player 1.

## Not checked

- **Captions staying off for a viewer whose YouTube account always shows
  them**, from layer 0. Needs a signed-in browser with that preference.
- **The phone's microphone prompt fix on Firefox and iOS Safari.** Unit tests
  show one request per game; nobody has watched it on those browsers yet.
- **ultrastar-es.org imports.** That site now serves every scripted request a
  Cloudflare challenge (403), so the importer's path to it is broken on their
  side. usdb works through the proxy.
- The visual regression baselines for the landing page and menu predate the
  layout change and will fail until regenerated.

## Waiting on a person

1. **The phone's microphone prompt** (one per game now) on Firefox and iOS
   Safari, which the user will test.
2. **The destiny.gg OAuth application** is registered; its values are in the
   API stack's environment for layer 2. Redirect URI
   `https://dgg-karaoke.netlify.app/auth/callback`.

## Noted for later

- **The calibration screen's purpose is unclear.** Settings → Calibration
  ("Sync video with sound") lines the picture up with the sound from the TV or
  speakers and applies that to every singer. It measures no microphone, but
  users read it as a mic test (the user did). Its wording should say what it
  syncs, and that microphones are handled separately.
- **Phones are compensated by formula, not measured.** A phone gets 180 ms for
  pitch detection, 25 ms for batching and half its measured round trip
  (`remote-mic-input.ts`). A real measurement would have the game play clicks
  over the speakers and each phone report when it heard them. Worth building if
  singers still find phones off after the formula.

## True but not visible in the code

- **The server never sees this repository.** Komodo has no shallow clone and
  this fork carries upstream's ~2.5 GB of history, so the API is built by
  GitHub Actions and the server only pulls the image. The Komodo stack's
  compose file is a copy of `server/compose.yaml` kept in Komodo; edit both.
- **Komodo checks images only once a day.** The deploy is triggered by a GitHub
  `package` webhook running a Komodo procedure, not by the stack's
  `auto_update`.
- **Netlify builds through its GitHub App**, which needs this repository in the
  app's repository access. It was missing at first, and pushes silently built
  nothing.
- **The prerender saves what a browser rendered**, including links Vite adds at
  runtime. It rewrites its own `localhost` server address out of the HTML;
  anything else absolute that appears there would leak the same way.
- **The fake input exists only in development and the e2e specs**
  (`fakeInputsAvailable()` in `input-sources/dummy.ts`). In production a new
  player still starts on it internally, as the marker for "no microphone": setup
  shows it as None, and pressing Play drops such players and lowers the player
  count, or opens mic setup if nobody has a real input. The e2e specs run with
  `?e2e-test`, so they never exercise the production path; it was checked by
  hand in a production build.
- **`APP_ORIGIN` on the API is a comma-separated list of the site's origins.**
  The relay refuses sockets from any other origin, so a new site address needs
  adding there first.
- **The repository is LF, and this machine's git is not.** The global
  `core.autocrlf=true` checked everything out as CRLF and the formatter then
  rejected every file. This clone has `core.autocrlf false` and `core.eol lf`;
  any new clone needs the same before its first checkout.
- **Don't run `pnpm format` across the repository.** It rewrites upstream files
  outside `src` (markdown tables, JSON) that upstream's CI never formatted. The
  pre-commit hook formats only staged files.
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

- **`using-tailwind`** before touching anything visual, and for the retheme in
  layer 2, which changes it.
- **`writing-unit-tests`** and **`e2e-playwright`** for this codebase's test
  conventions. The first now covers `server/`.
- **`tdd`** for the API, test-first against a real Postgres as in DGG Radio.
- **`research`** for destiny.gg OAuth details or OBS browser sources.
- **`diagnosing-bugs`** for anything broken.
- **`unslop`** on anything written for a person to read, this file included.
- **`grill-me`** before starting layer 5, whose design has real choices in it.

## Next

Layer 2: destiny.gg sign-in and the look. The OAuth values are already in the
API stack's environment.
