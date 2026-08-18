/**
 * collab-relay room DO tests (task 038): welcome/peer deltas, first-seed-wins,
 * scene relay + `from` stamping, exact-duplicate suppression, chunked snapshot
 * store/serve, room.storage hibernation round-trip.
 *
 * RoomState is driven through injected fakes — no PartyKit runtime.
 */
import { describe, expect, it } from "vitest"
import { ChunkAssembler, serializeEnvelope } from "collab-core"
import type { ChunkFrame, HelloPayload, Member, WireEnvelope } from "collab-core"
import { MAX_FRAME_BYTES, ROOM_NAME_KEY, RoomState, SNAPSHOT_KEY, parseSnapshotRecord } from "./room"
import type { RoomHooks, RoomStorage } from "./room"
// ─── harness ─────────────────────────────────────────────────────────────────

class FakeStorage implements RoomStorage {
  readonly map = new Map<string, unknown>()
  async get(key: string): Promise<unknown> {
    return this.map.get(key)
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }
}

/** Loose wire-frame view for assertions. */
interface WireFrame {
  v: number
  t: string
  p: any
  from?: string
}

interface Harness {
  room: RoomState
  storage: FakeStorage
  /** frames delivered via hooks.send (per connId) */
  outbox: Map<string, WireFrame[]>
  /** frames delivered via hooks.broadcast (fan-out; except = excluded connId) */
  broadcasts: { frame: WireFrame; except?: string }[]
}

function makeHarness(roomId = "room-abc123", storage = new FakeStorage()): Harness {
  const outbox = new Map<string, WireFrame[]>()
  const broadcasts: { frame: WireFrame; except?: string }[] = []
  const hooks: RoomHooks = {
    send(connId, frame) {
      const list = outbox.get(connId) ?? []
      list.push(JSON.parse(frame) as WireFrame)
      outbox.set(connId, list)
    },
    broadcast(frame, except) {
      broadcasts.push({ frame: JSON.parse(frame) as WireFrame, except })
    },
  }
  return { room: new RoomState({ roomId, hooks, storage }), storage, outbox, broadcasts }
}

/** Every frame a conn would actually receive: its sends + broadcasts not excluding it. */
function framesTo(h: Harness, connId: string): WireFrame[] {
  return [...(h.outbox.get(connId) ?? []), ...h.broadcasts.filter((b) => b.except !== connId).map((b) => b.frame)]
}

function baseHello(overrides: Partial<HelloPayload> = {}): HelloPayload {
  return {
    profileId: "install-uuid-1",
    name: "Ada",
    color: { background: "#ffffff", stroke: "#000000" },
    privacy: "team",
    room: "room-abc123",
    admit: { org: "acme", sig: "sig" },
    key: "member-key-1",
    ...overrides,
  }
}

function member(profileId: string, name: string, connId: string): Member {
  return { profileId, name, color: { background: "#ffffff", stroke: "#000000" }, connId }
}

const HELLO_2 = baseHello({ profileId: "install-uuid-2", name: "Bob" })
const MEMBER_2 = member("install-uuid-2", "Bob", "conn-2")

// ─── welcome + roster ────────────────────────────────────────────────────────

describe("RoomState join/leave", () => {
  it("welcome echoes the hello, snapshotAvailable=false, peers incl. the joiner; a second join broadcasts peer{join} to the first only", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    const w1 = framesTo(h, "conn-1").find((f) => f.t === "welcome")!
    expect(w1).toEqual({
      v: 1,
      t: "welcome",
      p: {
        profileId: "install-uuid-1",
        connId: "conn-1",
        room: "room-abc123",
        privacy: "team",
        snapshotAvailable: false,
        roomName: null,
        peers: [member("install-uuid-1", "Ada", "conn-1")],
      },
    })

    await h.room.join("conn-2", HELLO_2)
    // peer{join} broadcast to others, sender excluded (049 §1)
    expect(h.broadcasts.map((b) => b.frame)).toEqual([
      { v: 1, t: "peer", p: { kind: "join", member: member("install-uuid-1", "Ada", "conn-1") } },
      { v: 1, t: "peer", p: { kind: "join", member: MEMBER_2 } },
    ])
    expect(h.broadcasts[1].except).toBe("conn-2")
    // the first member sees the delta; the joiner does not see its own join
    expect(framesTo(h, "conn-1").filter((f) => f.t === "peer")).toEqual([
      { v: 1, t: "peer", p: { kind: "join", member: MEMBER_2 } },
    ])
    expect(framesTo(h, "conn-2").filter((f) => f.t === "peer" && f.p.member?.connId === "conn-2")).toEqual([])
    // the joiner's own welcome lists the full roster
    const w2 = framesTo(h, "conn-2").find((f) => f.t === "welcome")!
    expect(w2.p.peers).toEqual([member("install-uuid-1", "Ada", "conn-1"), MEMBER_2])
    expect([...h.room.members.keys()]).toEqual(["conn-1", "conn-2"])
  })

  it("leave broadcasts peer{leave} to the remaining members, drops the member; unknown leaves are no-ops", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    h.room.leave("conn-2")
    expect(framesTo(h, "conn-1").filter((f) => f.t === "peer")).toEqual([
      { v: 1, t: "peer", p: { kind: "join", member: MEMBER_2 } },
      { v: 1, t: "peer", p: { kind: "leave", member: MEMBER_2 } },
    ])
    expect([...h.room.members.keys()]).toEqual(["conn-1"])
    const before = h.broadcasts.length
    h.room.leave("conn-2") // already gone — no-op
    h.room.leave("conn-99") // never joined — no-op
    expect(h.broadcasts.length).toBe(before)
  })
})

// ─── seeding (first-seed-wins) ───────────────────────────────────────────────

describe("RoomState seeding", () => {
  it("first seed is stored and broadcast as scene to ALL (sender included); later seeds get SEED_REJECTED non-fatal", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "a", type: "rectangle" }], seq: 1 } }))

    // broadcast as scene to ALL — the sender's fresh view comes from this broadcast (049 §2)
    const scene = { v: 1, t: "scene", p: { elements: [{ id: "a", type: "rectangle" }], seq: 1 }, from: "conn-1" }
    expect(framesTo(h, "conn-1").filter((f) => f.t === "scene")).toEqual([scene])
    expect(framesTo(h, "conn-2").filter((f) => f.t === "scene")).toEqual([scene])
    expect(h.broadcasts.filter((b) => b.frame.t === "scene")[0].except).toBeUndefined()
    // stored pre-stamp (no `from`), unchunked
    const rec = parseSnapshotRecord(await h.storage.get(SNAPSHOT_KEY))
    expect(rec?.envelope).toEqual({ v: 1, t: "scene", p: { elements: [{ id: "a", type: "rectangle" }], seq: 1 } })
    expect(rec?.chunkId).toBeUndefined()

    // second seed → SEED_REJECTED (non-fatal); the loser still received the winner's broadcast (asserted above)
    await h.room.message("conn-2", JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "z" }], seq: 99 } }))
    const err = framesTo(h, "conn-2").filter((f) => f.t === "error").at(-1)!
    expect(err.p).toEqual({ code: "SEED_REJECTED", reason: expect.any(String), fatal: false })
    expect(parseSnapshotRecord(await h.storage.get(SNAPSHOT_KEY))?.envelope?.p.seq).toBe(1)
    expect(h.room.snapshot?.envelope?.p.seq).toBe(1)
  })
})

// ─── scene relay + dup suppression ───────────────────────────────────────────

describe("RoomState scene relay", () => {
  it("relays scene to others with envelope-level from, sender excluded; snapshot updates latest-wins", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "e1" }], seq: 5 } }))
    expect(framesTo(h, "conn-2").filter((f) => f.t === "scene")).toEqual([
      { v: 1, t: "scene", p: { elements: [{ id: "e1" }], seq: 5 }, from: "conn-1" },
    ])
    expect(framesTo(h, "conn-1").filter((f) => f.t === "scene")).toEqual([]) // sender excluded
    expect(h.room.snapshot?.envelope?.p.seq).toBe(5)
    // a newer scene from the other member supersedes (latest wins)
    await h.room.message("conn-2", JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "e1" }, { id: "e2" }], seq: 6 } }))
    expect(h.room.snapshot?.envelope?.p.seq).toBe(6)
  })

  it("rejects an older scene from the same sender even when its content differs", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "new" }], seq: 8 } }))
    const broadcastsBefore = h.broadcasts.length
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "old" }], seq: 7 } }))
    expect(h.broadcasts.length).toBe(broadcastsBefore)
    expect(h.room.snapshot?.envelope?.p).toEqual({ elements: [{ id: "new" }], seq: 8 })
  })

  it("an exact-duplicate scene (same seq + same elements) is neither re-stored nor re-broadcast; a newer scene relays", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    const scene = JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "e1", text: "hi" }], seq: 7 } })
    await h.room.message("conn-1", scene)
    const broadcastsBefore = h.broadcasts.length
    await h.room.message("conn-2", scene) // byte-identical duplicate
    expect(h.broadcasts.length).toBe(broadcastsBefore) // no new broadcast
    expect(h.room.snapshot?.envelope?.p.seq).toBe(7) // store untouched
    expect(parseSnapshotRecord(await h.storage.get(SNAPSHOT_KEY))?.envelope?.p.seq).toBe(7)
    // a different scene still relays
    await h.room.message("conn-2", JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "e1", text: "hi" }, { id: "e2" }], seq: 8 } }))
    const last = framesTo(h, "conn-1").filter((f) => f.t === "scene").at(-1)!
    expect(last.p.seq).toBe(8)
    expect(last.from).toBe("conn-2")
  })
})

// ─── chunked snapshot ────────────────────────────────────────────────────────

describe("RoomState chunked snapshot", () => {
  it("a >200KB scene is stored as its chunk set and served as chunk frames a late joiner reassembles to the original", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    const elements = Array.from({ length: 4000 }, (_, i) => ({ type: "text", id: `el-${i}`, text: "x".repeat(64) }))
    const env: WireEnvelope = { v: 1, t: "scene", p: { elements, seq: 3 } }
    const ser = serializeEnvelope(env)
    expect(ser.chunked).toBe(true)
    expect(ser.frames.length).toBeGreaterThan(1)
    // upload as chunks — the receive path reassembles transparently
    for (const frame of ser.frames) await h.room.message("conn-1", JSON.stringify(frame))
    // stored as chunk frames in separate keys (058 §1.3: envelope omitted for storage)
    const meta = await h.storage.get(`${SNAPSHOT_KEY}:meta`) as { chunkId: string; frameCount: number }
    expect(meta).toBeDefined()
    expect(meta.chunkId).toBeDefined()
    const frames = []
    for (let i = 0; i < meta.frameCount; i++) {
      frames.push(await h.storage.get(`${SNAPSHOT_KEY}:frame:${i}`))
    }
    expect(frames.length).toBe(ser.frames.length)
    expect(frames.every((f: any) => f.p.id === meta.chunkId)).toBe(true)
    // the live relay went out as chunk frames to the other members, sender excluded
    const live = h.broadcasts.filter((b) => b.frame.t === "chunk")
    expect(live.length).toBe(frames.length)
    expect(live.every((b) => b.except === "conn-1")).toBe(true)
    expect(live.every((b) => b.frame.from === "conn-1")).toBe(true)
    // a late joiner is served the stored chunk set (welcome → snapshotAvailable → chunks)
    await h.room.join("conn-2", HELLO_2)
    const w2 = framesTo(h, "conn-2").find((f) => f.t === "welcome")!
    expect(w2.p.snapshotAvailable).toBe(true)
    const served = h.outbox.get("conn-2")!.filter((f) => f.t === "chunk")
    expect(served.map((f) => f.p.id)).toEqual(Array(frames.length).fill(meta.chunkId))
    expect(served.every((f) => f.from === undefined)).toBe(true)
    // reassemble the served frames → the original envelope
    const asm = new ChunkAssembler()
    let out: unknown = null
    for (const frame of served) {
      const r = asm.feed(frame as unknown as ChunkFrame)
      if (r !== null) out = r
    }
    expect(out).toEqual(env)
  })
})

// ─── hibernation / room.storage ──────────────────────────────────────────────

describe("RoomState hibernation (room.storage)", () => {
  it("snapshot survives state recreation; the roster starts empty; storage is NOT cleared on leave", async () => {
    const storage = new FakeStorage()
    const h1 = makeHarness("room-abc123", storage)
    await h1.room.join("conn-1", baseHello())
    await h1.room.message("conn-1", JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "s1" }], seq: 1 } }))
    h1.room.leave("conn-1")
    expect(h1.room.members.size).toBe(0)
    // 052 §3: room.storage is left to DO eviction — never cleared on leave
    expect(await storage.get(SNAPSHOT_KEY)).toBeDefined()

    // wake: a fresh RoomState over the same room.storage (DO hibernation dropped in-memory state)
    const h2 = makeHarness("room-abc123", storage)
    expect(h2.room.members.size).toBe(0) // roster is session state — empty after wake
    await h2.room.join("conn-9", baseHello({ profileId: "install-uuid-9", name: "Zoe" }))
    const w = framesTo(h2, "conn-9").find((f) => f.t === "welcome")!
    expect(w.p.snapshotAvailable).toBe(true)
    expect(w.p.peers).toEqual([member("install-uuid-9", "Zoe", "conn-9")]) // only the new joiner
    // the stored snapshot is served as a single pre-stamp frame (no `from` on stored units, 058 §2.2)
    const served = framesTo(h2, "conn-9").find((f) => f.t === "scene")!
    expect(served).toEqual({ v: 1, t: "scene", p: { elements: [{ id: "s1" }], seq: 1 } })
  })

  it("a corrupted stored snapshot is deleted and reported absent (059 §4 serve-fail semantics)", async () => {
    const h1 = makeHarness()
    await h1.room.join("conn-1", baseHello())
    await h1.room.message("conn-1", JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "s1" }], seq: 1 } }))
    await h1.storage.put(SNAPSHOT_KEY, { envelope: { v: 1, t: "scene", p: { elements: "corrupted", seq: 1 } } })

    const h2 = makeHarness("room-abc123", h1.storage)
    await h2.room.join("conn-2", HELLO_2)
    const w = framesTo(h2, "conn-2").find((f) => f.t === "welcome")!
    expect(w.p.snapshotAvailable).toBe(false)
    expect(await h2.storage.get(SNAPSHOT_KEY)).toBeUndefined() // deleted — the room can re-seed
  })
})

// ─── pointer + misc routing ──────────────────────────────────────────────────

describe("RoomState pointer & misc routing", () => {
  it("pointer relays with from, sender excluded, and is never stored", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "pointer", p: { x: 12.5, y: -3, tool: "laser", button: "down" } }))
    expect(framesTo(h, "conn-2").filter((f) => f.t === "pointer")).toEqual([
      { v: 1, t: "pointer", p: { x: 12.5, y: -3, tool: "laser", button: "down" }, from: "conn-1" },
    ])
    expect(framesTo(h, "conn-1").filter((f) => f.t === "pointer")).toEqual([])
    expect(h.room.snapshot).toBeNull()
    expect(await h.storage.get(SNAPSHOT_KEY)).toBeUndefined()
  })

  it("a post-welcome hello and unknown message types are dropped", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    const sendsBefore = h.outbox.get("conn-1")!.length
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "hello", p: baseHello() }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "bogus", p: {} }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "file-put", p: { fileId: "f", mimeType: "x", size: 1 } }))
    expect(h.outbox.get("conn-1")!.length).toBe(sendsBefore) // nothing new sent
    expect(h.broadcasts.length).toBe(1) // only the first join's peer broadcast
  })

  it("malformed frames and >1MB single frames get CHUNK_INVALID (non-fatal) without any broadcast", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.message("conn-1", "not json")
    await h.room.message("conn-1", JSON.stringify({ v: 2, t: "scene", p: {} }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "scene", p: { elements: ["x".repeat(MAX_FRAME_BYTES + 16)], seq: 1 } }))
    const errors = h.outbox.get("conn-1")!.filter((f) => f.t === "error")
    expect(errors).toHaveLength(3)
    for (const e of errors) expect(e.p).toMatchObject({ code: "CHUNK_INVALID", fatal: false })
    expect(h.broadcasts.length).toBe(1) // peer join only
    expect(h.room.snapshot).toBeNull()
  })
})

// ─── room name + probe (ADR 0004) ───────────────────────────────────────────

describe("RoomState room-name + probe", () => {
  it("welcome carries the stored roomName; a rename stores + broadcasts with the renamer's connId (LWW by arrival)", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    const w1 = framesTo(h, "conn-1").find((f) => f.t === "welcome")!
    expect(w1.p.roomName).toBeNull()

    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "  Q3 planning  " } }))
    // stored + broadcast (sender excluded) with relay-stamped from
    expect(await h.storage.get(ROOM_NAME_KEY)).toBe("Q3 planning")
    expect(h.broadcasts.at(-1)).toEqual({
      frame: { v: 1, t: "room-name", p: { name: "Q3 planning" }, from: "conn-1" },
      except: "conn-1",
    })

    // late joiner's welcome carries the name
    await h.room.join("conn-2", HELLO_2)
    const w2 = framesTo(h, "conn-2").find((f) => f.t === "welcome")!
    expect(w2.p.roomName).toBe("Q3 planning")
  })

  it("a rename to the current name is a no-op (not re-stored, not re-broadcast); an empty or >100-char name gets a CHUNK_INVALID receipt", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    const broadcastsBefore = h.broadcasts.length

    // identical rename — byte-identical no-op (059 §6 duplicate-suppression precedent)
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "Q3" } }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: " Q3 " } }))
    expect(h.broadcasts.length).toBe(broadcastsBefore + 1) // first rename only

    // invalid names — rejected with a non-fatal error receipt, nothing broadcast
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "   " } }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "x".repeat(101) } }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: 42 } }))
    const errors = h.outbox.get("conn-1")!.filter((f) => f.t === "error")
    expect(errors).toHaveLength(3)
    for (const e of errors) expect(e.p).toMatchObject({ code: "CHUNK_INVALID", fatal: false })
    expect(h.broadcasts.length).toBe(broadcastsBefore + 1)
    expect(await h.storage.get(ROOM_NAME_KEY)).toBe("Q3")
  })

  it("rename broadcasts reach the other member; only members may rename (roster gate)", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.join("conn-2", HELLO_2)
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "Sprint 9" } }))
    expect(framesTo(h, "conn-2").filter((f) => f.t === "room-name")).toEqual([
      { v: 1, t: "room-name", p: { name: "Sprint 9" }, from: "conn-1" },
    ])

    // unknown connection (not in roster) — dropped before routing
    const before = h.broadcasts.length
    await h.room.message("ghost", JSON.stringify({ v: 1, t: "room-name", p: { name: "Nope" } }))
    expect(h.broadcasts.length).toBe(before)
  })

  it("probe answers {roomName, snapshotAvailable, peerCount} without joining the roster and without broadcasting", async () => {
    const h = makeHarness()
    await h.room.join("conn-1", baseHello())
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "r1" }], seq: 1 } }))
    await h.room.message("conn-1", JSON.stringify({ v: 1, t: "room-name", p: { name: "Q3" } }))
    await h.room.join("conn-2", HELLO_2)

    const before = h.broadcasts.length
    expect(await h.room.probe()).toEqual({
      roomName: "Q3",
      snapshotAvailable: true,
      peerCount: 2,
    })
    // no member-visible side effect: no joins, no broadcasts
    expect(h.broadcasts.length).toBe(before)
    expect([...h.room.members.keys()]).toEqual(["conn-1", "conn-2"])
  })

  it("probe on a hibernated room (fresh state over stored storage) answers from room.storage with peerCount 0", async () => {
    const storage = new FakeStorage()
    storage.map.set(ROOM_NAME_KEY, "Old name")
    storage.map.set(SNAPSHOT_KEY, { envelope: { v: 1, t: "scene", p: { elements: [{ id: "x" }], seq: 7 } } })
    const h = makeHarness("room-abc123", storage)
    expect(await h.room.probe()).toEqual({
      roomName: "Old name",
      snapshotAvailable: true,
      peerCount: 0,
    })
    // the probe's own loads prime the wake path so a subsequent join doesn't re-read
    expect(await h.storage.get(ROOM_NAME_KEY)).toBe("Old name")
  })
})
