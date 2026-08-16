import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, deriveColor, seedToPkcs8 } from "./wire"
import type { ClientMessage, HelloPayload, Member, RelayMessage } from "./wire"

const member: Member = {
  profileId: "profile-1",
  name: "Ada",
  color: { background: "#ffc9c9", stroke: "#e03131" },
  connId: "conn-1",
}

const hello: HelloPayload = {
  profileId: "profile-1",
  name: "Ada",
  color: { background: "#ffc9c9", stroke: "#e03131" },
  privacy: "team",
  room: "shareId-abc",
  admit: { org: "acme", sig: "c2lnbmF0dXJl" },
  key: "cHVibGljLWtleQ",
}

const clientMessages: ClientMessage[] = [
  { v: 1, t: "hello", p: hello },
  { v: 1, t: "seed", p: { scene: [{ type: "rectangle", id: "r1" }], seq: 1 } },
  { v: 1, t: "scene", p: { elements: [{ type: "rectangle", id: "r1" }], seq: 2 } },
  { v: 1, t: "pointer", p: { x: 10, y: 20, tool: "laser" } },
  { v: 1, t: "pointer", p: { x: 10, y: 20, tool: "pointer", button: "down" } },
  { v: 1, t: "file-put", p: { fileId: "f-1", mimeType: "image/png", size: 1234 } },
  { v: 1, t: "file-get", p: { fileId: "f-1" } },
  { v: 1, t: "chunk", p: { id: "chunk-1", n: 3, i: 0, d: "fragment" } },
]

const relayMessages: RelayMessage[] = [
  {
    v: 1,
    t: "welcome",
    p: {
      profileId: "profile-1",
      connId: "conn-1",
      room: "shareId-abc",
      privacy: "team",
      snapshotAvailable: false,
      peers: [member],
    },
  },
  { v: 1, t: "peer", p: { kind: "join", member } },
  { v: 1, t: "peer", p: { kind: "leave" } },
  { v: 1, t: "scene", p: { elements: [{ type: "rectangle", id: "r1" }], seq: 2 }, from: "conn-2" },
  { v: 1, t: "pointer", p: { x: 5, y: 6, tool: "pointer", button: "up" }, from: "conn-2" },
  { v: 1, t: "file", p: { fileId: "f-1", mimeType: "image/png" } },
  { v: 1, t: "file-available", p: { fileId: "f-1", mimeType: "image/png", size: 1234 } },
  { v: 1, t: "error", p: { code: "FILE_NOT_FOUND", reason: "blob not stored", fatal: false } },
  { v: 1, t: "error", p: { code: "ADMISSION_INVALID", reason: "bad signature", fatal: true } },
  { v: 1, t: "chunk", p: { id: "chunk-1", n: 1, i: 0, d: "fragment" } },
]

describe("wire envelope", () => {
  it("PROTOCOL_VERSION is fixed at 1", () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it("every ClientMessage shape round-trips through the {v,t,p} envelope", () => {
    expect(clientMessages.length).toBeGreaterThan(0)
    for (const msg of clientMessages) {
      const rt = JSON.parse(JSON.stringify(msg)) as ClientMessage
      expect(rt).toEqual(msg)
      expect(rt.v).toBe(1)
      expect(rt.t).toBe(msg.t)
      expect(rt.p).toBeDefined()
    }
  })

  it("every RelayMessage shape round-trips through the {v,t,p} envelope", () => {
    expect(relayMessages.length).toBeGreaterThan(0)
    for (const msg of relayMessages) {
      const rt = JSON.parse(JSON.stringify(msg)) as RelayMessage
      expect(rt).toEqual(msg)
      expect(rt.v).toBe(1)
      expect(rt.t).toBe(msg.t)
      expect(rt.p).toBeDefined()
    }
  })

  it("relayed scene/pointer carry `from` at envelope level, never inside p", () => {
    for (const msg of relayMessages) {
      if (msg.t === "scene" || msg.t === "pointer") {
        expect(msg.from).toBe("conn-2")
        expect("from" in msg.p).toBe(false)
        expect(Object.keys(msg.p).sort()).toEqual(
          msg.t === "scene" ? ["elements", "seq"] : ["button", "tool", "x", "y"],
        )
      }
    }
  })

  // "snapshot" is retired from the minted set (058 §1.3) — not a RelayMessage member.
  // @ts-expect-error snapshot is not a minted message type
  const retired: RelayMessage = { v: 1, t: "snapshot", p: { elements: [], seq: 1 } }
  void retired
})

describe("deriveColor", () => {
  it("is deterministic for the same profileId", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000"
    expect(deriveColor(id)).toBe(deriveColor(id))
  })

  it("is stable: known answers never change (055 native rule)", () => {
    // hand-verifiable: java hashCode("abc") = 96354 → 96354 % 37 = 6 → hue 60
    expect(deriveColor("abc")).toBe("hsl(60, 100%, 83%)")
    expect(deriveColor("123e4567-e89b-12d3-a456-426614174000")).toBe("hsl(-10, 100%, 83%)")
  })

  it("returns hsl(hue, 100%, 83%) for arbitrary ids", () => {
    for (const id of ["", "x", "profile-1", "a".repeat(1000)]) {
      expect(deriveColor(id)).toMatch(/^hsl\(-?\d+, 100%, 83%\)$/)
    }
  })
})

describe("seedToPkcs8", () => {
  const DER_PREFIX = [
    0x30, 0x2e, 0x02, 0x01, 0x00,
    0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20,
  ]

  it("prepends the 16-byte DER prefix to a 32-byte seed (48 bytes total)", () => {
    const seed = new Uint8Array(32).fill(7)
    const pkcs8 = seedToPkcs8(seed)
    expect(pkcs8).toHaveLength(48)
    expect(Array.from(pkcs8.slice(0, 16))).toEqual(DER_PREFIX)
    expect(Array.from(pkcs8.slice(16))).toEqual(Array.from(seed))
  })

  it("matches the known DER encoding for a zero seed", () => {
    const pkcs8 = seedToPkcs8(new Uint8Array(32))
    const hex = Array.from(pkcs8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    expect(hex).toBe("302e020100300506032b657004220420" + "00".repeat(32))
  })

  it("does not mutate the input seed", () => {
    const seed = new Uint8Array([1, 2, 3])
    seedToPkcs8(seed)
    expect(Array.from(seed)).toEqual([1, 2, 3])
  })
})
