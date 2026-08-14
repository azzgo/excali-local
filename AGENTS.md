# AGENTS.md

**Excali Local** — a local-first browser extension (Chrome/Firefox/Edge, MV3) that
runs Excalidraw **fully offline**: screenshot annotation, an offline editor, a local
gallery, presentation mode, custom fonts. No backend; all data in IndexedDB.

pnpm-workspaces monorepo, three packages (plus one Go package that is NOT a workspace
member — it builds with `go build`):

- `packages/local` — WXT **extension shell** (manifest, background, content, crop, popup, options).
- `packages/page` — React 19 + Vite **editor app** (the Excalidraw UI).
- `packages/shared` — font-config DB + the **agent-bridge wire contract** (`agent-bridge.ts` — the source of truth the Go daemon mirrors) + shared utils/types.
- `packages/bridge` — **Go daemon** (NOT a pnpm workspace): the Agent Bridge
  (Tickets 009/016/017) — a 127.0.0.1-only WS server (Leg B: the activated editor
  page dials out) + agent CLI (Leg A: versioned minimal JSON-RPC). Cross-profile
  single-active-canvas arbiter: pidfile single-instance, ≤1 active page, new
  activation displaces. Wire contract mirrored from `excali-shared/src/agent-bridge.ts`
  (the source of truth the Go side mirrors by hand). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `skills/excali-local/` — the **agent-agnostic drawing skill** (NOT a workspace member):
  `SKILL.md` + `references/` that bundle the static Go daemon and teach an agent to draw
  via the CLI. Pack with `scripts/skill-pack.ts`; verify with `scripts/check-skill-commands.ts`.

This file is **agent guidance + routing**, not a repo manual. For the why and the
detail, read the doc relevant to your task (links below).

## Hard constraints (do not break these)

- **pnpm** (package manager) + **tsx** (TS script runtime), not bun/npm/yarn.
- **Excalidraw is a local patched tgz** (`excalidraw-excalidraw-v0.18.0-csp.14.tgz`).
  Never swap for the npm version — CSP/offline will break. See [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).
- **`packages/local/public/editor/` is a gitignored build artifact**, not
  committed. Run `pnpm page:build` after changing page code; never commit it.
- **`skills/excali-local/bin/` is COMMITTED** (source-is-the-artifact): the 4
  platform daemon binaries ship inside the skill dir. Refresh them in place with
  `pnpm skill:pack` (cross-compile + static-verify; writes only to
  `skills/excali-local/bin/` + the README size table — scratch is in the OS temp
  dir, no `.skill-dist/`).
- **IndexedDB schema changes** require a `DB_VERSION` bump + `upgrade()` migration
  (users have existing data). Two DBs: `excali` (gallery) and `excali-fonts`. See
  [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- **Two i18n systems** — chrome.i18n (shell) vs i18next (page). Don't mix.
- **`packages/bridge` is Go, not a pnpm workspace** — `pnpm install`/workspace
  tooling ignores it. Build with `pnpm bridge:build` (`go build`); its Leg-B wire
  contract MUST mirror `excali-shared/src/agent-bridge.ts` (`internal/contract/`).
- **Exploration is read-only.** Don't run `pnpm install`, don't commit, don't write
  files beyond the change you were asked to make.
- After page edits, run `pnpm page:test` (and `page:build` if testing the extension).

## Daily commands

| Command | Purpose |
| --- | --- |
| `pnpm page:dev` | Editor webapp dev server (port 3000). |
| `pnpm page:build` | Build editor into `local/public/editor/`. |
| `pnpm page:test` | Vitest suite. |
| `pnpm local:build` | Build extension (Chrome + Firefox). |
| `pnpm local:tar` / `local:zip` | Pack release archives. |
| `pnpm sync:version` | Sync version across all packages.
| `pnpm bridge:build` | `go build` the Go bridge daemon into `bridge/bin/` (gitignored).
| `pnpm bridge:test` | `go test ./...` for the Go daemon (ws codec, pidfile, server).
| `pnpm skill:pack` | Cross-compile + refresh `skills/excali-local/bin/` (needs Go). |
| `pnpm skill:check` | Zero-drift gate: skill docs == wire contract. |

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
