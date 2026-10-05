# Online Mode

Online mode lets people in different places sing the same song together. The room's authority runs
in the host's browser. Its messages travel through the online relay on our API
(`server/src/online/`), which also keeps the room directory.

(Upstream ran this on Cloudflare: first a server-authoritative PartyKit room, then the Realtime SFU
with a Durable Object for the directory. Both are gone. The room logic, the host runtime and host
succession were written to be indifferent to the wire, and they did not change.)

### Room codes

A room code is five characters: a lead digit `2`–`9` and four lowercase letters
(`P2P_ROOM_CODE_PATTERN`). The lead digit is a leftover from when it told PartyKit rooms apart. `0`
and `1` are left out because they read as O and l. The directory refuses any other shape.

## The shape of it

One participant is the **host**: the room's authority runs in their browser tab. Everyone else is a
client. Clients never talk to each other; they talk to the host, and the host tells them what the
room looks like. If the host disappears, the next singer in line takes over.

```text
Host browser                         Our API                        Client browsers
────────────                         ───────                        ───────────────
OnlineRoomLogic                                                     OnlineClient
  └─ OnlineRoomHost ── broadcast ──▶  online relay ──fan-out──▶       └─ RoomClientTransport
  └─ (own OnlineClient               + directory   ◀───slot────       └─ subscriptions / rpc
      over a loopback)               (Postgres)
```

Each browser holds one WebSocket to `/online` (`RelayRoomConnection`). `OnlineRoomLogic`
(`src/modules/online/protocol/room-logic.ts`) takes everything it needs from `OnlineRoomDeps`, so
it runs in a tab with `setTimeout` instead of a server alarm and a snapshot broadcast instead of
storage.

## Why it is built this way

Online mode moves almost nothing: room state, a leaderboard, ping and volume numbers. Every client
loads the YouTube video itself, and the chart is a few compressed kilobytes sent once. A room is
single-digit megabytes for a whole session, so an always-on API carries it at no meaningful cost.

The relay fans the host's broadcast out, so the host's uplink does not grow with the room, and
every browser connects to the API, never to each other, so there is no peer-to-peer connection to
fail.

## Channels

The relay carries two kinds of message, the same two the SFU did:

| Channel   | Sent by        | Delivered to                    | Carries                                         |
| --------- | -------------- | ------------------------------- | ----------------------------------------------- |
| broadcast | host only      | every other member of the room  | state pushes, heartbeats, succession snapshots  |
| slot N    | host, or the one member holding slot N | the other end | that member's RPC calls and their replies |

The relay enforces both rules from the directory: a broadcast from anyone but the current host goes
nowhere, and a member can only write on its own slot. Routing follows each member's *current*
session, so a socket replaced by a rejoin stops receiving anything, and the old host's broadcasts go
nowhere once somebody else has been promoted.

When a member's current socket closes, the relay tells the host which slot went quiet
(`slot-closed`), which starts the room logic's reconnect grace.

The wire format is written out at the top of `server/src/online/relay.ts`.

## What the server keeps

The directory (`server/src/online/directory.ts`): who is in each room, which slot each holds, who
hosts, an epoch bumped on every host change, the ban list, and a secret per membership. Its rules
are ported unchanged from the Durable Object, and so is its test suite.

It is held in memory, where the relay reads it on every message, and written through to the
`online_rooms` table, so a deploy restarting the API does not end the rooms in progress: everyone
reconnects and rejoins with their secrets. Calls for one room run one at a time, which makes the
epoch check on `promote` a real compare-and-swap. A room is forgotten 30 minutes after the last
call touching it; the host's five-minute keepalive holds a live one open.

`GET /online/room/:code` answers whether a room exists and who hosts it, without claiming a seat.

## Who a participant is

While the API's `SIGN_IN_REQUIRED` is on, only a signed-in browser reaches the relay at all. The
socket goes to the API directly and carries no site cookie, so the browser first asks
`POST /api/socket-ticket` (through the site's `/api` proxy, which does carry it) for a ticket, good
once for a minute, and puts it in the socket's URL. A participant's name is then their destiny.gg
username. The relay does not read the room's messages, so it is each browser that sends that name;
the account behind every socket is known to the API, but nothing checks the two against each other
yet.

A participant id proves nothing. It is published to the whole room in `room-state` (that is how
every client computes the same succession order), so everyone who has been in a room knows
everyone else's.

So the directory mints a **membership secret** on a participant's first join, returns it to that
joiner alone, and requires it on everything that acts on that membership afterwards: rejoining it,
and promoting it. Without that, replaying somebody else's participant id at `join` would re-point
their row — moving the host's channels to whoever asked, or leaving any singer permanently unable
to open their own slot by pointing them at a session that does not exist. The browser keeps the
secret in `localStorage` next to the participant id and for the same reason: a room outlives
several page loads, and a singer who closes the tab and comes back is the same member.

Removing *somebody else* is separate, and gated on being the current host rather than on a secret —
`leave` carries the asking session and the directory checks it.

The host applies the same rule one level up, to the `hello` a client opens its slot with. The slot
a frame arrives on is trustworthy; the participant id inside it is not. A slot may name any
participant the room has not placed yet, and no participant it has placed somewhere else — the
host's own id included, which is the case the slot map cannot cover, since the host joins over the
loopback and never occupies a slot.

## Streaming a room

A moderator's OBS link (`/stream/?key=`, made on the admin page's Stream tab) follows the room they
sing in; `docs/plans/stream-view.md` is the design. The relay carries it alongside the room: every
online socket now remembers the destiny.gg account its ticket was for, so the relay knows which
room a moderator is in, and the OBS source connects to `/stream` with its key instead of a ticket.

- Members hear `stream-state`: who streams the room, who is on each stream and who asks to be,
  with each asker's destiny.gg name from their sign-in. The lobby's stream panel
  (`lobby/stream-panel.tsx`) asks, and lets the streamer accept, decline and remove.
- While a singer is on a stream, `use-stream-singing.ts` sends ten `stream-data` packets a second:
  the pitch readings since the last, the score, and the singer's video time. The relay passes them
  only to the streams that accepted that singer; a streamer is always on their own.
- The view (`routes/stream/`) plays the song a delay behind the freshest packet (600 ms, or
  `&delay=`), feeds every singer's readings into the game's state by its own video time, and draws
  a lane each with the game's renderer.
- The voice (`streaming/stream-voice.ts`) rides in the same packets: an audio worklet cuts the
  microphone into 20 ms frames at 48 kHz, WebCodecs encodes each to Opus (32 kbps), and each is
  stamped with the singer's video time when it was sung, less their calibrated input lag. The view
  decodes each singer's pieces and hands one to its audio clock only when its own video is about
  to reach it, so a pause or a seek leaves nothing queued; pieces that line up are joined, so
  jitter makes no clicks. A browser without an Opus encoder (`canSendVoice`) sends its line alone,
  and the lobby says so. `stream-voice.browser.test.ts` checks a sound is stamped within 40 ms
  before to 60 ms after the moment it was made.

Acceptance lives in the relay's memory, per room and streamer: an API restart forgets it.

## Room standings

A room keeps two different scoreboards, and they answer different questions.

`leaderboard` is the song in progress: a sorted list of live scores each singer publishes once a
second, rebuilt from scratch at `startReadiness` and wiped on the way back to the lobby. It is what
the in-game overlay draws, and it is gone by the time the next song starts.

`standings` is the evening: `{ total, lastSong }` per participant id, and it survives the songs.
`enterResults` banks the finished song into it (`bankStandings`), reading the score off
`leaderboard` rather than recomputing it from `finalResults` — each client publishes its final score
immediately before its detailed one, and `forceResults` falls back to the same place, so the banked
number is the one everyone watched climb. It also keeps the room from having to interpret
`WireDetailedScore`, which this protocol deliberately treats as opaque.

Three consequences worth knowing:

- **A song somebody sat out empties their `lastSong`, and leaves their `total` alone.** The map is
  rebuilt on every bank rather than added to, so a singer who was away for the whole song — inside
  their reconnect grace, never on its leaderboard — shows a dash in the last-song column instead of
  somebody else's stale number. Someone who walked in halfway did not sit it out: their client
  publishes every second from the moment it is in the room, so they bank what they had reached.
- **A published score is pulled into `0..MAX_POINTS`, and a non-number is dropped.** The standings
  add it up for the rest of the evening, where it used to die with the song. The game engine reports
  `-1` for a player it doesn't have yet, which is what the clamp is for.
- **A song ended before it was sung banks nothing.** The host can end the game during the readiness
  check, which still goes through `enterResults`; banking only out of `singing` keeps that song's
  all-zero leaderboard from overwriting everybody's `lastSong`.
- **Leaving for good resets the score.** `removeParticipant` drops the standings row with the seat,
  so a singer who runs out their reconnect grace comes back to zero. A refresh does not: the grace
  window is exactly what tells the two apart. The lobby's panel lists singers from `participants`,
  never from `standings`, which is what makes somebody who left disappear from the board rather
  than lingering on it with a frozen score.

The standings are persisted with the rest of the snapshot, so a host takeover or a hibernation wake
does not reset the party's running totals — see `LatePersistedField` for why the field is optional.

## Keeping singers in step

Every client plays the video itself, from a playback anchor the room publishes: the host's time the
song (re)started and the video position at that moment. Each browser estimates its offset from the
host's clock (five round trips, the median) and plays at `anchor position + (host time now - anchor
time)`, the same model DGG Radio uses against its server.

- **Drift.** Every two seconds a client checks its video against that position and jumps only when it
  is more than 1.5 s off. Scores come from each singer's own video, so drift costs nothing; a jump
  costs a buffer, and so is avoided while a previous jump is still loading.
- **Buffering.** Within five seconds of its own jump, a client keeps its buffering to itself unless it
  outlasts that, so a resume cannot set off another pause.
- **Pausing for buffering is the host's choice** (`pauseOnBuffering`, off by default, a checkbox in the
  lobby). On, a singer buffering for three seconds pauses the room for everyone until they are
  playing again. Off, a stall holds up only the singer who has it, who catches up at the next drift
  check. Anyone can still pause the room by hand.

## Host succession

Every client watches the host's heartbeat. Silence for `ONLINE_HOST_STALL_MS` means the host is
gone — a closed tab, or one throttled into the background, which is a real risk now that the
authority lives in a browser.

1. Each client waits its rank in the succession order (connected participants by `joinOrder`, the
   same ordering the room logic itself elects a host with) times `ONLINE_PROMOTE_STAGGER_MS`. The
   obvious successor therefore claims first and the rest only pile in if it turns out to be gone too.
2. It calls `promote` with its membership secret and the epoch it knows. The directory accepts only
   if that epoch is still current, so of two clients reacting to the same stall exactly one wins —
   and only if the secret matches, so the claim can only be made by the participant itself.
3. The loser's rejection carries the winner's session id — that is how it learns who to
   re-subscribe to, with no extra round trip.
4. The winner rebuilds `OnlineRoomLogic` from the last snapshot it received. That is the same code
   path the old server used for a hibernation wake, so a takeover resumes the song in progress
   rather than dropping everyone into the lobby.

The snapshot deliberately leaves out the compressed chart: it is the only large field, and every
singer already had to download it to sing. A successor restores it from `chart-cache.ts`.

The host that was replaced has to find out too, and nothing tells it: it does not read its own
broadcast, so the successor's heartbeats never reach it, and it stopped watching for a stall the
moment it became host. What it does have is the gap between its own heartbeat ticks. One longer
than `ONLINE_HOST_STALL_MS` means it was starved for as long as the room waits before replacing a
host, so it asks the directory who is in charge and steps down if the answer is not itself
(`verifyStillHosting`).

## The page-navigation constraint

The game is not a single-page app: moving between the lobby, the song and the results is a real
page load. That was free when the room lived on a server. With the authority in a browser it means
the room is destroyed several times per song, along with every client's succession state.

Two mitigations are in place:

- The host writes its snapshot to `sessionStorage` on `pagehide` and the reloaded page picks the
  room back up from it.
- Every client stores the newest snapshot it receives the same way, so a takeover right after a
  navigation still has something to restore from.

A host disappearing within a couple of seconds of starting a song used to lose the round: the
successor took over holding a *lobby*-phase snapshot, so `scoring.publishFinal` (which requires
`phase === 'singing'`) dropped the score and everyone landed back in the lobby.

The cause was the snapshot rate limit rather than the navigation. `broadcastSnapshot` thinned the
stream to one every `ONLINE_SNAPSHOT_BROADCAST_MS`, which drops precisely the wrong snapshot: a
phase change is the newest thing that has happened, so it falls inside the window and is held back
while the *previous* phase keeps going out. Starting a song is also when every tab is at its
busiest, so it is exactly when a host is likely to vanish.

The same limiter lost the room in the lobby, too. A singer who had joined, or changed colour, less
than a couple of seconds before the host left was holding a snapshot from before that change — or,
for a newcomer, no snapshot at all, in which case they took over by opening an empty room of their
own.

So the rule is now by caller rather than by content. Every time the room logic persists — a join or
leave, a colour, readiness, a playback transition, a final score — the snapshot goes out at once.
Those are discrete events, each already accompanied by a full room-state push, so the snapshot
alongside costs next to nothing. Only the heartbeat's refresh, which exists to carry the leaderboard
through a song, is limited to one per `ONLINE_SNAPSHOT_BROADCAST_MS`.

That change exposed a race in kicking: a kick removes the singer — which persists — before it
disconnects them, and slot bookkeeping used to run on the snapshot path, in between, dropping the
slot the eviction then needed to deliver the rejection on. It runs on the heartbeat now, which a
synchronous handler cannot be interrupted by.

`tests/online-mode.spec.ts` covers all three end to end ("host closing the tab mid-song…", "host
disconnect promotes the next-joined singer", "host can kick a singer…"), and
`online-room-host.test.ts` pins each rule directly.

Still worth doing: stop navigating altogether, keeping online mode on one page for the whole
lobby → song → results cycle, so neither the host's authority nor a client's succession state is
torn down mid-room. Everything else here is indifferent to that change.

## Testing

`room-logic.test.ts` drives the logic through a harness, and `online-room-host.test.ts` drives the
host runtime against an in-memory fabric standing in for the relay, including a takeover from a
snapshot.

On the server, `directory.test.ts` is the Durable Object's suite ported case for case, plus restart
and expiry; `relay.test.ts` pins the routing rules; `room-store.integration.test.ts` runs the
Postgres store against a real database (`npm run test:db` in `server/`, with the test stack up).

`tests/online-mode.spec.ts` runs real browsers through the API's local test stack, which
`playwright.config.ts` starts. `tests/steps/fill-online-room.ts` fills a room by speaking the relay
protocol directly.

## Configuration

Nothing beyond the API's own: the relay accepts sockets only from the origins in `APP_ORIGIN`, and
the browser finds it at `VITE_APP_API_URL`. See `docs/deployment.md`.
