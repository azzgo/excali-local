# Excali Local

A local-first browser extension that runs Excalidraw fully offline: screenshot annotation, an
offline editor, a local gallery, presentation mode, custom fonts. No backend; all data in
IndexedDB. This glossary captures the terms that are specific to this project — in particular
the in-progress **Agent Bridge** feature (an external local agent driving the editor).

## Agent Bridge

**Activated canvas**:
The single Excalidraw canvas a user has explicitly exposed for external agent driving. Bound
to canvas-bound operations and the single-active-canvas invariant; activated on the editor
page that owns that canvas.
_Avoid_: active canvas, controlled canvas, open canvas

**Paired connection**:
A bridge connection from a specific agent that the user has explicitly allowed via first-use
pairing. The connection-level consent; independent of any canvas. Gates all agent control.
_Avoid_: trusted session, authenticated connection

**Global allow**:
The user-controlled, opt-in extension toggle (default off) that permits the bridge to accept
agent connections at all — i.e. permits pairing. Lives in the global UI (popup/options), not
on a canvas.
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
