# Community songs

Anyone signed in can send a song they made or fixed in the editor to DGG Karaoke. Until a moderator
reviews it, others can find and play it as an **unverified** song; once published, it is in
everyone's song list beside the built-in songs.

Upstream collected shared songs as PostHog events that a scheduled GitHub Action copied into
Cloudflare KV, behind a password admin page. All of that is gone; this runs on our API.

## Lifecycle

`community_songs` (`server/src/schema.ts`) holds every submission, with a status:

| Status      | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `submitted` | Waiting for a moderator. Searchable and playable as unverified.            |
| `published` | In everyone's song list. One published version per song id.                |
| `rejected`  | Sent back, with a reason the submitter sees on their edit list.            |
| `archived`  | A published version a newer one replaced.                                  |

A row keeps the UltraStar text the game reads and the song list's preview of it, worked out by the
browser that last saved the song. The API checks only what it reads out of them: the id, artist and
title, sizes, and that the text names an artist and a title.

Submitting the same song again while it still waits replaces that submission rather than queueing
another. Publishing archives whatever version of the song was published before, in the same
transaction. A built-in song keeps its id: a published song with the same id stays out of the list.

## In the site

- **Submitting:** after every save in the editor, a signed-in user is asked whether to submit the song
  (`submit-song-modal.tsx`, opened by the editor's `submit` query parameter on the edit list). The
  song stays in their browser either way. Signed out, nothing is asked.
- **Your songs:** the edit list shows the songs this account submitted, with their status and any
  reason for a rejection (`my-submissions.tsx`).
- **Unverified songs:** a search in the song list with few results also asks
  `/api/songs/unverified` and shows matches under "Unverified songs"; playing one loads it from there
  and asks for a rating afterwards, as upstream did.
- **Published songs:** `SongsService.reloadIndex` adds `/api/songs/index` to the built-in index, and
  `get` loads a community song from `/api/songs/published/:songId` instead of `/songs`. The built-in
  songs still work when the API does not answer.
- **Reviewing:** the Songs tab of `/admin/` lists waiting, published and rejected songs. Open loads a
  submission into the editor (`edit/song/?submission=<id>`), where saving corrects the submission
  instead of a local copy; Publish and Reject (with a reason) act on it.

## API

| Route                                          | Who        | Does                                     |
| ---------------------------------------------- | ---------- | ---------------------------------------- |
| `POST /api/songs`                              | signed in  | Submits `{ txt, preview }`               |
| `GET /api/songs/mine`                          | signed in  | Your submissions and their status        |
| `GET /api/songs/index`                         | anyone     | Previews of the published songs          |
| `GET /api/songs/published/:songId`             | anyone     | A published song's text                  |
| `GET /api/songs/unverified?query`              | anyone     | Waiting songs by artist or title         |
| `GET /api/songs/unverified/:id`                | anyone     | A waiting song with its text             |
| `GET /api/moderation/songs?status&query`       | moderators | The queue, by status                     |
| `GET`/`PUT /api/moderation/songs/:id`          | moderators | Read or correct a submission             |
| `POST /api/moderation/songs/:id/publish`       | moderators | Publish, archiving the previous version  |
| `POST /api/moderation/songs/:id/reject`        | moderators | Reject with `{ reason }`                 |

## Not decided yet

- Whether published songs are later written back into `public/songs`, so they ship with the site.
- Playing a waiting song from the review queue rather than finding it by search.

## Tests

- `server/src/songs/songs.integration.test.ts`: the routes against a real Postgres.
- `tests/community-songs.spec.ts`: a signed-in singer submits a converted song, a signed-out visitor
  finds it as unverified, a moderator publishes it, and it is in the visitor's song list. Every other
  spec stubs `/api/songs/index` as empty (`mockSongs`), so songs published by earlier runs stay out of
  their lists.
