---
name: excali-local-test
description: Set up and drive the dev/test loop for the Excali Local browser extension (excali-local repo) — runs `pnpm local:dev`'s wxt dev server headlessly (no browser auto-launch), CDP-installs the fresh dev build into the chrome-devtools MCP browser, opens the local editor, activates the agent-bridge canvas, then combines chrome-devtools MCP browser control (click/fill/snapshot) with the excali-local skill (excali-bridge CLI) to run user-simulated manual tests of the extension and its agent-driven drawing. Use when asked to test, debug, or manually-verify the excali-local extension, run the dev loop, or verify agent-drive features end to end.
disable-model-invocation: true
---

# Excali Local — dev/test loop (skill for the project's dev agent)

This skill prepares and supervises the **development test loop** for the
**Excali Local** extension (the repo that hosts it). It is a *dev-time* tool:
it exists to let an agent test the extension the way a user would, by hand,
in a real browser — nothing it produces ships with the extension. The
extension (and its Agent Bridge) is the **thing under test**; this skill is
the test harness.

The harness combines two already-existing pieces:

- **chrome-devtools MCP** — controls the test browser (the extension's own
  Chrome, launched and owned by the MCP server). You click, fill, snapshot,
  and read console/network through these tools.
- **the `excali-local` skill** — drives the *activated canvas* through the
  `excali-bridge` CLI (draw elements, read the scene, export PNG, gallery,
  fonts). That skill is a sibling at `~/.agents/skills/excali-local/` —
  the agent-installed copy of the repo's packaged `skills/excali-local/`
  (which carries the platform binaries under `bin/`).

Division of labor: **browser chrome & UI flows** → chrome-devtools MCP;
**canvas/gallery/font operations on the activated canvas** → excali-local skill.

> **What this skill automates.** It automates what the *user* would do by hand
> on their own dev machine: run the dev server, load the dev build, open the
> editor, turn on agent control. The consent gates of the Agent Bridge
> (paired connection, activated canvas) are exercised through their real UI —
> scripted here because the user asked for the test, not bypassed.

---

## Prerequisites

1. **The repo**: an `excali-local` checkout, and you are running from its root
   (or pass `--root <path>` / set `EXCALI_REPO_ROOT`).
2. **chrome-devtools MCP** configured with extension tools. The repo carries
   `.mcp.json` (project-level, committed) that pins `chrome-devtools-mcp@1.6.0`
   with `--categoryExtensions=true --allowUnrestrictedPaths`. If the MCP
   server was started before that file existed, **reconnect it** (restart pi,
   or re-establish the chrome-devtools connection) so the new args take effect.
   Verify with: the `chrome_devtools_list_extensions` /
   `chrome_devtools_install_extension` tools are available.
3. **The `excali-local` skill** installed (for the `excali-bridge` binaries and
   the drawing methodology). Located at `~/.agents/skills/excali-local/`;
   fallback: the repo's packaged `skills/excali-local/` (run `pnpm skill:pack`
   to refresh the committed binaries).
4. `pnpm` and Node available; port **3000** free (wxt dev is strictPort —
   a running `pnpm page:dev` or another `local:dev` will block setup).

## Flow at a glance

| Step | Who does it | What happens |
| --- | --- | --- |
| 1. Start dev server | `scripts/dev-server.mjs start` | pnpm install if needed → `pnpm page:build` if the editor artifact is stale → spawns `wxt` headlessly (browser disabled) under a supervisor, waits for `:3000` + fresh `.output/chrome-mv3-dev` |
| 2. Load the extension | you, via chrome-devtools MCP | `install_extension` the dev outdir, record the id, `new_page` the editor |
| 3. Activate the canvas | you | start the bridge daemon (`excali-bridge ping`), click the **Agent** button (cold-start path: Turn on → confirm → auto-activate), verify with the bridge |
| 4. Run the tests | you, self-directed | simulate manual user flows: UI via MCP, canvas via the excali-local skill (details in `references/`) |
| 5. Teardown | `scripts/dev-server.mjs stop` | kills only the supervised wxt dev server; the bridge daemon and MCP browser are left running |

## Step 1 — start the dev server (supervised)

```bash
# SKILL_DIR = the directory of this skill — you, the invoking agent, know it
# from how you loaded it (e.g. .agents/skills/excali-local-test at the repo root,
# or ~/.agents/skills/excali-local-test). Never hardcode it in a reusable form.
SKILL_DIR=...  # resolve to this skill's directory
mkdir -p "$SKILL_DIR/.excali-test"
nohup node "$SKILL_DIR/scripts/dev-server.mjs" start > "$SKILL_DIR/.excali-test/supervisor.log" 2>&1 &
# wait for the "ready" line (poll "$SKILL_DIR/.excali-test/supervisor.log")
node "$SKILL_DIR/scripts/dev-server.mjs" status
```

`start` is idempotent (reuses a live supervisor) and, critically, **the wxt
process exits if its stdin closes** — the supervisor holds the pipe, so wxt
lives exactly as long as the supervisor does. Kill the supervisor (or run
`stop`) and wxt dies with it; no orphans.

## Step 2 — load the extension into the MCP browser

Use the chrome-devtools MCP tools (server name `chrome-devtools`):

1. `chrome_devtools_list_extensions` — confirm the tool set works.
2. `chrome_devtools_install_extension` with the absolute outdir from the
   `start` output (`.output/chrome-mv3-dev`) → returns the extension id.
3. Record the id for later use: `echo <id> > "$SKILL_DIR/.excali-test/extension-id.txt"`.
4. `chrome_devtools_new_page` → `chrome-extension://<id>/editor/index.html?type=local`.
5. `chrome_devtools_take_snapshot` — expect the Excalidraw editor UI
   ("Diagrams. Made. Simple.", Shapes toolbar, the **Agent** button).

The dev build serves page assets from `http://localhost:3000` (vite HMR), so
the supervised dev server must stay up for the whole test session.

## Step 3 — activate the canvas (agent bridge)

The bridge daemon is machine-wide and lazy: any `excali-bridge` command starts
it. From the sibling skill:

```bash
BIN=~/.agents/skills/excali-local/bin/excali-bridge-$(uname -s)-$(uname -m | tr -d 'v')
chmod +x "$BIN" 2>/dev/null || true
"$BIN" ping            # → "pong" (starts the daemon)
"$BIN" bridge.status   # daemon up, no canvas yet
```

Then activate through the real UI (cold-start path — the user's one-action
journey, scripted here):

1. In the editor page, click the **Agent** button (top-right toolbar).
2. In the enable modal, confirm **"Turn on agent control?"**.
3. The state machine goes grey → amber ("waiting for bridge") → blue/active.
   With the daemon already running, it should land on **Controlling**.
4. Verify end to end with the bridge: `"$BIN" scene.get` → empty scene,
   `"$BIN" bridge.status` → canvas connected.

State-machine details, failure states, and the per-canvas consent modal
(warm path) are in [`references/activation.md`](references/activation.md).

## Step 4 — run the tests (self-directed, user-simulated)

You decide the test cases — this mirrors a user's manual testing, so there is
no fixed suite. Standard patterns:

- **UI flows** (popup, options, gallery sidebar, modals, toasts): chrome-devtools
  MCP — `take_snapshot`, `click`, `fill`, `press_key`, `list_console_messages`,
  `take_screenshot`.
- **Canvas operations**: the excali-local skill — `elements.add`, `scene.get`,
  `scene.exportPng` (render → view → fix loop), `gallery.save/load`, fonts.
- **Agent-bridge consent gates**: with a canvas activated, canvas-bound ops
  succeed; blocking confirmations (destructive gallery/font ops) surface a
  confirmation you accept/decline through the UI (declining yields error
  `-32005` on the CLI).
- **Code iteration**: after editing extension code, the dev server rebuilds;
  call `chrome_devtools_reload_extension` (id from step 2) to apply, then
  re-verify.
- **Displacement**: activating another canvas displaces the first — canvas-bound
  calls start failing (`-32001`); re-check which canvas is active.

What the skill guarantees is the *environment* (dev server up, extension
loaded, canvas activated) — the scenarios above are guidance, not a suite.

## Step 5 — teardown

```bash
node "$SKILL_DIR/scripts/dev-server.mjs" stop
```

Kills only the supervised wxt dev server. The bridge daemon (machine-wide,
user-owned, `~/.excali-local/bridge.pid`) and the MCP browser are **left
running** on purpose. If the session crashed, the next `start` detects stale
state and cleans up.

## References

| When you need… | Read |
| --- | --- |
| The complete environment recipe, readiness checks, and notes (ports, artifacts, MCP config) | [`references/environment-setup.md`](references/environment-setup.md) |
| The Agent-button state machine and activation click paths | [`references/activation.md`](references/activation.md) |
| Failure modes and fixes (roots access-denied, orphans, port conflicts, HMR, MCP restart) | [`references/troubleshooting.md`](references/troubleshooting.md) |
| Drawing/driving the canvas (methods, gates, methodology) | the sibling `excali-local` skill |

## Respect the boundaries

- **Only the dev server is owned here** — do not kill the bridge daemon or
  the MCP browser in teardown; they are shared/user-owned.
- **Consent is exercised through the real UI, not bypassed** — activation
  uses the actual Agent-button flow; blocking confirmations are answered
  through the page, not silenced.
- **External-reach flows stay out of scope** (screenshot capture/annotation,
  external `.excalidraw` files, popup navigation) — the excali-local skill's
  boundary, unchanged here.
- **Exploration stays read-only** — the only mutations this skill makes are
  its own `.excali-test/` scratch dir (gitignored), the gitignored build artifacts
  (`.output/`, `public/editor/`), and the background processes it manages.
