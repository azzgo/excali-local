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
