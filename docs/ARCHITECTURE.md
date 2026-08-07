# Architecture

> Detail doc linked from [AGENTS.md](../AGENTS.md). Verified against `main` @ `00a9674` (v1.7.0).

## Three-layer monorepo

Excali Local is a local-first browser extension (Chrome/Firefox/Edge, MV3) that runs
Excalidraw **fully offline**: screenshot annotation, an offline editor, a local gallery
with collections, presentation mode, and custom fonts. No backend — all data in
IndexedDB / localStorage.

pnpm workspaces, three packages (plus a Go package that is NOT a workspace member):

| Package | Role |
| --- | --- |
| `packages/excali-local` | **Extension shell** (WXT). Generates the MV3 manifest; hosts the background service worker, content script, crop script, popup, and options page. Embeds the built editor from `excali-page`. |
| `packages/excali-page` | **Editor app** (React 19 + Vite 5). The Excalidraw UI — editor, gallery, presentation, marker. Ships as a standalone web app and as the extension's editor. |
| `packages/excali-shared` | **Shared layer**. Font-config IndexedDB (`excali-fonts`) + the **agent-bridge wire contract** (`agent-bridge.ts` — method sets, ports, WS types, token rules; the source of truth the Go daemon mirrors) + pure utils/types (`cn`, `getBrowser`, `getLang`). Imported via the `excali-shared` workspace alias. |
| `packages/excali-bridge` | **Go daemon** (Go, not a workspace member). The Agent Bridge: a 127.0.0.1-only WS server + agent CLI. Cross-profile single-active-canvas arbiter. See the bridge section below. |

## Repository layout

```
packages/
  excali-local/            # WXT extension shell
    wxt.config.ts          # manifest generator (perms, commands, i18n)
    entrypoints/
      background.ts        # message-routing hub
      excalidraw.content.ts# .excalidraw detection + "Open with" button
      crop.ts              # select-area screenshot script
      popup/ options/      # React entry UIs
      lib/utils.ts         # shell helpers (cn, ...)
    public/_locales/{en,zh_CN}/messages.json  # chrome.i18n strings
    public/editor/         # GENERATED (gitignored) — output of page:build
  excali-page/
    excalidraw-excalidraw-v0.18.0-csp.14.tgz   # local patched Excalidraw dep
    vite.config.mts        # CSP globals, @ alias, Vitest config
    src/
      main.tsx             # single root: mounts <Editor/>, injects fonts
      features/editor/     # editor core: components/ hooks/ store/ utils/ lib/
      features/gallery/    # gallery + collections
      components/ui/       # shadcn-style primitives (Radix + Tailwind)
      lib/ locales/        # utils + i18n
    test/                  # mirrors src/features/...; setup.ts + provider.helper.tsx
  excali-shared/src/       # db.ts (fonts) + agent-bridge.ts (wire contract) + index.ts (utils/types)
  excali-bridge/           # Go daemon (NOT a pnpm workspace): go.mod + main.go +
    internal/              #   contract (wire mirror), pidfile, ws (RFC 6455), fonts,
    bin/                   #   server (daemon), client (Leg-A CLI); bin/ gitignored
skills/excali-draw/        # agent-agnostic drawing skill (SKILL.md + references/) —
                           #   bundled daemon built at pack time; NOT a pnpm workspace
scripts/                   # build/clean/tar/zip, sync-version.sh, skill-pack.ts,
                           #   check-skill-commands.ts
  agent-bridge/            # e2e drivers: driver / driver-canvas / driver-gallery /
                           #   driver-fonts / driver-skill (spawn the daemon lazily)
.github/workflows/release.yml
```

## Data flow & message protocol

`popup / content script → background (message router) → editor tab → READY`.

Message `type` values are string literals (no enum). Defined in
`entrypoints/background.ts` and `features/editor/hooks/use-message-event.ts`:

- **Inbound to background** (from popup/content): `OPEN_LOCAL_EDITOR`,
  `OPEN_QUICK_EDITOR`, `OPEN_QUICK_EDITOR_WITH_JSON`, `CAPTURE_VISIBLE_TAB`,
  `CAPTURE_SELECT_AREA`, `CAPTURE_SELECT_AREA_END`, `CAPTURE_SELECT_AREA_ERROR`.
- **Background → editor tab**: `UPDATE_CANVAS_WITH_SCREENSHOT`,
  `UPDATE_CANVAS_WITH_JSON`.
- **Editor → background**: `READY` (editor finished booting; can accept canvas updates).

Adding a message type: update both the background router and the editor hook.

## Agent bridge daemon (agent-driven drawing)

The **Agent Bridge** lets an external local agent drive the activated canvas and the
canvas-related subsystems (gallery, fonts) over a loopback-only connection. It is a
**two-gate consent** model (Wayfinder 003/011/013): a **paired connection** (the user has
allowed *this* agent via first-use pairing) gates **all** agent control; an **activated
canvas** (the user has exposed a specific canvas on the editor page) is an **additional**
gate for canvas-bound operations + the single-active-canvas invariant. Global operations
(gallery, fonts) work over a paired connection **without** an activated canvas.

The **Go daemon** (`packages/excali-bridge`, Tickets 009/016/017) is the **cross-profile
arbiter** — the only entity shared across browsers/profiles (loopback). One self-contained
binary, two faces:

- **serve** — 127.0.0.1-only WS server on the fixed range `[17331..17335]` (first free
  wins). Auth per 011: origin allow-list (`chrome-extension://<id>`) at upgrade + ≥128-bit
  per-session hex token in the `handshake` message (never logged). Holds **≤1 active page**
  keyed on the WS connection (never tabId — per-profile, not global); a new activation
  **displaces** the prior page: it receives `{type:"displaced"}`, then its socket closes.
  The page hook stops its session on `displaced`, tells its SW (`AGENT_BRIDGE_DISPLACED`),
  and flips the UI. Agent CLI connections handshake with `role:"agent"` — authenticated but
  never claiming the slot.
- **Leg-A agent CLI** — versioned minimal JSON-RPC (ADR 0001); **CLI subcommand ==
  JSON-RPC method** (`excali-bridge <method> [params-json]`). Lazy daemon: the first CLI
  command spawns `serve` detached if needed.
- **Single-instance** = fixed-path pidfile `~/.excali-local/bridge.pid` holding
  `{pid, port}` **only** (never the token, per 011/017); stale pid cleaned up; a later
  invocation finds a live pid + answering daemon → reuses, no respawn.

**Connection model (goal-3, Option A):** every page connection carries a **per-profile
uuid** (store-install extension ids are identical across profiles, so origin alone can't
distinguish them). A Local editor page may dial a **control connection** (`role:"control-page"`)
**without** being activated — this is how gallery/fonts (global) ops reach a page with no
active canvas. Routing is unambiguous:

- **Daemon-local** methods (`ping`, `commands.list`, `protocol.version`, `bridge.status`,
  `fonts.system.list`) resolve in the daemon — no page involved.
- **Canvas-bound** methods (all `canvas/v1`; `gallery.load`/`gallery.save`) route to the
  **active slot only** — no active canvas → `-32001`, never a silent guess.
- **Paired-only** methods (gallery list/get/rename/delete/collections; fonts
  get/assign/install/clear) route to the **active canvas's page if one is active, else to
  exactly one control page** — zero or >1 control pages with no active canvas → `-32004`
  (ambiguous target), never a silent guess.

**Command surface** (33 methods; the `excali-bridge` CLI is the stable contract — the
drawing skill teaches this surface, never the JSON-RPC/WS internals):

- **canvas/v1** (16) — the activated Excalidraw canvas: read (`scene.get`/`elements`/
  `state`/`bounds`/`exportPng`/`exportSvg`), write (`scene.update`/`elements.add`/`clear`/
  `scene.reset`/`files.add`/`tool.setActive`/`view.scrollTo`/`history.clear`), +
  `commands.list`/`protocol.version`. Destructive subset fires a non-blocking indicator.
- **gallery/v1** (10) — `gallery.{list,get,rename,delete,collections.*}` paired;
  `gallery.{load,save}` canvas-bound. delete/rename = blocking confirm.
- **fonts/v1** (5) — `fonts.system.list` **daemon-local** (Go enumerates OS-installed
  fonts by scanning standard font dirs + parsing sfnt name tables; pure stdlib,
  cross-browser, no `queryLocalFonts` permission); `fonts.{get,assign,install,clear}`
  paired (touch the `excali-fonts` IndexedDB record). install/clear = blocking confirm;
  `requiresReload:true` on every write (fonts inject once at boot).

JSON-RPC error codes: `-32001` no active canvas · `-32002` page timeout · `-32003` page
disconnected mid-flight · `-32004` ambiguous target (>1 control page, no active canvas) ·
`-32005` user cancelled a blocking op · plus std `-32600..-32603`.

Wire contract: `packages/excali-shared/src/agent-bridge.ts` is the **source of truth** for
the method set + ports + WS types + token rules; `packages/excali-bridge/internal/contract/`
**mirrors it by hand** (change both together — code-gen to eliminate the manual mirror is a
tracked follow-up). The e2e harness in `scripts/agent-bridge/` exercises the full surface
against the real daemon: `driver.ts` (ping + displacement), `driver-canvas.ts` (canvas/v1),
`driver-gallery.ts` (gallery/v1), `driver-fonts.ts` (fonts/v1), `driver-skill.ts` (the
assembled skill binary end-to-end).

The agent-facing surface is packaged as the **excali-draw skill** (`skills/excali-draw/`,
Ticket 009) — an agent-agnostic `SKILL.md` + `references/` that bundles static
multi-platform daemon binaries and teaches an agent to draw via the CLI.
`scripts/skill-pack.ts` cross-compiles (CGO disabled, symbols stripped) + static-verifies +
builds the binaries **in place** into `skills/excali-draw/bin/` (source-is-the-artifact) +
emits the versioned tarball; `scripts/check-skill-commands.ts` is a zero-drift gate
asserting the skill's documented command set matches the contract.


## Editor boot & forms

Single HTML entry (`index.html` → `src/main.tsx`) mounts `<Editor />` inside a Jotai
`<Provider>`. Boot sequence in `main.tsx`:

1. `initI18n()` (i18next).
2. `injectCustomFonts()` — installs `@font-face` rules before Excalidraw reads them.
3. `initFontConfig(...)` — hands the font config to Excalidraw.
4. `EXCALIDRAW_ASSET_PATH` is set from the Vite-injected env var.

Three editor components under `features/editor/components/`:

- `editor.tsx` — root assembler.
- `local-editor.tsx` — full editor with autosave.
- `quick-editor.tsx` — ephemeral annotation, no save.

## Presentation & marker

- **Presentation:** slides are Excalidraw frame elements, ordered by an index stored
  on each frame's `customData`. Sorting in `utils/assemble.ts`; the index is written in
  `utils/excalidraw-api.helper.ts`. State in `store/presentation.ts`; slide UI in
  `components/slide-*.tsx`; orchestration in `hooks/use-update-slides.ts`.
- **Marker sidebar:** `components/marker-sidebar.tsx` + `hooks/use-marker.ts` +
  `store/marker.ts`. Excalidraw's `renderTopRightUi` does **not** react to external
  state, so the code uses a `forceUpdate` trick to refresh it — preserve that pattern.

## Key file index

| File | Why it matters |
| --- | --- |
| `packages/excali-local/wxt.config.ts` | Manifest, permissions, keyboard commands, Firefox `gecko.id`. |
| `packages/excali-local/entrypoints/background.ts` | Extension hub; all message routing. |
| `packages/excali-local/entrypoints/excalidraw.content.ts` | `.excalidraw` detection + button injection. |
| `packages/excali-local/entrypoints/crop.ts` | Select-area screenshot logic. |
| `packages/excali-page/vite.config.mts` | CSP globals, `@` alias, Vitest config. |
| `packages/excali-page/src/features/editor/utils/indexdb.ts` | `excali` DB schema (v2) + gallery CRUD. |
| `packages/excali-page/src/features/editor/components/local-editor.tsx` | Main editor UI + save pipeline. |
| `packages/excali-page/src/features/gallery/store/gallery-atoms.ts` | Gallery Jotai state. |
| `packages/excali-shared/src/db.ts` + `index.ts` | Font-config storage + shared utils/types.
| `packages/excali-shared/src/agent-bridge.ts` | Agent-bridge wire contract — **source of truth**: method sets (canvas/gallery/fonts), ports, WS types, token rules, consent keys, error codes. The Go daemon mirrors it. |
| `packages/excali-bridge/` (`main.go` + `internal/`) | Go daemon: WS server + agent CLI, pidfile single-instance, displacement, daemon-local OS-font enumeration, cross-profile routing. |
| `scripts/agent-bridge/` (5 drivers) | e2e vs the real daemon: `driver` (ping+displacement), `driver-canvas` (canvas/v1), `driver-gallery` (gallery/v1), `driver-fonts` (fonts/v1), `driver-skill` (source skill binary). |
| `skills/excali-draw/` | Agent-agnostic drawing skill (`SKILL.md` + `references/`); bundles the static multi-platform daemon binaries **committed under `bin/`** (source-is-the-artifact). Pack with `scripts/skill-pack.ts`. |
| `scripts/{build,clean,tar,zip}.ts` + `sync-version.sh` + `skill-pack.ts` + `check-skill-commands.ts` | Build/pack/version tooling + skill binary refresh/archive + zero-drift command gate. |
| `.github/workflows/release.yml` | Tag → test → build → pack → draft release. |
