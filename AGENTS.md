# AGENTS.md

**Excali Local** — a local-first browser extension (Chrome/Firefox/Edge, MV3) that
runs Excalidraw **fully offline**: screenshot annotation, an offline editor, a local
gallery, presentation mode, custom fonts. No backend; all data in IndexedDB.

Bun-workspaces monorepo, three packages:

- `packages/excali-local` — WXT **extension shell** (manifest, background, content, crop, popup, options).
- `packages/excali-page` — React 19 + Vite **editor app** (the Excalidraw UI).
- `packages/excali-shared` — font-config DB + shared utils/types.

This file is **agent guidance + routing**, not a repo manual. For the why and the
detail, read the doc relevant to your task (links below).

## Hard constraints (do not break these)

- **Bun**, not npm/pnpm/yarn.
- **Excalidraw is a local patched tgz** (`excalidraw-excalidraw-0.18.0-csp.12.tgz`).
  Never swap for the npm version — CSP/offline will break. See [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md).
- **`packages/excali-local/public/editor/` is a gitignored build artifact**, not
  committed. Run `bun run page:build` after changing page code; never commit it.
- **IndexedDB schema changes** require a `DB_VERSION` bump + `upgrade()` migration
  (users have existing data). Two DBs: `excali` (gallery) and `excali-fonts`. See
  [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- **Two i18n systems** — chrome.i18n (shell) vs i18next (page). Don't mix.
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
| `bun run sync:version` | Sync version across all packages. |

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
