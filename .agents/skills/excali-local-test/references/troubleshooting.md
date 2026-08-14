# Troubleshooting

## `install_extension` → "Access denied: path ... is not within any of the configured workspace roots"

The chrome-devtools MCP restricts file-tool paths to its workspace roots
unless `--allowUnrestrictedPaths` is set. The repo's `.mcp.json` sets it — but
only when the MCP server actually started with the project config:

- **MCP server still running with old args** — the server keeps its launch
  args until reconnected. Reconnect (restart pi / re-establish the
  chrome-devtools connection), then verify `list_extensions` works.
- **pi started outside the repo root** — `.mcp.json` is read from pi's cwd.
  Start pi from the repo root.
- **Another agent runtime that ignores the repo `.mcp.json`** — fallback:
  copy the outdir into the OS temp dir and install from there:
  ```bash
  TMP=$(node -e "process.stdout.write(require('os').tmpdir())")
  rsync -a --delete <outdir> "$TMP/excali-test-extension"
  # install_extension "$TMP/excali-test-extension"
  ```
  The temp dir is always an allowed root.

## wxt exits immediately after "Load .output/... as an unpacked extension manually"

Known: **wxt exits when its stdin closes** (readline on `process.stdin`).
Never spawn wxt directly in a backgrounded shell — always through
`scripts/dev-server.mjs start`, which holds the stdin pipe. If you see this,
you ran wxt by hand; use the script (or `tail -f /dev/null | wxt ...` for a
manual session).

## Orphan / stale state

`start` is self-healing: a dead supervisor/wxt leaves pidfiles that the next
`start` detects and cleans (SIGKILL fallback). If a *live* wxt is somehow
running without a supervisor: `node scripts/dev-server.mjs stop` kills it by
pidfile; worst case `pkill -f "wxt.test.config"`.

## Port 3000 conflicts

wxt dev uses strictPort — if `:3000` is taken, `start` fails before spawning
with a clear message. Likely culprits: `pnpm page:dev` (vite dev on 3000) or
a leftover `local:dev`. Stop those first. (`status` shows port state.)

## Stale dev build / code changes not applied

The dev server rebuilds on change (see `.excali-test/wxt.log`). The extension in
the MCP browser does **not** auto-reload — call
`chrome_devtools_reload_extension` with the recorded id after edits. Page
(HMR) content updates live; the background service worker needs the reload.

## Extension missing from the browser after reconnect

The MCP browser keeps its profile; a reconnected server may or may not
re-attach the previously installed unpacked extension. Just re-run step 2:
`install_extension` (same path → same id), reopen the editor page, and
re-activate if needed.

## Extension id changed

The id derives from the install path. If you moved/copied the outdir to a new
temp path, the id changes — re-record it in `.excali-test/extension-id.txt` and use
the new id for `new_page`/`reload_extension`.

## `list_console_messages` / evaluation on the extension page fails

Extension pages are inspectable only because the MCP browser uses the native
extension connection (pipe) — that is the supported path and the repo config
keeps it (`--categoryExtensions=true`). If the tools are missing entirely,
the MCP server is not running with `--categoryExtensions=true` — check
`.mcp.json` and reconnect.

## Bridge: canvas won't activate / stays amber

- The daemon must be up first: `excali-bridge ping` → `pong`. Order otherwise
  doesn't matter (the button retries detection).
- Check the page console (`list_console_messages`) for WebSocket errors to
  the daemon port range `127.0.0.1:[17331..17335]`.
- Check the daemon: `excali-bridge bridge.status`; pidfile
  `~/.excali-local/bridge.pid`; if wedged, kill the pidfile process and let
  the next command start a fresh daemon (machine-wide, single-instance).

## `pnpm page:build` fails or editor page is blank

The editor artifact is required (`packages/local/public/editor/`,
gitignored). Rebuild with `pnpm page:build` and re-run `start` — the artifact
check re-triggers when `page/src` is newer. A blank editor page usually
means a stale/missing artifact (the dev server serves
`editor/index.html` from the extension bundle, not from vite).
