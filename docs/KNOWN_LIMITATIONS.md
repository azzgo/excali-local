# Known Limitations

[简体中文](./KNOWN_LIMITATIONS.zh-CN.md)

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

## Realtime collaboration (1.8.0)

Design and platform limits of the collaboration feature ([COLLAB.md](COLLAB.md),
[ADR 0003](adr/0003-byo-relay-realtime-collab.md)). Each entry states the
limitation, why it exists, and what the code does in response.

### 20MB per-file cap, no resumable upload

**What**: files synced in a collab room (images, attachments) are capped at
**20MB per file**, and uploads are not resumable — a dropped upload restarts.

**Why**: the relay chunks every message under the DO 256KB cap (20MB / 200KB =
100 chunks per file), and v1 deliberately ships no resumable-upload machinery.

**What the code does**: the file-put path rejects larger files at the client
with a clear error; the room keeps working for everything below the cap.

### One relay per extension

**What**: the extension connects to exactly one relay at a time — permanently.
Accepting a server invite replaces the stored config; there is no multi-relay
list.

**Why**: multi-relay support was rejected permanently in ADR 0003 (design
exclusion, not a deferral) — it removes the routing ambiguity that room invites
rely on.

**What the code does**: the server-invite parser and the Options → Collaboration
surface enforce the single-config invariant; room invites never carry a server
address.

### No per-member revocation

**What**: a compromised member key cannot be revoked individually; ejection uses
the org-level path — rotate the org keys, re-issue server invites, and have the
affected member reinstall.

**Why**: identity is self-asserted (no PKI) by ADR 0003; a mini-CA was
explicitly rejected.

**What the code does**: stored content signed under an old member key remains
verifiable via its self-contained `signer` field, so rotation does not corrupt
history.

### Relay has no rate limiting (v1)

**What**: the relay reference does not rate-limit or throttle traffic.

**Why**: v1 targets org-private, small-team deployments where the operator
trusts the membership; bandwidth abuse is not part of the v1 threat model.

**What the code does**: documented behavior — the relay is not intended for
public/multi-tenant operation.

### Rooms die when empty

**What**: a room's snapshot and files are deleted when the room is empty and the
Durable Object is evicted (~70–140s of inactivity). Nothing user-visible
persists server-side.

**Why**: by design — a room is an ephemeral overlay; the local gallery is the
durable record (ADR 0003).

**What the code does**: the room list stores invite payloads locally; re-entering
a dead room prompts the first member to reseed from their gallery.

### Presentation mode × collaboration deferred

**What**: presentation mode does not interact with collab rooms in 1.8.0
(follow-a-collaborator / whole-room presentation is out of scope).

**Why**: human decision 2026-08-16 — revisit only after the collab model matures
in real use.

**What the code does**: the two modes are separate editor forms; nothing
prevents presenting a drawing you saved from a collab session.

### Laser pointer sync not in v1

**What**: the `tool: "laser"` pointer mode is not synced to collaborators.

**Why**: ADR 0003 consequence list — laser sync is a 1.9 candidate.

**What the code does**: laser strokes stay local-only; the pointer message type
carries the tool field, so the wire contract already supports it.
