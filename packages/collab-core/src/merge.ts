/**
 * collab-core client-side three-way scene merge — Wayfinder 061 §3 (conflict
 * rule; amends 053 rule (A)).
 *
 * Conflict rule (061 §3, verbatim semantics):
 * - Unresolvable = the SAME element changed on both sides: edit-edit,
 *   edit-vs-delete, delete-vs-edit → the online (server) version wins; the
 *   offline-side change lands at reconnect and is by definition the later one
 *   ("first to modify wins" = whoever reached the server first), so it is
 *   force-reset and returned in `resets` for the amber reset notice ("N local
 *   edits conflicted — the online version was kept").
 * - Single-side changes (create/edit/delete on one side only) merge cleanly
 *   with NO warning.
 * - Re-entry (ADR 0005) and mid-session reconnect (ADR 0007) are the SAME code
 *   path: both call `reconcileScene` with their own base/ours/theirs. Mid-session
 *   fires only after `onReconnect` when the local canvas has unsynced edits
 *   (`localDirtyRef`) AND the snapshot diverges; that one frame bypasses the live
 *   seq gate once (the relay's seq resets on DO eviction / ghost recovery).
 *
 * Why a client-side merge at all: the tgz `reconcileElements` tie-break is
 * version/nonce-ordered and cannot express "server wins on conflict". We diff
 * base/ours/theirs FIRST, resolve conflicts online-wins, and hand the merged
 * scene to the UI.
 *
 * Identity = element id. "Changed" = the full snapshot differs from base,
 * compared by canonical serialization (object keys sorted recursively, so key
 * insertion order is irrelevant; version/versionNonce bumps count as changes).
 * Snapshots must be JSON-serializable (they travel the wire as JSON).
 *
 * Inputs are never mutated; the merged scene holds references to the winning
 * snapshots. Duplicate ids inside one input array: last occurrence wins for
 * content, first occurrence for scene position.
 *
 * Ordering: the merged scene keeps theirs' array order (each conflict resolves
 * to the online snapshot at its online position); local-only creates
 * (present in ours, absent from base and theirs) are appended afterwards in
 * ours' relative order.
 */

/** Minimal structural shape of an Excalidraw scene element. The merge treats
 * snapshots opaquely — anything extra is compared as-is. */
export interface Element {
  id: string
  type: string
  version: number
  versionNonce: number
  [key: string]: unknown
}

/** Why an element landed in the reset list — 061 §3's three unresolvable shapes. */
export type ResetKind = "edit-edit" | "edit-vs-delete" | "delete-vs-edit"

/** One force-reset: the offline change lost, the online version was kept. */
export interface ResetRecord {
  /** element id that was reset to the online version */
  id: string
  kind: ResetKind
  /** the discarded offline snapshot — absent when the local change was a delete */
  oursWas?: Element
  /** the winning element: the online (server) version, or null when the online change was a delete */
  kept: Element | null
}

export interface MergeInput {
  /** last synced scene (the session cache's base snapshot) */
  base: readonly Element[]
  /** local scene (the offline-edited canvas) */
  ours: readonly Element[]
  /** online scene (server snapshot at reconnect / re-entry) */
  theirs: readonly Element[]
}

export interface MergeResult {
  /** merged scene — theirs' array order, local-only creates appended in ours' relative order */
  scene: Element[]
  /** same-element-both-sides conflicts; empty when every change was single-sided */
  resets: ResetRecord[]
}

/**
 * Three-way merge (base/ours/theirs) with online-wins conflict resolution.
 *
 * Per element id (b = base snapshot, o = ours, t = theirs; "changed" = snapshot
 * differs from base):
 * - b only (both deleted)                                → absent
 * - o only, base lacked it (local create)                → ours wins, no conflict
 * - o only, base had it + t === b (local delete)         → deleted, no conflict
 * - t only, base lacked it (remote create)               → theirs arrives, no conflict
 * - t only, base had it + o === b (remote delete)        → deleted, no conflict
 * - o deleted + t changed (delete-vs-edit)               → theirs restored + reset
 * - o changed + t deleted (edit-vs-delete)               → deleted + reset
 * - all present: o === b                                 → theirs silently
 * - all present: t === b                                 → ours silently
 * - all present: both changed, o === t                   → merged silently
 * - all present: both changed, o !== t (edit-edit)       → theirs + reset
 * - both created, o === t                                → merged silently
 * - both created, o !== t                                → theirs + reset (edit-edit;
 *   deterministic extension: same element created on both sides with different
 *   content is unresolvable, so online wins)
 */
export function mergeScene({ base, ours, theirs }: MergeInput): MergeResult {
  const baseById = indexById(base)
  const oursById = indexById(ours)
  const theirsById = indexById(theirs)

  /** surviving id → merged snapshot (winners only; deleted ids have no entry) */
  const winner = new Map<string, Element>()
  const resets: ResetRecord[] = []

  // Deterministic id order: first-encounter across base → ours → theirs.
  for (const id of collectIds(baseById, oursById, theirsById)) {
    const b = baseById.get(id)
    const o = oursById.get(id)
    const t = theirsById.get(id)

    // Both sides deleted (element only in base) → absent.
    if (b !== undefined && o === undefined && t === undefined) continue

    // Local-only create: base lacked it, theirs never saw it → ours wins, no conflict.
    if (b === undefined && o !== undefined && t === undefined) {
      winner.set(id, o)
      continue
    }

    // Remote-only create: base lacked it, ours never saw it → theirs arrives, no conflict.
    if (b === undefined && o === undefined && t !== undefined) {
      winner.set(id, t)
      continue
    }

    // Ours deleted it; theirs still has it.
    if (b !== undefined && o === undefined && t !== undefined) {
      if (sameSnapshot(t, b)) continue // theirs untouched → local delete stands, no conflict
      // delete-vs-edit: theirs changed while we deleted → online wins, element restored.
      winner.set(id, t)
      resets.push({ id, kind: "delete-vs-edit", kept: t })
      continue
    }

    // Theirs deleted it; ours still has it.
    if (b !== undefined && o !== undefined && t === undefined) {
      if (sameSnapshot(o, b)) continue // ours untouched → remote delete applies, no conflict
      // edit-vs-delete: ours changed while theirs deleted → online wins, element deleted.
      resets.push({ id, kind: "edit-vs-delete", oursWas: o, kept: null })
      continue
    }

    // Both sides have it (all prior branches continued, so o/t are defined here).
    if (o === undefined || t === undefined) continue // defensive: unreachable
    if (b === undefined) {
      // Both created the same id (base lacked it): identical → silent; differ → unresolvable.
      if (!sameSnapshot(o, t)) {
        resets.push({ id, kind: "edit-edit", oursWas: o, kept: t })
      }
      winner.set(id, t)
      continue
    }
    // Base had it.
    if (sameSnapshot(o, b)) {
      winner.set(id, t) // ours untouched → theirs wins silently
      continue
    }
    if (sameSnapshot(t, b)) {
      winner.set(id, o) // theirs untouched → ours wins silently
      continue
    }
    if (sameSnapshot(o, t)) {
      winner.set(id, t) // both changed identically → merge silently
      continue
    }
    // edit-edit: both changed differently → online wins + reset.
    resets.push({ id, kind: "edit-edit", oursWas: o, kept: t })
    winner.set(id, t)
  }

  // Ordering: theirs' array order (winners in their online position), then
  // local-only creates appended in ours' relative order.
  const scene: Element[] = []
  const placed = new Set<string>()
  for (const el of theirs) {
    const w = winner.get(el.id)
    if (w !== undefined && !placed.has(el.id)) {
      scene.push(w)
      placed.add(el.id)
    }
  }
  for (const el of ours) {
    if (!theirsById.has(el.id) && !baseById.has(el.id)) {
      const w = winner.get(el.id)
      if (w !== undefined) scene.push(w) // local create (must exist)
    }
  }

  return { scene, resets }
}

function indexById(elements: readonly Element[]): Map<string, Element> {
  const map = new Map<string, Element>()
  for (const el of elements) map.set(el.id, el)
  return map
}

/** All ids in first-encounter order across the three scenes (base → ours → theirs). */
function collectIds(...maps: Map<string, Element>[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const map of maps) {
    for (const id of map.keys()) {
      if (!seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

/** Snapshot equality: canonical JSON (keys sorted recursively). */
function sameSnapshot(a: Element, b: Element): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** JSON.stringify semantics with object keys sorted recursively — key insertion
 * order never matters. Mirrors JSON.stringify's value rules: undefined/function
 * properties are omitted in objects, rendered as null in arrays. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (typeof v === "function" ? "null" : canonicalJson(v))).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key]
      if (v === undefined || typeof v === "function") continue
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`)
    }
    return `{${parts.join(",")}}`
  }
  // Primitives (undefined/symbol/function render as JSON.stringify's null-ish "null").
  return JSON.stringify(value) ?? "null"
}
