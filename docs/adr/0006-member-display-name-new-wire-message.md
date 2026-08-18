# Member display name: dedicated wire message, not reconnect

Members were only ever named at `hello`: the display name rode the handshake,
the relay stamped it into the roster, and no message existed to change it —
so a mid-room rename would have required a silent re-dial (a leave/join pair
on every peer's roster plus the full re-entry merge) for a purely cosmetic
change. We decided a member's display name is mutable presence state: a new
`member-name` wire message mirrors ADR 0004's `room-name` exactly —
client→relay `{name}`, relay updates its member record (so `welcome` shows
late joiners the current name) and broadcasts relay-stamped `{name, from}`,
last-write-wins by relay arrival order. Any member may rename **themselves
only** — the message renames the sender's own connection; there is no way to
rename another member.

## Status

accepted — 2026-08-18

## The model

- **Wire.** One new directed message `member-name`, shaped and stamped like
  `room-name` (envelope-level `from`; a missing `from` is a relay bug and the
  frame is dropped). The sender must be an admitted member of the room.
- **Effective name.** What a client sends (in `hello` and in `member-name`)
  is the *effective* display name: the per-room override when one is cached
  on the local rooms-list entry, else the profile default from the
  CollabIdentity record, else the minted short handle.
- **Validation.** Mirrors `room-name`: trimmed, non-empty, length-capped; the
  client-side guard matches the relay's so a bad rename never hits the wire.
- **Persistence is client-local only.** The relay holds the name only as long
  as the connection lives (unlike `room-name`, nothing lands in room.storage);
  the default and the per-room override are local storage concerns
  (CollabIdentity record / rooms-list entry respectively) and never ride
  invites.

## Considered Options

- **Silent reconnect with a new `hello` — rejected.** A cosmetic rename would
  surface as a leave/join pair on every peer's roster and trigger the whole
  re-entry merge path; the roster already dedupes reconnect races precisely
  because that churn is a wart, not a mechanism to lean on.
- **Rename via pointer/presence frames — rejected.** Presence frames are
  high-frequency and ephemeral; smuggling durable identity into them would
  force every client to treat a transient channel as state.

## Consequences

- The committed wire is still the plaintext form (058's signed envelope is
  future work, per ADR 0004's follow-up note); `member-name` must ride inside
  it when it lands. Until then a member's chosen name is visible to the
  relay, same as `room-name` today — no new leak class.
- `room-name` attribution toasts map `from` through the roster to a member
  name; a rename mid-session makes older toasts read stale. Accepted: toasts
  are transient by design.
