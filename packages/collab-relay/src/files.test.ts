/**
 * collab-relay file-store tests (goal 023 task 040) — content-addressed
 * put/get, 20MB cap, room-scoped storage, FILE_NOT_FOUND, serve-fail
 * delete (051 §2/§4/§7, 059 §4/§6, 052 §5).
 *
 * TDD marker: unit. Mirrors verify.test.ts fixtures: real Ed25519 via
 * WebCrypto, frames signed with raw subtle.sign over rebuildCanon, and
 * collab-core's encryptContent for the round-trip. The FileStore consumes
 * RoomStorage/RoomHooks seams exactly like RoomState (room.ts) — no
 * PartyKit runtime needed.
 */
import { describe, expect, it } from "vitest"
import { b64urlToBytes, bytesToB64url, deriveContentKey, encryptContent } from "collab-core"
import type { ContentSigner } from "collab-core"
import { rebuildCanon } from "./verify"
import type { MemberKey, SignedContentEnvelope, StorableContentType } from "./verify"
import { createFileStore, deriveFileId, MAX_FILE_BYTES } from "./files"
import type { FileStore, FileStoreOptions, StoredFileRecord } from "./files"
import type { RoomHooks, RoomStorage } from "./room"

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOM = "relay-room-0001"
const OTHER_ROOM = "relay-room-0002"

interface Keypair {
  privateKey: CryptoKey
  publicKeyB64url: string
}

async function makeKeypair(): Promise<Keypair> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyB64url: bytesToB64url(pub) }
}

/** Sign a content envelope with raw subtle.sign over rebuildCanon (058 §2.1). */
async function signEnvelope(
  t: StorableContentType,
  room: string,
  c: string,
  iv: string,
  kp: Keypair,
  profileId = "member-1",
  fileId?: string,
): Promise<SignedContentEnvelope> {
  const canon = rebuildCanon(t, room, c, iv, fileId)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(canon)),
  )
  return {
    v: 1,
    t,
    p: { c, iv },
    sig: bytesToB64url(sig),
    signer: { profileId, key: kp.publicKeyB64url },
  }
}

/** A real encrypted file-data frame via collab-core (058 §3.1 send path). */
async function makeFileFrame(
  kp: Keypair,
  bytes: Uint8Array,
  room: string,
  fileId: string,
): Promise<{ frame: SignedContentEnvelope; key: CryptoKey }> {
  const key = await deriveContentKey({ baseSecret: "A".repeat(43), shareId: room })
  const signer: ContentSigner = {
    profileId: "member-1",
    privateKey: kp.privateKey,
    publicKey: b64urlToBytes(kp.publicKeyB64url),
  }
  const frame = await encryptContent({
    key,
    t: "file-data",
    room,
    shareId: room,
    plaintext: { bytes: bytesToB64url(bytes) },
    signer,
    fileId,
  })
  return { frame: { v: 1, t: "file-data", p: { c: frame.c, iv: frame.iv }, sig: frame.sig, signer: frame.signer }, key }
}

function makeHooks(): RoomHooks & { sent: string[]; broadcasts: string[] } {
  const hooks = {
    sent: [] as string[],
    broadcasts: [] as string[],
    send(connId: string, frame: string) {
      this.sent.push(frame)
    },
    broadcast(frame: string, exceptConnId?: string) {
      this.broadcasts.push(frame)
      void exceptConnId
    },
  }
  return hooks
}

function makeStorage(): RoomStorage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    async get(key: string) {
      return map.get(key)
    },
    async put(key: string, value: unknown) {
      map.set(key, value)
    },
    async delete(key: string) {
      map.delete(key)
    },
  }
}

function makeStore(roomId = ROOM, storage?: RoomStorage, hooks?: RoomHooks): { store: FileStore; storage: RoomStorage; hooks: RoomHooks & { sent: string[]; broadcasts: string[] } } {
  const st = storage ?? makeStorage()
  const hk = (hooks ?? makeHooks()) as RoomHooks & { sent: string[]; broadcasts: string[] }
  const opts: FileStoreOptions = { roomId, storage: st, hooks: hk }
  return { store: createFileStore(opts), storage: st, hooks: hk }
}

function member(kp: Keypair): MemberKey {
  return { profileId: "member-1", key: kp.publicKeyB64url }
}

const IV = "AQIDBAUGBwgJCgsM"

// ─── deriveFileId (051 §3) ───────────────────────────────────────────────────

describe("deriveFileId", () => {
  it("is deterministic and content-addressed (sha256 → b64url, 43 chars)", async () => {
    const bytes = new TextEncoder().encode("hello file")
    const a = await deriveFileId(bytes)
    const b = await deriveFileId(bytes)
    expect(a).toBe(b)
    expect(a).toHaveLength(43)
    const other = await deriveFileId(new TextEncoder().encode("hello file!"))
    expect(other).not.toBe(a)
  })
})

// ─── beginPut (051 §2 / 052 §5 guard) ────────────────────────────────────────

describe("beginPut", () => {
  it("registers a well-formed header", () => {
    const { store, hooks } = makeStore()
    store.beginPut("conn-1", { fileId: "f-1", mimeType: "image/png", size: 100 })
    expect(store.inflight("conn-1")).toEqual({ fileId: "f-1", mimeType: "image/png", size: 100 })
    expect(hooks.sent).toHaveLength(0)
  })

  it("refuses a structurally malformed header with CHUNK_INVALID", () => {
    const { store, hooks } = makeStore()
    store.beginPut("conn-1", { fileId: 42 })
    expect(store.inflight("conn-1")).toBeUndefined()
    expect(hooks.sent).toHaveLength(1)
    expect(JSON.parse(hooks.sent[0]).p.code).toBe("CHUNK_INVALID")
    expect(JSON.parse(hooks.sent[0]).p.fatal).toBe(false)
  })

  it("refuses an over-cap declared size before any chunk is accepted (051 §7)", () => {
    const { store, hooks } = makeStore()
    store.beginPut("conn-1", { fileId: "f-big", mimeType: "application/octet-stream", size: MAX_FILE_BYTES + 1 })
    expect(store.inflight("conn-1")).toBeUndefined()
    const p = JSON.parse(hooks.sent[0]).p
    expect(p.code).toBe("CHUNK_INVALID")
    expect(p.reason).toContain("20MB")
  })

  it("leave() drops the in-flight header", () => {
    const { store } = makeStore()
    store.beginPut("conn-1", { fileId: "f-1", mimeType: "image/png", size: 10 })
    store.leave("conn-1")
    expect(store.inflight("conn-1")).toBeUndefined()
  })
})

// ─── putFile / getFile (051 §2/§4, 059 §4/§6) ───────────────────────────────

describe("putFile / getFile", () => {
  it("put round-trips: store under file:<fileId>, broadcast file-available, get serves verbatim", async () => {
    const kp = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const bytes = new TextEncoder().encode("blob-content")
    const fileId = await deriveFileId(bytes)
    const { frame } = await makeFileFrame(kp, bytes, ROOM, fileId)

    store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    const res = await store.putFile("conn-1", frame, member(kp))
    expect(res).toEqual({ ok: true, fileId, stored: "stored" })

    // stored under the room-scoped key (fileId lives in the key, not the record)
    const record = (await storage.get(`file:${fileId}`)) as StoredFileRecord
    expect(record).toBeDefined()
    expect(record.mimeType).toBe("image/png")
    expect(record.envelope.t).toBe("file-data")

    // broadcast file-available, sender excluded
    expect(hooks.broadcasts).toHaveLength(1)
    const avail = JSON.parse(hooks.broadcasts[0])
    expect(avail.t).toBe("file-available")
    expect(avail.p.fileId).toBe(fileId)

    // serve path: `file` header frame, then the envelope verbatim
    await store.getFile(fileId, "conn-2")
    expect(hooks.sent).toHaveLength(2)
    const served = JSON.parse(hooks.sent[0])
    expect(served.t).toBe("file")
    expect(served.p.fileId).toBe(fileId)
    expect(served.p.mimeType).toBe("image/png")
    const body = JSON.parse(hooks.sent[1])
    expect(body.t).toBe("file-data")
    expect(body.p.c).toBe(frame.p.c)
  })

  it("dedup: byte-identical unit under the same fileId is neither re-stored nor re-broadcast (059 §6)", async () => {
    const kp = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const bytes = new TextEncoder().encode("dedup-me")
    const fileId = await deriveFileId(bytes)
    const { frame } = await makeFileFrame(kp, bytes, ROOM, fileId)

    store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    await store.putFile("conn-1", frame, member(kp))
    expect(hooks.broadcasts).toHaveLength(1)

    // same bytes, same fileId, same frame → duplicate
    store.beginPut("conn-2", { fileId, mimeType: "image/png", size: bytes.length })
    const res = await store.putFile("conn-2", frame, member(kp))
    expect(res).toEqual({ ok: true, fileId, stored: "duplicate" })
    expect(hooks.broadcasts).toHaveLength(1) // no re-broadcast
    expect(await storage.get(`file:${fileId}`)).toBeDefined()
  })

  it("beginPut refuses an over-cap DECLARED size before any chunk (051 §7, 052 §5)", async () => {
    const { store, hooks } = makeStore()
    store.beginPut("conn-1", {
      fileId: "f-declared-big",
      mimeType: "application/octet-stream",
      size: MAX_FILE_BYTES + 1,
    })
    expect(store.inflight("conn-1")).toBeUndefined()
    expect(hooks.sent).toHaveLength(1)
    expect(JSON.parse(hooks.sent[0]).p.code).toBe("CHUNK_INVALID")
  })

  it("reassembled payload over the 20MB cap is refused + nothing stored (051 §7)", async () => {
    const kp = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const fileId = "f-reassembled-big"
    // legal header (small declared size passes beginPut), but the reassembled
    // envelope is huge — sign a frame whose ciphertext alone exceeds the cap.
    const hugeC = "A".repeat(MAX_FILE_BYTES + 1024)
    const unit = await signEnvelope("file-data", ROOM, hugeC, IV, kp, "member-1", fileId)

    store.beginPut("conn-1", { fileId, mimeType: "application/octet-stream", size: 100 })
    const res = await store.putFile("conn-1", unit, member(kp))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID")
      expect(res.reason).toContain("20MB")
    }
    expect(await storage.get(`file:${fileId}`)).toBeUndefined()
    // error frame to the sender
    expect(hooks.sent).toHaveLength(1)
    expect(JSON.parse(hooks.sent[0]).p.code).toBe("CHUNK_INVALID")
  })

  it("store-verify fails silently for a wrong signer (058 §3.3) — nothing stored, no error frame", async () => {
    const kp = await makeKeypair()
    const attacker = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const bytes = new TextEncoder().encode("signed-by-attacker")
    const fileId = await deriveFileId(bytes)
    // attacker signs a frame claiming member-1's profileId but with THEIR key
    const { frame } = await makeFileFrame(attacker, bytes, ROOM, fileId)
    frame.signer = { profileId: "member-1", key: attacker.publicKeyB64url }

    store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    const res = await store.putFile("conn-1", frame, member(kp))
    expect(res.ok).toBe(false)
    expect(await storage.get(`file:${fileId}`)).toBeUndefined()
    expect(hooks.sent).toHaveLength(0) // silent (058 §3.3)
    expect(hooks.broadcasts).toHaveLength(0)
  })

  it("FILE_NOT_FOUND on a missing unit — never a crash (051 §4)", async () => {
    const { store, hooks } = makeStore()
    await store.getFile("missing-file", "conn-2")
    expect(hooks.sent).toHaveLength(1)
    const p = JSON.parse(hooks.sent[0]).p
    expect(p.code).toBe("FILE_NOT_FOUND")
    expect(p.fatal).toBe(false)
  })

  it("serve-verify fail (tampered stored bytes) → unit deleted, never served (059 §4)", async () => {
    const kp = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const bytes = new TextEncoder().encode("tamper-me")
    const fileId = await deriveFileId(bytes)
    const { frame } = await makeFileFrame(kp, bytes, ROOM, fileId)

    store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    await store.putFile("conn-1", frame, member(kp))
    expect(await storage.get(`file:${fileId}`)).toBeDefined()

    // tamper the stored ciphertext
    const rec = (await storage.get(`file:${fileId}`)) as StoredFileRecord
    rec.envelope = { ...rec.envelope, p: { ...rec.envelope.p, c: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" } }
    await storage.put(`file:${fileId}`, rec)

    await store.getFile(fileId, "conn-2")
    // deleted, never served
    expect(await storage.get(`file:${fileId}`)).toBeUndefined()
    expect(hooks.sent).toHaveLength(1)
    const p = JSON.parse(hooks.sent[0]).p
    expect(p.code).toBe("FILE_NOT_FOUND")
  })

  it("cross-room smuggling fails: frame signed for ROOM cannot be stored under OTHER_ROOM", async () => {
    const kp = await makeKeypair()
    const { store, storage } = makeStore(OTHER_ROOM)
    const bytes = new TextEncoder().encode("smuggle")
    const fileId = await deriveFileId(bytes)
    // frame canonically signed against ROOM, but presented to a store for OTHER_ROOM
    const { frame } = await makeFileFrame(kp, bytes, ROOM, fileId)

    store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    const res = await store.putFile("conn-1", frame, member(kp))
    expect(res.ok).toBe(false)
    expect(await storage.get(`file:${fileId}`)).toBeUndefined()
  })

  it("room-scoping: same fileId bytes in two rooms → independent storage", async () => {
    const kp = await makeKeypair()
    const bytes = new TextEncoder().encode("scoped")
    const fileId = await deriveFileId(bytes)

    const s1 = makeStore(ROOM)
    const { frame } = await makeFileFrame(kp, bytes, ROOM, fileId)
    s1.store.beginPut("conn-1", { fileId, mimeType: "image/png", size: bytes.length })
    await s1.store.putFile("conn-1", frame, member(kp))
    expect(await s1.storage.get(`file:${fileId}`)).toBeDefined()

    const s2 = makeStore(OTHER_ROOM)
    expect(await s2.storage.get(`file:${fileId}`)).toBeUndefined()
  })

  it("getFile on a unit stored without a header but validly signed still serves", async () => {
    const kp = await makeKeypair()
    const { store, storage, hooks } = makeStore()
    const bytes = new TextEncoder().encode("no-header")
    const fileId = await deriveFileId(bytes)
    const c = bytesToB64url(bytes)
    const unit = await signEnvelope("file-data", ROOM, c, IV, kp, "member-1", fileId)
    await storage.put(`file:${fileId}`, { fileId, mimeType: "image/png", size: bytes.length, envelope: unit })

    await store.getFile(fileId, "conn-2")
    expect(hooks.sent).toHaveLength(2)
    const served = JSON.parse(hooks.sent[0])
    expect(served.t).toBe("file")
    expect(served.p.fileId).toBe(fileId)
  })
})
