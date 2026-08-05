# Excali Local — Handoff (agent-driven drawing, post goal-5 + doc-sync)

> **Read this first if you're a new session picking up after testing found a problem.**
> This is a fresh-start handoff: it assumes you know nothing about the prior conversation.
> It points you at the authoritative docs rather than duplicating them, and tells you how
> to reproduce, diagnose, and fix without re-litigating settled decisions.

**State as of this writing:** the Agent Bridge feature is **functionally complete** and
**all docs are synced** to the implemented state. The user is about to do live-browser
testing. If something breaks, this doc + `AGENTS.md` + `docs/ARCHITECTURE.md` + `CONTEXT.md`
are all you need to get oriented.

---

## 1. What this project is

**Excali Local** — a local-first browser extension (Chrome/Firefox/Edge, MV3) that runs
Excalidraw **fully offline**: screenshot annotation, an offline editor, a local gallery,
presentation mode, custom fonts. No backend; all data in IndexedDB.

Bun-workspaces monorepo. **Always read [`AGENTS.md`](AGENTS.md) first** — it's the routing
doc (hard constraints, daily commands, package layout). Honour its hard constraints
absolutely: Bun (not npm/pnpm), the **local patched Excalidraw tgz** (`excalidraw-excalidraw-0.18.0-csp.12.tgz` — never swap for npm), `public/editor/` + `excali-bridge/bin/` + `.skill-dist/` are gitignored build artifacts, IndexedDB schema changes need a `DB_VERSION` bump + migration.

## 2. Packages (4 — 3 Bun workspaces + 1 Go)

| Package | Role |
| --- | --- |
| `packages/excali-local` | WXT **extension shell** (manifest, background, content, crop, popup, options). |
| `packages/excali-page` | React 19 + Vite **editor app** (the Excalidraw UI; gallery, presentation, marker). |
| `packages/excali-shared` | Font-config DB + the **agent-bridge wire contract** (`src/agent-bridge.ts` — the source of truth) + utils/types. |
| `packages/excali-bridge` | **Go daemon** (NOT a Bun workspace): the Agent Bridge — WS server (Leg B) + agent CLI (Leg A). |
| `skills/excali-draw/` | The **agent-agnostic drawing skill** (NOT a workspace): `SKILL.md` + `references/` bundling static multi-platform daemon binaries. |

---

## 3. The Agent Bridge — what's built (goals 1-5, all done + verified)

An external local agent drives the editor via the **`excali-bridge` CLI** (the stable
contract — JSON-RPC/WS internals are never exposed to the agent). Architecture is
**agent ↔ daemon (Leg A, custom JSON-RPC, CLI subcommand == method) ↔ page (Leg B, reverse
WS)**. The daemon brokers; the agent never connects to the page directly.

**Two-gate consent** (use the exact `CONTEXT.md` terms): a **paired connection** (user
allowed *this* agent) gates ALL control; an **activated canvas** (user exposed a specific
canvas on the editor page) ADDITIONALLY gates canvas-bound ops + the single-active-canvas
invariant. Global ops (gallery, fonts) work over a paired connection with **no** activated
canvas.

**Connection model = goal-3 "Option A"** (this intentionally changed an earlier design — do
NOT revert): a Local editor page may dial a **control connection** (`role:"control-page"`)
without being activated. Every page connection carries a **per-profile uuid**. Routing is
unambiguous: daemon-local → resolved in daemon; canvas-bound → active slot (else `-32001`);
paired-only → active canvas's page if active, else exactly-one control page, else `-32004`
(ambiguous — never a silent guess).

**Command surface — 33 methods** (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §"Agent
bridge daemon" for the full inventory + payload shapes; [`skills/excali-draw/references/command-reference.md`](skills/excali-draw/references/command-reference.md) is the agent-facing version):
- **canvas/v1** (16, activated): read (`scene.get`/`elements`/`state`/`bounds`/`exportPng`/`exportSvg`), write (`scene.update`/`elements.add`/`clear`/`scene.reset`/`files.add`/`tool.setActive`/`view.scrollTo`/`history.clear`), + `commands.list`/`protocol.version`.
- **gallery/v1** (10): `gallery.{list,get,rename,delete,collections.*}` paired; `gallery.{load,save}` canvas-bound. delete/rename = blocking confirm.
- **fonts/v1** (5): `fonts.system.list` **daemon-local** (Go enumerates OS fonts — pure stdlib, cross-browser, NOT `queryLocalFonts`); `fonts.{get,assign,install,clear}` paired. install/clear = blocking confirm; `requiresReload:true` on every write.
- **daemon-local meta**: `ping`, `commands.list`, `protocol.version`, `bridge.status`.

**Error codes:** `-32001` no active canvas · `-32002` page timeout · `-32003` page disconnected · `-32004` ambiguous target · `-32005` user cancelled a blocking op · std `-32600..-32603`.

**The skill** (`skills/excali-draw/`, Wayfinder Ticket 009) packages this as an
agent-agnostic `SKILL.md` + `references/` that bundles **static, dependency-free
multi-platform daemon binaries** (darwin-arm64/amd64, linux-amd64, windows-amd64;
`CGO_ENABLED=0 -trimpath -ldflags="-s -w"`). It reuses the coleam00 diagram methodology
(Ticket 004) **adapted** to the live-canvas delivery model (emit to the activated canvas via
CLI, not write-to-disk; the "view" step is `scene.exportPng`).

## 4. Recent commits (most recent first)

```
bd84a55  docs: sync all docs to goals 1-5 state (this is the doc-sync handoff)   ← JUST LANDED
00a9674  feat(skill): excali-draw — agent-agnostic drawing skill + pack tooling  ← goal-5
e68e854  test(page): element-template round-trip through the real patched tgz
41e00e9  fix(bridge): build-tag pidfile.Alive + client detach for Windows x-compile
3ce7f93  test: fonts/v1 e2e driver                                                ← goal-4
... (a230a2d, dcbd2ee, 3b60d1e, 422e94a = fonts/v1)
... (0f0f0c8, 92f7930, 1c31624, 11b4f0c, 608b022, f829c8c, e9b420e, 680ea41, 4c55acf, 47caf8a, 745f856, 28861b0, b421ddd = goals 1-3)
```

---

## 5. How to verify / reproduce (the recipe)

Run from repo root. Everything exits on its own (macOS has **no `timeout` binary** — don't use it).

```bash
go vet ./...  &&  (cd packages/excali-bridge && go test ./... -count=1)   # daemon (6 pkgs)
bun run page:test                  # vitest --run (251 tests)
bun run local:build                # Chrome + Firefox
bun run bridge:build               # Go daemon → excali-bridge/bin/ (gitignored)
bun scripts/check-skill-commands.ts        # zero-drift: skill docs == contract (33 methods)
bun scripts/agent-bridge/driver.ts         # goal-1: ping + displacement
bun scripts/agent-bridge/driver-canvas.ts  # goal-2: canvas/v1 round-trip
bun scripts/agent-bridge/driver-gallery.ts # goal-3: gallery/v1 + connection model
bun scripts/agent-bridge/driver-fonts.ts   # goal-4: fonts/v1 + daemon-local system.list
bun scripts/agent-bridge/driver-skill.ts   # goal-5: runs the SOURCE skill binary (skills/excali-draw/bin/) end-to-end
bun scripts/skill-pack.ts                  # cross-compile 4 targets into skills/excali-draw/bin/ + static-verify + refresh README sizes + tarball
# ALWAYS cleanup after (drivers spawn the daemon lazily):
pkill -f 'excali-bridge serve'; pkill -f 'bin/excali-bridge'; rm -f ~/.excali-local/bridge.pid
git status   # must be clean (public/editor/ + excali-bridge/bin/ + .skill-dist/ + .output/ gitignored)
```

**Static-verify (the multi-platform binaries are dep-free):** linux → `file` says
"statically linked"; windows → `objdump -p <exe>` imports **only kernel32.dll**; darwin →
`otool -L` shows **only Apple system libs** (libSystem, libresolv, CoreFoundation, Security
— the last two are Go ≥1.24's cgo-less x509 dynamic imports; this is the dep-free maximum on
Apple, NOT a bug; documented in `skills/excali-draw/README.md`).

---

## 6. Known caveats / gotchas (don't chase these as bugs)

- **`internal/ws` `TestCloseHandshake` is flaky under heavy concurrent CPU load** — it can
  fail when `go test ./...` runs alongside cross-compiles/builds (timing-sensitive loopback
  close-handshake: gets "broken pipe" instead of `ErrClosed`). It passes 5/5 in isolation.
  Goal-5 does not touch `internal/ws/`. **Not a regression** — but a real latent quality
  issue worth stabilizing (separate, low-priority task).
- **darwin binaries link 4 Apple libs, not "only libSystem"** — Go ≥1.24 reality (see above).
  The `skill-pack.ts` static-verify gate correctly checks "Apple system libs only" (the
  spirit), not the literal "only libSystem".
- **The e2e drivers stub `window.excaliAPI`** (Bun can't load the patched tgz prod entry) —
  so live-browser Excalidraw rendering is **not** auto-covered. That gap is the user's
  final-acceptance lane. Use the `browser-bridge` skill to read live DOM/console/styles from
  a real Chrome tab when helping with live-browser QA.
- **Two i18n systems** — chrome.i18n (shell) vs i18next (page). Don't mix.
- **The TS↔Go wire contract is a manual mirror** — `excali-shared/src/agent-bridge.ts` is the
  source of truth; `excali-bridge/internal/contract/contract.go` mirrors it by hand. Change
  both together. Code-gen to eliminate the manual mirror is a tracked follow-up (not a bug).
  `scripts/check-skill-commands.ts` guards the skill docs against the TS contract, but does
  NOT yet guard the Go mirror — if you add/change a method, verify the Go side compiles +
  routes correctly (`GOOS=darwin go test ./internal/server`).

---

## 7. If testing found a bug — how to diagnose + fix

1. **Reproduce automatically first.** Try to trigger it via the relevant e2e driver (above)
   before touching the browser. If a driver reproduces it, you have a fast loop.
2. **Find the owner.** The routing/contract is in `excali-shared/src/agent-bridge.ts` (TS) +
   `excali-bridge/internal/contract/contract.go` (Go mirror). The daemon logic:
   `internal/server/server.go` (routing, local methods), `internal/client/client.go`
   (Leg-A CLI + lazy daemon spawn), `internal/pidfile/`, `internal/fonts/fonts.go`,
   `internal/ws/`. The page dispatchers: `excali-page/src/lib/{canvas-v1,gallery-v1,fonts-v1}.ts`
   + hooks in `excali-page/src/features/editor/`.
3. **Read the decision before "fixing" it.** The locked decisions live in
   [`.pi/wayfinder/tickets/`](.pi/wayfinder/tickets/) — load-bearing: **009** (skill
   packaging), **004** (methodology), **013** (content scope + two-gate consent), **007**
   (command map), **016/017** (singleton), **003/010/011** (activation/transport/auth),
   **014/015** (gallery/fonts). If a "bug" is actually a settled design choice, don't revert
   it — confirm with the user. (Notably: the goal-3 connection model deliberately changed
   Ticket 010's "page does not dial until activation"; `fonts.system.list` deliberately moved
   to the daemon, supersededing 015's `queryLocalFonts`.)
4. **For live-browser issues** (rendering, font injection, the destructive indicator, the
   blocking confirm modal, displacement UI), use the `browser-bridge` skill to inspect the
   real tab — it's far cheaper than screenshots and shows live DOM/console/styles/network/storage.
5. **Commit discipline:** small conventional commits (`feat:` `fix:` `refactor:` `test:`
   `chore:` `docs:`). After page edits run `page:test` (+ `page:build` if testing the
   extension). After daemon edits run `go test ./...` + the relevant driver. Keep `git status`
   clean (artifacts are gitignored).

---

## 8. Deferred fog / explicitly out of scope (don't expand into these without asking)

- `scene.subscribe` / push streaming / `applyDeltas` — the skill teaches poll-based reads only.
- Hot font-swap without page reload (re-inject + Excalidraw re-init) — `fonts.install/assign`
  return `requiresReload:true`; document the reload, don't implement hot-swap.
- `skills.sh` remote distribution — `skill-pack.ts` emits a **local** tarball only.
- Bun → pnpm monorepo migration — separate future effort.
- Stabilizing the `ws` `TestCloseHandshake` flake — low priority.
- A 2nd canvas-driving skill / extracting the daemon into a shared component — escape hatch
  in Ticket 009, not triggered.

---

## 9. Quick file index

| File | Why it matters |
| --- | --- |
| `AGENTS.md` | Routing + hard constraints. **Read first.** |
| `docs/ARCHITECTURE.md` | 3-layer design, repository layout, the full Agent Bridge section (connection model + 33-method surface + error codes), editor boot, key-file index. |
| `docs/BUILD_AND_RELEASE.md` | Commands, build pipeline, CSP, release flow, skill-pack. |
| `docs/CONVENTIONS.md` | Jotai, UI primitives, i18n, storage, the agent-bridge wire-contract convention. |
| `CONTEXT.md` | Domain glossary — use these exact terms (Activated canvas, Paired connection, Global allow, Canvas-bound/Global operation, Canvas-related, External-reach flow). |
| `docs/adr/0001-leg-a-custom-jsonrpc-not-mcp.md` | Why Leg A is custom JSON-RPC, not MCP. |
| `packages/excali-shared/src/agent-bridge.ts` | **Wire contract — source of truth** (method sets, ports, WS types, token rules, error codes). |
| `packages/excali-bridge/` | Go daemon: `main.go` (CLI dispatch), `internal/{server,client,pidfile,ws,fonts,contract}/`. |
| `packages/excali-page/src/lib/{canvas-v1,gallery-v1,fonts-v1}.ts` | Page-side dispatchers (PURE, injected deps). |
| `skills/excali-draw/` | The skill: `SKILL.md` + `references/` (`command-reference.md`, `element-templates.md`, `json-schema.md`, `color-palette.md`, `workflows/`). Platform daemon binaries ship **committed** under `bin/` (source-is-the-artifact). |
| `scripts/skill-pack.ts` | Cross-compile + static-verify + refresh the source skill's `bin/` + emit the versioned tarball. |
| `scripts/check-skill-commands.ts` | Zero-drift gate (skill docs == contract). |
| `scripts/agent-bridge/` | 5 e2e drivers (driver / driver-canvas / driver-gallery / driver-fonts / driver-skill). |
| `.pi/wayfinder/tickets/` | The locked decisions (Map 001 + 16 tickets). Read before re-deciding anything. |
| `.pi/planning/progress.md` | ext-impl's per-goal run logs + verification evidence. |

---

## 10. A note on roles

This work historically used a **two-agent split**: a *verifier + planner* agent (drafted
goals, verified output, did NOT write production code) and an **`ext-impl`** agent (ran
`/plan-goal-impl`, wrote all the daemon/page/skill code). For a debugging session the user
may simply want **direct fixes** — defer to what the user asks for. If they want the split
preserved, hand implementation back to `ext-impl` via `xfer_to` and keep to verification.

**Conversation language with the user is Chinese**; canonical terms (Map, Ticket, Goal,
Frontier) stay untranslated; repo records are English.
