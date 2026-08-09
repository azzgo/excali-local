# Canvas activation — the Agent button state machine

Source of truth: `packages/excali-page/src/features/editor/components/agent-activation-control.tsx`
(the comment block at the top describes the states). Rendered by the **local**
editor only; the quick editor never shows it.

## States (button color)

| State | Meaning | Click behavior |
| --- | --- | --- |
| **grey** (feature OFF) | Agent Bridge master switch off | opens the enable modal → confirm "Turn on agent control?" → opens master + pairing (Gate 0+1) and *arms auto-activate* |
| **amber** ("waiting for bridge") | paired, but the bridge daemon is not detected | toggles the inline help card (two daemon-start paths) |
| **blue** (ready) | paired + daemon detected, canvas not active | cold-start path auto-activates past this; warm path: click → (first time per canvas) consent modal → activate |
| **solid** (controlling) | this canvas is the activated canvas | click deactivates (no consent needed to stop) |

## The cold-start path (what this skill scripts)

The user's one-action journey: **Turn on** counts as the per-canvas consent —
no second modal. Order between turning on and daemon start does not matter;
the button re-runs the detection and activates once the daemon answers.

```
daemon up (excali-bridge ping)  →  click Agent  →  confirm "Turn on agent control?"
  →  grey→(amber briefly)→Controlling   →  verify via bridge
```

If you turned on *before* the daemon was up, the button shows amber — click it
again to re-trigger the two daemon-start options (or just start the daemon;
the detection retries).

## Warm path (feature already on, activating another canvas)

Click **Agent** → per-canvas consent modal → activate. This is also the path
that **displaces** a previously activated canvas (single-active-canvas
invariant): the displaced editor shows a toast, and its canvas-bound bridge
calls start failing with `-32001` until re-activated.

## Verifying activation (always via the bridge, not the UI alone)

```bash
BIN=~/.agents/skills/excali-local/bin/excali-bridge-$(uname -s)-$(uname -m | tr -d 'v')
"$BIN" bridge.status     # shows which canvas/profiles are connected
"$BIN" scene.get         # canvas-bound — needs the activated canvas
```

- `bridge.status` lists the daemon state and the connected canvas → the
  authoritative activation check.
- `scene.get` returns the (initially empty) scene once activated; error
  `-32001` means no activated canvas (or you were displaced).

## Failure states to expect in tests

- **`-32001`** — no activated canvas: canvas-bound op without activation, or
  the canvas was displaced by a newer activation.
- **`-32005`** — a blocking confirmation (destructive global op) was declined;
  in tests, answer the confirmation through the page UI and observe the CLI
  result flip between success and `-32005`.
- **"Waiting for the bridge daemon" (amber) forever** — the daemon never
  started (`excali-bridge ping` first), or the daemon port range
  `127.0.0.1:[17331..17335]` is unreachable from the page (should not happen
  on localhost; check the page console via `list_console_messages`).
