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
| `src/modules/leaderboard/notes-hash.ts`                | sha-256 over `notes ++ score`, recomputed by the API                     |
| `src/routes/game/singing/post-game/views/leaderboard/` | The prompt, the panel under the scores, and the hook holding their state |
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
  for anything that cannot be a sung run (below); 413 over 256 KB; 429 past six accepted runs a
  minute from one account. Answers `{ improved }`: whether the run beat the account's best.
- `GET /api/leaderboard`: the global board, `{ entries }`, the top 50 of the last 14 days at Medium
  or harder. A plain query; there is no cache, since there is no free-tier quota to protect.
- `GET /api/leaderboard/song?songId&tolerance&score`: one song at one difficulty,
  `{ entries, total, startPosition, position }`.
- `GET /api/moderation/leaderboard?query` and `DELETE /api/moderation/leaderboard/:id`, for moderators
  and admins: the newest rows, or those whose singer, artist or title contains the query, and
  removing one with its run. The Leaderboard tab of `/admin/` uses them. A removal leaves no trace;
  an audit log is for when there is more than one moderator to tell apart.

## Checking a run

`readSubmission` refuses, in order: a body that is not msgpack or is missing a field or has an
impossible value (a score that is not an integer, below the qualifying 1,000,000 or above the
3,500,000 maximum; a difficulty easier than Easy; song text over 200 characters), a hash that does
not match `notes ++ score`, and notes that do not unpack to between 100 and 200,000 records.

The hash is integrity, not authenticity: it stops someone editing the score of a captured request,
but anyone reading the site can compute a valid one. What a sign-in adds is accountability: every row
is somebody's destiny.gg account. Recomputing the score from the notes is layer 5.

## The song board

Answers, for the song just sung, "who else has sung this, and where would this score land among
them". Split by difficulty only, matched exactly: a wider pitch window is a different game. The vocal
track is not part of the split, so both singers of a duet are ranked together.

`position` counts rows scoring `>=` the queried score, plus one: a tie loses to the row already there,
the order the board gives it. `entries` is a window of 25 rows either side of that position, with
`startPosition` the rank of the first; with no score, the top 20. Being told you are 4,000th under
people you will never catch says nothing; your neighbours do.

The panel slots the run just sung into that window as a row of its own, ringed like a focused
control. The row is synthetic: nothing refetches after a submission, and the ranks still come out
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

- **Signed out:** no prompt. The panel under the scores says the score is good enough and asks for a
  sign-in before the next song. Signing in there and then would leave the page and the result.
- **One singer on this computer:** "Put it up as <name>?" — put it up, or not this time.
- **Several singers on this computer:** "Which singer were you?", one button per singer whose score
  qualifies, and "None of them". Only the account holder's own run goes up under their name.

A phone's singer is not offered here: they are signed in on the phone, and their run goes up from
there. Putting a score up sends it at once; the panel then says whether it went on, and "Not this
time" leaves a way back into the prompt.

## Phones

The computer that ran the game holds every singer's notes, phones' included. When the results open
(`sendPhoneRuns`, local games only), it builds each phone singer's run the same way as its own
(`buildRun`) and, if the score qualifies, hands it to that phone over the remote-mic relay as the
`leaderboardRun` client call. The phone (`leaderboard-run-modal.tsx`) asks its own signed-in account
and submits through its own `/api` session; signed out, it says to sign in on the phone. The run
passes through the game, so the phone trusts it as far as the API trusts any client: it is checked
the same way when it arrives.

## Tests

- `server/src/leaderboard/leaderboard.integration.test.ts`: the routes against a real Postgres.
- `src/modules/leaderboard/rules-in-sync.test.ts`: the site's and the API's numbers agree.
- `tests/leaderboard.spec.ts`: signed out, signed in (choosing a singer, then finding the row on the
  song's board in the next run), declining, and a signed-in phone putting its own run up. Signed-in specs open a session straight in the e2e
  stack's database (`signIn` in `tests/helpers.ts`), since the sign-in stand-in redirects to port
  3000. They sing on Easy, where the stubbed microphone clears the real qualifying score (about 1.7
  million), and so check the song board; the global board's query is covered by the server tests.
- `src/stories/post-game-scoreboards.stories.tsx`: the high-scores step with both boards, signed in or
  out, with `/api/me` and the song board stubbed.
- No visual spec yet: upstream's shot the typed-name prompt and went with it. Shots of the new prompt
  and panels belong with the visual baseline refresh.
