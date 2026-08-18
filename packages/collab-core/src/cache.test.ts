// Session cache + room list persistence tests against a real IndexedDB
// implementation (fake-indexeddb). Covers Wayfinder 048 (rooms store), 053
// (persistent session cache) and 061 (base scene retained for the three-way
// merge).
import "fake-indexeddb/auto"
import { openDB } from "idb"
import { describe, expect, it } from "vitest"
import {
  clearSession,
  deleteRoom,
  listRooms,
  loadSession,
  saveRoomMeta,
  saveSession,
} from "./cache"
import type { CollabScene, RoomEntry } from "./cache"

function scene(marker: string): CollabScene {
  return {
    elements: [{ type: "rectangle", id: `rect-${marker}` }],
    appState: { viewBackgroundColor: "#ffffff" },
  }
}

function roomEntry(overrides: Partial<RoomEntry> & { id: string }): RoomEntry {
  return {
    label: "Design review",
    labelKind: "named" as const,
    tier: "team",
    pinned: false,
    lastJoined: 1000,
    invite: `excali-collab:v1:room:${overrides.id}`,
    ...overrides,
  }
}

describe("session cache (collab-session store)", () => {
  it("round-trips edited + base scenes", async () => {
    await saveSession("share-rt", {
      edited: scene("edited"),
      base: scene("base"),
    })

    const session = await loadSession("share-rt")
    expect(session).toBeDefined()
    expect(session?.roomId).toBe("share-rt")
    expect(session?.edited.elements).toEqual([{ type: "rectangle", id: "rect-edited" }])
    expect(session?.edited.appState).toEqual({ viewBackgroundColor: "#ffffff" })
    expect(session?.base?.elements).toEqual([{ type: "rectangle", id: "rect-base" }])
    expect(session?.updatedAt).toBeGreaterThan(0)
  })

  it("round-trips a session with base null (nothing synced yet)", async () => {
    await saveSession("share-nobase", { edited: scene("e"), base: null })

    const session = await loadSession("share-nobase")
    expect(session?.base).toBeNull()
  })

  it("keeps sessions separate per room and returns undefined for unknown rooms", async () => {
    await saveSession("share-a", { edited: scene("a"), base: null })
    await saveSession("share-b", { edited: scene("b"), base: null })

    expect((await loadSession("share-a"))?.edited.elements).toEqual([
      { type: "rectangle", id: "rect-a" },
    ])
    expect((await loadSession("share-b"))?.edited.elements).toEqual([
      { type: "rectangle", id: "rect-b" },
    ])
    expect(await loadSession("share-missing")).toBeUndefined()
  })

  it("overwrites an existing session for the same room", async () => {
    await saveSession("share-ov", { edited: scene("v1"), base: null })
    await saveSession("share-ov", { edited: scene("v2"), base: scene("v1") })

    const session = await loadSession("share-ov")
    expect(session?.edited.elements).toEqual([{ type: "rectangle", id: "rect-v2" }])
    // base now carries the previously-edited scene (last synced semantics)
    expect(session?.base?.elements).toEqual([{ type: "rectangle", id: "rect-v1" }])

    // the put replaced the record — no duplicates in the store
    const db = await openDB("excali", 4)
    const all = await db.getAll("collab-session")
    expect(all.filter((s) => s.roomId === "share-ov")).toHaveLength(1)
  })

  it("clearSession drops only the target room's cache", async () => {
    await saveSession("share-clr", { edited: scene("e"), base: null })
    await saveSession("share-keep", { edited: scene("k"), base: null })

    await clearSession("share-clr")

    expect(await loadSession("share-clr")).toBeUndefined()
    expect(await loadSession("share-keep")).toBeDefined()
  })
})

describe("room list (rooms store)", () => {
  it("saves, lists and deletes room metadata", async () => {
    await saveRoomMeta(roomEntry({ id: "share-r1", label: "Design review" }))
    await saveRoomMeta(
      roomEntry({ id: "share-r2", label: "Private room", tier: "private", pinned: true, lastJoined: 2000 }),
    )

    const rooms = await listRooms()
    expect(rooms).toHaveLength(2)
    // most recently joined first
    expect(rooms[0].id).toBe("share-r2")
    expect(rooms[0].tier).toBe("private")
    expect(rooms[0].pinned).toBe(true)
    expect(rooms[1].id).toBe("share-r1")
    expect(rooms[1].invite).toBe("excali-collab:v1:room:share-r1")

    await deleteRoom("share-r1")

    const after = await listRooms()
    expect(after.map((r) => r.id)).toEqual(["share-r2"])
  })

  it("stores the optional server fingerprint", async () => {
    await saveRoomMeta(roomEntry({ id: "share-r3", fp: "fp-abc123" }))

    const rooms = await listRooms()
    expect(rooms.find((r) => r.id === "share-r3")?.fp).toBe("fp-abc123")
  })

  it("updates an existing entry in place (no duplicates)", async () => {
    await saveRoomMeta(roomEntry({ id: "share-r4", pinned: false, lastJoined: 1000 }))
    await saveRoomMeta(roomEntry({ id: "share-r4", pinned: true, lastJoined: 3000, label: "Renamed" }))

    const rooms = await listRooms()
    const matches = rooms.filter((r) => r.id === "share-r4")
    expect(matches).toHaveLength(1)
    expect(matches[0].pinned).toBe(true)
    expect(matches[0].label).toBe("Renamed")
    expect(matches[0].lastJoined).toBe(3000)
  })

  it("deleteRoom does not touch the session cache", async () => {
    await saveRoomMeta(roomEntry({ id: "share-r5" }))
    await saveSession("share-r5", { edited: scene("e"), base: null })

    await deleteRoom("share-r5")

    expect((await listRooms()).map((r) => r.id)).not.toContain("share-r5")
    expect(await loadSession("share-r5")).toBeDefined()
  })

  it("labelKind provenance round-trips (ADR 0004)", async () => {
    await saveRoomMeta(roomEntry({ id: "share-r6", labelKind: "auto" }))
    await saveRoomMeta(roomEntry({ id: "share-r7", labelKind: "named" }))
    const rooms = await listRooms()
    expect(rooms.find((r) => r.id === "share-r6")?.labelKind).toBe("auto")
    expect(rooms.find((r) => r.id === "share-r7")?.labelKind).toBe("named")
  })
})
