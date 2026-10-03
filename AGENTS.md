# Project instructions

DGG Karaoke is a fork of [AllKaraoke](https://github.com/Asvarox/allkaraoke), the
browser karaoke game, for the destiny.gg community: people sign in with their
destiny.gg account, and that community adds and looks after the songs.
`docs/plans/dgg-karaoke.md` is the plan and the order things are built in;
`docs/handoff.md` is where the last session left off.

## Engineering principles

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

Source: https://x.com/MarcosHernanz/status/2083954734487212511

## Project stage

The site is live, and the header carries a `beta` badge.
While that badge is there, the stored data is disposable: migrations may drop or
rewrite tables, and a change that loses rows is acceptable if it keeps the schema
simple. Do not build backfills, dual-write paths, or compatibility shims for data
during this stage.

Removing that badge is the signal that the data belongs to the community rather
than to testing. From then on, every migration must preserve what is already
stored, and anything destructive needs to be raised before it is written.

## Living with upstream

`origin` is `NickMarcha/dgg-karaoke`, a GitHub fork. `upstream` is
`Asvarox/allkaraoke`, whose default branch is `master`; ours is `main`.

Upstream is active, and its fixes to the game itself (pitch detection, scoring,
the song editor, the song files) are worth taking. Merge `upstream/master`
deliberately, as its own commit, never as part of other work. Expect conflicts
wherever this fork has replaced something: the backend, sign-in, the theme.

`package.json` declares the MIT licence but the repository carries no LICENSE
file. Keep the upstream copyright and attribution intact, and do not present
the game as written from scratch.

Upstream's backend was Cloudflare: a Worker, KV, Durable Objects, PartyKit and
a Realtime SFU. It has been removed. Our own API lives in `server/` (Hono,
Drizzle, Postgres) and is its own npm package with its own lockfile, so the
image never installs the frontend's toolchain. **Nothing may be deployed that
talks to allkaraoke's infrastructure**: our users must not run on somebody
else's servers or quota. Features that upstream ran on Cloudflare and we have
not rebuilt yet (the global leaderboard, shared songs and their admin page)
are hidden, not deleted; the plan says which layer brings each back.
`docs/deployment.md` says how the API and the site are deployed.

## Working in the codebase

- This project uses React Compiler, so callbacks and values don't need to be memoized by hand.
- Use the package scripts rather than the tools directly: `pnpm type-check`, `pnpm lint`, `pnpm format`, `pnpm format-check`, `pnpm knip`.
- `pnpm test` runs the unit tests (`*.test.ts(x)`, happy-dom) in watch mode; pass `--watch=false` for one run. `pnpm test:browser` runs `*.browser.test.ts(x)` in Chromium.
- `context.md` is upstream's glossary of the game's terms (song, track, section, note, gap, tolerance). Read it before touching the game engine.
- Do not use Material UI or Emotion for new styles or new UI components. Use Tailwind utility classes and existing AKUI primitives instead. The `using-tailwind` skill is the design language.
- Unless explaining a workflow or a process, keep comments to at most two lines.
- The repository is LF. A global `core.autocrlf=true` checks it out as CRLF, which the formatter then rejects everywhere, so a fresh clone needs `git config core.autocrlf false` before checkout.

## External-source hygiene

- Cache website responses in an OS temporary directory, keyed by the full URL and any request options that affect the response. Reuse the cached response during the task. Refresh it only when freshness matters or the user asks for a refresh. If a fetch tool exposes a stable result reference or its own cache, reuse that instead of fetching the page again.
- When a GitHub repository is needed, clone or download it once into a uniquely named OS temporary directory with the `gh` CLI. Search and read the local copy instead of repeatedly fetching GitHub pages or raw files. Pull or re-clone only when a freshness check is required.
