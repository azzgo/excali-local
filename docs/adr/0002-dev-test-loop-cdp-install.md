# Dev-test loop: CDP-install the dev build into the MCP browser

The developer's test loop for the extension needs a real browser with the dev
build loaded and an agent attached to it. The obvious path — let `wxt dev`
launch its own browser and attach the agent to *that* Chrome via CDP — does
not work, because WXT's web-ext runner launches Chrome with
`--remote-debugging-pipe` (a stdio pipe it owns), never a TCP port, so no
external CDP client can reach it. We instead run wxt dev **headless**
(browser launch disabled), let **chrome-devtools-mcp own the test browser**
(its native pipe connection, which is also the only channel that supports the
extension tools), and load the freshly built extension into it via the CDP
`Extensions.loadUnpacked` path — surfaced in the MCP as `install_extension`.

## Status

accepted — 2026-08-09 (dev-test skill, excali-local-test)

## Considered Options

- **Attach to the wxt-launched Chrome — rejected.** WXT launches Chrome via
  web-ext with `--remote-debugging-pipe`; the pipe belongs to the wxt
  process, so `--browserUrl`-style CDP attachment is impossible without
  fighting the runner. Even forcing `--remote-debugging-port` through
  `chromiumArgs` conflicts with the pipe flag and leaves the profile
  wxt-managed.
- **Skill launches Chrome with `--remote-debugging-port` + `--browserUrl`
  MCP — rejected.** Requires a second MCP server instance pointed at a fixed
  port, brittle at server start (Chrome must already be up), and duplicates
  browser ownership. Branded Chrome 151 also ignores `--load-extension`, so
  the extension would have to be installed over CDP anyway — making the
  separate browser pointless.
- **MCP browser owns the Chrome; wxt dev runs headless — chosen.** The MCP
  server already launches a persistent-profile Chrome over its native pipe
  connection; extension tools (`install_extension`, `list_extensions`,
  `reload_extension`) work over that channel out of the box
  (`--categoryExtensions=true`). WXT's `webExt.disabled` switches it to the
  "manual runner": dev server + `.output/*-mv3-dev` build, no browser. The
  dev build's pages load from the dev server (vite HMR), so the supervised
  dev server stays up for the session.

### Project-level MCP config (`.mcp.json`)

To make the MCP dependency reproducible in-repo, the repo carries a project
level `.mcp.json` (pi reads it from its cwd and merges per-server, per-field
over the global `~/.pi/agent/mcp.json`). It pins `chrome-devtools-mcp@1.6.0`
(verified with Chrome 151), keeps `--categoryExtensions=true`, and adds
`--allowUnrestrictedPaths` — pi's MCP client does not negotiate the MCP
`roots` capability, so without that flag the server restricts file-tool paths
(including `install_extension`'s path) to the OS temp dir, and the install
path would need a temp copy. The config contains no absolute paths and is
machine-portable. Fallback for runtimes that ignore it: copy the build to the
temp dir before installing.

## Consequences

- **The test browser is a separate Chrome from the user's daily browser.** Its
  profile is persistent (`~/.cache/chrome-devtools-mcp/chrome-profile`), and
  the dev extension is installed per session via `install_extension` (id is
  derived from the path — stable per path per machine).
- **The `excali-local-test` skill (dev-only, `~/.agents/skills/`) owns the wxt
  dev server as a supervised background job.** wxt exits when its stdin
  closes, so a supervisor process holds an open stdin pipe; killing the
  supervisor stops wxt — no orphans. It does **not** own the bridge daemon
  (machine-wide, user-owned) or the MCP browser.
- **Extension code iteration requires `reload_extension`** (page HMR is live,
  the service worker is not) — the skill documents this.
- **The extension under test is the dev build** (CSP permits `localhost:3000`
  for HMR). For a production-representative pass, `wxt build`'s self-contained
  `.output/chrome-mv3` can be installed instead — same flow, no dev server.
