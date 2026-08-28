# Collab room gallery sidebar — in-room load is an ordinary edit; explicit save only

## Status

accepted — implemented in 1.9 (planned 2026-08; the pre-implementation qualifier is superseded by the shipping code)

## Context & decision

The collab room gets the local editor's gallery sidebar (list / collections /
search / thumbnails) mounted on RoomScreen. Three decisions settle its
semantics:

1. **In-room load = whole-scene replacement through the ordinary edit
   pipeline.** Choosing a drawing mid-session clears and inserts it like any
   local edit: same onChange broadcast, same session-cache base reset, same
   merge/re-entry treatment for everyone. No new wire message, no special
   sync rules — the entire capability folds into the existing model. Risk is
   contained by a per-act confirmation modal ("this replaces the room's
   current content, visible to all members"); no "don't ask again" suppression
   in v1. Every member can already wipe the scene today (delete-all +
   broadcast), so this opens no new permission surface.
2. **The chrome's dedicated "Save to my gallery" button is removed** along
   with its hidden room⇄drawing binding (the synthetic `room-${shareId}`
   record). Persistence goes exclusively through the sidebar's own model:
   open/choose a drawing → in-memory mapping → the gallery's own save
   overwrites it; never chose one → SaveDialog creates a new entry. A room has
   **no implicit durable copy** anywhere; legacy `room-*` records degrade to
   ordinary drawings, no migration needed.
3. **The leave modal shrinks to Leave / Stay** with body text warning that
   unsaved content will be lost and pointing at saving via the sidebar first.
   The former "Save & leave" third path would be the removed channel re-
   entering through a farewell upsell; the multi-member redundancy of collab
   (every peer holds the full scene locally) plus untouched session caches on
   non-explicit leaves are the safety nets.

## Considered Options

- **Incremental insert next to existing content** — rejected: creates a
  fourth scenario semantic (neither seed nor edit) with muddy interactions
  against the base-scene merge model; "look at this canvas" degrades to
  overlay soup.
- **Read-only sidebar browsing, load allowed only at seeding time** —
  rejected: halves the feature for no added safety; presentation-driven deck
  switching ("next slide please") needs mid-session loads.
- **Save & leave via the unified sidebar path** — rejected: drags a choose-a-
  drawer dialog into the goodbye flow and resurrects exactly the implicit-save
  convenience being removed.

## Consequences

- One confirmation modal per in-room load (no suppression toggle in v1).
- Session chrome loses its save button; leave modal loses a button; both copy
  changes ride normal i18n keys.
- KNOWN_LIMITATIONS gains nothing new; the removed synthetic binding means
  there is no longer any code keyed by `room-${shareId}` outside the history
  of old gallery rows.
- **File-id normalization on load.** Gallery drawings carry legacy non-
  content-addressed image fileIds (the local editor never rewrites them),
  which the collab upload path skips ("not content-addressed, peers cannot
  fetch it") — leaving peers stranded at placeholders. In-room load (and the
  dead-room gallery seed path) rewrites every image ref to its content hash
  (`dataURLToBytes` + `fileIdFor`) before broadcasting; one pure helper,
  shared by both paths.
