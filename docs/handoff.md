# Handoff

One rolling file. Update it at the end of a session rather than adding another.
Session narrative belongs in git history; what belongs here is the state of the
project, what is waiting on a person, and the things that are true but not
visible in the code.

Last updated 2026-10-03.

## Continue from this repository

Planning and implementation now live in `NickMarcha/dgg-karaoke`. Open this
repository for the next session and update this file when stopping.

- On `sage`, the checkout is `C:\Users\Nicol\Desktop\dgg\dgg-karaoke`.
- On `sage-dev`, it is `/home/sage/Projects/dgg-karaoke`, a shallow clone
  without `node_modules`. Run `pnpm install` there before anything else.
- Read [AGENTS.md](../AGENTS.md), then [the plan](plans/dgg-karaoke.md) and
  [deployment](deployment.md). [Online mode](online-mode.md) covers the relay.
- `deck-assistant` issue 092 is the old infrastructure log. Its deployment
  checklist is out of date; `docs/deployment.md` replaces it.

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

`pnpm type-check`, `pnpm knip`, `pnpm format-check` and `pnpm test --watch=false`
pass; `pnpm lint` fails only on a skill asset (see Next). `server/` has its own
`npm test` (82 tests with the database, `npm run test:db`) and `npm run type-check`; the
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
2. **Phone lag with a real song.** Listen for whether the automatic
   compensation feels right before deciding to build click-based measurement.
3. **HomeServer SSH, if needed.** The last Tailscale SSH attempt required an
   extra login check. Tell the user if SSH is needed; public endpoint checks
   did not require it.

The destiny.gg OAuth application is already registered. Its client ID and
secret, admin usernames and PostHog token were recorded as present in the
Komodo stack environment. The registered redirect is
`https://dgg-karaoke.netlify.app/auth/callback`. Registration is not a blocker
for layer 2. Keep secret values out of documentation and diagnostic output.

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

Layer 2 is built and committed, not yet pushed.

**Sign-in** (`3f78372f`): the API's `users`, `sessions` and
`oauth_login_transactions` tables (migration `0001_sign_in`),
`/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` and `/api/me`, the
`/auth/callback` page, and a sign-in button in the toolbar that becomes the
flair-coloured username and a sign-out button. Roles are `singer` and `admin`;
reviewers come with layer 4. Checked locally in headless Chromium against the
stand-in. The site proxies `/api/*` to the API (Netlify in production, Vite
locally) so the session cookie is first-party and Safari keeps it;
`docs/deployment.md` explains it. The user has set the `DGG_*` values in
Komodo.

**The look**: destiny.gg's near-black canvas with its blue let in from one
corner, `#0090ff` as the accent in place of orange, `#18191b` dialogs edged in
`#43484e`, Inter and Poppins bundled through `@fontsource`, sentence case
instead of all-caps buttons and headings, and a "DGG Karaoke" wordmark beside
upstream's microphones. `info` became violet so no status reads as focus. Page
titles and the PWA manifest say DGG Karaoke; the landing page credits
AllKaraoke. `using-tailwind` and the Foundations stories describe the new
tokens.

Next:

1. Push, then on the live site: sign in (Safari too), sign out, sing without an
   account, a phone microphone and an online room.
2. **Refresh the visual baselines.** All 291 (`tests/visual-regression`,
   `tests/storybook`) are Linux renders of the old look, and upstream's CI
   that produced them is gone. Regenerating on Windows only adds `-win32`
   copies, so it needs a Linux Playwright container (or `sage-dev`) with the
   API stack reachable.
3. Left as they were: the toolbar covers the right end of the song list's
   filter row on wide screens (it did before; the account button adds a
   little), the Beta badge sits under the toolbar on a phone, and the menu
   footer's "Get in touch" links and the GitHub ribbon are still upstream's.

`pnpm lint` fails on `.agents/skills/d3-viz/assets/interactive-template.jsx`,
a skill asset that arrived with `9b9d6c64`, not on app code. Excluding
`.agents` from oxlint is probably the fix.

For ad hoc browser checks, this app uses `data-test`, not Playwright's default
`data-testid`. Do not run `pnpm format` across the repository. On Windows,
use `C:/Users/Nicol/AppData/Local/Temp` when Git Bash and Windows Python need
to share a temporary file.

When inspecting the server, avoid full process arguments, environment dumps
and unrestricted container inspection, which can expose credentials. The
previous session leaked a GitHub token through process arguments; it was
rotated. Use `ps -eo pid,etime,comm` and narrowly selected non-secret fields.
