# DGG Karaoke

Started 2026-10-02. The plan for turning the AllKaraoke fork into the destiny.gg
community's karaoke, and the order it gets built in. Upstream's own plans sit
beside this one in `docs/plans/` and describe the game as it was when forked.

## What it is for

- Sign in with destiny.gg, the same way DGG Radio does. A singer is a
  destiny.gg account, not a name typed into a box.
- The community adds and looks after the songs. Anyone signed in can submit a
  song; trusted people review it; reviewed songs are available to everyone.
- Leaderboards people can trust, because a score arrives with the run that
  produced it and can be replayed and checked.
- OBS sources, so a streamer can put karaoke on stream properly.
- A few things about the game itself that annoy people, fixed in the fork.
- The destiny.gg look, like DGG Radio.

## Where it comes from

**The game is AllKaraoke's**, forked at `7ea0b58` (2026-10-02) with its history.
It is about 56,000 lines of TypeScript and 6,457 UltraStar song files, and the
pitch detection, scoring, song editor, remote phone microphones and game
renderer are all theirs. Rebuilding it on DGG Radio's stack was considered and
rejected: it would be many sessions before anyone could sing, and it would cut
us off from upstream's fixes.

**The frontend stays as upstream built it**: a Vite single-page app with React
19, React Compiler, Tailwind and the AKUI components. It is not moved to Astro.

**Everything upstream runs on Cloudflare gets replaced** by an API of our own,
built and deployed the way DGG Radio's is. That is the main work.

## What carries over from DGG Radio

From `../dggradio`, which is the reference for each of these.

- **Sign-in.** `src/server/auth.ts`: destiny.gg's OAuth with its non-standard
  code challenge (`sha256(verifier + sha256(secret))`, hex, then base64), a
  login transaction keyed by a hashed `state`, Destiny's tokens thrown away
  after reading the profile, and our own random 30-day session token stored
  only as a hash in an HTTP-only cookie. The redirect lands on a frontend page
  (`src/pages/auth/callback.astro`) that posts the code to the API, so the
  registered redirect belongs to the stable site rather than to wherever the
  API runs. Cross-site cookies need `SameSite=None; Secure` once the site is
  https. `dev/dgg-oauth/server.mjs` is the local stand-in that signs anyone in
  as anyone, and `src/server/env.ts` refuses to start against it once
  `APP_ORIGIN` is https.
- **Name colours.** `src/server/flair.ts`, `src/styles/flairs.css` and
  `flairs.md`: which flair wins is decided by the upstream stylesheet's source
  order. Gradient flairs (tier 5) need `filter: drop-shadow` rather than
  `text-shadow`.
- **Deployment.** `docs/deployment.md`: Netlify builds the frontend from `main`;
  one Docker Compose stack (API, Postgres 17, Cloudflare tunnel) runs on the
  self-hosted server and is redeployed by a GitHub webhook. The API applies its
  migrations on startup and refuses to serve if they fail. `webhook_force_deploy`
  must be on, or a code-only push deploys nothing. `PUBLIC_API_URL` and the
  PostHog keys are read at build time on Netlify. The tunnel means no inbound
  port, and `CF-Connecting-IP` is trusted only because of that.
- **Stack for the API.** Hono, Drizzle with Postgres, zod, `posthog-node`,
  Vitest against a real local Postgres. Same versions as DGG Radio where they
  overlap.
- **The look.** `styles.md`: the near-black canvas, the narrow blue accent,
  Poppins and Inter, 10 to 12px corners, a glow only on the one featured thing.
- **Skills.** Copied into `.claude/skills` and `.agents/skills`, next to the
  upstream skills that describe this codebase (`using-tailwind`,
  `using-storybook`, the test-writing skills).

## Upstream's backend, and what replaces each part

Every one of these talks to allkaraoke's servers today, which is why nothing is
deployed until it is replaced.

| Upstream | Used for | Ours |
| --- | --- | --- |
| `backend.allkaraoke.party/proxy` (`functions/proxy.ts`) | Fetching UltraStar files from ultrastar-es.org and usdb.animux.de in the song importer | An allow-listed proxy route on our API |
| PeerJS on `backend.allkaraoke.party` | Remote microphones, the legacy transport | Dropped |
| PartyKit on `asvarox.partykit.dev` | Remote microphones, the default transport | Dropped |
| `allkaraoke-posthog.fly.dev` | Remote microphones over a plain WebSocket relay | A WebSocket relay on our API. The client side (`web-socket-server.ts`, `web-socket-client.ts`) exists; the server is not in the repository and has to be written |
| `a.allkaraoke.party` | PostHog proxy | Our own PostHog project, its own keys |
| Worker + Durable Object + KV (`worker/leaderboard*.ts`) | Global and per-song leaderboards | Postgres tables on our API, keyed by the destiny.gg user |
| KV + PostHog events + GitHub Actions (`functions/unverified-songs*.ts`, `docs/unverified-songs-flow.md`) | Songs players share, promoted by a scheduled job | Song submissions stored directly by our API, reviewed in an admin page |
| Durable Object + Cloudflare Realtime SFU (`worker/online-*.ts`) | Online mode, singing together from different places | The same WebSocket service as the remote-mic relay, on our API |
| `public/songs/*.txt` | The 6,457 built-in songs | Stay static files on Netlify |

Remote microphones are a party's main input method, so the relay is not
optional; it comes before the first deploy.

**Why upstream uses Cloudflare Realtime, and why we do not.** Online mode
carries no audio or video: every player loads the YouTube video and detects
their own pitch. What moves is room state, scores, pings and volume levels,
a few megabytes a session (`docs/online-mode.md`). The room's authority already
runs in the host's browser, so the network only has to fan the host's messages
out and carry replies back. Upstream is serverless, and a Durable Object in the
middle was billed on every second a room was open; the SFU is billed on egress
instead, fans out for the host, and avoids peer-to-peer NAT traversal. An
always-on server of our own has none of that cost, so a WebSocket relay on the
API does the same job. `OnlineRoomLogic` takes its environment from
`OnlineRoomDeps`, so the change is a transport, not a rewrite: the room logic,
host takeover and leaderboard stay as upstream wrote them, which keeps merges
from upstream cheap.

## Layers

Each one ends with something working. Nothing deploys before layer 1.

### 0. The fork, working locally (done 2026-10-02)

The fork with history, `main` as its branch, skills, `AGENTS.md`, this plan,
and the three game fixes:

- **YouTube captions over the lyrics.** The embed asks for `cc_load_policy=0`
  and `iv_load_policy=3`, and captions are switched off again with
  `setOption('captions', 'track', {})` each time playback starts, because a
  viewer's own "always show captions" preference beats the embed parameter.
- **Previews too eager.** A `Song previews` setting: *When opened* (the new
  default), *While browsing* (upstream's behaviour) or *Off*.
- **No global volume.** A master volume in the toolbar on every screen that has
  one, as a row in Settings, and in both pause menus. It scales the song, the
  previews, the menu music and the sound effects; a song's own volume still sets
  its level relative to other songs. The song editor's volume step is left
  alone on purpose, because it reads the player's volume back into the song.

### 1. Our own API, and the first deploy (done 2026-10-03)

Live at `https://dgg-karaoke.netlify.app`, API at `https://karaoke-api.nickmarcha.com`.
Two departures from what was planned, both in `docs/deployment.md`: the API ships
as an image built by GitHub Actions rather than being cloned and built on the
server (this fork's 2.5 GB of history), and a GitHub package webhook triggers
the deploy. A real phone has sung through the relay.

- `server/` with Hono, Drizzle and Postgres, packaged like DGG Radio's: a
  `Dockerfile`, `compose.yaml` with the database and the tunnel, migrations on
  startup, `/health`.
- The WebSocket relay for remote microphones, and the import proxy.
- The frontend's `.env` pointing at our API; PeerJS and PartyKit removed;
  online mode hidden until layer 1b; `worker/`, `functions/`, `wrangler.jsonc` and the
  Cloudflare Vite plugin removed once nothing uses them. The leaderboard is
  hidden until layer 3 rather than kept on the Worker.
- `netlify.toml` with the SPA fallback. Upstream prerenders pages with
  Playwright at build time; whether that runs on Netlify's builders is checked,
  and dropped if it does not.
- Netlify site, tunnel hostname, webhook. A `beta` badge in the header.

### 1b. Online mode on our relay (done 2026-10-03)

Online mode runs through `/online` on our API: a relay with the SFU's channel rules, and the
Durable Object's directory ported rule for rule, kept in Postgres so deploys do not end rooms.
`docs/online-mode.md` describes it. The 11 upstream online e2e specs pass against it.

Replace `SfuClientTransport` and the host's SFU publishing with the WebSocket
relay, and the `OnlineDirectory` Durable Object (who is in which room, who
hosts) with state on the API. Then show online mode again.

### 2. destiny.gg sign-in and the look

- Sign-in carried over from DGG Radio: `/auth/callback`, `GET /api/me`,
  sign-out, root admins from `ADMIN_DGG_USERNAMES`, roles held in the database.
- Signing in is not required to sing on one computer. It is required to submit
  a song or a score, and, while the API's `SIGN_IN_REQUIRED` is on (the
  default), to sing online or through a phone: both go through our relays,
  and a signed-in singer sings under their destiny.gg name rather than a typed
  nickname. Turning it off brings back anonymous rooms and phones with
  nicknames.
- The destiny.gg theme. Upstream's design language lives in `tailwind.config.js`,
  `src/index.css`, the AKUI components and `src/modules/game-engine/drawing/styles`
  (the canvas colours); the `using-tailwind` skill describes it. Retheming is
  token work first, then the logo and the menu backgrounds.

### 3. Leaderboards on our API

Upstream's design (`docs/leaderboard.md`) is good and is kept: a global board
over a recent window, all-time boards per song and difficulty, and every run's
pitch data stored with its score. What changes is who a row belongs to: the
signed-in destiny.gg user rather than a localStorage id and a typed name, which
removes the name and country prompt and the rename problem.

Decided with the user: every qualifying game asks (no standing answer); with
several singers on one computer it asks which of them is the signed-in
account; and singers on phones put their own runs up under their own
accounts, from the phone, in this layer too. All three are built; moderators
removing rows is what is left of the layer.

### 4. Community songs

Moderators do the reviewing. Admins appoint them on the admin page (`/admin/`), which this layer
extends with the song queue and the song editor's moderator actions.

Anyone signed in submits a song from the existing editor. It lands as
unverified, visible in the song list under its own heading as upstream does
today. Mods review, edit and publish it, or reject it with a reason. This
replaces upstream's path through PostHog events and a scheduled GitHub Action.

Published songs live in Postgres and are served by the API next to the static
ones. Whether published songs are later written back into `public/songs` is a
question for when there are some.

### 5. Verified leaderboards

The idea: a score on the board is one somebody else can watch being sung.

Upstream already keeps what this needs. Every submitted run carries its
frequency records, delta-encoded and msgpack-packed (`notes-payload.ts`), with a
hash over notes and score. Upstream's own docs say what that hash is worth:
integrity, not authenticity, since anyone reading the bundle can compute it.

Two steps, either of which is useful alone.

1. **Recompute every score on the server.** A score is derived from the song
   chart and the frequency records (`docs/player-note-calculation-logic.md`).
   Run the same module on the API and store the score it produces rather than
   the one the client sent, which ends edited scores outright. Not yet checked:
   how much of that module depends on the browser or on `GameState`.
2. **Replay.** Draw the run from its stored records over the song: the note
   lanes, the singer's pitch line, the lyrics and the video, using the game's
   own renderer fed from the records instead of a microphone. No audio is
   needed to watch a replay, which keeps storage at the size it already is (up
   to 256 KB a run, usually far less).

What neither step proves is that a person sang it: pitch data can be
synthesised. A third tier would record the singer's audio with `MediaRecorder`
for the runs that reach the top of a board, for a mod to listen to before the
row counts as verified. That costs real storage and a consent question, so it
is a decision for when the first two exist.

The user wants that third tier: **verified entries**, where a singer chooses to
submit a recording with the run. Only the voice, from the microphone, never the
song's audio; played back in sync with the YouTube video, so a moderator (or
anyone) hears the singing against the song. Unverified rows stay on the
boards; a verified one is marked as such.

### 6. OBS sources

Candidates: who is singing and what, a live score bar, the lyrics line on its
own, and the leaderboard. A browser source cannot easily read state out of the
game tab, so the host game publishes its state to the API over the same socket
the relay uses, and the source reads it from there.

What DGG Radio learned building its watcher overlay, all of it in
`../dggradio/docs/handoff.md` and `docs/plans/bigscreen-watchers.md` there:

- An OBS browser source carries no session cookie, so whatever it reads must be
  public or keyed by something in its own URL.
- Configuring a source two ways works well: a query string for one that is set
  up once and left alone, and `?profile=<id>` reading saved settings that the
  overlay polls, so the look can change from the site without touching the
  machine OBS runs on.
- Read options from the URL in an effect, not while rendering, if the page is
  ever prerendered: the server has no query string, and a hydration mismatch
  keeps the server's markup.
- A hidden browser tab runs no animation at all, so motion cannot be checked by
  screenshotting a background tab. Drive the animation by hand or test the step
  function.
- destiny.gg's sockets refuse a foreign `Origin`, so anything reading Destiny
  chat lives on the server, not in the source.
- Open the overlay in a browser before fixing it. Three rounds of CSS fixes
  were spent there on a layout nobody had looked at.

## Decided

- **Licence**: not a concern for the operator. Upstream's attribution stays.
- **destiny.gg OAuth**: a new application, registered from a separate
  destiny.gg account the operator has ready. Its redirect URI is the frontend's
  `/auth/callback`, so it is registered once the site address is known.
- **Online mode**: kept, self-hosted on our relay rather than Cloudflare
  Realtime (layer 1b).
- **Lyrics**: songs carry lyrics as upstream's do, in the open UltraStar format,
  and community uploads are accepted knowing that makes this site their host.
