# Deployment

Two halves from one repository, deployed the same way DGG Radio's are.

| | Site | API |
|---|---|---|
| What | The Vite app, prerendered | `server/`: Hono, Postgres 17 and a Cloudflare tunnel in one Compose stack |
| Where | Netlify | The self-hosted server, as a Komodo stack |
| Built by | Netlify, from `netlify.toml` | The server, from `server/Dockerfile` |
| Address | The Netlify site | `https://karaoke-api.nickmarcha.com` |

The API is not a Netlify function because it holds the remote-mic sockets open for a whole party.

The server opens no inbound port. The `tunnel` container dials out to Cloudflare, and the hostname's route in the Cloudflare dashboard points at `http://api:8787` on the Compose network. Cloudflare's WAF and DDoS protection sit in front of the API as a result.

## What a push to `main` does

**Site.** Netlify runs `pnpm exec playwright install chromium && pnpm build` and publishes `build/`. The Chromium download is for the prerender step, which renders each route in a headless browser. `VITE_APP_API_URL` is set in `netlify.toml` and baked in at build time, so changing it takes a rebuild.

**API.** A GitHub webhook asks Komodo to deploy the `dgg-karaoke` stack. Komodo pulls the commit, builds the image from `server/` and recreates whatever changed. The API runs its migrations as it starts and exits if they fail, because nobody is there at deploy time to run them by hand.

The stack's compose file is `server/compose.yaml`, and Komodo runs it from `server/`. Komodo writes `server/.env` from the stack's environment: `POSTGRES_PASSWORD`, `APP_ORIGIN` (the site's origin, comma-separated if there is more than one) and `CLOUDFLARE_TUNNEL_TOKEN`.

## Two Komodo settings that matter

**`webhook_force_deploy` must be on.** Without it a webhook runs `DeployStackIfChanged`, which compares the contents of the compose file, not the commit. A change to `server/src` leaves `compose.yaml` identical, so nothing would deploy and nothing would say so. DGG Radio lost an afternoon to this.

**`run_build` must be on.** It defaults to off, and the image is built from source.

To tell an automatic deploy from a manual one, look at who ran the deploy in Komodo's update log: the webhook shows up as Komodo's git-webhook user, a manual deploy as the API key or account that ran it. A push that only touches docs proves the webhook fired, not that anything was rebuilt.

## Trying a change before it deploys

`main` is production; there is no staging. In `server/`, `npm run stack:test` builds the same image and runs it with the tunnel parked, the API on `localhost:8788` and Postgres on `localhost:54330`. The root `.env` points the dev server there, so `pnpm start` plus the test stack is the whole thing running locally. The Playwright config starts the same stack for the e2e specs.

## Changing the API's address

1. The tunnel's public hostname route in Cloudflare.
2. `VITE_APP_API_URL` in `netlify.toml`, then let the site rebuild.

`APP_ORIGIN` is the site's origin, not the API's. It only changes if the site moves, and when it does the relay refuses every socket from the new origin until it is updated.
