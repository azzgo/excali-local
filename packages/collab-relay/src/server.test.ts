/**
 * collab-relay admission tests (task 037).
 *
 * Real Ed25519 keypairs via WebCrypto (node 25 supports
 * `crypto.subtle.generateKey({ name: "Ed25519" })`); the org seed signs
 * the 057 §3 canonical hello string via `helloCanon` (raw subtle.sign —
 * committed collab-core exports no hello signer helper).
 */
import { describe, expect, it, vi } from "vitest"
import { bytesToB64url } from "collab-core"
import type { HelloPayload } from "collab-core"
import type { Connection, ConnectionContext, Room } from "partykit/server"
import {
  ADMISSION_REJECT_REASON,
  admitHello,
  createRelayServer,
  deriveShareId,
  helloCanon,
  parseFirstMessage,
  parseRelayEnv,
} from "./server"
import type { RelayEnv } from "./server"

// ─── helpers ────────────────────────────────────────────────────────────────

interface Keypair {
  privateKey: CryptoKey
  publicKeyB64url: string
}

async function makeKeypair(): Promise<Keypair> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyB64url: bytesToB64url(pub) }
}

/** Sign the 057 §3 canonical hello string with the org seed (raw subtle.sign). */
async function signHello(hello: HelloPayload, privateKey: CryptoKey): Promise<HelloPayload> {
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(helloCanon(hello))),
  )
  return { ...hello, admit: { ...hello.admit, sig: bytesToB64url(sig) } }
}

function baseHello(overrides: Partial<HelloPayload> = {}): HelloPayload {
  return {
    profileId: "install-uuid-1",
    name: "Ada",
    color: { background: "#ffffff", stroke: "#000000" },
    privacy: "team",
    room: "room-abc123",
    admit: { org: "acme", sig: "" },
    key: "member-key-1",
    ...overrides,
  }
}

function pubkeysEnv(org: string, pubkeys: string[]): RelayEnv {
  return { ORG_PUBKEYS: JSON.stringify([{ org, pubkeys }]) }
}

function secretsEnv(org: string, secret: string): RelayEnv {
  return { ORG_SECRETS: JSON.stringify({ [org]: secret }) }
}

// ─── helloCanon (057 §3) ────────────────────────────────────────────────────

describe("helloCanon", () => {
  it("rebuilds the 057 §3 canonical string exactly", () => {
    expect(helloCanon(baseHello())).toBe(
      'excali-collab/v1:hello:{"v":1,"t":"hello","p":{"profileId":"install-uuid-1","name":"Ada","color":{"background":"#ffffff","stroke":"#000000"},"privacy":"team","room":"room-abc123","org":"acme","key":"member-key-1"}}',
    )
  })

  it("is independent of admit.sig and hoists admit.org to org", () => {
    const signed = { ...baseHello(), admit: { org: "acme", sig: "some-sig-value" } }
    expect(helloCanon(signed)).toBe(helloCanon(baseHello()))
  })
})

// ─── admitHello ─────────────────────────────────────────────────────────────

describe("admitHello — ORG_PUBKEYS (059 §3 v2)", () => {
  it("admits a hello whose sig verifies against the org's registered pk", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    await expect(admitHello(hello, pubkeysEnv("acme", [kp.publicKeyB64url]), "room-abc123")).resolves.toEqual({
      ok: true,
      hello,
    })
  })

  it("rejects an unknown org with ADMISSION_INVALID", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    const result = await admitHello(hello, pubkeysEnv("other-org", [kp.publicKeyB64url]), "room-abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ADMISSION_INVALID")
      expect(result.reason).toContain('unknown org "acme"')
    }
  })

  it("rotation grace: any registered pk admits — a sig matching the second pk passes after the first fails", async () => {
    const stale = await makeKeypair()
    const current = await makeKeypair()
    const env = pubkeysEnv("acme", [stale.publicKeyB64url, current.publicKeyB64url])
    const hello = await signHello(baseHello(), current.privateKey)
    await expect(admitHello(hello, env, "room-abc123")).resolves.toEqual({ ok: true, hello })
  })

  it("rejects a sig from the stale key once it is dropped from ORG_PUBKEYS", async () => {
    const stale = await makeKeypair()
    const current = await makeKeypair()
    const env = pubkeysEnv("acme", [current.publicKeyB64url]) // old pk removed after the grace window
    const hello = await signHello(baseHello(), stale.privateKey)
    const result = await admitHello(hello, env, "room-abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ADMISSION_INVALID")
      expect(result.reason).toBe(ADMISSION_REJECT_REASON) // 057 §5 verbatim rotation hint
    }
  })

  it("rejects a sig with the wrong member key / garbage sig", async () => {
    const kp = await makeKeypair()
    const other = await makeKeypair()
    const hello = await signHello(baseHello(), other.privateKey)
    const result = await admitHello(hello, pubkeysEnv("acme", [kp.publicKeyB64url]), "room-abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("ADMISSION_INVALID")
  })
})

describe("admitHello — legacy ORG_SECRETS (052 §2 fallback)", () => {
  it("admits when hello.admit.sig equals the registered secret", async () => {
    const hello = baseHello({ admit: { org: "acme", sig: "s3cr3t-value" } })
    await expect(admitHello(hello, secretsEnv("acme", "s3cr3t-value"), "room-abc123")).resolves.toEqual({
      ok: true,
      hello,
    })
  })

  it("rejects a wrong secret with ADMISSION_INVALID", async () => {
    const hello = baseHello({ admit: { org: "acme", sig: "wrong-secret" } })
    const result = await admitHello(hello, secretsEnv("acme", "s3cr3t-value"), "room-abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("ADMISSION_INVALID")
  })

  it("rejects an unknown org with ADMISSION_INVALID", async () => {
    const hello = baseHello({ admit: { org: "nope", sig: "s3cr3t-value" } })
    const result = await admitHello(hello, secretsEnv("acme", "s3cr3t-value"), "room-abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("ADMISSION_INVALID")
  })

  it("v2 is authoritative: a present ORG_PUBKEYS disables the legacy path even when empty", async () => {
    const env: RelayEnv = {
      ORG_PUBKEYS: JSON.stringify([]),
      ORG_SECRETS: JSON.stringify({ acme: "s3cr3t-value" }),
    }
    const hello = baseHello({ admit: { org: "acme", sig: "s3cr3t-value" } })
    const result = await admitHello(hello, env, "room-abc123")
    expect(result.ok).toBe(false) // legacy secret ignored — 059 §2 "empty/malformed ⇒ all admissions fail"
  })
})

describe("admitHello — room claim (059 §3 step 5, checked first per the task spec)", () => {
  it("rejects a hello whose room does not match the URL shareId with ROOM_CLAIM_MISMATCH", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    const result = await admitHello(hello, pubkeysEnv("acme", [kp.publicKeyB64url]), "room-other")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ROOM_CLAIM_MISMATCH")
      expect(result.reason).toContain("room-other")
    }
  })

  it("skips the room-claim check when no shareId is supplied (PartyKit handler always passes it)", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    await expect(admitHello(hello, pubkeysEnv("acme", [kp.publicKeyB64url]))).resolves.toEqual({ ok: true, hello })
  })
})

// ─── parseFirstMessage ──────────────────────────────────────────────────────

describe("parseFirstMessage", () => {
  it("accepts a well-formed v1 hello", () => {
    const hello = baseHello({ admit: { org: "acme", sig: "some-sig" } }) // non-empty sig passes the codec gate
    expect(parseFirstMessage(JSON.stringify({ v: 1, t: "hello", p: hello }))).toEqual({ ok: true, kind: "hello", hello })
  })

  it("accepts a room-probe first message WITHOUT admission (ADR 0004)", () => {
    expect(parseFirstMessage(JSON.stringify({ v: 1, t: "room-probe", p: {} }))).toEqual({
      ok: true,
      kind: "probe",
    })
  })

  it("wrong v → PROTOCOL_VERSION", () => {
    const parsed = parseFirstMessage(JSON.stringify({ v: 2, t: "hello", p: baseHello() }))
    expect(parsed).toEqual({ ok: false, code: "PROTOCOL_VERSION", reason: expect.any(String) })
  })

  it("non-JSON first message → PROTOCOL_VERSION", () => {
    expect(parseFirstMessage("not json")).toEqual({ ok: false, code: "PROTOCOL_VERSION", reason: expect.any(String) })
  })

  it("a well-formed v1 envelope that is neither hello nor room-probe → ADMISSION_INVALID", () => {
    const parsed = parseFirstMessage(JSON.stringify({ v: 1, t: "scene", p: {} }))
    expect(parsed).toEqual({ ok: false, code: "ADMISSION_INVALID", reason: expect.any(String) })
  })

  it("hello with missing fields → ADMISSION_INVALID", () => {
    const parsed = parseFirstMessage(JSON.stringify({ v: 1, t: "hello", p: { profileId: "x" } }))
    expect(parsed).toEqual({ ok: false, code: "ADMISSION_INVALID", reason: expect.any(String) })
  })
})

// ─── parseRelayEnv ──────────────────────────────────────────────────────────

describe("parseRelayEnv", () => {
  it("duplicate org entries: first wins + warn (059 §2)", () => {
    const warn = vi.fn()
    const env: RelayEnv = {
      ORG_PUBKEYS: JSON.stringify([
        { org: "acme", pubkeys: ["pk-first"] },
        { org: "acme", pubkeys: ["pk-second"] },
      ]),
    }
    const config = parseRelayEnv(env, warn)
    expect(config.orgPubkeys.get("acme")).toEqual(["pk-first"])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate org "acme"'))
  })

  it("malformed ORG_PUBKEYS JSON → empty registry (all admissions fail)", () => {
    const warn = vi.fn()
    const config = parseRelayEnv({ ORG_PUBKEYS: "{nope" }, warn)
    expect(config.orgPubkeys.size).toBe(0)
    expect(warn).toHaveBeenCalled()
  })

  it("non-array ORG_PUBKEYS → empty registry", () => {
    const config = parseRelayEnv({ ORG_PUBKEYS: JSON.stringify({ acme: ["pk"] }) })
    expect(config.orgPubkeys.size).toBe(0)
  })

  it("non-string pubkeys are filtered out of an entry", () => {
    const env: RelayEnv = { ORG_PUBKEYS: JSON.stringify([{ org: "acme", pubkeys: ["pk-1", 42, null] }]) }
    expect(parseRelayEnv(env).orgPubkeys.get("acme")).toEqual(["pk-1"])
  })

  it("absent env → empty registry", () => {
    const config = parseRelayEnv({})
    expect(config.orgPubkeys.size).toBe(0)
    expect(config.orgSecrets.size).toBe(0)
  })
})

// ─── deriveShareId ──────────────────────────────────────────────────────────

describe("deriveShareId", () => {
  it("extracts the shareId from /room/<shareId> WS URLs", () => {
    expect(deriveShareId("wss://relay.example.com/room/room-abc123")).toBe("room-abc123")
    expect(deriveShareId("ws://localhost:1999/room/room-abc123")).toBe("room-abc123")
    expect(deriveShareId("wss://relay.example.com/room/room-abc123/?x=1")).toBe("room-abc123")
  })

  it("returns null for non-room paths and garbage", () => {
    expect(deriveShareId("wss://relay.example.com/other/room-abc123")).toBeNull()
    expect(deriveShareId("not a url")).toBeNull()
  })
})

// ─── connection flow through createRelayServer ──────────────────────────────

interface FakeConn {
  id: string
  uri: string
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function fakeConn(id: string, uri: string): FakeConn {
  return { id, uri, send: vi.fn(), close: vi.fn() }
}

function fakeRoom(env: RelayEnv): Room {
  return { env } as unknown as Room
}

const FAKE_CTX = {} as unknown as ConnectionContext
const WS_URI = "wss://relay.example.com/room/room-abc123"

describe("createRelayServer connection flow", () => {
  it("hello with a valid sig → welcome echoing the approved hello (snapshot/peers left to 038)", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", [kp.publicKeyB64url]))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "hello", p: hello }), conn as unknown as Connection, room)

    expect(conn.close).not.toHaveBeenCalled()
    expect(conn.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(conn.send.mock.calls[0][0])
    expect(sent).toEqual({
      v: 1,
      t: "welcome",
      p: {
        profileId: "install-uuid-1",
        connId: "conn-1",
        room: "room-abc123",
        privacy: "team",
        snapshotAvailable: false,
        roomName: null,
        peers: [],
      },
    })
  })

  it("sig from a non-registered key → error{ADMISSION_INVALID, fatal} + close(1008)", async () => {
    const kp = await makeKeypair()
    const other = await makeKeypair()
    const hello = await signHello(baseHello(), other.privateKey)
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", [kp.publicKeyB64url]))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "hello", p: hello }), conn as unknown as Connection, room)

    expect(conn.close).toHaveBeenCalledWith(1008, "ADMISSION_INVALID")
    expect(conn.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(conn.send.mock.calls[0][0])
    expect(sent).toEqual({
      v: 1,
      t: "error",
      p: { code: "ADMISSION_INVALID", reason: ADMISSION_REJECT_REASON, fatal: true },
    })
  })

  it("wrong protocol version → error{PROTOCOL_VERSION, fatal} + close(1003)", async () => {
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", []))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 2, t: "hello", p: baseHello() }), conn as unknown as Connection, room)

    expect(conn.close).toHaveBeenCalledWith(1003, "PROTOCOL_VERSION")
    const sent = JSON.parse(conn.send.mock.calls[0][0])
    expect(sent.p).toMatchObject({ code: "PROTOCOL_VERSION", fatal: true })
  })

  it("non-hello first message → error{ADMISSION_INVALID, fatal} + close(1008)", async () => {
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", []))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "scene", p: {} }), conn as unknown as Connection, room)

    expect(conn.close).toHaveBeenCalledWith(1008, "ADMISSION_INVALID")
  })

  it("room-claim mismatch → error{ROOM_CLAIM_MISMATCH, fatal} + close(1008)", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello({ room: "room-other" }), kp.privateKey)
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", [kp.publicKeyB64url]))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "hello", p: hello }), conn as unknown as Connection, room)

    expect(conn.close).toHaveBeenCalledWith(1008, "ROOM_CLAIM_MISMATCH")
  })

  it("post-welcome frames are dropped (task 038 room-DO seam)", async () => {
    const kp = await makeKeypair()
    const hello = await signHello(baseHello(), kp.privateKey)
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", [kp.publicKeyB64url]))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "hello", p: hello }), conn as unknown as Connection, room)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "scene", p: {} }), conn as unknown as Connection, room)

    expect(conn.send).toHaveBeenCalledTimes(1) // welcome only
    expect(conn.close).not.toHaveBeenCalled()
  })

  it("a room-probe first message → the onProbe hook answers and the connection closes (ADR 0004)", async () => {
    const onProbe = vi.fn(async (conn: Connection, _room: Room) => {
      conn.send(JSON.stringify({ v: 1, t: "room-probe", p: { roomName: "Q3 planning", snapshotAvailable: true, peerCount: 2 } }))
    })
    const server = createRelayServer({ onProbe })
    const conn = fakeConn("conn-1", WS_URI)
    // No keys — admission would fail anyway; the probe needs none (ADR 0004).
    const room = fakeRoom(pubkeysEnv("acme", []))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "room-probe", p: {} }), conn as unknown as Connection, room)

    expect(onProbe).toHaveBeenCalledTimes(1)
    expect(conn.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(conn.send.mock.calls[0][0])
    expect(sent).toEqual({ v: 1, t: "room-probe", p: { roomName: "Q3 planning", snapshotAvailable: true, peerCount: 2 } })
    // One-shot: the relay closes the probe connection (a lingering socket
    // would hold the DO awake against the "cheap read path" intent).
    expect(conn.close).toHaveBeenCalledWith(1000, "probe complete")
  })

  it("a room-probe WITHOUT the onProbe hook is answered by the stub (empty-room facts) and closed", async () => {
    const server = createRelayServer()
    const conn = fakeConn("conn-1", WS_URI)
    const room = fakeRoom(pubkeysEnv("acme", []))

    server.onConnect?.(conn as unknown as Connection, room, FAKE_CTX)
    await server.onMessage?.(JSON.stringify({ v: 1, t: "room-probe", p: {} }), conn as unknown as Connection, room)

    const sent = JSON.parse(conn.send.mock.calls[0][0])
    expect(sent).toEqual({ v: 1, t: "room-probe", p: { roomName: null, snapshotAvailable: false, peerCount: 0 } })
    expect(conn.close).toHaveBeenCalledWith(1000, "probe complete")
  })
})
