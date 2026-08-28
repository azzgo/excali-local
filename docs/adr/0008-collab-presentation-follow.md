# Collab room presentation follow — self-declared presenters, gesture-break

## Status

accepted — implemented in 1.9 (planned 2026-08; the pre-implementation qualifier is superseded by the shipping code)

## Context & decision

`KNOWN_LIMITATIONS.md` carried a 2026-08-16 deferral: "Presentation mode ×
collaboration" was out of scope until the collab model matured in real use. The
collab model has since shipped end-to-end (wire v1, E2E tiers, re-entry rules,
file sync), so the deferral is reopened **partially**.

Decision: in a collab room, presentation follow is **a light adhesive feature on
top of collab, not a presentation tool**. Concretely:

- **Self-declared, multi-presenter.** Any member may enter local presentation
  mode; doing so broadcasts an ephemeral `present` state (`active: true`, then
  viewport frames, then `active: false`). Per-connection lifecycle, exactly
  ADR 0006's member-name shape: relay-stamped gossip, no room.storage, initial
  value carried to late joiners in `welcome.peers`. No presenter slot, no
  displacement, no host semantics.
- **Follow is local-only.** Clicking a presenting member's roster icon pins my
  viewport to their broadcast viewport stream. Followers gain no presentation
  capability; slide machinery (frames, ordering, navigation) never leaves the
  presenter's client and `slideIndex` never rides the wire.
- **Gesture-break.** Follow ends at the *onset* of any local pan/zoom gesture,
  on the presenter leaving, or when I enter my own presentation (the last is a
  corollary of the same predicate, not a special rule). Figma-style.
- **No reverse channel.** Presenters cannot see who follows or how many. If a
  user needs a heavyweight presentation tool with audience feedback, meeting
  software serves them better than this feature ever should.
- **Cursor jump, not continuous follow.** Outside presentation, the only "reach
  another member" affordance is clicking their avatar → one-shot hop to their
  last known pointer position (the existing 055 pointer stream); for a
  presenting member, the hop uses their live presentation viewport. Continuous
  non-presentation viewport following remains out of scope.

Wire shape: one new message type `present` (ClientMessage + RelayMessage,
relay content-blind), payload `{ active: true } | { x, y, z } | { active:
false }`. It joins the encrypted content class (`ContentType` gains `"present"`
— same privacy tier as `pointer`: where someone is looking). Viewport updates
use sendScene's ~100ms trailing-edge throttle precedent.

## Considered Options

- **Room-level single presenter slot with displacement** — rejected: conflicts
  with the hostless principle (no member holds authority over another's view);
  needs orphan cleanup and mid-session succession rules. Concurrent presenters
  are legitimate; followers pick whom to watch per-icon.
- **`slideIndex` on the wire / followers enter presentation mode** — rejected:
  slides are frames ordered by local `customData`; a follower only needs the
  viewport, which makes follow reusable beyond frame-based decks for free.
- **Sticky follow (only explicit actions break it)** — rejected: dragged-back
  users are startled, viewport is personal space, and it forces a state machine
  full of exceptions instead of one predicate ("local interaction").
- **Reverse audience-count gossip** — rejected: turns one elegant message into
  three, requires TTL/heartbeat lifecycle decisions, and yields a metric that
  is inherently unreliable in hostless rooms anyway.
- **Protocol version bump** — rejected: legacy relays silently drop unknown
  types (covered by relay tests); against an old relay the feature is simply
  absent, old clients ignore the new type entirely. Same treatment as ADR
  0006's member-name.

## Consequences

- New wire message + `ContentType` extension; KNOWN_LIMITATIONS'
  "Presentation × collaboration deferred" entry gets rewritten at ship time —
  still-not-doing list afterwards: continuous non-presentation follow, laser
  sync (1.9 candidate, unchanged), audience visibility.
- Late joiners see the presenting icon immediately from `welcome.peers`; the
  first viewport frame arrives within the throttle window, so no snapshot of
  presentation state is stored relay-side.
- Demo-mode exclusivity falls out naturally: entering local presentation while
  following breaks the follow (same predicate as any interaction).
