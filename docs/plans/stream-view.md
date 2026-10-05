# Streaming a room: the OBS view

A streamer who duets today shares their screen over Discord, so their partner sings against a late
picture and their voice comes back late on top of the streamer's. Online rooms already have every
singer singing against their own copy of the video, in time and scored where they sing. What the
stream lacks is one picture and one mix that put everyone together in time.

## What it is

A moderator (or admin) copies a personal OBS link from the admin page: `/stream/?key=<key>`, added
as an OBS browser source. That source follows whichever online room its owner is singing in and
plays the song's video with every singer's lane and score, and (layer 2) every singer's voice,
a fixed half second behind the singers. The streamer sings in their own browser as usual and
captures only the source on stream, video and audio; routing their own audio is theirs to do.

Nobody's singing goes out on a stream without the streamer's say. In a streamed room, a singer
asks to be on that stream, and the streamer accepts the people they trust; the relay forwards a
singer's data only to the streams that accepted them. Requests show the singer's destiny.gg name,
which the API takes from their sign-in, not from anything the browser says. Two moderators in one
room each stream with their own list.

## How it keeps time

Every packet a singer sends is stamped with their video's time. The view's clock is its own
video: it keeps the video about half a second behind the newest packets and places every lane
(and every voice) by those stamps. Nobody's clock needs syncing, and a slow connection only
spends some of the half second.

## Layers

1. **The link, the requests, and the picture.** Stream keys, the `/stream` socket, asking and
   accepting, singers sending their pitch readings and score ten times a second, and the view
   drawing the video with every accepted singer's lane, name and score.
2. **Voices.** Each accepted singer's microphone encoded to Opus (WebCodecs) and sent with the
   same stamps; the view schedules each piece where it belongs. A browser without an Opus encoder
   sends its lane and no voice, and says so.
3. **Replay right after.** The API keeps the last streamed song of each room for an hour, and
   everyone in the room can replay it with every voice from their results screen.

Online rooms only; a moderator's local games could follow on the same view later.

Layers 1 and 2 are built (`docs/online-mode.md`, Streaming a room; `tests/online-stream.spec.ts`).
An OBS browser source may play sound at once; opened in an ordinary browser, the view's voices wait
for a click on the page.
