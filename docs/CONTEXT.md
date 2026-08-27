# Context — Collab Implementation Reference

This file tracks verified collab terms and their ship-time definitions against the
actual implementation. It is English-only (no zh-CN mirror) and a dev reference only —
user-facing descriptions live in [COLLAB.md](COLLAB.md) and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

---

## Presenting member

**Definition**: A member who has sent `present {active:true}` and is broadcasting a
stream of `present {x,y,z}` viewport frames. The state is ephemeral — `Member.presenting`
is relay-side state set on `active:true` and deleted (not set to `false`) on
`active:false`. It is carried to late joiners in `welcome.peers` but never persisted.

**Source**: `packages/collab-core/src/wire.ts` lines 40–44 (`Member.presenting?: boolean`);
`packages/collab-relay/src/room.ts` (route case `"present"`; ephemeral mutation in place,
deleted on `active:false`).

**Note**: Any member may present concurrently — there is no single-presenter slot,
no displacement, no host semantics. Presenters cannot see their audience.

---

## Presentation follow

**Definition**: A local-only client state where the follower's viewport is pinned to the
followed presenter's broadcast viewport stream. Follow is entered by clicking the
follow icon on a presenting member's presence row. Follow breaks on: local pan/zoom
gesture onset (`pointerdown`/drag, `wheel`, pinch), presenter-leave, or own-present-start.
Involuntary breaks show a toast ("Stopped following {name}"); manual unfollow is silent.

**Source**: `packages/page/src/features/collab/follow-break.ts` (pure `shouldBreakFollow`
predicate: `localGesture || presenterLeft || ownPresentStarted`);
`packages/page/src/features/collab/follow-engine.ts` (`classifyFollowEvent` truth table;
toast key `FOLLOW_BREAK_TOAST_KEY`);
`packages/page/src/features/collab/use-follow-break-toast.ts` (effect wires the toast,
captures peer name on follow-entry);
`packages/page/src/features/collab/use-collab-session.ts` lines 239–244
(`followTargetId`, `setFollowTarget`, `startPresenting`, `stopPresenting`).

**Note**: There is no continuous non-presentation viewport follow in v1. The only
reach-other-member affordance outside of presentation mode is the one-shot cursor jump.

---

## Cursor jump

**Definition**: A one-shot hop from the local viewport to a target member's viewport,
triggered by clicking the jump button (compass icon) on any presence row. Priority:
(1) follow target's live presentation viewport if the target is presenting and is the
current follow target; (2) the target's last-known pointer position from the pointer
stream; (3) button grayed-out when neither is known.

**Source**: `packages/page/src/features/collab/presence.tsx` lines 57–79
(`pickJumpTarget` function with ADR 0008 priority rules);
`packages/page/src/features/collab/follow-engine.ts` lines 86–97 (`applyViewport`).

**Note**: Cursor jump is a one-shot hop, not continuous follow. For a presenting
member, the jump uses their live presentation viewport (priority 1). For a non-presenting
member, it uses their last-known pointer position (priority 2).

---

## In-room load

**Definition**: Loading a gallery drawing into a live collab room, replacing the
current scene. The load travels as an **ordinary edit** through the existing
`broadcastScene` pipeline — no new wire message type, no special receiver casing.
Image fileIds are normalized to content hashes before broadcast. A per-act text-only
confirmation modal is required ("This replaces the room's current content, visible to
all members"); there is no "don't ask again" suppression in v1.

Saving is explicit and sidebar-only: the session chrome's "Save to my gallery" button
is removed; rooms have no implicit durable copy.

**Source**: `packages/page/src/features/collab/room-screen.tsx` lines 209–250
(`onLoadDrawing`, `handleConfirmLoad`, `pendingLoadDrawing` confirm flow;
`broadcastScene` call with `normalizeSceneImageRefs`);
`packages/page/src/features/gallery/utils/normalize-image-refs.ts`
(`normalizeSceneImageRefs` helper: `dataURLToBytes` + `fileIdFor`);
`packages/page/src/features/collab/session-chrome.tsx` lines 253–280
(leave modal = Leave / Stay; save button removed);
`packages/page/src/features/gallery/components/gallery-sidebar.tsx`
(`onLoadDrawing` + `chosenDrawingId` seam).

**Note**: The same `normalizeSceneImageRefs` normalization is applied when seeding
a dead room from a gallery drawing. Whole-scene replace as an ordinary edit means
all three-way merge and re-entry rules apply unchanged — the receiving client
processes an ordinary `scene` message.
