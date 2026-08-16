import { describe, expect, it } from "vitest"
import { mergeScene } from "./merge"
import type { Element, ResetKind } from "./merge"

/** Minimal element factory — {id,type,version,versionNonce} + optional extras. */
function el(id: string, patch: Partial<Element> = {}): Element {
  return { id, type: "rectangle", version: 1, versionNonce: 1, x: 0, y: 0, width: 100, height: 50, ...patch }
}

describe("mergeScene — 061 §3 conflict matrix", () => {
  it("both sides deleted the element (base only) → absent, no reset", () => {
    const r = mergeScene({ base: [el("a")], ours: [], theirs: [] })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([])
  })

  it("local delete stands: ours deleted, theirs untouched → absent, no reset", () => {
    const base = [el("a")]
    const r = mergeScene({ base, ours: [], theirs: base })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([])
  })

  it("local create wins: ours only, base lacked it → kept, no reset", () => {
    const created = el("a", { x: 42 })
    const r = mergeScene({ base: [], ours: [created], theirs: [] })
    expect(r.scene).toEqual([created])
    expect(r.resets).toEqual([])
  })

  it("remote delete applies: theirs deleted, ours untouched → absent, no reset", () => {
    const base = [el("a")]
    const r = mergeScene({ base, ours: base, theirs: [] })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([])
  })

  it("remote create arrives: theirs only, base lacked it → kept, no reset", () => {
    const created = el("a", { x: 7 })
    const r = mergeScene({ base: [], ours: [], theirs: [created] })
    expect(r.scene).toEqual([created])
    expect(r.resets).toEqual([])
  })

  it("ours unchanged, theirs changed → theirs wins silently", () => {
    const base = [el("a")]
    const theirs = [el("a", { x: 9 })]
    const r = mergeScene({ base, ours: base, theirs })
    expect(r.scene).toEqual(theirs)
    expect(r.resets).toEqual([])
  })

  it("theirs unchanged, ours changed → ours wins silently", () => {
    const base = [el("a")]
    const ours = [el("a", { x: 9 })]
    const r = mergeScene({ base, ours, theirs: base })
    expect(r.scene).toEqual(ours)
    expect(r.resets).toEqual([])
  })

  it("edit-edit: both changed differently → theirs wins + edit-edit reset", () => {
    const base = [el("a")]
    const ours = [el("a", { x: 1, version: 2, versionNonce: 2 })]
    const theirs = [el("a", { x: 9, version: 3, versionNonce: 3 })]
    const r = mergeScene({ base, ours, theirs })
    expect(r.scene).toEqual(theirs)
    expect(r.resets).toEqual([
      { id: "a", kind: "edit-edit", oursWas: ours[0], kept: theirs[0] },
    ])
  })

  it("edit-vs-delete: ours changed, theirs deleted → deleted + edit-vs-delete reset", () => {
    const base = [el("a")]
    const ours = [el("a", { x: 1, version: 2, versionNonce: 2 })]
    const r = mergeScene({ base, ours, theirs: [] })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([
      { id: "a", kind: "edit-vs-delete", oursWas: ours[0], kept: null },
    ])
  })

  it("delete-vs-edit: ours deleted, theirs changed → restored + delete-vs-edit reset", () => {
    const base = [el("a")]
    const theirs = [el("a", { x: 9, version: 3, versionNonce: 3 })]
    const r = mergeScene({ base, ours: [], theirs })
    expect(r.scene).toEqual(theirs)
    expect(r.resets).toEqual([{ id: "a", kind: "delete-vs-edit", kept: theirs[0] }])
    // a delete has no offline snapshot — oursWas stays absent
    expect(r.resets[0].oursWas).toBeUndefined()
    expect("oursWas" in r.resets[0]).toBe(false)
  })

  it("unchanged on both sides → element survives, no reset", () => {
    const base = [el("a")]
    const r = mergeScene({ base, ours: base, theirs: base })
    expect(r.scene).toEqual(base)
    expect(r.resets).toEqual([])
  })
})

describe("mergeScene — identical changes merge silently", () => {
  it("ours changed + theirs changed identically (both edited) → silent, no reset", () => {
    const base = [el("a")]
    const same = el("a", { x: 5, version: 2, versionNonce: 2 })
    const r = mergeScene({ base, ours: [same], theirs: [same] })
    expect(r.scene).toEqual([same])
    expect(r.resets).toEqual([])
  })

  it("both created the same element identically → kept, no reset", () => {
    const same = el("a", { x: 5 })
    const r = mergeScene({ base: [], ours: [same], theirs: [same] })
    expect(r.scene).toEqual([same])
    expect(r.resets).toEqual([])
  })

  it("identical content with different key insertion order still compares equal", () => {
    const base = [el("a")]
    const ours = el("a", { x: 5, version: 2, versionNonce: 2 })
    // same content as ours, keys in a different insertion order
    const theirs = { versionNonce: 2, x: 5, id: "a", type: "rectangle", version: 2, y: 0, width: 100, height: 50 }
    const r = mergeScene({ base, ours: [ours], theirs: [theirs] })
    expect(r.resets).toEqual([])
    expect(r.scene).toEqual([ours])
  })
})

describe("mergeScene — edge semantics", () => {
  it("both created the same id with different content → theirs wins + edit-edit reset (documented extension)", () => {
    const ours = el("a", { x: 1 })
    const theirs = el("a", { x: 9 })
    const r = mergeScene({ base: [], ours: [ours], theirs: [theirs] })
    expect(r.scene).toEqual([theirs])
    expect(r.resets).toEqual([{ id: "a", kind: "edit-edit", oursWas: ours, kept: theirs }])
  })

  it("versionNonce bump alone counts as a change (theirs unchanged → ours wins silently)", () => {
    const base = [el("a", { version: 1, versionNonce: 1 })]
    const ours = [el("a", { version: 1, versionNonce: 2 })]
    const r = mergeScene({ base, ours, theirs: base })
    expect(r.scene).toEqual(ours)
    expect(r.resets).toEqual([])
  })

  it("both sides bump versionNonce differently → edit-edit conflict", () => {
    const base = [el("a", { version: 1, versionNonce: 1 })]
    const ours = [el("a", { version: 1, versionNonce: 2 })]
    const theirs = [el("a", { version: 1, versionNonce: 3 })]
    const r = mergeScene({ base, ours, theirs })
    expect(r.scene).toEqual(theirs)
    expect(r.resets).toHaveLength(1)
    expect(r.resets[0].kind).toBe("edit-edit")
  })

  it("a version-bump-only local edit vs a remote delete is still a conflict", () => {
    const base = [el("a", { version: 1, versionNonce: 1 })]
    const ours = [el("a", { version: 1, versionNonce: 2 })]
    const r = mergeScene({ base, ours, theirs: [] })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([
      { id: "a", kind: "edit-vs-delete", oursWas: ours[0], kept: null },
    ])
  })

  it("empty inputs → empty scene, no resets", () => {
    const r = mergeScene({ base: [], ours: [], theirs: [] })
    expect(r.scene).toEqual([])
    expect(r.resets).toEqual([])
  })

  it("does not mutate any input", () => {
    const base = [el("a"), el("b")]
    const ours = [el("a", { x: 1 }), el("c", { x: 2 })]
    const theirs = [el("b", { x: 3 }), el("a", { x: 9 })]
    const before = JSON.stringify({ base, ours, theirs })
    mergeScene({ base, ours, theirs })
    expect(JSON.stringify({ base, ours, theirs })).toBe(before)
  })
})

describe("mergeScene — reset list discipline", () => {
  it("resets only ever contain same-element-both-sides cases", () => {
    // a: ours edited (single-side)   b: theirs edited (single-side)   f: untouched
    // c: edit-edit   d: edit-vs-delete   e: delete-vs-edit
    const base = [el("a"), el("b"), el("c"), el("d"), el("e"), el("f")]
    const ours = [el("a", { x: 1, version: 2 }), el("b"), el("c", { x: 1, version: 2 }), el("d", { x: 1, version: 2 }), el("f")]
    const theirs = [el("a"), el("b", { x: 2, version: 2 }), el("c", { x: 9, version: 3 }), el("e", { x: 9, version: 3 }), el("f")]

    const r = mergeScene({ base, ours, theirs })

    // only the three both-sides-changed ids are reset
    expect(r.resets.map((rec) => rec.id)).toEqual(["c", "d", "e"])
    expect(r.resets.map((rec) => rec.kind).sort()).toEqual<ResetKind[]>(["delete-vs-edit", "edit-edit", "edit-vs-delete"])

    // single-side changes merged in, no warning
    expect(r.scene.map((el) => el.id)).toEqual(["a", "b", "c", "e", "f"])
    expect(r.scene[0]).toEqual(ours[0]) // a: ours wins silently
    expect(r.scene[1]).toEqual(theirs[1]) // b: theirs wins silently
    expect(r.scene[2]).toEqual(theirs[2]) // c: theirs wins (conflict)
    expect(r.scene[3]).toEqual(theirs[3]) // e: restored by theirs
    expect(r.scene[4]).toEqual(base[5]) // f: untouched
  })
})

describe("mergeScene — ordering", () => {
  it("keeps theirs' array order; local-only creates appended in ours' relative order", () => {
    const base = [el("a"), el("b"), el("c")]
    // theirs reorders; ours interleaves two local creates between shared elements
    const theirs = [el("c"), el("a"), el("b")]
    const ours = [el("a"), el("x"), el("b"), el("y"), el("c")]

    const r = mergeScene({ base, ours, theirs })

    expect(r.scene.map((el) => el.id)).toEqual(["c", "a", "b", "x", "y"])
    expect(r.resets).toEqual([])
  })

  it("conflict winner sits at theirs' position; local creates come after", () => {
    const base = [el("a"), el("b")]
    const ours = [el("a", { x: 1, version: 2 }), el("new", { x: 5 })]
    const theirs = [el("b", { x: 9, version: 2 }), el("a", { x: 9, version: 3 })]

    const r = mergeScene({ base, ours, theirs })

    expect(r.scene.map((el) => el.id)).toEqual(["b", "a", "new"])
    expect(r.scene[1]).toEqual(theirs[1]) // conflicted a resolved to online, in online position
    expect(r.scene[2]).toEqual(ours[1]) // local create appended
    expect(r.resets).toEqual([
      { id: "a", kind: "edit-edit", oursWas: ours[0], kept: theirs[1] },
      // ours deleted b while theirs edited it → online wins + reset (061)
      { id: "b", kind: "delete-vs-edit", kept: theirs[0] },
    ])
  })
})

describe("mergeScene — mixed scene", () => {
  it("clean merges + one conflict return both parts correctly", () => {
    const base = [el("a"), el("b"), el("c"), el("d")]
    const ours = [el("a", { x: 1, version: 2 }), el("b"), el("c", { x: 1, version: 2 }), el("d"), el("local", { x: 5 })]
    const theirs = [
      el("a"),
      el("b", { x: 2, version: 2 }),
      el("c", { x: 9, version: 3 }),
      el("d"),
      el("remote", { x: 6 }),
    ]

    const r = mergeScene({ base, ours, theirs })

    // theirs' order + remote create in place, local create appended
    expect(r.scene.map((el) => el.id)).toEqual(["a", "b", "c", "d", "remote", "local"])
    expect(r.scene[0]).toEqual(ours[0]) // a: ours wins silently
    expect(r.scene[1]).toEqual(theirs[1]) // b: theirs wins silently
    expect(r.scene[2]).toEqual(theirs[2]) // c: conflict → online wins
    expect(r.scene[3]).toEqual(base[3]) // d: untouched
    expect(r.scene[4]).toEqual(theirs[4]) // remote create
    expect(r.scene[5]).toEqual(ours[4]) // local create

    // exactly the one conflict
    expect(r.resets).toEqual([
      { id: "c", kind: "edit-edit", oursWas: ours[2], kept: theirs[2] },
    ])
  })
})
