# Collaboration Guide

[简体中文](./COLLAB.zh-CN.md)

Realtime collaboration in Excali Local 1.8.0: **hostless, end-to-end-encrypted rooms
over a relay you deploy yourself**. No Excali Local backend exists — the extension
project operates no servers, and the relay is a small PartyKit reference implementation
that forwards ciphertext between your team's browsers.

Decision record: [ADR 0003 — BYO relay realtime collab](adr/0003-byo-relay-realtime-collab.md).

---

## Overview

- **One relay per extension.** Each team deploys the relay once (PartyKit, ~150 lines).
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

### 1. Prerequisites

```bash
pnpm install          # workspace install (the relay package is a workspace member)
npx partykit login    # PartyKit account
```

### 2. Generate keys and the server invite

The relay package ships an `org-keygen` tool: it derives the org's Ed25519 keypair
once and prints (a) the `pk` line for the env var below, and (b) a paste-ready
**server invite** for your relay URL and org label.

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

### 3. Set the env schema

`ORG_PUBKEYS` — JSON array of `{ org, pubkeys[] }`, where each pubkey is the org's
32-byte Ed25519 public key (b64url, 43 chars):

```jsonc
// partykit.json vars, or `partykit secret set ORG_PUBKEYS '…'`
// [{"org":"acme","pubkeys":["x57…","yQ2…"]}]
[
  { "org": "acme", "pubkeys": ["<pk b64url>"] }
]
```

- The **array per org is rotation grace**: keep old + new keys through the re-issue
  window, then drop the old one and redeploy (see [Key rotation](#key-rotation)).
- One relay hosts multiple orgs — one entry per org.
- Empty/malformed `ORG_PUBKEYS` ⇒ **all admissions fail** (fail closed).
- Legacy: pre-1.8 relays used `ORG_SECRETS` (org → secret object). A v2 relay
  disables the legacy path whenever `ORG_PUBKEYS` is present.

### 4. Deploy

```bash
npx partykit deploy   # → https://<name>.partykit.dev
```

Custom domain via the PartyKit dashboard or a `domain` field in `partykit.json`.

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
"rejected", retrying stops, and the banner offers **Save to gallery / Leave**.

## Local dev loop

```bash
pnpm relay:dev        # one command: seed → .env → invite print → partykit dev
pnpm relay:dev:https  # optional TLS-parity mode (mkcert)
```

`pnpm relay:dev`:

1. **Idempotent seed** — generates `.dev-keys.json` (org Ed25519 seed + content key)
   at the repo root once; re-running reuses it (re-seeding must NOT rotate keys —
   your dev invite keeps working across days).
2. Writes `.env` (gitignored): `ORG_PUBKEYS` (v2) + legacy `ORG_SECRETS` for
   compatibility. PartyKit's dev server auto-loads it.
3. Prints a **paste-ready server invite for `http://127.0.0.1:1999`** — the loopback
   carve-out: `http:/ws:` is accepted only for the IP literals `127.0.0.1` / `[::1]`;
   remote traffic stays TLS-only.
4. Runs `partykit dev` against `packages/collab-relay`.

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
- **Wipe-state emulation.** `partykit dev` persists room state by default
  (`packages/collab-relay/.partykit/state` — gitignored), the opposite of production
  eviction. `rm -rf packages/collab-relay/.partykit/` simulates room death and
  exercises the dead-room seed prompt path.
- **`--https` (mkcert):** `pnpm relay:dev:https` generates local-CA certs
  (`.dev-cert.pem` / `.dev-key.pem`) and runs partykit's native `--https` mode — a
  real `https://localhost:1999` for one-off TLS-parity checks (reconnect/TLS-failure
  UX, strict-https parser path).

**What local dev does NOT emulate** (per PartyKit docs): the dev server never
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
  freely offline. At T+60s the banner escalates copy only (elapsed + Keep waiting /
  Save & leave). Offline banners promise "edits are kept, sync on return" plus a
  one-line conflict pre-warning. The roster freezes dimmed — "presence frozen" on
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

## See also

- [ADR 0003 — BYO relay realtime collab](adr/0003-byo-relay-realtime-collab.md) — the
  decision record: model, considered options, consequences.
- [Known Limitations](KNOWN_LIMITATIONS.md) — 20MB file cap, one relay per extension,
  no per-member revocation, presentation × collab deferred, and more.
- [Architecture](ARCHITECTURE.md) — repository layout and the editor boot model.
- [README](../README.md) — install and feature overview.
