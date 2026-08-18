# Room entry: probe-gated join + the re-entry rule (staged seeds never merge)

Joining a room had two defects. First, the join screen decided whether to show the seed
prompt ("This room is empty — load from gallery / start blank") from **local cache
absence alone**, never asking the relay — so a cacheless joiner of a *live, populated*
room was offered seed choices for a room that needed none. Second, a staged seed
(the blank/gallery scene parked in the session cache before entering) could be dragged
into the 061 three-way merge as "local edits that must survive the first snapshot",
producing a redundant full-scene rebroadcast (everyone's canvas force-repainted — the
observed "flash") and, in first-seed races, either silently wiping a loser's synced
content or polluting the winner's blank room with the losers' ghost elements.

We decided: the join screen is **gated by the room probe** (ADR 0004), and room entry
follows a single **re-entry rule** with exactly two branches, discriminated by whether
the client has ever synced with this room (non-null `base` in the session cache):

- **Never synced** (staged seeds, first-seed race losers with no real base) → **the room
  is authoritative.** Apply the room's scene as-is; the staged seed is discarded
  silently. No merge, no rebroadcast. This is the seed prompt's own copy made load-bearing:
  "whoever seeds first sets everyone's starting point."
- **Synced before** → the existing 061 §3 three-way merge, unchanged: single-side
  changes merge cleanly, conflicts resolve online-wins and surface in the amber reset
  notice.

A room death is never surfaced (054 Q7), which **forces** uniformity: a return to a
dead-then-reseeded room must behave indistinguishably from a reconnect to an alive room,
so both take the merge branch. Against a fresh seed this yields the natural outcome —
old ghost content is cleanly "online-deleted", offline-*created* strokes survive as
local-only creates, offline edits to old elements lose with a reset notice.

Finally, the post-merge rebroadcast is **tightened**: it fires only when the merged
scene actually differs from the online scene (`localDirty`), not "even when the online
version won". A merged result identical to the online scene adds nothing the others
don't already have; rebroadcasting it was the flash.

## Status

accepted — 2026-08-18

## Considered Options

- **Content-preserving entry (never discard anything local) — rejected.** Every local
  element becomes a "local-only create" against the room's scene: a winner who picked
  "start blank" watches losers' caches re-materialize in their blank room. "Blank"
  stops meaning blank.
- **Keep seed-offer decisions client-local (no probe) — rejected.** Local cache state
  cannot tell an empty room from a populated one; any client-side heuristic re-introduces
  the untruthful seed prompt under some timing.
- **Probe-gate only the UI, no session-layer rule — rejected.** The probe→connect gap is
  a real race (someone seeds in between), and the bookmarkable `#room/<shareId>` path
  bypasses the join screen entirely. The re-entry rule lives in the session layer
  precisely so the UI can be optimistic and wrong without consequence.
- **Relay-side wipe heuristics (e.g. reject empty scenes over non-empty snapshots) —
  rejected.** Clearing the canvas is a legitimate edit; the relay cannot distinguish
  intent. Protection belongs in the client rules above.
- **Keep the always-rebroadcast after merge — rejected.** Convergence is unaffected
  (identical content needs no re-assertion) and the relay's duplicate suppression keys
  on seq+payload, so these redundant scenes always broadcast.

## Consequences

- The staged seed stops being a merge participant; `use-collab-session`'s "edits must
  survive the first snapshot even when cached.base is null" carve-out is narrowed to
  genuine pre-snapshot local strokes, never to staged seeds.
- First-seed losers with a *synced* cache lose their old content by design (the room
  died; the winner redefined it) but keep offline-created strokes via the merge — and
  never learn that anything unusual happened, per death-silence.
- The join screen gains a truthful intermediate state (probe in flight) and truthful
  copy: "This room is empty" is now only shown when the relay says so.
- The seed prompt's staged choices become unreachable in live rooms through the UI;
  the session-layer rule is the backstop that makes this a guarantee rather than a hope.
