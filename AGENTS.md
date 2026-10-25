# AGENTS.md

**Excali Local** — a local-first browser extension (Chrome/Firefox/Edge, MV3) that
runs Excalidraw **fully offline**: screenshot annotation, an offline editor, a local
gallery, presentation mode, custom fonts. No backend; all data in IndexedDB.

pnpm-workspaces monorepo, three packages (plus one Go package that is NOT a workspace
member — it builds with `go build`):

- `packages/local` — WXT **extension shell** (manifest, background, content, crop, popup, options).
- `packages/page` — React 19 + Vite **editor app** (the Excalidraw UI).
- `packages/shared` — font-config DB + the **agent-bridge wire contract** (`agent-bridge.ts` — the source of truth the Go daemon mirrors) + shared utils/types.
- `packages/presence` — **Rust menu-bar tray** (NOT a pnpm workspace, `cargo build`):
  `tray-icon` + `muda` on a winit event loop; a bridge-only five-item menu that
  reads status and switches LAN / autostart by exec'ing `excali-bridge` (ADR 0014).
- `packages/bridge` — **Go daemon** (NOT a pnpm workspace): the Agent Bridge
  (Tickets 009/016/017) — a 127.0.0.1-only WS server (Leg B: the activated editor
  page dials out) + agent CLI (Leg A: versioned minimal JSON-RPC). Cross-profile
  single-active-canvas arbiter: pidfile single-instance, ≤1 active page, new
  activation displaces. Wire contract mirrored from `excali-shared/src/agent-bridge.ts`
  (the source of truth the Go side mirrors by hand). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `skills/excali-local/` — the **agent-agnostic drawing skill** (NOT a workspace member):
  `SKILL.md` + `references/` that teach an agent to draw via the CLI, plus a preflight step
  that fetches the daemon binary on demand (no binaries in the skill dir, ADR 0012). Pack
  with `scripts/skill-pack.ts`; verify with `scripts/check-skill-commands.ts`.

This file is **agent guidance + routing**, not a repo manual. For the why and the
detail, read the doc relevant to your task (links below).

## Hard constraints (do not break these)

- **pnpm** (package manager) + **tsx** (TS script runtime), not bun/npm/yarn.
- **Excalidraw is a local patched tgz** (`excalidraw-excalidraw-v0.18.0-csp.14.tgz`).
  Never swap for the npm version — CSP/offline will break. See [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).
- **`packages/local/public/editor/` is a gitignored build artifact**, not
  committed. Run `pnpm page:build` after changing page code; never commit it.
- **No built binaries in git.** `skills/excali-local/bin/` is NOT committed: the daemon
  binaries ship as GitHub release assets and land on demand at the one canonical path
  (`~/.local/bin/excali-bridge`, ADR 0012). `pnpm skill:pack` still cross-compiles +
  static-verifies but writes outside the repo; `pnpm skill:check` guards against a
  binary reappearing under `skills/excali-local/bin/`.
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
| `pnpm skill:pack` | Cross-compile the daemon for 4 static targets and stage its release assets (needs Go). |
| `pnpm skill:check` | Zero-drift gate: skill docs == wire contract. |
| `pnpm relay:dev` / `relay:dev:https` | One-command collab-relay dev loop: idempotent seed, `.dev.vars` + invite print, `wrangler dev` (optional mkcert TLS). |
| `pnpm relay:keygen` | Production org keypair + server invite generator (`--org` / `--relay`). |

Full list + build/release/CSP detail: [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).

## Operating rules

- Verify paths/scripts/strings against the code before trusting any doc (including
  this one) — the repo evolves. Use `rg` / `read`.
- Read the target file to get current line anchors before editing; follow existing
  patterns in the same directory.
- Small, conventional commits (`feat:` `fix:` `refactor:` `test:` `chore:` `docs:`).
- When code and docs disagree, trust the code and update the docs.
- **User-facing docs are bilingual (EN ⇄ zh-CN).** `README.md`, `docs/AGENT_BRIDGE.md`,
  `docs/KNOWN_LIMITATIONS.md`, and `skills/excali-local/README.md` each have a
  `*.zh-CN.md` mirror linked from the top of the file (pattern: pi-web). Update both
  halves of a pair together — prose differs, assets/links/code stay identical.
  Developer docs (`ARCHITECTURE`, `BUILD_AND_RELEASE`, `CONVENTIONS`, `CONTEXT.md`,
  `AGENTS.md`) stay English-only.

## Deeper knowledge (read when relevant)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 3-layer design, repository layout,
  message protocol, editor boot, presentation & marker, key-file index.
- [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md) — full commands, build
  pipeline, CSP constraints, release flow, version sync.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — Jotai, UI primitives, icons, path
  alias, i18n, storage, testing.
- [docs/PEERING.md](docs/PEERING.md) — cross-machine Canvas transfer: the two daemon
  surfaces, LAN listener switch, manual-address peering, the S1 exchange, limits,
  failure paths ([docs/PEERING-TESTING.md](docs/PEERING-TESTING.md) is the verification
  guide) ([ADR 0012](docs/adr/0012-bridge-daemon-is-the-product-presence-is-its-face.md),
  [ADR 0013](docs/adr/0013-cross-machine-canvas-transfer.md)).
