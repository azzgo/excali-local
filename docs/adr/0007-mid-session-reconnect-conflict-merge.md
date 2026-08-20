# Mid-session reconnect: same online-wins merge as re-entry, blip-protected

A mid-session relay drop with offline edits on both sides silently diverged. The
live `onScene` path (`packages/page/src/features/collab/use-collab-session.ts`
L902-922) applies the relay snapshot straight through `applyScene` with **no
three-way merge, no reset notice** — even though `mergeScene` (`packages/collab-core/src/merge.ts`
L98) is the *only* caller of itself via `handleFirstScene` (L1038), which runs
only on the first scene of a mount (`isFirst = !firstSceneRef.current`, L889-896).
`firstSceneRef` resets solely on teardown (L1020, L1166), never on reconnect, so
the merge never fires mid-session. This contradicts `merge.ts` L14-15
("Applies identically to mid-session recovery and re-entry") — the claim was
aspirational, not true.

We decided: a mid-session reconnect runs the **same 061 §3 three-way merge +
amber reset notice as re-entry**, but only when it is *genuinely needed* — the
client has unsynced local edits (`localDirtyRef`) **and** the relay's
post-reconnect snapshot diverges from the local scene on shared elements
(content diff). The trigger is the existing `onReconnect` callback (L748, fired
only by `client.scheduleReconnect`, `packages/collab-core/src/client.ts` L663-669)
setting a `midReconnectRef`; the first scene after is treated as the
reconciliation snapshot and **bypasses the L883 seq gate once** so the relay's
re-sent scene is actually comparable (required after a DO eviction / ghost
recovery, where the relay's seq counter resets). Crucially, the merge +
notice + rebroadcast-if-divergent logic is **extracted into one shared helper
reused by both re-entry and the mid-session branch** — `handleFirstScene`'s
merge block (L1069-1111) is refactored into it; no second copy is written. The
mid-session base is `baseSceneRef.current` (last synced before the outage),
conceptually identical to re-entry's `pending.base`.

## Status

accepted — 2026-08-20

## Considered Options

- **Silent last-edit-wins mid-session (no merge, no notice) — rejected.** Keeps
  the current behavior. Leaves a consistency window (both canvases hold their
  own edit until the next edit re-converges) and zero conflict visibility, and
  leaves `merge.ts` L14-15 contradicting the code. The online-wins contract the
  relay already advertises would apply only on join, never on reconnect.
- **Always merge on every reconnect (no blip protection) — rejected.** A
  transient blip where the user's latest stroke hadn't yet reached the relay
  would be judged an edit-edit conflict → online-wins → that local stroke is
  force-reset. Every network flutter would swallow the user's most recent edit.
  This is the exact failure mode the current "don't merge mid-session" behavior
  accidentally avoids, and the reason it was avoided.
- **Time threshold to separate blip from real divergence — rejected.** Fragile:
  a long blip whose edit *was* delivered still false-fires a conflict, while a
  short real double-edit is skipped. A magic constant encodes no real
  semantics. The content-diff heuristic needs no threshold and is correct for
  any outage duration.

## Consequences

- `merge.ts` L14-15 becomes true: re-entry and mid-session reconnect are now the
  *same* code path through the shared helper. The stale comment is corrected to
  describe the blip guard (mid-session fires only when `localDirtyRef` AND the
  snapshot diverges) and the one-frame seq-gate bypass.
- DRY enforced: one helper owns merge → `applyScene` → `setResets` (only when
  `resets.length > 0`, L1082) → rebroadcast-if-divergent (`localDirty`, L1107-1110)
  → `persistSession`. re-entry passes its `pending.base`/`pending.edited`/`pendingLocal`
  tuple; mid-session passes `baseSceneRef`/`localSceneRef`/the post-reconnect scene.
- Blips stay silent. When the local scene has no unsynced edits, or the relay
  snapshot matches the local scene, no merge runs and no notice fires — the
  existing `ResetNotice` only renders when `session.resets !== null`
  (`conn-health.tsx` L785), and that is set only on a non-empty `resets`.
- The Q6 "amber forever on mid-session relay death" window now additionally
  *reconciles* on the post-reconnect snapshot instead of waiting for the next
  edit to converge — the silent-divergence gap is closed without changing the
  reconnect-forever UX.
- Ghost-connection recovery (DO eviction, fix e867e1c) is covered for free: the
  server closes the ghost → `scheduleReconnect` → `onReconnect` fires →
  `midReconnectRef` is set → reconciliation runs. The seq-gate bypass is
  essential there because the relay's seq counter resets on eviction, so the
  re-sent snapshot would otherwise be dropped by `seq <= lastApplied` at L883.
- A user actively drawing may see their element snap to the peer's version on
  reconnect when both edited the same element. That is the documented
  online-wins contract and is explained by the amber "N local edits conflicted
  — the online version was kept" notice. Intentional, not a bug. Repeated
  reconnect flaps with genuine conflicts will re-notify each time; that is
  correct (the conflict is real on each reconnect), and no extra one-shot-per-
  session dedupe is added.
