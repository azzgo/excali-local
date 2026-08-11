# Known Limitations

Documented platform / upstream constraints that the extension cannot fix in
code. Each entry states the limitation, why it exists, and what the code does
in response. Keep this file updated when a limitation lifts (e.g. a Chrome
milestone default-enables a feature).

## WebMCP is blocked on chrome-extension:// pages before Chrome 157

**Status**: upstream platform limitation — cannot be fixed in this repo.

**What**: WebMCP (the `document.modelContext` imperative API — the basis of
the extension's "WebMCP" active control route, Wayfinder 043/044) is present
on `chrome-extension://` pages but **not usable there before Chrome 157**:
calling `registerTool` / `getTools` throws

```
SecurityError: document.modelContext cannot be used when document.domain is enabled.
```

Chrome treats extension origins as `document.domain`-enabled, which the WebMCP
implementation rejects. A plain web page (`https://…`, `http://localhost` —
verified with `example.com` in testing) registers fine. Extension-origin
support is flagged as "ongoing development" upstream; Chrome 157 is the
default-enable milestone for WebMCP, and whether it lifts this block for
extension pages is not verifiable from here.

**What this means in practice**:

- Until Chrome 157, the WebMCP route can be switched to in the Options page,
  but the canvas Register action cannot succeed on an extension page — with or
  without an origin-trials token or the `--enable-features=WebMCPTesting,…`
  development flags (the flags enable the API on web origins; they do not lift
  the extension-origin block).
- The ws + daemon route is unaffected.

**What the code does** (E2E finding → hardened feature detection):

- Presence is not usability: `'modelContext' in document` is `true` on
  extension pages even though the API throws. `isWebmcpUsable()` in
  `packages/excali-shared/src/agent-bridge.ts` probes the API once — a
  throwing call (the SecurityError above) reports the feature as **unusable**.
- The Options page uses that probe: the WebMCP segment greys out
  ("Requires Chrome with WebMCP enabled") on blocked origins instead of
  lighting up and failing on click.
- The page's `registerWebmcp` also probes first and returns `false` without
  attempting, so the button's failure path is the honest toast
  ("Couldn't expose this canvas. Try again, or switch to ws + daemon.")
  rather than a raw SecurityError.

**Re-verify when**: Chrome 157+ is the default channel — check whether an
extension page can call `document.modelContext.registerTool`; if yes, remove
the probe's catch-all `return false` on throw (or keep it — a real SecurityError
on web origins would still be a regression to surface).
