# Environment setup — full recipe

The supervised dev-server script owns everything in this document; these are
the exact mechanics, the checks it performs, and the failure points, so you
can reason about what you see in `.excali-test/` and `supervisor.log`.

> **Why `.excali-test/` and not `runtime/`?** The generated state is machine-specific
> (pids, logs, and the materialized config with absolute paths) — it must never be
> committed, and a generic name invites collisions. The dir is dot-prefixed, tool-owned,
> and ignored both by the skill's own `.gitignore` and by a scoped entry in the repo's
> root `.gitignore`.

## What `start` does, in order

1. **Resolve the repo root** — `--root <path>` > `EXCALI_REPO_ROOT` > `cwd`.
   Validates `package.json` name is `excali` and
   `packages/excali-local/wxt.config.ts` exists. Exit 1 with a clear message
   otherwise.
2. **Idempotency check** — if a supervisor pidfile exists and both the
   supervisor and wxt are alive, it prints `already running` and exits 0.
   Stale state (dead supervisor / dead wxt) is cleaned: the old wxt is
   SIGKILLed if still alive, pidfiles removed.
3. **Port check** — `127.0.0.1:3000` must be free (wxt dev is strictPort).
   A running `pnpm page:dev` or a second `local:dev` blocks setup — the error
   tells you which.
4. **`pnpm install`** — only if neither the repo nor the package has
   `node_modules` (first run on a fresh clone).
5. **`pnpm page:build`** — the editor is a build artifact at
   `packages/excali-local/public/editor/` (gitignored). Rebuilt when
   `public/editor/index.html` is missing or older than the newest file under
   `packages/excali-page/src/`.
6. **Materialize `.excali-test/wxt.test.config.ts`** from
   `templates/wxt.test.config.ts.tpl` — the template imports the project's
   real `wxt.config.ts` by absolute path and sets `webExt: { disabled: true }`
   (WXT's "manual runner": dev server + build, no browser launched).
7. **Spawn wxt** — `node <pkg>/node_modules/wxt/dist/cli/index.mjs -c <config>`,
   cwd = `packages/excali-local`, **stdin = an open pipe the supervisor holds**.
   wxt exits when its stdin closes, so the supervisor is both the
   stdin-holder and the lifecycle guard: supervisor dies → pipe closes → wxt
   dies. No orphans possible.
8. **Readiness** — polls `:3000` until it answers, then requires a fresh
   `.output/chrome-mv3-dev/manifest.json` (mtime after start). Prints:
   ```
   [excali-test] ready
   [excali-test] dev-server: http://127.0.0.1:3000
   [excali-test] extension-outdir: <abs path to .output/chrome-mv3-dev>
   ```
9. **Stays alive** as supervisor; forwards SIGTERM/SIGINT to wxt.

## Generated state (all in `<skill>/.excali-test/`)

| File | Meaning |
| --- | --- |
| `supervisor.pid` / `wxt.pid` | pids for `stop`/`status` |
| `supervisor.log` | the `[excali-test]` lines (also echoed to stdout) |
| `wxt.log` | wxt/vite output (build errors, HMR) |
| `wxt.test.config.ts` | generated dev config (absolute paths — machine-specific, never commit) |
| `extension-id.txt` | the extension id you recorded in step 2 (convention, optional) |

## Readiness checklist (after `start`)

1. `scripts/dev-server.mjs status` → supervisor alive, port open, dev-build
   fresh, editor artifact present.
2. chrome-devtools MCP has the extension tools
   (`list_extensions` / `install_extension` available).
3. `install_extension` succeeds on the reported outdir and `list_extensions`
   shows **Excali Local**.
4. `new_page` the editor URL renders the Excalidraw UI (snapshot).
5. `excali-bridge ping` → `pong`; `bridge.status` → daemon up.
6. Canvas activated (see `activation.md`) → `scene.get` answers.

## Notes

- **Pi reads `.mcp.json` from its cwd** — start pi from the repo root for the
  project-level MCP config to apply.
- **The MCP server keeps its launch args until reconnected** — after editing
  `.mcp.json` (or installing this skill fresh), reconnect chrome-devtools
  (restart pi, or re-establish the connection) so `--allowUnrestrictedPaths`
  and the pinned version take effect.
- **The extension id derives from the install path** — the same outdir yields
  the same id on a machine; a changed temp path yields a new id.
- **`wxt build` mode** — for a CI-style regression pass you can instead run a
  plain `pnpm --filter ./packages/excali-local build` and `install_extension`
  the self-contained `.output/chrome-mv3` (no dev server needed). Everything
  else in this skill is unchanged.
