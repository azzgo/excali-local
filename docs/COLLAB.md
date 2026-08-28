# Collaboration Guide

[简体中文](./COLLAB.zh-CN.md)

Realtime collaboration in Excali Local 1.8.0: **hostless, end-to-end-encrypted rooms
over a relay you deploy yourself**. No Excali Local backend exists — the extension
project operates no servers, and the relay is a small partyserver reference implementation
that forwards ciphertext between your team's browsers.

Decision record: [ADR 0003 — BYO relay realtime collab](adr/0003-byo-relay-realtime-collab.md).

---

## Overview

- **One relay per extension.** Each team deploys the relay once (a small partyserver project, ~150 lines).
  The extension connects to **exactly one relay at a time — permanently**; a server
  invite replaces the stored config, there is no multi-relay list.
- **Hostless rooms.** A collaboration session is an ephemeral overlay on top of
  local-first canvases. There is no creator authority, no host, no room registry: a
  room is its invite payload plus the relay's in-memory snapshot. Saving stays
  explicit ("save to my gallery" per member).
- **E2E by default.** Team rooms are end-to-end encrypted *to the org*; private rooms
  are end-to-end encrypted *per room*. The relay stores and forwards **ciphertext +
  member signatures only** — it holds no decryption key for any org.
- **File sync included.** Image/file references ride the same wire contract with
  on-demand chunked fetch and encrypted blobs (20MB per-file cap, see
  [Known Limitations](KNOWN_LIMITATIONS.md)).
- **Zero backend.** The relay is the only moving part, and it is yours.

## Deploy a relay

The relay is a [partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)
project (Cloudflare Workers + Durable Objects). Deploy to **your own Cloudflare
account** with wrangler — no PartyKit cloud, no extra login — or run locally with
`wrangler dev` (see [Local dev loop](#local-dev-loop)).

> **Not on Cloudflare?** Durable Objects runtimes are self-hostable:
> [celld](https://github.com/denoland/celld) embeds V8 and executes wrangler
> bundles (Workers + Durable Objects) on your own machines — each DO backed by
> SQLite replicated to a bucket you own (S3/GCS/Azure), no control plane. A
> viable non-Cloudflare path for this relay with zero WS-server rewrite.
>
> **Status: PARKED — awaiting celld WebCrypto Ed25519.** The 2026-08 pilot
> shipped the relay to celld v0.3.0 (deploy/vars/DO cells/hibernatable
> WebSockets all work) but its embedded V8 rejects
> `crypto.subtle.importKey("raw", …, { name: "Ed25519" })` ("unsupported key
> import") — every org-signed hello is rejected. celld remains the preferred
> self-hosting target (native wrangler config + partyserver + hibernation; only
> crypto is missing). The one complete alternative today is running the
> **workerd** runtime yourself (self-hosted Workers) — it passes the
> `cloudflare:workers` and Ed25519 gates natively, but needs a capnp config
> translation, runs single-node, and wants a reverse proxy for TLS. Revisit
> celld when Ed25519 lands upstream.

All wrangler commands below run from **`packages/collab-relay/`** (where
`wrangler.jsonc` lives); `pnpm relay:keygen` is a **repo-root** script:

```bash
cd packages/collab-relay          # ← all wrangler commands here
cd <repo root> && pnpm relay:keygen …   # ← keygen here
```

### 1. Prerequisites

```bash
cd packages/collab-relay
pnpm install          # workspace install (the relay package is a workspace member)
npx wrangler login    # Cloudflare account (or export CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
```

### 2. Deploy — first, to learn your relay URL

The server invite embeds the relay URL, so **deploy before keygen**:

```bash
cd packages/collab-relay
npx wrangler deploy   # → prints https://excali-local-collab-relay.<account>.workers.dev
```

The worker name comes from `packages/collab-relay/wrangler.jsonc`. Custom
domain: Cloudflare dashboard or a `routing` rule in `wrangler.jsonc` — if you
use one, deploy again and use that URL in the invite.

> **`.workers.dev` is blocked in mainland China** (DNS poisoning + SNI/TLS
> dropping — GreatFire measures 147/149 subdomains blocked). Symptom: TCP
> connects but TLS never completes, and the extension reports "WebSocket is
> closed before the connection is established". If your users need to reach
> the relay from mainland China, **bind a custom domain** (domain DNS at
> Cloudflare → Workers → Settings → Domains & Routes → Custom Domains → Add)
> and re-generate the invite with that URL. Plain Cloudflare anycast with a
> custom domain generally works from the mainland; `.workers.dev` does not.

### 3. Generate keys and the server invite (repo root)

```bash
cd <repo root>
pnpm relay:keygen --org acme --relay https://excali-local-collab-relay.<account>.workers.dev
```

prints (a) the `ORG_PUBKEYS` entry for the env below, and (b) a paste-ready
**server invite** for your org label and relay URL. Keep the output secret —
`sk`/`ck` are client-config-only (below).

```text
server invite = excali-collab:v1:srv:<b64url(JSON { relay, org, sk, ck })>
  relay   https:/wss: URL of your deployment (http:/ws: loopback IPs only, dev)
  org     your org label — shown in the trust confirmation beside the URL
  sk      org Ed25519 seed, 32 bytes b64url — signs hello (admission proof)
  ck      org content key, 32 bytes b64url — encrypts team-room content
```

`sk` and `ck` are **client-config-only**: they ride in server invites, live in the
extension's local config, and are **never sent to the relay**. The relay env holds
public verification keys only.

### 4. Set the env schema (relay dir)

`ORG_PUBKEYS` — JSON array of `{ org, pubkeys[] }`, where each pubkey is the org's
32-byte Ed25519 public key (b64url, 43 chars):

```jsonc
// [{"org":"acme","pubkeys":["x57…","yQ2…"]}]
[
  { "org": "acme", "pubkeys": ["<pk b64url>"] }
]
```

Make it live one of two ways (both run from `packages/collab-relay`):

```bash
# (a) vars in wrangler.jsonc — simplest; ORG_PUBKEYS is PUBLIC verification
#     material, so committing it in the config is fine:
#     "vars": { "ORG_PUBKEYS": "[...]" }
#
# (b) wrangler secret put — value via stdin (no shell-quoting fights):
echo '[{"org":"acme","pubkeys":["x57…"]}]' | npx wrangler secret put ORG_PUBKEYS

# then redeploy so the env applies:
npx wrangler deploy
```

- The **array per org is rotation grace**: keep old + new keys through the re-issue
  window, then drop the old one and redeploy (see [Key rotation](#key-rotation)).
- One relay hosts multiple orgs — one entry per org. **Multi-org is the planned
  design; the v1 implementation is effectively single-org** — the dev loop
  registers one org (`local`) and each client holds exactly one server config
  (one org label). The array schema is forward-compatible: adding an org later
  is a config change, not a breaking one. Multi-org registration is about
  *admission keys*, not room tenancy — see [Security model](#security-model).
- Empty/malformed `ORG_PUBKEYS` ⇒ **all admissions fail** (fail closed).
- Legacy: pre-1.8 relays used `ORG_SECRETS` (org → secret object). A v2 relay
  disables the legacy path whenever `ORG_PUBKEYS` is present.

### 5. Configure the extension
Open **Options → Collaboration** and paste the server invite. The trust confirmation
shows **`<relay URL> · <org label>`** before anything is stored — that pair is what
you are deciding to trust. Accepting replaces the stored server config (single-relay
invariant).

## Generate and share invites

### Server invite (admission)

One per org, generated at deploy time (above). Contains the relay address, org label,
org signing seed and org content key. Handed out to the org's members; each member
pastes it once in Options → Collaboration.

### Room invite (membership)

```text
room invite = excali-collab:v1:room:<b64url(JSON { shareId, tier, roomSecret?, fp? })>
  shareId     128-bit random capability token (~22 chars) — the room id IS the permission
  tier        "team" (default) or "private"
  roomSecret  only for private rooms — the per-room E2E key
  fp          optional server fingerprint (short hash, warn-only — never a routing input)
```

- **Room invites never carry the server address** — the single-relay invariant makes
  routing unambiguous.
- Sharing is **sentence + code**: the invite is copied as a short sentence with the
  token inline (survives chat apps); a "code only" button exists on the share step.
  The paste box accepts both — the parser extracts the token.
- If an invite is ever shared as a URL (future web wrapper), the payload goes in the
  **`#` fragment** so it never reaches any server, including the relay.
- Tier is immutable at creation in v1 — changing tier means a new room.

Paste a room invite in the collab editor to join the room; create a room there to
mint one.

**One-click from the editor.** The Local editor's top-right **Collab ▾** menu
mints a room from your current canvas: "Create room from this canvas" stages the
live scene as the room's seed (an empty/dead room adopts it — first seed wins)
and drops you straight into `#room/<shareId>`. The room is created as a team
room with the auto label "Untitled room" — rename it from the session bar. The
second item, "Open collaboration page", lands on the collab home (join / my
rooms / server config). The Quick editor toolbar is unchanged.

## Key rotation

Rotation = **redeploy with a new `ORG_PUBKEYS` array + hand out fresh server invites**.
Zero relay downtime.

- **Grace:** `pubkeys` is an array — keep old + new through the re-issue window, then
  drop the old key and redeploy to cut off old invites. Members with old keys are
  admitted until then.
- **A leaked invite leaks both `sk` and `ck`** → rotate both. `sk`-only rotation is
  routine hygiene: `ck` untouched means team-room snapshots stay decryptable — no
  room reset.
- **`ck` rotation side effect:** relay-stored team-room ciphertext becomes
  undecryptable for everyone (GCM auth failure on join) → team rooms reset; members
  reseed from their local gallery — cheap, because the room is an ephemeral overlay.
  Private rooms are immune (independent per-room keys).

**What breaks, and the recovery path:**

| Signal | When | Copy family | Recovery |
|---|---|---|---|
| `ADMISSION_INVALID` at hello (fatal, connection closed) | `sk` stale — no registered `pk` verifies your signature | `stale.admit`: "The server rejected this member key / The invite is probably outdated." | Paste a fresh server invite in Options → Collaboration |
| GCM auth failure on the first snapshot/scene | `sk` still valid but `ck` rotated | `stale.gcm`: "This room's key doesn't match / The room may have been recreated." | Ask the host to copy the full room invite again (or paste a fresh server invite if the org key rotated) |

Mid-session rotation surfaces the same families: the connection goes red
"rejected", retrying stops, and the fatal banner offers **Leave** only —
saving is sidebar-only (see "Saving is sidebar-only" below), so a fatal
must hand over to the gallery before the room is gone.

## Local dev loop

```bash
pnpm relay:dev        # one command: seed → .dev.vars → invite print → wrangler dev
pnpm relay:dev:https  # optional TLS-parity mode (mkcert)
```

`pnpm relay:dev`:

1. **Idempotent seed** — generates `.dev-keys.json` (org Ed25519 seed + content key)
   at the repo root once; re-running reuses it (re-seeding must NOT rotate keys —
   your dev invite keeps working across days).
2. Writes `packages/collab-relay/.dev.vars` (gitignored): `ORG_PUBKEYS` (v2) +
   legacy `ORG_SECRETS`. Wrangler dev auto-loads it.
3. Prints a **paste-ready server invite for `http://127.0.0.1:1999`** — the loopback
   carve-out: `http:/ws:` is accepted only for the IP literals `127.0.0.1` / `[::1]`;
   remote traffic stays TLS-only.
4. Runs `wrangler dev` against `packages/collab-relay` (port 1999).

Fresh clone → working collab:

```bash
pnpm install
pnpm relay:dev                    # terminal 1 — note the printed invite
pnpm page:dev                     # terminals 2 & 3 — two editor windows
# paste the invite into Options → Collaboration in both windows
# create a room in window A → paste the room invite into window B → draw
```

- **Two windows for plumbing, two profiles for crypto.** Member keys are minted once
  per install, so two windows of the same profile share one member key — fine for
  broadcast/roster, but the honest member-signature verification test needs two
  profiles (or Chrome + Firefox).
- **Wipe-state emulation.** `wrangler dev` persists room state by default
  (`packages/collab-relay/.wrangler/state` — gitignored), the opposite of production
  eviction. `rm -rf packages/collab-relay/.wrangler/state` simulates room death and
  exercises the dead-room seed prompt path.
- **`--https` (mkcert):** `pnpm relay:dev:https` generates local-CA certs
  (`.dev-cert.pem` / `.dev-key.pem`) and runs wrangler's `--local-protocol https`
  mode — a real `https://localhost:1999` for one-off TLS-parity checks
  (reconnect/TLS-failure UX, strict-https parser path).

**What local dev does NOT emulate** (per workerd docs): the dev server never
hibernates, and eviction timing is not observable. Do one deployed-relay smoke for
the hibernation path: idle ≥10s with members connected, reconnect, and confirm the
snapshot survives.

## Room lifecycle

- **Seed.** The first member of an empty/dead room is prompted to load a scene from
  their gallery or start blank. **First seed wins** — it becomes the room snapshot;
  a concurrent second seed gets a non-fatal `SEED_REJECTED` and joins live instead
  (the relay's single DO instance serializes the race; no arbitration).
- **Shared room name (ADR 0004).** A room has **one broadcast name** — room content
  like the scene. It lives in `room.storage` beside the snapshot (same lifecycle,
  dies with the room), is last-write-wins by relay arrival order, and can be renamed
  by **any member** (rooms are hostless). `welcome` carries the name; `room-name`
  broadcasts a rename with the author mapped through the roster. The local `rooms`
  entry's label is just a mirror; a genuinely named label is *pushed* as the room
  name when the room has none (first naming / dead-room revival).
- **Member display names (ADR 0006).** A member has a **profile default** display
  name — minted once in the identity, edited in the shared config section
  (Options), instant-apply, always non-empty and trimmed ≤ 40 chars — plus an
  optional **per-room name**: a one-time *copy* of the default materialized at
  room entry (join *and* create), then a free-standing value reused on re-entry.
  Editing the default later never reaches rooms already entered (copy semantics).
  Renames ride a dedicated `member-name` wire message (mirrors `room-name`, ADR
  0004): the client sends `{name}`, the relay trims/validates (non-empty, ≤ 40),
  updates the *sending* member's record in the roster, and broadcasts
  `{name, from}` (relay-stamped `from` at envelope level, sender excluded). The
  name dies with the connection — nothing lands in `room.storage`. Receiving
  clients update the roster + canvas collaborator chips live — no reconnect, no
  toast; `welcome.peers` shows late joiners the current per-room names.
- **Room probe (ADR 0004).** A lightweight pre-join query (`room-probe` — no
  admission, no roster side effect) returns `{roomName, snapshotAvailable,
  peerCount}`. The join screen uses it to show the real name and to gate the seed
  prompt: "This room is empty" is only shown when the relay says so.
- **Snapshot + files live in `room.storage`.** They survive DO hibernation (~10s
  quiet — in-memory fields are discarded but storage persists) and code deploys
  (sockets drop, storage persists). They die **only with the room**: empty + ~70–140s
  eviction deletes everything. Nothing user-visible ever accumulates server-side.
- **Reconnect resync.** The client reconnects with capped backoff, re-sends `hello`,
  and gets a fresh `welcome` + snapshot — the snapshot is the resync point, so any
  broadcast lost during the gap is recovered (then reconciled, see below).
- **Privacy tiers.** Team rooms (default) are E2E *to the org* (`ck` from the server
  invite); private rooms are E2E *per room* (`roomSecret` in the invite only). Both
  tiers are byte-identical in crypto machinery — only the key's provenance differs.
  The relay is **content-blind in every room**: it sees routing metadata, message
  sizes, and signatures — never keys, never plaintext. The `welcome` privacy flag
  lets the UI show "this room is end-to-end encrypted" even without the key — a UX
  hint, never a security mechanism.

## Client semantics

- **Re-entry rule (ADR 0005).** Joining discriminates on whether the client ever
  synced with the room (cached `base` non-null): **never synced** → the **room is
  authoritative** — the snapshot applies as-is and any staged seed is discarded
  silently (no merge, no rebroadcast); **synced before** → the three-way merge below
  applies unchanged. Room death is never surfaced, so a dead-room-reseeded return
  behaves identically to an alive-room reconnect.
- **Three-way merge on re-entry and recovery.** When a *synced-before* room is
  re-entered (or the link returns mid-session), the client merges base (last synced
  scene) / ours (local edits) / theirs (snapshot). Single-side changes merge cleanly;
  an unresolvable conflict — the same element changed on both sides (edit-edit,
  edit-vs-delete, delete-vs-edit) — resolves as **online version wins**: the local
  change is force-reset with an amber notice ("N local edits conflicted — the online
  version was kept", with a "Show me" highlight). A pure cache without offline edits
  is simply overwritten by the snapshot. The merged result is **rebroadcast only when
  it differs from the online scene** (local creates survived) — an identical result
  adds nothing the peers don't already have.
- **Conn-health vocabulary.** One dot in the session chrome bar: **live** (green,
  steady — dot only), **connecting** (blue pulse, first connect), **reconnecting**
  (amber pulse — dot + word), **rejected** (red, steady — fatal only). Tooltip =
  state + one detail line. Recovery returns **silently to green**.
- **Mid-session server death.** Auto-reconnect never gives up; editing continues
  freely offline. At T+60s the banner escalates copy only (elapsed + the
  frozen-roster count) — it carries no action buttons; saving happens via the
  gallery sidebar (see "Saving is sidebar-only" below). Offline banners promise
  "edits are kept, sync on return" plus a one-line conflict pre-warning. The
  roster freezes dimmed — "presence frozen" on
  hover, and the banner names the count ("N collaborators were in the room") so a
  frozen roster never reads as "everyone left". Peer-leave stays a silent fade.
- **Re-entry while the server is down.** 10s timeout → red card "Can't reach your
  team server" with **Retry / Open last synced copy / Leave**. My Rooms entries never
  gray out for an outage.
- **Degraded-but-alive.** Silence by default; ≥3 reconnects within 5 minutes → one
  amber hint per session ("Connection is unstable — edits still sync").

## Security model

- **Admission = Ed25519 signatures, not secrets.** `hello` carries an org-signed
  signature over the full hello payload (domain-prefixed, fixed property order) plus
  the member's public key (minted once per install). The relay verifies against every
  `pk` registered for the org — so it can *verify* admission but **cannot mint
  invites or impersonate members** (it never holds `sk`).
- **Org is an admission + encryption label, not a room tenant.** Any member
  admitted to the relay can connect to any room whose shareId they hold — the
  org bound to the hello gates only what they can *decrypt* (team rooms: this
  org's `ck`; private rooms: the room's own key). Rooms are never bound to an
  org; room-level isolation between orgs is future work — v1 is effectively
  single-org (see the env schema section above).
- **Per-message E2E.** Content key = `HKDF-SHA256(baseSecret, salt=shareId)` where
  `baseSecret` is `ck` (team) or `roomSecret` (private); each message is AES-GCM-256
  with a fresh 96-bit nonce; AAD binds type + room (or file id); a monotonic `seq`
  inside the ciphertext defeats replay; each message decrypts independently, so
  reconnect needs zero crypto state.
- **Member signatures on every encrypted frame** (Ed25519 over `(t, room, c, iv)`).
  Clients verify every received frame and cross-check the signer against the roster;
  the relay verifies at its store/serve boundary without ever decrypting. Failures
  drop silently — the data plane is self-healing (full-scene LWW, next frame wins).
- **What the relay can / cannot do.** It can verify admission, relay traffic, store
  and serve ciphertext — and it can **drop or withhold** anything (liveness DoS, a
  documented limitation). It cannot read content, tamper undetected, forge a frame
  as a member, or smuggle content across rooms.
- **Member-key compromise:** there is no per-member revocation (no PKI, by design).
  Ejection uses the org-level path: rotate `sk`+`ck`, re-issue invites, the affected
  member reinstalls (fresh member key). Stored content signed under the old key stays
  verifiable via its self-contained `signer` field.
- **Trust boundaries.** The relay operator is trusted not to drop traffic; a leaked
  server invite exposes that org's team rooms (private rooms stay safe — per-room
  keys). Keys and the room list live in the extension's local storage, same as all
  your drawings.

Known platform/design limitations: [Known Limitations](KNOWN_LIMITATIONS.md).

## Presentation follow

Rooms can run a lightweight multi-presenter follow mode (ADR 0008). It is not a presentation tool — no frames, no ordering, no slides. It is an adhesive layer on top of collab: one-way raw viewport streaming from a presenting member to their followers.

### Presenting

Any member may start presenting from the people/presence menu (the Collaborators feed). Doing so sends a `present {active:true}` message, followed by a throttled stream of `present {x,y,z}` viewport frames (~100ms trailing-edge throttle, same as `sendScene`). Stopping sends `present {active:false}`. The presenter's `Member.presenting` flag is ephemeral relay-state (no storage); `welcome.peers` carries it to late joiners so the presenting icon is visible immediately.

### Following

Click the follow icon (eye) on a presenting member's presence row to follow their view. Their live viewport is applied to your canvas continuously. Follow is a purely local client-side feature — no wire message is sent; the follower receives the presenter's raw `{x,y,z}` frames and applies them as viewport updates.

### Gesture-break and the follow-break toast

Follow breaks automatically on:

- **Involuntary break** — local pan/zoom gesture onset: `pointerdown` drag, `wheel`, or pinch (`use-follow-break-toast.ts` wires the native events; `classifyFollowEvent` returns `shouldBreak: true, toastKey: "CollabFollowBroke"` for all involuntary events). The toast reads "Stopped following {name}".

- **Presenter-leave** — the followed member stops presenting or disconnects: the `Member.presenting` flag disappears from the roster, triggering the same break path.

- **Own-present-start** — you enter presentation mode yourself while following: `startPresenting()` clears `followTargetId` synchronously, which fires the same effect.

Manual unfollow (clicking the active follow icon to stop following) breaks silently — `classifyFollowEvent` returns `toastKey: ""`.

### Cursor jump

The jump button (compass icon) on every presence row performs a **one-shot hop** to the target's viewport. Priority:

1. **Follow target's viewport wins** — if the row's profileId matches your current `followTargetId` and that member is presenting, use their live presentation viewport.

2. **Row's own last-known pointer position** — for non-presenting members (or when not following them), hop to their last broadcast `{x,y,z}` from the pointer stream.

3. **Button disabled** — when neither is known, the jump button is grayed out (no viewport to hop to).

### Protocol versioning

The `present` message type and `ContentType "present"` join the existing wire contract without a protocol version bump. Old relays silently drop the unknown type (covered by relay tests); old clients ignore the new type entirely. Against a legacy relay the feature is simply absent — no degradation path needed.

### Still not in v1

- **Continuous non-presentation viewport follow** — the only way to reach another member's canvas outside of presentation mode is the one-shot cursor jump.

- **Laser sync** — see [Known Limitations](KNOWN_LIMITATIONS.md).

- **Audience visibility** — presenters cannot see who follows them or how many.

---

## Room gallery sidebar

The local editor's gallery (list, collections, search, thumbnails) is mounted inside RoomScreen — giving every room member the same rich browsing experience as the local editor.

### In-room load is an ordinary edit

Choosing a drawing and confirming replaces the room's scene. The load travels as an **ordinary edit** through the existing `broadcastScene` pipeline:

1. Gallery card click opens a text-only confirmation modal ("Load drawing to room? / This replaces the room's current content, visible to all members."). No thumbnail preview, no "don't ask again" suppression in v1.

2. Confirm → `normalizeSceneImageRefs` rewrites every image ref to its content hash (`dataURLToBytes` + `fileIdFor` from `collab-core`) before broadcasting.

3. `broadcastScene` clears the echo guard so the resulting `onChange` is NOT swallowed; `onLocalChange` handles the normal `seq` bump + `sendScene` + debounced persist path.

Receivers need zero special casing — they process an ordinary full-scene `scene` message.

The same normalization applies to **gallery seed-from-gallery paths**: when a dead room is seeded from a gallery drawing (instead of blank), `normalizeSceneImageRefs` is applied before the seed broadcast.

### Saving is sidebar-only

The session chrome's dedicated "Save to my gallery" button is **removed**. The room has **no implicit durable copy** — nothing is saved unless a member explicitly saves via the gallery sidebar.

Flow: open a gallery drawing → the sidebar marks it as the room's chosen drawing; any subsequent sidebar Save overwrites that same record. Never chose one → Save creates a new gallery entry. Legacy `room-*` synthetic records (the old implicit binding) degrade to ordinary drawings.

### Leave modal: Leave / Stay

The leave modal now has two actions: **Leave** (discard and exit) and **Stay** (close the modal and continue editing). The body copy warns that unsaved changes will be lost and points at the sidebar for saving first. The removed "Save & leave" path would resurrect the implicit save channel — the sidebar-only saving rule is the cleaner design.

---
## See also

- [ADR 0003 — BYO relay realtime collab](adr/0003-byo-relay-realtime-collab.md) — the
  decision record: model, considered options, consequences.
- [Known Limitations](KNOWN_LIMITATIONS.md) — 20MB file cap, one relay per extension,
  no per-member revocation, continuous viewport follow deferred, laser sync not in v1,
  audience visibility not in v1, and more.
- [Architecture](ARCHITECTURE.md) — repository layout and the editor boot model.
- [README](../README.md) — install and feature overview.
