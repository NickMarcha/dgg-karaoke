# Deployment

Two halves from one repository.

| | Site | API |
|---|---|---|
| What | The Vite app, prerendered | `server/`: Hono, Postgres 17 and a Cloudflare tunnel in one Compose stack |
| Where | Netlify | The self-hosted server, as a Komodo stack |
| Built by | Netlify, from `netlify.toml` | GitHub Actions (`.github/workflows/api-image.yml`), published as `ghcr.io/nickmarcha/dgg-karaoke-api:main` |
| Address | `https://dgg-karaoke.netlify.app` | `https://karaoke-api.nickmarcha.com` |

The API is not a Netlify function because it holds the remote-mic sockets open for a whole party.

The server opens no inbound port. The `tunnel` container dials out to Cloudflare, and the hostname's route in the Cloudflare dashboard points at `http://api:8787` on the Compose network. Cloudflare's WAF and DDoS protection sit in front of the API as a result.

## Why the server never sees this repository

DGG Radio's stack clones its repository and builds on the server. This one can't sensibly do that. The fork carries upstream's history, about 2.5 GB of old screenshots, and Komodo has no shallow clone, so every fresh clone downloads all of it. Instead GitHub Actions checks out one commit, builds the image and publishes it, and the server only pulls images. The server also no longer spends memory compiling.

## What a push to `main` does

**Site.** Netlify runs `pnpm exec playwright install chromium && pnpm build` and publishes `build/`. The Chromium download is for the prerender step, which renders each route in a headless browser. `VITE_APP_API_URL` is set in `netlify.toml` and `VITE_APP_POSTHOG_KEY` in Netlify's environment; both are baked in at build time, so changing either takes a rebuild.

**API.** If the push touches `server/`, the `API image` workflow builds `server/Dockerfile` and pushes two tags: `main` and the commit SHA. Komodo checks the `main` tag for a new image every 5 minutes (`KOMODO_RESOURCE_POLL_INTERVAL`) and, with `auto_update` on, pulls it and recreates the API. Expect a change to be live 2 to 7 minutes after the push.

The API runs its migrations as it starts and exits if they fail, because nobody is there at deploy time to run them by hand.

To tell which build is running, compare the SHA tag that points at the same digest as `main` with `git log`. To deploy by hand, run `DeployStack` on `dgg-karaoke` in Komodo; it pulls `main` first.

## The Komodo stack

The compose file is defined in Komodo itself (the stack's file contents), as a copy of `server/compose.yaml`. **If you change `server/compose.yaml`, paste the new version into the stack in Komodo**; nothing syncs it. Image changes need no Komodo edit.

Komodo writes `.env` from the stack's environment: `POSTGRES_PASSWORD`, `APP_ORIGIN` (the site's origin, comma-separated if there is more than one), `CLOUDFLARE_TUNNEL_TOKEN`, and the destiny.gg and PostHog values that sign-in and analytics will read.

The image is public, so Komodo needs no registry login. If the package is ever made private, Komodo needs a registry account with `read:packages`.

## Trying a change before it deploys

`main` is production; there is no staging. In `server/`, `npm run stack:test` builds the image from the working tree (`compose.test.yaml` swaps the registry image for a local build) and runs it with the tunnel parked, the API on `localhost:8788` and Postgres on `localhost:54330`. The root `.env` points the dev server there, so `pnpm start` plus the test stack is the whole thing running locally. The Playwright config starts the same stack for the e2e specs.

## Changing the API's address

1. The tunnel's public hostname route in Cloudflare.
2. `VITE_APP_API_URL` in `netlify.toml`, then let the site rebuild.

`APP_ORIGIN` is the site's origin, not the API's. It only changes if the site moves, and when it does the relay refuses every socket from the new origin until it is updated.
