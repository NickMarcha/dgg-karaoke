# Remote Mic Networking

This document describes the networking layer that connects phone microphones to the game host.

## Overview

The network layer lives in `src/modules/remote-mic/network/`. It is split into a **client** side (the phone) and a **server** side (the game host, running in the host browser tab). Messages flow over a WebSocket-like transport and are dispatched through a typed RPC system.

```
Phone (browser)                        Host (browser)
───────────────                        ──────────────
NetworkClient                          NetworkServer
  └─ transport (adapter)  ←──────────→  └─ transport (adapter)
  └─ rpc proxy                           └─ RpcServer
  └─ subscriptionManager                 └─ serverHandlers
  └─ ClientHandlers
```

## Transport Adapters

There is one transport: a WebSocket to the relay in `server/src/relay.ts`, at `/remote-mic` on our API (`VITE_APP_API_URL`). The phone side is `web-socket-client.ts` and the game side is `web-socket-server.ts`. Upstream also had PartyKit and PeerJS adapters and picked one by a letter in front of the game code; both ran on allkaraoke's servers and are gone, so a game code is five letters with no prefix.

The relay never reads the game's messages. It knows rooms, which socket is the host and which are phones, and wraps each message with who sent it. The protocol is written out at the top of `relay.ts`. Two things it does on its own:

- When a phone's socket closes, it sends the host an `unregister` from that phone. A phone that reloads or loses signal never sends one itself, and the game marks the singer as gone when it arrives.
- When the host's socket closes, it closes every phone with `host-left`. The phones keep retrying with `game-not-found` until the game is back, then register again.

A game whose code is already taken (a duplicated tab copies session storage, code included) is closed with `room-taken` and picks a new code.

### The direct link

The relay is the session, but the pitch readings don't have to cross it. A phone and its game are
usually in the same room, and a trip to the API and back costs a US singer the Atlantic twice, plus
whatever the API's own line is doing. So once a phone has joined, it offers a WebRTC data channel to
the game (`direct-link.ts`), with the offer, the answer and the ICE candidates passed as `rtc`
messages over the relay. On the same Wi-Fi the channel connects directly; otherwise through
Cloudflare TURN, at the Cloudflare location nearest the singer.

Only `freq`, `ping` and `pong` use it: the messages whose lateness costs more than their loss. The
channel is unordered and never retransmits, so a lost batch of readings is skipped rather than
holding up the next. Everything else, RPC included, stays on the relay. Until the channel opens, or
if it never does, those three go over the relay too.

The game's pings carry when they left and the phone echoes that, so a dropped ping costs one
measurement. When a phone's pings move to or from the link, the averaged round trip starts over:
the game corrects for half of it, and the relay's round trip is the wrong number for the link.

The relay hands both sides their ICE servers when they register (`server/src/ice-servers.ts`):
Cloudflare's STUN, and with `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` set, TURN
credentials that last a day and are renewed every twelve hours. A link that opens logs `Direct link
open` in both browsers' consoles.

Both sides still implement the transport interfaces (`client/transport/interface.ts`, `server/transport/interface.ts`), so `NetworkClient` and `NetworkServer` don't know about sockets.

## RPC System

Most communication between phone and host goes through a typed RPC layer rather than raw message handling.

### Server handlers

Handlers are defined in `Server/serverHandlers.ts` using two factory helpers from `Rpc/define.ts`:

- **`defineQuery`** — read-only, defaults to `'read'` permission (any connected client can call it)
- **`defineMutation`** — side-effecting, defaults to `'write'` permission (only clients with write permission)

Handlers are grouped into namespaces.

### Client proxy

On the phone side, `createRpcProxy<typeof serverHandlers>()` (`Rpc/RpcClient.ts`) builds a nested Proxy that mirrors the server handler contract. Calls are serialized to wire messages and resolved asynchronously (with a timeout):

```ts
const result = await Client.rpc.songs.getSongList();
await Client.rpc.input.keystroke('ArrowRight');
```

TypeScript infers the argument and return types directly from `serverHandlers`, so there is no manual type duplication.

### Wire protocol

```
Client → Server   { t: 'rpc', ns, method, args, id }
Server → Client   { t: 'rpc-res', id, result?, error? }

Server → Client   { t: 'rpc-call', method, args }        ← server-initiated call

Client → Server   { t: 'rpc-sub', channel }              ← subscribe to a push channel
Server → Client   { t: 'rpc-pub', channel, data }        ← push update to subscribers
Client → Server   { t: 'rpc-unsub', channel }            ← unsubscribe
```

### Server → client calls

The server can also initiate calls to the phone using `RpcServer.callClient()`. Handlers for these are registered on the phone with `registerClientHandler(method, fn)` and exposed via the `ClientContract` interface (`Client/clientContract.ts`). This is used for things like `setPlayerNumber`, `setPermissions`, `requestReadiness`, and `reload`.

### Push subscriptions

For server-pushed state (e.g. the live list of connected mics), the phone subscribes to a named channel. `ClientSubscriptionManager` (`Client/subscriptions.ts`) tracks ref-counts, caches the last received value (delivered immediately to new subscribers), and re-sends subscriptions on reconnect. React components use the `useSubscription` hook to consume these channels.

## Performance-Critical Messages (outside RPC)

A handful of message types bypass RPC entirely because they are sent at high frequency and latency matters:

| Message         | Direction     | Purpose                                                              |
| --------------- | ------------- | -------------------------------------------------------------------- |
| `freq`          | phone → host  | Batched pitch/frequency data; throttled to ~60 Hz, sent every ~50 ms |
| `ping` / `pong` | bidirectional | Round-trip latency measurement; the game's carry their send time     |
| `rtc`           | bidirectional | Sets up the direct link; handled inside the transports               |
| `register`      | phone → host  | Initial handshake on connect                                         |
| `unregister`    | phone → host  | Clean disconnect                                                     |
| `register-room` | host → phone  | Associates the connection with a room                                |

These are defined as plain interfaces in `Network/messages.ts` and handled directly in `NetworkClient` / `NetworkServer` without going through the RPC dispatcher.

## React Hooks

Four hooks wrap the RPC layer for use in React components (all in `Client/hooks/`):

| Hook                           | Purpose                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `useServerQuery(fn, deps)`     | Runs a query on mount and reconnect; returns `{ data, loading, error, refetch }` |
| `useServerMutation(fn)`        | Returns a stable `mutate` function with `loading`/`error` state                  |
| `useSubscription(channel)`     | Subscribes to a push channel; returns the latest data                            |
| `useClientHandler(method, fn)` | Registers a handler for a server → client call; auto-unregisters on unmount      |
