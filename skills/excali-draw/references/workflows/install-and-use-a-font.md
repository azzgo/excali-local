# Workflow — install and use a font (the two-step recipe)

Excali Local lets the user configure three **font slots** that map to
Excalidraw's per-element `fontFamily` ids:

| Slot | fontFamily | Role |
| --- | --- | --- |
| `handwriting` | `1` | handwritten-style font |
| `normal` | `2` | body/regular font |
| `code` | `3` | monospace/code font |

**The fog to know about:** fonts inject **once at page boot**. Every
page-side font write returns `{ config, requiresReload: true }` — the change
will not render until the editor page reloads. There is no hot-swap
(hot-swap without reload is out of scope for this skill).

## The recipe (three steps — do not skip the reload)

### Step 1 — configure the slot

Discover system fonts (daemon-local, no permission prompt):

```bash
$BIN fonts.system.list
# → [ { "family": "SFNS-Regular", "postscriptName": "SFNS-Regular" }, … ]
```

Assign a system font to a slot (non-blocking):

```bash
$BIN fonts.assign '{"slot":"code","postscriptName":"JetBrains Mono Regular"}'
# → { "config": { …, "code": { "type": "system", "postscriptName": "JetBrains Mono Regular" } }, "requiresReload": true }
```

Or install a custom font file (blocking confirmation; validated BEFORE the
prompt):

```bash
$BIN fonts.install '{"slot":"handwriting","family":"My Hand","data":"<base64 of a .ttf/.otf/.woff/.woff2, ≤ 30 MiB>"}'
# → { "config": { …, "handwriting": { "type": "custom", "family": "My Hand" } }, "requiresReload": true }
```

- Format (magic bytes) and size are validated **before** the confirmation
  modal; an invalid file fails with `-32602` and never prompts.
- The response is **trimmed**: custom slots serialize as
  `{ type: "custom", family }` — no font bytes travel on the wire.
- `fonts.clear '{"slot":"code"}'` (blocking) empties a slot.
- Read the current config anytime: `fonts.get`.

### Step 2 — reload the editor page

The slot change renders only after a page reload. **You have no reload
command** — ask the user to reload the editor page, or coordinate with the
user's own reload affordance, then continue only after it reloaded.

### Step 3 — use the font in drawn text

Set the per-element `fontFamily` to the slot you configured. The canvas's
appState default font is NOT sufficient — every text element carries its own
`fontFamily`:

```json
{ "type": "text", "text": "const x = 1;",
  "fontFamily": 3, "fontSize": 14,          // 3 = the code slot you configured
  "textAlign": "left", "verticalAlign": "top",
  "strokeColor": "#64748b", "strokeWidth": 2, "roughness": 0, "opacity": 100 }
```

## Behavior notes (verified against the implementation)

- `fonts.assign` / `fonts.install` / `fonts.clear` are **paired** operations
  — they need the paired connection but **no activated canvas**.
- `fonts.system.list` is **daemon-local** — works with nothing else
  connected (no page, no canvas, no permission prompt; cross-browser).
- The `requiresReload: true` flag is returned by every page-side write —
  treat it as a contract: reload before verifying with `fonts.get` +
  rendering.
- User declines an install/clear confirmation → `-32005` — back off.
