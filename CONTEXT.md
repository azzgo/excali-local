# Excali Local

A local-first browser extension that runs Excalidraw fully offline: screenshot annotation, an
offline editor, a local gallery, presentation mode, custom fonts. No backend; all data in
IndexedDB. This glossary captures the terms that are specific to this project — in particular
the **Agent Bridge** feature (agent-driven drawing — an external local agent driving the

## Agent Bridge

**Activated canvas**:
The single Excalidraw canvas a user has explicitly exposed for external agent driving. Bound
to canvas-bound operations and the single-active-canvas invariant; activated on the editor
page that owns that canvas.
_Avoid_: active canvas, controlled canvas, open canvas

**Registered canvas** (WebMCP mode only):
An editor page whose canvas tools have been explicitly exposed via `document.modelContext`
registration — the WebMCP-mode per-page exposure consent. Replaces the ws+daemon WS dial as
the exposure mechanism; there is no daemon, no pairing, and no single-active-canvas invariant
(each registered editor page exposes its own canvas; consumer topology is the consumer's concern).
Consent is per-canvas and dynamic: the user performs an explicit register act, and unregister
withdraws exposure immediately.
_Avoid_: activated canvas (a ws+daemon term bound to the single-active-canvas invariant), exposed
page, opened session

**Paired connection**:
A bridge connection the user has explicitly allowed (first-use pairing). The
connection-level consent; independent of any canvas and of any specific agent
(the daemon is a shared bridge — pairing is a profile-level transport consent,
not a bond with one agent). Gates all agent control.
_Avoid_: trusted session, authenticated connection

**Global allow**:
The user-controlled, opt-in extension toggle (default off) that permits the bridge to accept
agent connections at all — i.e. permits pairing. Adjustable on the Options page (a
kill-switch) and, as a one-action quick-start that also pairs + activates the current
canvas, from the canvas button.
_Avoid_: agent permission, bridge enable

**Canvas-bound operation**:
An operation whose effect lands on the activated canvas (draw, read scene, set tool, load a
drawing onto it, push a screenshot). Requires an activated canvas in addition to a paired
connection.
_Avoid_: canvas action, drawing command

**Global operation**:
An operation on an extension subsystem not tied to a specific canvas (gallery list/save,
fonts list/assign). Requires only a paired connection; does not need an activated canvas.
_Avoid_: background operation, non-canvas action

**Canvas-related**:
A plugin-internal subsystem whose state configures or feeds the activated canvas (gallery
drawings, font config). The agent-controllable boundary beyond the canvas itself; controllable
over a paired connection.
_Avoid_: extension feature, plugin surface

**External-reach flow**:
A flow that reaches beyond the plugin's own pages — screen capture / screenshot annotation, or
opening external `.excalidraw` files. Explicitly out of scope for agent control.
_Avoid_: external action, capture flow

**Options persistence rule**:
The Options page has a single persistence semantics: every control on it takes
effect immediately upon act (agent kill-switch, route, font slots alike). There is no
draft/Save staging on the Options page. Font-config changes persist at once and take
effect in newly opened editor windows (the editor reads font config once at boot).
_Avoid_: Save flow, deferred apply, draft state

## Collab

**Room name**:
The shared, broadcast name of a collab room. Room content like the scene: held relay-side,
last-write-wins, renamable by any member (there is no room owner). Dies with the room —
when everyone leaves and the room's state is gone, the name is gone too; whoever re-seeds
the room next names it.
_Avoid_: room title, room label (the local rooms-list entry mirrors the room name)

**Room probe**:
The lightweight pre-join query: a wire request/response keyed by shareId that returns room
facts (room name, whether content exists, peer count) without admission, without joining
the roster, and without any side effect visible to members inside.
_Avoid_: pre-request, peek, room-info lookup

**Staged seed**:
The scene picked at the seed prompt (blank or gallery drawing), parked in the session
cache before entering the room. A never-synced draft: if the room turns out to have
content, the staged seed is discarded silently — it never merges and never broadcasts.
_Avoid_: pending scene, initial scene

**Re-entry rule**:
The two-branch rule for joining a room, discriminated by whether the client has ever
synced with this room (a non-null base in the session cache). Never synced → the room
is authoritative: apply the room's scene as-is, drop anything staged. Synced before →
three-way soft-merge the offline edits against the room's scene, online wins on
conflicts (losers surface as a reset notice). Room death is never surfaced, so a
dead-room-reseeded return behaves identically to an alive-room reconnect.
_Avoid_: re-activation rule (061 §3's wire-level name for the same merge), seed merge
