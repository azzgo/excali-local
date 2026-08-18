# Room name: relay-stored shared content, not invite-carried

Collab rooms had no shared name: the create screen's name input only wrote a **local**
label into the `rooms` IndexedDB store, so the invite (which IS the room, ADR 0003)
carried no name and every joiner fell back to a shareId-derived placeholder. We decided
the room name is **room content**: held relay-side in room.storage beside the snapshot,
set by a new `room-name` wire message, last-write-wins by relay arrival order, renamable
by **any member** (rooms stay hostless), and **ephemeral — it dies with the room**. When
a dead room is re-seeded, the re-seeder's local (genuinely named) label becomes the new
room name. A lightweight **room probe** (a shareId-keyed request/response returning
`{roomName, snapshotAvailable, peerCount}`, no admission, no roster side effects) lets
the join screen show the real name and room state before entering.

## Status

accepted — 2026-08-18

## The model

- **Wire.** One new directed message `room-name` (client→relay `{name}`; relay→all
  `{name, from}`). Senders must be admitted members of the room. Relay stores the name
  under its own room.storage key (beside, not inside, the snapshot record), stamps
  arrival order, broadcasts with `from`. `welcome` carries the current `roomName`.
- **Ordering.** Relay arrival order is the LWW order — the relay is already the single
  serialization point for scenes; client timestamps (clock skew) are not used. No undo,
  no history.
- **Validation.** Trimmed name must be non-empty (an unnamed-room state would force
  fallback rendering in the rooms list, join screen, and session chrome alike — rejected
  by construction) and ≤ 100 chars.
- **Attribution.** The broadcast's `from` (connId) maps through the existing roster to a
  member name; clients show a transient toast ("X renamed the room to Y"). No persistent
  `renamedBy` is stored; late joiners see the name, not its author.
- **Local label becomes a mirror.** The `rooms` store entry's `label` is now a cache of
  the shared name, updated from `welcome.roomName` and rename broadcasts. To know which
  labels may be *pushed* (initial naming / dead-room revival), entries gain a provenance
  field `labelKind: "named" | "auto"`; only `"named"` labels are ever pushed. Migration
  marks all pre-existing entries `"auto"` — conservative, since no shared names existed
  before this feature; one manual rename re-arms an entry.
- **Amends ADR 0003's host-token trigger list.** 0003 deferred a cryptographic host
  token "until a host gains real powers (kick, privacy change, **rename**, transfer)".
  Rename is now settled as a non-host power: any member may rename, LWW. The host-token
  trigger shrinks accordingly.

## Considered Options

- **Name in the room invite — rejected.** Invites are immutable capability payloads; a
  rename would strand the old name in every circulated invite, contradicting
  anyone-can-rename. (A hybrid "invite carries the initial name as a hint" was also cut:
  the room probe covers pre-join visibility without baking a stale-able value into the
  one artifact that must never go stale.)
- **Persistent server-side room registry — stays rejected (ADR 0003).** The name shares
  the snapshot's lifecycle exactly: DO eviction (empty + inactivity) deletes both. No
  longer-lived metadata store is introduced for a name alone.
- **Per-device local alias overriding the shared name — rejected (YAGNI).** One name,
  mirrored everywhere; a second naming layer is a mental-model cost with no asked-for
  use case.
- **Empty names allowed (clear = revert to shareId display) — rejected.** See Validation.

## Consequences

- **E2E follow-up.** The committed wire is still the plaintext form (058's signed
  encrypted envelope is future work). When that envelope lands, `room-name` and the
  probe's `roomName` must ride inside it — under ADR 0003's "relay stores no plaintext"
  model the name is content like the scene. Until then the name is visible to the relay,
  same as scene payloads today; no *new* leak class is introduced.
- **Probe privacy.** Any invite holder can learn `{roomName, snapshotAvailable,
  peerCount}` without revealing member identity — exactly what they would learn by
  joining, so no new disclosure. The probe is the designated cheap read path; future
  consumers (e.g. a rooms-list presence refresh) should reuse it rather than dialing
  full sessions.
- **DB migration.** `excali` DB gains the `labelKind` field on the `rooms` store —
  additive `DB_VERSION` bump per repo convention; existing entries migrate to `"auto"`.
- **First namer / re-namer races** resolve by the same LWW as renames; no special-casing.
