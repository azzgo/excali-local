# AGENTS.md

**Excali Local** — a local-first browser extension (Chrome/Firefox/Edge, MV3) that
runs Excalidraw **fully offline**: screenshot annotation, an offline editor, a local
gallery, presentation mode, custom fonts. No backend; all data in IndexedDB.

Bun-workspaces monorepo, three packages (plus one Go package that is NOT a workspace
member — it builds with `go build`, not Bun):

- `packages/excali-local` — WXT **extension shell** (manifest, background, content, crop, popup, options).
- `packages/excali-page` — React 19 + Vite **editor app** (the Excalidraw UI).
- `packages/excali-shared` — font-config DB + the **agent-bridge wire contract** (`agent-bridge.ts` — the source of truth the Go daemon mirrors) + shared utils/types.
- `packages/excali-bridge` — **Go daemon** (NOT a bun workspace): the Agent Bridge
  (Tickets 009/016/017) — a 127.0.0.1-only WS server (Leg B: the activated editor
  page dials out) + agent CLI (Leg A: versioned minimal JSON-RPC). Cross-profile
  single-active-canvas arbiter: pidfile single-instance, ≤1 active page, new
  activation displaces. Wire contract mirrored from `excali-shared/src/agent-bridge.ts`
  (the source of truth the Go side mirrors by hand). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `skills/excali-draw/` — the **agent-agnostic drawing skill** (NOT a workspace member):
  `SKILL.md` + `references/` that bundle the static Go daemon and teach an agent to draw
  via the CLI. Pack with `scripts/skill-pack.ts`; verify with `scripts/check-skill-commands.ts`.

This file is **agent guidance + routing**, not a repo manual. For the why and the
detail, read the doc relevant to your task (links below).

## Hard constraints (do not break these)

- **Bun**, not npm/pnpm/yarn.
- **Excalidraw is a local patched tgz** (`excalidraw-excalidraw-0.18.0-csp.12.tgz`).
  Never swap for the npm version — CSP/offline will break. See [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).
- **`packages/excali-local/public/editor/` is a gitignored build artifact**, not
  committed. Run `bun run page:build` after changing page code; never commit it.
- **`skills/excali-draw/bin/` is COMMITTED** (source-is-the-artifact): the 4
  platform daemon binaries ship inside the skill dir. Refresh them in place with
  `bun scripts/skill-pack.ts` (cross-compile + static-verify; writes only to
  `skills/excali-draw/bin/` + the README size table — scratch is in the OS temp
  dir, no `.skill-dist/`).
- **IndexedDB schema changes** require a `DB_VERSION` bump + `upgrade()` migration
  (users have existing data). Two DBs: `excali` (gallery) and `excali-fonts`. See
  [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- **Two i18n systems** — chrome.i18n (shell) vs i18next (page). Don't mix.
- **`packages/excali-bridge` is Go, not a Bun workspace** — `bun install`/workspace
  tooling ignores it. Build with `bun run bridge:build` (`go build`); its Leg-B wire
  contract MUST mirror `excali-shared/src/agent-bridge.ts` (`internal/contract/`).
- **Exploration is read-only.** Don't run `bun install`, don't commit, don't write
  files beyond the change you were asked to make.
- After page edits, run `bun run page:test` (and `page:build` if testing the extension).

## Daily commands

| Command | Purpose |
| --- | --- |
| `bun run page:dev` | Editor webapp dev server (port 3000). |
| `bun run page:build` | Build editor into `excali-local/public/editor/`. |
| `bun run page:test` | Vitest suite. |
| `bun run local:build` | Build extension (Chrome + Firefox). |
| `bun run local:tar` / `local:zip` | Pack release archives. |
| `bun run sync:version` | Sync version across all packages.
| `bun run bridge:build` | `go build` the Go bridge daemon into `excali-bridge/bin/` (gitignored).
| `bun run bridge:test` | `go test ./...` for the Go daemon (ws codec, pidfile, server).


Full list + build/release/CSP detail: [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).

## Operating rules

- Verify paths/scripts/strings against the code before trusting any doc (including
  this one) — the repo evolves. Use `rg` / `read`.
- Read the target file to get current line anchors before editing; follow existing
  patterns in the same directory.
- Small, conventional commits (`feat:` `fix:` `refactor:` `test:` `chore:` `docs:`).
- When code and docs disagree, trust the code and update the docs.

## Deeper knowledge (read when relevant)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 3-layer design, repository layout,
  message protocol, editor boot, presentation & marker, key-file index.
- [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md) — full commands, build
  pipeline, CSP constraints, release flow, version sync.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — Jotai, UI primitives, icons, path
  alias, i18n, storage, testing.
