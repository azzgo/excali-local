# 1.8.0 collaboration: self-hosted relay, hostless rooms, optional E2E

Excali Local 1.8.0 adds realtime collaboration without the project operating any server:
each team deploys their own relay (PartyKit reference implementation), members configure
one server address plus an org admission secret, and a collaboration session is an
ephemeral overlay on top of local-first canvases. The official `@excalidraw/excalidraw`
package explicitly supports host-implemented collaboration, and the patched tgz
(`excalidraw-excalidraw-v0.18.0-csp.14.tgz`) exports everything v1 needs — verified:
`reconcileElements`, `onPointerUpdate`, `updateScene({elements, appState, collaborators})`,
`isCollaborating`, `CaptureUpdateAction.NEVER`.

## Status

accepted — 2026-08-15 (Wayfinder Map 046; reviewed in Ticket 048; three open placeholders
settled + relay-content-blind amendment)

## The model

**Three credential layers, deliberately not collapsed:**

- **Admission (server invite).** Relay address + org label + org **signing keypair**. The
  relay env holds **public verification keys only** (`ORG_PUBKEYS`); the private key rides
  in server invites (client config only). Members prove membership by signature at hello;
  the relay can verify admission but cannot mint invites or impersonate members. One relay
  hosts multiple orgs; each org keypair is independently regenerable (v1: env array,
  redeploy to rotate). The extension connects to **exactly one relay at a time —
  permanently**, not as a deferral. Server invites are pasted (Options or CollabEditor)
  with a trust-confirmation step showing the target URL; only `https`/`wss` accepted.
- **Room identity.** A shareId on the currently configured server. Room invites carry
  **no server address** — the single-server invariant removes the routing ambiguity
  entirely. Room invites carry a **server fingerprint** (`fp`, short hash of mint-time
  config, warn-only, **never a routing input**): mismatch → "may belong to another server"
  gray-out in the local room list + warn-only on paste. On server-config change: **no
  automatic cleanup**; stale entries gray out; deletion is explicit per-entry (private
  rooms warn that deletion destroys the room key; partial-retention multi-select is a
  surface requirement → Ticket 053).
- **Content privacy — bottom line: the relay stores no plaintext.** Team rooms (default)
  are E2E to the org: an **org content key** rides in the server invite (client config
  only) and never reaches the relay; payloads use the same WebCrypto AES-GCM envelope as
  private rooms (050, with an org-key mode). Private rooms are E2E per room: roomSecret
  lives only in the invite payload / URL fragment. The relay stores and forwards
  ciphertext + member signatures only and holds **no decryption keys for any org**.
  Messages are signed by members (Ed25519); the relay verifies signatures on stored/served
  state (tamper-evidence; replay defeated by monotonic `seq`, already in 050). A malicious
  relay can drop/withhold messages (DoS) but cannot read content or tamper undetected —
  documented limitation. The patched tgz does not export `encryptString`, so the crypto is
  ours — in `collab-core`, never in the fork.

**Hostless rooms.** No persistent roles, no authority:

- *Creator* is one-shot: generate shareId, pick privacy tier, mint roomSecret, hand out
  the invite. Then they are a plain member.
- *Seeder* is first-come: whoever joins an empty/dead room is prompted to load a seed
  from their Gallery or start blank. Seeds apply **only to empty rooms** — first seed
  wins and becomes the room snapshot; later joiners join live. No arbitration needed.
- Host leaving means nothing; the room survives on the relay snapshot plus remaining
  members, and dies when empty + the Durable Object hibernates.
- A cryptographic host token is deferred with an explicit trigger: worth adding only
  when a host gains real powers (kick, privacy change, rename, transfer).

**Sync semantics.** Full-scene broadcast + client-side `reconcileElements` — the same
element-level last-write-wins semantics as excalidraw.com. The relay's in-memory snapshot
doubles as the resync point for reconnects and late joiners (no op-log, no vector
clocks) — the snapshot is ciphertext; late joiners decrypt with the org key / roomSecret
and verify member signatures. A transparent chunking layer handles the 256KB DO message
cap. File/image sync (fileId references + on-demand chunked fetch + `addFiles`) is
**in 1.8.0 scope** — ship complete, not half-finished.

**Packages and surfaces.**

- `packages/collab-core` — TS source of truth: wire contract, crypto envelope, chunking,
  file sync, headless session controller. The relay imports the same package — zero-drift
  by construction, unlike the agent-bridge Go mirror.
- `packages/collab-relay` — PartyKit reference server (workspace member, not shipped in
  the extension; users deploy it themselves). Go stays agent-bridge-only.
- `packages/page` keeps a thin UI layer; `?type=collab` is a third editor form beside
  `local`/`quick`; popup gains an entry. Collab semantics never enter the local editor.
- Local-first stays: the collab form suspends autosave; saving is an explicit
  "save to my gallery" per member. B-lite local room list (shareId, label, privacy tier,
  roomSecret?, fp) stored in the **`excali` DB v3 `rooms` store** (keyPath shareId,
  updatedAt index; additive 2→3 migration); fp mismatch grays out stale entries — rooms do
  not persist server-side; **a room is its invite payload**.

## Considered Options

- **Official socket.io / excalidraw-room wire compatibility — rejected.** No auth hook
  where we need admission-key validation; `socket.io-client` dep inside the extension;
  undocumented internal message enums. Payload *semantics* (full-scene + reconcile) stay
  aligned with official instead.
- **Yjs (y-excalidraw + y-partykit) — rejected.** `y-excalidraw` unmaintained ~2 years.
- **Strong host authority — rejected.** Single point of failure and lag; the host has no
  real powers worth protecting.
- **Host badge without powers — rejected.** A meaningless marker; the role dissolves into
  the two one-shot actions above.
- **Room invite carrying the server address — rejected.** Unnecessary under the
  single-server invariant, and it creates unresolvable branch decisions on mismatch.
- **Multi-relay support — rejected permanently** (design exclusion, not a deferral).
- **Deriving team-room content keys from the admission secret — rejected.** The relay
  knows the admission secret, so it protects nothing and costs complexity. "Not even the
  relay sees it" is exactly what private rooms are for. (The adopted org content key is
  independent material in server invites — this rejection does not apply to it.)
- **Team rooms plaintext to the owned relay — amended at ADR review (Ticket 048).** Once
  one relay hosts multiple orgs, the operator is not necessarily a member of every org;
  transparency must not cross org boundaries. Replaced by per-org E2E (independent org
  content key) + signature verification; the relay becomes content-blind for every org.
- **At-rest key encryption on the relay — rejected.** Theater: runtime keys are
  co-located with the deployment; anyone who can read the deployment can read the keys.
  The real fix is not holding plaintext at all (asymmetric admission + content keys in
  client config).
- **Server-side room registry (for re-openable rooms) — rejected.** The relay stays
  stateless; rooms collapse to invite payloads plus the local list.
- **Deferring E2E / file sync to 1.9 — rejected by product decision.** No half-finished
  release.

## Consequences

- Two new workspace members (`collab-core`, `collab-relay`); PartyKit-only, no Go relay.
- `wxt.config.ts`: `extension_pages` CSP `connect-src` gains `wss:` / `https:`. Zero new
  permissions — WebSocket from extension pages is CSP-gated, not host_permissions-gated;
  no new install-time warnings; existing users update without re-consent. **Spike passed
  (Ticket 047); locked string:** `script-src 'self'; object-src 'self'; connect-src 'self'
  http://127.0.0.1:* ws://127.0.0.1:* wss: https:` — loopback entries preserve the
  agent-bridge Leg B production path; remote traffic TLS-only. Store privacy notes gain
  "data may be sent to a user-configured server" (relay sees ciphertext + routing only);
  `data_collection_permissions: none` still holds.
- **Fork gate:** v1 needs zero changes to the patched tgz (API audit above). Any future
  need to touch the fork is a human decision, never agent-initiated.
- Remote updates apply with `CaptureUpdateAction.NEVER` — the undo stack stays local.
- Identity: install-uuid (mint-once, `use-agent-bridge.ts` pattern) + self-chosen display
  name + uuid-derived stable color. Identity itself stays self-asserted (no PKI);
  **message integrity is signed** (per-member Ed25519 keys) so tampering is detectable.
- Known limitations to document: an org content key leak (any member's config) exposes
  that org's team rooms (private rooms safe — per-room keys); a malicious relay can
  DoS (drop/withhold) but cannot read content or tamper undetected; room secret stored
  locally in the `rooms` store; laser pointer sync not in v1.
- 1.9 candidates with triggers recorded: host token (when hosts gain powers),
  secret-rotation admin endpoint, webapp clickable invite links.

## Settled placeholders (Ticket 048, 2026-08-15)

1. **Server fingerprint: yes.** `fp` in room invites, warn-only, never a routing input;
   no auto-cleanup on server-config change (stale entries gray out; explicit per-entry
   delete, private rooms warn on key loss).
2. **Room-list storage: `excali` DB v3.** New `rooms` store (keyPath shareId, updatedAt
   index); additive `DB_VERSION` 2→3 migration.
3. **CSP spike result: passed.** Locked string above (loopback entries required for the
   agent-bridge production path).

Plus the review amendment: **relay stores no plaintext** (per-org E2E + signature
verification; see Content privacy above). Hostless confirmed; host trigger stays deferred
to real host powers (kick, rename, transfer).
