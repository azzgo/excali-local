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

### Non-Cloudflare relay self-hosting: single-node only, no SLA

**What**: self-hosting the relay away from Cloudflare is supported — run
`workerd` itself (`pnpm relay:dev` drives it via `wrangler dev`; see
[ADR 0010](./adr/0010-self-host-cf-workerd.md)). Two limits come with it:

1. **Single-node.** Durable Object persistence rides on workerd's built-in
   SQLite cells, which live on one machine. There is no replication story; a
   second node does not exist. Multi-node is deliberately out of scope for now
   (a future ADR, not this one).
2. **No SLA.** This repo ships the runtime integration, not a turnkey platform.
   Cloudflare offers no SLA for the open-source `workerd` build and we do not
   commit to one on the deployer's behalf — availability, backups, TLS
   termination (Caddy/nginx in front of it), and upgrades are the deployer's.

**Why**: the runtime choice was gated on Ed25519 raw key import, which the
relay's org-signature admission requires. [celld](https://github.com/denoland/celld)
was the preferred target until the 2026-08 pilot showed its embedded V8 rejects
`crypto.subtle.importKey("raw", …, {name:"Ed25519"})`, so every org-signed hello
was refused. `workerd` passed the same probe on 2026-09-08.

**What the code does**: `pnpm relay:smoke` asserts the Ed25519 raw-import + verify
round-trip (happy and tampered) against the current runtime, so a runtime that
regresses this fails loudly instead of silently locking out every member.
Multi-node replication is not implemented.

### Effective single-org: rooms are org-unbound (v1)

**What**: multi-org is the planned design, but v1 ships effectively single-org:
the dev loop registers one org (`local`), each client holds exactly one server
config (one org label), and rooms are never bound to an org. Any member admitted
to the relay can connect to any room whose shareId they hold — org scoping
decides only what a client can *decrypt* (team rooms: this org's `ck`), not
which rooms it can reach.

**Why**: the org label and the `ORG_PUBKEYS` env schema are deliberate
forward-compat — the array already accepts multiple entries, so a future
multi-org deployment needs no breaking change; per-org room isolation would
need an org→room binding that v1 deliberately does not have.

**What the code does**: `ORG_PUBKEYS` accepts an array of orgs; admission
verifies the hello's org signature against every registered key for that org;
no code ever compares the hello's org with the room. Room-level isolation
between orgs is future work, not a v1 property.

### Rooms die when empty

**What**: a room's snapshot and files are deleted when the room is empty and the
Durable Object is evicted (~70–140s of inactivity). Nothing user-visible
persists server-side.

**Why**: by design — a room is an ephemeral overlay; the local gallery is the
durable record (ADR 0003).

**What the code does**: the room list stores invite payloads locally; re-entering
a dead room prompts the first member to reseed from their gallery.

### Presentation mode × collaboration (ADR 0008 — ships in 1.9)

**What**: the 2026-08 deferral is partially lifted — **presentation follow ships in 1.9**.

**What ships**: a self-declared multi-presenter model (any member may present), one-way raw viewport streaming to followers, per-follower follow-entry on a roster click, and gesture-break at local pan/zoom onset with a toast ("Stopped following {name}"). One-shot cursor jump: clicking a presenter's avatar hops to their live viewport; for non-presenting members the hop uses their last known pointer position.

**What is still not done**:

- **Continuous non-presentation viewport follow** — following another member's viewport outside of presentation mode is not implemented; the only reach-other-member affordance is the one-shot cursor jump described above.

- **Laser sync** (see [Laser pointer sync not in v1](#laser-pointer-sync-not-in-v1)) — the wire contract already carries the `tool` field, but the laser pointer is not broadcast to collaborators.

- **Audience visibility** — presenters cannot see who follows them or how many.

**What the code does**: `Member.presenting` (an ephemeral relay-side flag, not persisted) is set on `present {active:true}` and deleted on `present {active:false}`; `welcome.peers` propagates it to late joiners so they see the presenting icon immediately. `PresentPayload` = `{active:true}` | `{x,y,z}` | `{active:false}`. `ContentType` gains `"present"` — same privacy tier as `pointer` (where someone is looking). Viewport frames use the ~100ms trailing-edge throttle precedent from `sendScene`. Old relays silently drop the unknown type; old clients ignore it — no protocol version bump needed.

### Laser pointer sync not in v1

**What**: the `tool: "laser"` pointer mode is not synced to collaborators.

**Why**: ADR 0003 consequence list — laser sync is a 1.9 candidate.

**What the code does**: laser strokes stay local-only; the pointer message type
carries the tool field, so the wire contract already supports it.

### Room name is plaintext to the relay (not E2E yet)

**What**: a room's shared name (ADR 0004) rides the *unencrypted* `room-name` and
`room-probe` messages, so the relay can read it — exactly like it can read scene
payloads today while the committed wire is still the plaintext form.

**Why**: 058's signed encrypted envelope (where `room-name` and the probe's
`roomName` must ride inside) is future work. Until it lands, the name joins the
scene in being relay-visible; no *new* leak class is introduced. The probe also
answers `{roomName, snapshotAvailable, peerCount}` to any invite holder — but that
is exactly what they would learn by joining, so there is no added disclosure.

**What the code does**: the room probe gate (ADR 0005) keeps "This room is empty"
truthful regardless; the name is short-lived room content that dies with the room.

## Peering (cross-machine Canvas transfer)

Design: [ADR 0013](adr/0013-cross-machine-canvas-transfer.md),
[PEERING.md](PEERING.md). Each entry states the limitation, why it exists, and what
the code does in response.

### The transfer wire is plaintext and forgeable

**What**: a Canvas transfer crosses the LAN unencrypted. Anyone on the same network
can observe it and can forge one — there is no authentication of the sender at all,
only a human confirmation on the receiving side.

**Why**: encrypting requires either a PKI (rejected in ADR 0003 — self-asserted
identity, no mini-CA, no per-member revocation) or a TLS story that a peer-running
daemon cannot bootstrap without user-managed certificates. v1 chose a receiver
confirmation over a cryptographic identity, and deferred confidentiality rather
than faking it.

**What the code does**: the offer carries descriptions only (alias, fingerprint,
element count, bytes, canvas name) — no content, no thumbnail — and canvas bytes
leave the sender only after acceptance. The Device fingerprint **identifies, it
does not authenticate**; it exists so a machine can ignore its own announcement.
This is the LocalSend failure mode taken seriously: that project's discovery MitM
(GHSA-424h-5f6m-x63f, CVSS 9.3) is exactly "a spoofed announcement impersonating a
known device", so nothing is treated as trusted on the strength of an announcement.

**Re-verify when**: an anonymous, offer-scoped encryption scheme is added — that
lifts the confidentiality half but not the impersonation half; only a real identity
story does that, and it is out of scope.

### The LAN listener is a second surface, off by default

**What**: the daemon opens a second listening surface (`0.0.0.0`, ephemeral port,
mDNS-advertised) that is reachable from other machines. It is off until switched
on, and off again after a restart unless the user persisted it.

**Why**: the loopback surface carries agent control with the two consent gates;
widening it would silently widen agent control to the network. The two surfaces
must not share a capability set.

**What the code does**: the LAN listener carries **Canvas transfer only**. It does
not use `originAllowed()` (which needs an `Origin` header — a Go peer sends none, so
the check would reject every legitimate peer), exposes no scene read/write, no gallery, no fonts, and no agent methods.
`excali-bridge lan on|off|status` is the single source of truth shared by the CLI,
the tray, and the Options page.

### There is no automatic discovery on any platform

**What**: Peering has no zero-configuration discovery at all — not on macOS, not
on Linux, not on Windows. A peer is reached by a **manually exchanged address**,
and that is the only way.

**Why**: this is a decision against mDNS/DNS-SD across the board, not a platform
gap. Userland mDNS is not viable: on macOS `mDNSResponder` owns port 5353
exclusively and the OS delivers a multicast packet to only one socket, so a
library that opens the port itself receives nothing — and the common workaround
(answering from an ephemeral port) violates RFC 6762 §11, so compliant peers
discard it. Doing it correctly would mean a cgo binding to the system Bonjour API
on macOS and Avahi on Linux — a per-platform dependency tree in exchange for a
discovery that half of all real networks (guest Wi-Fi with client isolation,
enterprise VLAN segmentation) block outright anyway.

**What the code does**: the manual-address path is not a fallback but the feature.
`excali-bridge peers` lists the peers the user has added, and the address
exchange is a plain copy-paste. This also works on the networks where mDNS would
have failed, so it is the more reliable half in practice, not the degraded one.
The tray is never the only way to see or act on peers.

**Re-verify when**: a cross-platform discovery story that does not require cgo or
per-platform system APIs appears (e.g. a local-network permission-gated browser
API). Until then, adding mDNS would trade a working copy-paste for a
platform-dependent maybe.

### An offer nobody answers expires; it does not queue

**What**: if the receiving machine has no extension page connected, the offer waits
out a 60s deadline and fails. There is no store-and-forward.

**Why**: a LAN-open port that also accumulates unowned canvas content is a worse
failure mode than a failed transfer.

**What the code does**: the daemon keeps offer metadata in memory only, with a
deadline, and stores no canvas content before acceptance. The sender sees a
timeout — never a silent success and never a misreported rejection.

### Peering has no sender-side UI

**What**: a canvas transfer can only be started from the CLI
(`excali-bridge peers.transferOffer '{"address":"<ip>:<port>"}'`). The editor
ships the receiving side (the top-right offer toast) but nothing that offers to
send. The tray's LAN row is hidden for the same reason: exposing the switch
would advertise a feature a user cannot reach.

**Why**: the send side without discovery is an address-typing form either way.
With no mDNS (a deliberate decision, above) a dialog would ask for exactly the
`ip:port` the CLI asks for, so the UI would decorate the interaction without
removing its one hard step. A genuinely useful sender needs remembered peers or
a QR/link hand-off, and that is design work, not a missing button.

**What the code does**: the full transfer path works end to end — receiver toast,
consent, 200KB chunks, sha256, canvas load — and is exercised by the double-machine
runbook ([PEERING-TESTING.md](PEERING-TESTING.md)). The LAN row returns to the tray
when the send side ships.

### The tray's "Canvas" row lags a deactivation

**What**: turning a canvas off in the editor can take a few seconds to reach the
Presence tray's `Canvas` row, which keeps reading `active` while the editor
button already reads `Activate`.

**Why**: the tray refreshes on a 2-second timer, and the daemon's active-canvas
slot is cleared when the page's data socket closes. Deactivation now closes that
socket immediately, but the two polling cycles between them still leave a window.
Removing it entirely needs a push channel (the daemon announcing a state change)
instead of more frequent polling — polling faster would just spend more CPU to
hide the same race.

**What the code does**: `toggleActivation` stops the session synchronously, so the
daemon sees the socket close in the same turn as the UI change. The tray still
learns about it on its next 2-second tick. Left as-is for 1.9.0; a push channel is
the follow-up.

### One binary per machine, downloaded on demand

**What**: the CLI is no longer in the source tree. A fresh clone cannot `ping`
without a download, and `~/.local/bin` is not on every user's `PATH`.

**Why**: [ADR 0012](adr/0012-bridge-daemon-is-the-product-presence-is-its-face.md) —
maintaining 28MB of cross-compiled binaries in git was worse than a download step.

**What the code does**: `excali-bridge` resolves one canonical path, compares
versions by asking the binary (`excali-bridge version`) rather than by filename,
never falls back silently to a second copy, and the skill preflight **prints** the
one-line `PATH` export instead of editing the user's shell rc files.
