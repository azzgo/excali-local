# Known Limitations

Documented platform / upstream constraints that the extension cannot fix in
code. Each entry states the limitation, why it exists, and what the code does
in response. Keep this file updated when a limitation lifts (e.g. a Chrome
milestone default-enables a feature).

## WebMCP is blocked on chrome-extension:// pages on default Chrome ≤156

**Status**: upstream platform limitation — cannot be fixed in this repo
(user-visible on branded/default Chrome without the dev flags).

**What**: on **default (non-flagged) Chrome ≤156**, WebMCP (the
`document.modelContext` imperative API — the basis of the extension's
"WebMCP" active control route, Wayfinder 043/044) is present on
`chrome-extension://` pages but **not usable there**: calling
`registerTool` / `getTools` throws

```
SecurityError: document.modelContext cannot be used when document.domain is enabled.
```

Chrome treats extension origins as `document.domain`-enabled, which the WebMCP
implementation rejects. A plain web page (`https://…`, `http://localhost` —
verified with `example.com` in testing) registers fine.

**Caveat — the block is flag-sensitive, not absolute** (E2E re-verify finding):
with the WebMCP **testing flags** (`--enable-features=WebMCPTesting,WebMCP,DevToolsWebMCPSupport`,
as the repo's `.mcp.json` passes to the chrome-devtools-mcp-launched Chrome),
the extension-origin block is **lifted**: `getTools()` and `registerTool()` work
on `chrome-extension://` pages. So the limitation is exactly: *default/branded
Chrome ≤156 without those flags*. That is precisely the honest-detect case the
extension handles — a normal user's browser cannot have the flags, so the
WebMCP route correctly greys out for them; a dev/test browser with the flags
correctly lights it up.

Extension-origin support is flagged as "ongoing development" upstream; Chrome
157 is the default-enable milestone for WebMCP, and whether it lifts this block
for extension pages is not verifiable from here.

**What this means in practice**:

- On **default Chrome ≤156**: the WebMCP route can be switched to in the
  Options page only after the API is actually usable — see the honest-detect
  below. In practice the segment stays greyed ("Requires Chrome with WebMCP
  enabled") until Chrome 157 (or a flagged dev browser).
- On a **flagged dev browser**: the full WebMCP journey (switch route →
  Register → AI calls the `excali_canvas` tool → Unregister) is testable on
  the extension page itself.
- The ws + daemon route is unaffected in both cases.

**What the code does** (E2E finding → hardened feature detection):

- Presence is not usability: `'modelContext' in document` is `true` on
  extension pages even though the API throws there. `isWebmcpUsable()` in
  `packages/shared/src/agent-bridge.ts` probes the API once — a
  throwing call (the SecurityError above) reports the feature as **unusable**.
- The Options page uses that probe: the WebMCP segment greys out
  ("Requires Chrome with WebMCP enabled") on blocked origins instead of
  lighting up and failing on click.
- The page's `registerWebmcp` also probes first and returns `false` without
  attempting, so the button's failure path is the honest toast
  ("Couldn't expose this canvas. Try again, or switch to ws + daemon.")
  rather than a raw SecurityError.

**Re-verify when**: Chrome 157+ is the default channel — check whether an
extension page can call `document.modelContext.registerTool` without flags; if
yes, remove the probe's catch-all `return false` on throw (or keep it — a real
SecurityError on web origins would still be a regression to surface).
