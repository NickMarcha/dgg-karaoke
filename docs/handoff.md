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

Layers 0, 1 and 1b of `docs/plans/dgg-karaoke.md` are done, and layer 2
(sign-in and the look) is built and live apart from its visual baselines. The
site is live at
`https://dgg-karaoke.netlify.app` with a Beta badge, and the API at
`https://karaoke-api.nickmarcha.com`. A real phone has joined a game and sung
through the relay. `docs/deployment.md` describes how both halves deploy.

- The API (`server/`) is its own npm package: Hono, Drizzle, Postgres,
  migrations at startup, `/health`, the remote-mic relay at `/remote-mic` and
  the song importer's proxy at `/proxy`, and online mode at `/online` (room
  relay plus directory, the directory's one table `online_rooms`), and
  destiny.gg sign-in under `/api` (`users`, `sessions`,
  `oauth_login_transactions`).
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
- Sign-in, locally in headless Chromium against the stand-in: signing in, the
  flair colour, a reload, signing out, a used state. On the live site only that
  `/api/me` answers through Netlify and `/api/auth/login` redirects to
  destiny.gg with the right client and redirect.
- "Join with code" with an online room code, and the coloured room codes, in a
  local browser: a phone-sized page lands on `online/?room=…`, and a hosted
  room's lobby and the joining guest's wizard show the digit in blue.

## Not checked

- **Captions staying off for a viewer whose YouTube account always shows
  them**, from layer 0. Needs a signed-in browser with that preference.
- **The phone's microphone prompt fix on Firefox and iOS Safari.** Unit tests
  show one request per game; nobody has watched it on those browsers yet.
- **ultrastar-es.org imports.** That site now serves every scripted request a
  Cloudflare challenge (403), so the importer's path to it is broken on their
  side. usdb works through the proxy.
- **A real destiny.gg sign-in on the live site**, in Safari as well, which is
  why `/api` is proxied through Netlify.
- **"Join with code" with an online room code on a real phone.** It used to
  open the remote-mic join and answer "room not found"; fixed in `ffb3183a`.
- **The visual baselines**, all 291, still show the old look (see Next).

## Waiting on a person

1. **The phone's microphone prompt** (one per game now) on Firefox and iOS
   Safari, which the user will test.
2. **Phone lag with a real song.** Listen for whether the automatic
   compensation feels right before deciding to build click-based measurement.
3. **HomeServer SSH, if needed.** The last Tailscale SSH attempt required an
   extra login check. Tell the user if SSH is needed; public endpoint checks
   did not require it.

The destiny.gg OAuth application is registered with the redirect
`https://dgg-karaoke.netlify.app/auth/callback`, and the user has set
`DGG_CLIENT_ID`, `DGG_CLIENT_SECRET`, `DGG_REDIRECT_URI` and
`ADMIN_DGG_USERNAMES` in the Komodo stack. Keep secret values out of
documentation and diagnostic output.

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

- **The logo is destiny.gg's AMAZIN emote, its Halloween 2026 version**,
  downloaded from `r2cdn.destiny.gg` on 2026-10-04 into
  `src/assets/emotes/AMAZIN.png` (`amazin.tsx`). destiny.gg swaps seasonal
  versions under the same name; this copy stays until someone replaces it. The
  favicon and app icons are the user's own illustration of the same face.
- **The menu music is SoundCloud's embedded player** (`soundcloud-music.ts`),
  playing "black lover, instrumental only" by Tiny Ghost Studios, credited in
  the menu footer. SoundCloud lets a track play on another site only through
  its player, so the audio is not in the repository. Browsers hold sound back
  until the page is used, so it starts on the first click or key. It plays on
  the landing page, the main menu and the post-game results; upstream had the
  menu's music switched off. The editor's volume step keeps upstream's funk
  track as its loudness reference, since every song was matched against it.
- **Two e2e specs fail on `main` already**, found while checking the branding:
  `more-languages.spec.ts` (the toolbar's volume slider covers what the spec
  clicks) and `remote-mics-keyboard-mirror.spec.ts` (no `control-connection
  type` on the phone). `remote-song-list.spec.ts`'s language filtering fails
  now and then under load.

- **`npm run test:db` and the e2e stack share one database.** The server's
  integration tests clear `users`, which takes every account, leaderboard row
  and session the e2e runs or a hand check left there.

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

Layer 2 is pushed and live except for its visual baselines.

- **Sign-in** (`3f78372f`): the tables above, `/api/auth/login`,
  `/api/auth/callback`, `/api/auth/logout`, `/api/me`, the `/auth/callback`
  page, and a toolbar button that becomes the flair-coloured name and a
  sign-out button. Roles are `singer`, `moderator` (appointed on `/admin/`)
  and `admin`; what moderators may do comes with layer 4. Sign-in is required
  for online rooms and phones (below); layers 3 and 4 make scores and song
  submissions need it too.
- **The look** (`f6b7d5eb`): destiny.gg's near-black canvas, `#0090ff` in place
  of orange, `#18191b` dialogs edged in `#43484e`, Inter and Poppins bundled,
  sentence case instead of all-caps, a "DGG Karaoke" wordmark beside
  upstream's microphones, `info` violet so no status reads as focus. Titles
  and the manifest say DGG Karaoke; the landing page credits AllKaraoke.
  `using-tailwind` and the Foundations stories describe the tokens.
- **Join with code** (`ffb3183a`): the landing page's phone button takes both
  kinds of code. An online room code starts with a digit
  (`P2P_ROOM_CODE_PATTERN`) and a remote-mic code never does, so the shape
  decides; an online code goes to `online/?room=…`.
- **Room codes** (`cfa1582b`): `RoomCode` draws digits in the accent and
  letters in the default colour. The code input itself cannot.

**The computer's microphone in Firefox** (`a1d78402`, `7b2c2866`,
`f0e83414`, `f65bfc4d`) asks once now, confirmed by the user in a private
window through to a song. Firefox grants only the device picked in its prompt,
so in Firefox the list opens only that device and makes it the default; other
devices are listed as one channel until chosen, so a two-channel SingStar mic
shows both channels only if it was the one picked. The computer's microphones
stay open, muted, between songs (the browser's in-use indicator stays on,
which the user accepted); `InputManager.open` gives back any no player uses.

**Sign-in for online rooms and phones** (the commit after `4e3c09e1`). The
API's `SIGN_IN_REQUIRED`, `true` unless set, makes both relays serve only
signed-in people. Sockets go to the API directly without the site's cookie,
so the browser takes a one-minute, single-use ticket from
`POST /api/socket-ticket` and puts it in the socket URL; the upgrade answers
401 without one. `/api/me` reports the setting. The online pages, the phone
page and the game's phone-connection panel show a sign-in prompt instead
(`SignInGate`); signing in returns to the page it started on. Names are the
destiny.gg username: the name steps drop out and the rename controls hide.
Off, everything is as before. The e2e stack runs it off, which is what the
existing specs cover; the on path was checked with a throwaway spec against
the stand-in (two signed-in browsers in a room, a signed-in phone joining a
signed-in game), not kept, because it needs the stack started with
`SIGN_IN_REQUIRED=true`. Names are not verified by the relay: a modified
client could send another, though only from a signed-in account.

**Leaderboards, first step of layer 3** (`docs/leaderboard.md`). The API
serves `/api/leaderboard`: submit a run as the signed-in account, the global
board, a song's board. One row per account, song and difficulty, the best;
the run's notes are kept beside it for layer 5. The main-menu board and the
post-game song board are back. Every qualifying game asks; with several
singers on this computer it asks which one the account was; signed out, it
asks for a sign-in before the next song. Upstream's name, country, flags and
standing share decision are gone, and so is its leaderboard admin tab.
`tests/leaderboard.spec.ts` signs in by opening a session in the e2e
database (`signIn` in `tests/helpers.ts`) and sings on Easy, where the stubbed
microphone clears the real threshold. Not built yet: moderators removing rows.

Built since layer 2, none of it tried on the live site with real accounts:

- **Layer 3, leaderboards** (`docs/leaderboard.md`): the boards, the
  computer's scores, phones putting their own runs up (`leaderboardRun`), and
  moderators removing rows on the Leaderboard tab of `/admin/`.
- **Layer 4, community songs** (`docs/community-songs.md`): signed-in users
  submit songs after saving in the editor, waiting songs are playable as
  unverified, moderators review them on the Songs tab of `/admin/` (open in
  the editor, correct, publish, or reject with a reason), and published songs
  join everyone's song list. Upstream's PostHog sharing,
  `scripts/get-shared-songs.ts` and `src/routes/admin` are gone. The e2e specs
  stub `/api/songs/index` as empty except `community-songs.spec.ts`.
- **Moderators** are appointed by admins on the Moderators tab of `/admin/`;
  admins come only from `ADMIN_DGG_USERNAMES`.

Built since, the same caveat: the **song of the day** (its own board on the main menu, picked from
the popular songs or by a moderator on the admin page), **Score / Recorded / Verified runs**
(recordings from computer, online and phone singers, the run page at `/run/?id=` playing them against the
video, vouching and reporting, moderators verifying), online rooms offering each singer their own
run, a run being the singer's own score rather than co-op's team average, and pausing for buffering
as a room setting.

The API now scores every run itself from its notes (`docs/leaderboard.md`, Scoring a run), with the
game's scoring bundled from `src/`; its image builds from the repository root. The migration that
added it emptied the boards. One local e2e run of the signed-in leaderboard spec saw the API refuse
a run, and four after it did not; the cause was not caught. If it comes back, the API's answer says
why (the spec can log the POST response).

Next:

1. **Try it on the live site** with real accounts: sign in and out (Safari
   too), sing without an account, a phone microphone, joining an online room
   from a phone, putting a score up from the computer and from a phone,
   submitting a song, and reviewing it as a moderator. Send a recording
   from a phone and play it back on its run page: whether half the round
   trip places a real phone's voice in step has only been checked in e2e.
2. **Streaming a room** (`docs/plans/stream-view.md`), the user's choice of OBS source: layer 1
   (the moderator's OBS link, asking and accepting, every accepted singer's lane on the stream) and
   layer 2 (every singer's voice on the stream, placed by their video time) are built. Not yet
   tried in OBS itself or with real singers across real connections: do that before layer 3,
   replaying the streamed song with every voice from the results screen. Layer 5 is built: recorded and verified
   runs, scores the API works out, and replays on each run's page.
3. **Refresh the visual baselines.** All 291 (`tests/visual-regression`,
   `tests/storybook`) are Linux renders of the old look, and upstream's CI
   that produced them is gone. Regenerating on Windows only adds `-win32`
   copies, so it needs a Linux Playwright container (or `sage-dev`) with the
   API stack reachable. The leaderboard and community-song screens have no
   shots yet.
4. Left as they were: the toolbar covers the right end of the song list's
   filter row on wide screens (it did before; the account button adds a
   little), the Beta badge sits under the toolbar on a phone, the menu
   footer's "Get in touch" links and the GitHub ribbon are still upstream's,
   and on a phone the landing page shows no "Sing online" entry, only "Join
   with code".

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
