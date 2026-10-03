import { Browser, BrowserContext, test } from '@playwright/test';

import { ONLINE_MAX_PLAYERS } from '~/modules/players/player-number';

/** The API's online relay in the local test stack Playwright starts (playwright.config.ts). */
const ONLINE_RELAY_URL = 'ws://localhost:8788/online';

/**
 * Occupies every seat but the host's, at the protocol level.
 *
 * Five real guest tabs each holding a live fake-audio capture reliably deadlocks Chromium's
 * fake-audio backend, so the seats are filled the way the client fills them (open a socket to the
 * online relay, claim a slot in the room directory, say hello on that slot) without the game running
 * around them. Only the final, rejected join goes through the real UI, which is the part under test.
 *
 * The work happens inside a page on the app's origin, because the relay only accepts sockets from
 * the app's origins.
 *
 * Returns the context holding the connections; closing it frees the seats.
 */
export async function fillOnlineRoom(browser: Browser, roomCode: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/online/?e2e-test');

    await page.evaluate(
      async ({ roomCode, seats, relayUrl }) => {
        // Parked on `window` so the sockets outlive this call and keep their seats claimed.
        const sockets: WebSocket[] = ((window as never as { __fillers: WebSocket[] }).__fillers = []);

        for (let seat = 1; seat < seats; seat++) {
          const participantId = crypto.randomUUID();
          const socket = new WebSocket(relayUrl);
          sockets.push(socket);

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Filler ${seat} timed out`)), 10_000);
            const settle = (error?: Error) => {
              clearTimeout(timer);
              if (error) reject(error);
              else resolve();
            };
            socket.addEventListener('message', (event: MessageEvent<string>) => {
              const frame = JSON.parse(event.data);
              if (frame.t === 'welcome') {
                socket.send(JSON.stringify({ t: 'join', id: 1, code: roomCode, participantId }));
              } else if (frame.t === 'reply' && frame.id === 1) {
                // Role and slot are the directory's to decide
                if (!frame.result?.ok)
                  return settle(new Error(`Filler ${seat} could not claim a seat: ${frame.result?.reason}`));
                const hello = { t: 'hello', participantId, name: `Filler ${seat}`, create: false };
                socket.send(JSON.stringify({ t: 'slot', slot: frame.result.slot, payload: hello }));
              } else if (frame.t === 'message' && frame.slot !== null) {
                if (frame.payload.t === 'joined') settle();
                if (frame.payload.t === 'join-rejected')
                  settle(new Error(`Filler ${seat} rejected: ${frame.payload.reason}`));
              }
            });
            socket.addEventListener('close', () => settle(new Error(`Filler ${seat} socket closed before joining`)));
          });
        }
      },
      { roomCode, seats: ONLINE_MAX_PLAYERS, relayUrl: ONLINE_RELAY_URL },
    );

    return context;
  } catch (error) {
    // The caller has no handle on the seats already taken, so a failed setup cleans up after
    // itself rather than leaving the room full for the rest of the run.
    await context.close();
    throw error;
  }
}
