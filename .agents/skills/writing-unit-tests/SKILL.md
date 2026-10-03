---
name: writing-unit-tests
description: Use when Codex updates, fixes, or adds unit tests in this project. Covers basic unit test conventions, Vitest usage, and tests for the API in server/.
---

# Writing Unit Tests

## Basics

- Write unit tests with Vitest.
- Use `.test.ts` for TypeScript unit test files, and `.test.tsx` when the test uses React or JSX.
- Keep test files close to the code they cover when that matches the local structure.

## The API (`server/`)

- `server/` is its own package with its own `vitest.config.ts`. Run its tests from there with `npm test`; the root `pnpm test` excludes it.
- Keep logic that is worth testing out of `index.ts`, which only wires sockets and HTTP together. The relay takes a `Peer` interface, so `relay.test.ts` drives it with fake peers and no network.
- Code that talks to the database gets tested against a real Postgres, as DGG Radio does, not a mock. `npm run stack:test` in `server/` starts one on port 54330.
