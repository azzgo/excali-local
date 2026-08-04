# Workflow — save to / load from the local gallery

The gallery stores the editor's drawings locally (IndexedDB — no backend).
The agent works with **metadata only on the wire**: listing returns
`{id, name, thumbnail, collectionIds, createdAt, updatedAt}`; the heavy
scene payloads (elements/appState/files) never travel to you — `gallery.save`
captures them in-page and `gallery.load` parses them in-page.

## Gates

- `gallery.list` / `gallery.get` / `gallery.rename` / `gallery.delete` /
  `gallery.collections.*` → **paired** (no canvas needed).
- `gallery.load` / `gallery.save` → **activated** (canvas-bound).

## Save the current canvas

```bash
$BIN gallery.save '{"name":"Architecture v2"}'
# → { "id": "…", "isNew": true }
```

- New save: `isNew: true`, fresh id, thumbnail generated in-page.
- Overwrite an existing drawing: pass its `id` —
  ```bash
  $BIN gallery.save '{"id":"<id>","name":"Architecture v2 (updated)"}'
  ```
  → **blocking confirmation** (the stored version is destroyed); if the user
  declines → `-32005`. Prefer `isNew` saves unless the user asked to update.
- Optional `collectionIds: ["…"]` to file it into collections.

## List and find drawings

```bash
$BIN gallery.list
# → metadata only; thumbnails stripped by default
$BIN gallery.list '{"nameContains":"architecture"}'
# → filter by name substring (case-insensitive)
$BIN gallery.list '{"collectionId":"<collection-id>","includeThumbnail":true}'
```

## Load a drawing onto the canvas (activated)

```bash
$BIN gallery.load '{"id":"<id>"}'
# → { "id": "…", "name": "…" }
```

- Replaces the current scene with the stored drawing (the editor's own
  load-to-scene path). Missing id → `-32006`.
- After loading, re-read with `scene.get` before drawing on top.

## Collections

```bash
$BIN gallery.collections.list
$BIN gallery.collections.create '{"name":"Diagrams"}'
$BIN gallery.collections.rename '{"id":"<id>","name":"New name"}'   # blocking
$BIN gallery.collections.delete '{"id":"<id>"}'                     # blocking
```

- `collections.delete` rewrites every member drawing to strip the collection
  id and reports how many were affected:
  `{ "id": "…", "affectedDrawings": 3 }`.
- `collections.create` returns a fresh id each call (not idempotent — do not
  re-create on retry; re-list first).

## Rename / delete (blocking-confirmed)

```bash
$BIN gallery.rename '{"id":"<id>","name":"New name"}'   # blocking
$BIN gallery.delete '{"id":"<id>"}'                     # blocking
```

Both show the user a blocking confirmation; a decline → `-32005` — **back
off, don't retry**. These are destructive global operations; always confirm
the target id by listing first, and never rename/delete without an explicit
user request in this session.

## Editing a saved drawing (read → edit → save)

The gallery does not expose raw scene payloads on the wire; to edit a saved
drawing:

1. `gallery.load '{"id":"<id>"}'` (activated canvas).
2. `scene.get` — read the loaded scene.
3. Emit edits with `elements.add` (new content) or `scene.update`
   (replacement of existing elements — the id/binding-preserving path).
4. `gallery.save '{"id":"<id>"}'` — overwrite (blocking confirmation) or
   `gallery.save '{"name":"<new name>"}'` for a new copy.
