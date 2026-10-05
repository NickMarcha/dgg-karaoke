# Leaderboard

Two kinds of board. The **global** board on the main menu ranks the best scores of the last 14 days
across every song. Each song has its own **song board** per difficulty, all-time, shown beside the
local high scores after singing. A row belongs to a destiny.gg account: it shows the account's name
in its flair colour, and putting a score up needs a sign-in.

Upstream ran this on a Cloudflare Worker with a Durable Object and KV, under a typed name, a country
and a device id. This is the same design on our API; what changed is who a row belongs to.

## Files

| Path                                                   | Role                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `server/src/leaderboard/routes.ts`                     | `/api/leaderboard`: submit, the global board, a song's board             |
| `server/src/leaderboard/leaderboard.ts`                | The queries, and keeping the best run per singer, song and difficulty    |
| `server/src/leaderboard/submission.ts`                 | Reading and checking a submitted run                                     |
| `server/src/leaderboard/rules.ts`                      | The numbers the API checks                                               |
| `src/modules/leaderboard/consts.ts`                    | The site's copy of those numbers; `rules-in-sync.test.ts` compares them  |
| `src/modules/leaderboard/client.ts`                    | Submitting and fetching                                                  |
| `src/modules/leaderboard/notes-payload.ts`             | Delta encoder/decoder for the sung frequency records                     |
| `src/modules/leaderboard/score-run.ts`                 | A run's score from its notes and the song: the game's scoring, for the API |
| `server/src/leaderboard/charts.ts`                     | The songs the API scores runs against                                    |
| `src/routes/game/singing/post-game/views/leaderboard/` | The prompt, the panel above the boards, and the hook holding their state |
| `src/modules/leaderboard/leaderboard-row.tsx`          | One row, shared by the main-menu board and the song boards               |
| `src/routes/welcome/leaderboard-panel.tsx`             | The board on the main menu                                               |

## Storage

`leaderboard_records` holds one row per **(account, song, difficulty)**: the best run. A worse run
changes nothing; a better one replaces the row, its date included, since the date is when the run
was sung. Artist and title are kept on the row, so the board shows a song the site no longer has.
Rows are kept for good: the song boards are all-time, and the global board does its own 14-day
windowing.

`leaderboard_notes` holds the run behind each row, the frequency records the game packed, in its own
table so no board query loads them. They are what layer 5 of the plan needs to recompute and replay a
score. One blob per row, replaced with it, so the table grows with singers and songs rather than with
every attempt.

Deleting an account deletes its rows and their notes.

## Routes

All through the site's `/api` proxy, so a submission carries the session cookie.

- `POST /api/leaderboard`: a run, msgpack-packed, as the signed-in account. 401 when signed out; 400
  for anything that cannot be a sung run, or scores short of the board (below); 413 over 10 MB; 429
  past six accepted runs a minute from one account; 503 when the song cannot be read to score it.
  Answers `{ improved, score }`: whether the run beat the account's best, and the score it was given.
- `GET /api/leaderboard`: the global board, `{ entries }`, the top 50 of the last 14 days at Medium
  or harder. A plain query; there is no cache, since there is no free-tier quota to protect.
- `GET /api/leaderboard/song?songId&tolerance&score`: one song at one difficulty,
  `{ entries, total, startPosition, position }`.
- `GET /api/moderation/leaderboard?query` and `DELETE /api/moderation/leaderboard/:id`, for moderators
  and admins: the newest rows, or those whose singer, artist or title contains the query, and
  removing one with its run. The Leaderboard tab of `/admin/` uses them. A removal leaves no trace;
  an audit log is for when there is more than one moderator to tell apart.

## Scoring a run

The API works out every score itself; a run carries no score. It reads the song as the game plays it
(`charts.ts`: the site's own `/songs/<id>.txt`, else a published community song, processed by the
game's own `processSong`), and sings the run's notes against it with the game's own scoring
(`score-run.ts`, bundled into the API from `src/`). Artist and title come from the song too. Editing
a request can change nothing but the notes, and notes are what a singer has to produce.

The two agree to the point: the game rounds each pitch reading to the 0.01 ms and 0.01 Hz the run is
packed at (`packedPrecision`), so the packed notes reproduce its score exactly
(`score-run.test.ts`, alone, in a duet and in a group). A run says whether it was sung against the
song's merged track, as every game but a two-singer one is, and which track it was.

`readSubmission` refuses, before scoring: a body that is not msgpack or is missing a field or has
an impossible value (a difficulty easier than Easy), and notes that do not unpack to between 100
and 200,000 readings. After it, a song the API does not have, and a score under 1,000,000.

What this does not prove is that a person sang it: readings can be made up. That is what a
recording is for (below). A song changed after the run was sung is scored as it is now, and a song
edited or imported on one computer only is not on the board at all.

## The song board

Answers, for the song just sung, "who else has sung this, and where would this score land among
them". Split by difficulty only, matched exactly: a wider pitch window is a different game. The vocal
track is not part of the split, so both singers of a duet are ranked together.

`position` counts rows scoring `>=` the queried score, plus one: a tie loses to the row already there,
the order the board gives it. `entries` is a window of 25 rows either side of that position, with
`startPosition` the rank of the first; with no score, the top 20. Being told you are 4,000th under
people you will never catch says nothing; your neighbours do.

The panel slots the run just sung into that window as a row of its own, ringed like a focused
control. It is "This run", not the account's name, until it is up, with "not put up" or "under
1,000,000" where the date would be: a name there read as a score already on the board. The row is synthetic: nothing refetches after a submission, and the ranks still come out
right, since the rows below are pushed down by exactly the one that joined them. It shows whether or
not the score qualifies, and not at all for the dev-only difficulties that are never stored.

## Two boards, two difficulty rules

| Constant                     | Value      | Meaning                                                                    |
| ---------------------------- | ---------- | -------------------------------------------------------------------------- |
| `MAX_SUBMITTED_TOLERANCE`    | 3 (Easy)   | The easiest run stored at all. Wider ones are dev-only and get no board.   |
| `MAX_GLOBAL_BOARD_TOLERANCE` | 2 (Medium) | The easiest run the global board ranks.                                    |

The global board mixes every song and difficulty, and Easy reaches the qualifying score for singing
that would not come close on Medium, so those rows are not comparable there. A song board compares
Easy only with Easy. The post-game copy names the board a score is going on, so an Easy player is
never told their score is on the main menu.

## After singing

Every game with a qualifying score asks; there is no standing answer.

- **Signed out:** no prompt. The panel above the boards says the score is good enough and asks for a
  sign-in before the next song. Signing in there and then would leave the page and the result.
- **One singer on this computer:** "Put it up as <name>?" — put it up, or not this time.
- **Several singers on this computer:** "Which singer were you?", one button per singer whose score
  qualifies, and "None of them". Only the account holder's own run goes up under their name.

A phone's singer is not offered here: they are signed in on the phone, and their run goes up from
there. Putting a score up sends it at once; the panel then says whether it went on, and "Not this
time" leaves a way back into the prompt.

A run is always the singer's own score, from their own notes (`buildRun`). Co-op shows the team's
average on screen, but that is nobody's run: putting it up would credit one singer with the others'
singing, behind notes that do not add up to it. Below the qualifying score, the panel says what
would reach the board.

## Score, Recorded, Verified

A run on the board is a **Score**, **Recorded** when the singer sent their voice with it, or
**Verified** once a moderator has listened to that recording and confirmed it. One board shows all
three, with badges, and the main menu's board has a "Verified only" switch (`?verified=1` on the
board routes).

**Recording.** `run-recorder.ts` records each local singer's microphone through every song, in the
browser: it starts two seconds before the song's gap (after any skipped intro), pauses while the
video does, and starts over if the song seeks. Its offset is the video's time when it began (the
song's clock plus the calibrated lag), which is where playback starts the video. Nothing leaves the
browser unless the singer ticks "Send my recording too" on the prompt. Two singers on one stereo
SingStar device share that device's recording.

A phone records its own singer (`phone-recorder.ts`), told by the game when to start, pause, resume,
start over and stop (the `runRecording` client call). The game places that recording in the video:
its own offset plus half the phone's measured round trip, the time the start call took to arrive;
the pause and resume calls take as long, so they cancel out. The offset comes with the run the phone
is handed, and the phone keeps the take for its prompt even once the next song starts.

**Replays.** A run's name on any board links to its page (`/run/?id=`), which replays it over the
song's video, recorded or not (`run-replay.tsx`). The run's stored readings
(`GET /api/leaderboard/runs/:id/notes`) are fed into the game's own state as the video reaches them,
so the game's renderer draws the notes, the sung line and the lyrics, and the game's scoring counts
them up to the board's score. A run sung on one track of a duet is replayed on that track alone.
Going back in the video starts the run over; when the video ends, the rest of the run counts, so a
replay always ends on the run's whole score. The renderer draws whichever singers it is given
(`CanvasDrawing`'s last argument), this computer's players unless a replay says otherwise.

**Playing back.** A recorded run's page plays the singer's voice with the replay, kept within 150 ms
of where the video says it should be. The recording is fetched whole into memory first, because the
browser seeks a recording only where it can request any part of it, and the API serves it in one
piece.

**Vouching and reporting.** Other signed-in players can vouch for a recorded run or report it, once
each, never their own (`run_flags`). Moderators get a "Recorded, to listen to" view on the admin
page's Leaderboard tab, the most vouched-for and reported first, with Verify and Remove. A better run
replaces the row and takes the recording, vouches and reports with it.

Storage: `leaderboard_recordings` holds the audio (Opus at 32 kbps, under a megabyte for most songs),
apart from the rows like the notes. A submission may be 10 MB, with the notes capped at 256 KB and the
recording at 8 MB.

## Song of the day

One song a day (UTC), with its own board on the main menu: each singer's best run of it that day,
Medium and harder (`server/src/daily/`, `song-of-the-day-panel.tsx`). The API picks the song the
first time a day is asked for, from the site's `most-popular-songs.json` by a hash of the date, and
stores the pick in `daily_songs` so a deploy or a change to the list never moves it mid-day.
Moderators choose a song for any of the next fourteen days on the admin page's Song of the day
tab, or put a day back to the automatic pick.

A run counts toward the day when it is submitted that day, on that song, at Medium or harder,
whether or not it beats the singer's all-time best (`daily_runs`, one row per singer, the day's
best). "Sing it" opens the song list on the song. The panel hides when this browser's song list
does not have the day's song, and in the local e2e stack, whose API cannot reach the dev site to
read the popular songs.

## Online rooms

Each browser in a room sings one part, so the results screen offers that singer their own run, with
the same prompt a phone uses (`run-share-modal.tsx`), when it qualifies and they are signed in.

## Phones

The computer that ran the game holds every singer's notes, phones' included. When the results open
(`sendPhoneRuns`, local games only), it builds each phone singer's run the same way as its own
(`buildRun`) and, if the score qualifies, hands it to that phone over the remote-mic relay as the
`leaderboardRun` client call. The phone (`leaderboard-run-modal.tsx`) asks its own signed-in account
and submits through its own `/api` session. Nothing is asked of a phone nobody is signed in on. The run
passes through the game, so the phone trusts it as far as the API trusts any client: it is checked
the same way when it arrives.

## Tests

- `server/src/leaderboard/leaderboard.integration.test.ts`: the routes against a real Postgres.
- `src/modules/leaderboard/rules-in-sync.test.ts`: the site's and the API's numbers agree.
- `src/modules/leaderboard/score-run.test.ts`: the API's scoring of packed notes matches the game's.
- `tests/run-replay.spec.ts`: a run put up through the API, replayed on its page to the board's score.
- `tests/leaderboard.spec.ts`: signed out, signed in (choosing a singer, then finding the row on the
  song's board in the next run), declining, and a signed-in phone putting its own run up. Signed-in specs open a session straight in the e2e
  stack's database (`signIn` in `tests/helpers.ts`), since the sign-in stand-in redirects to port
  3000. They sing on Easy, where the stubbed microphone clears the real qualifying score (about 1.7
  million), and so check the song board; the global board's query is covered by the server tests.
- `src/stories/post-game-scoreboards.stories.tsx`: the high-scores step with both boards, signed in or
  out, with `/api/me` and the song board stubbed.
- No visual spec yet: upstream's shot the typed-name prompt and went with it. Shots of the new prompt
  and panels belong with the visual baseline refresh.
