/**
 * collab-relay verification tests (goal 023 task 039) — store/serve
 * signature verification, serve-fail ⇒ delete, canon rebuild from the
 * relay's own ids, FILE_NOT_FOUND (059 §4/§5, 058 §2.1/§3.2, 051 §4).
 *
 * TDD marker: unit. Real Ed25519 via WebCrypto (node supports
 * `crypto.subtle.generateKey({ name: "Ed25519" })`); frames are signed
 * with raw subtle.sign over rebuildCanon — the exact bytes collab-core's
 * contentCanon produces — and the round-trip test uses collab-core's own
 * encryptContent signer (058 §3.1 send path).
 *
 * Serve-fail tests inject corrupt units DIRECTLY into the room model's
 * storage: store-verify already rejects tampered frames at the door (058
 * §3.2 first line of defense), so serve-verify's delete path is exercised
 * on the post-store tampering/corruption case (059 §4 — an attacker with
 * storage access, DO storage corruption, rotated keys).
 */
import { describe, expect, it } from "vitest"
import { b64urlToBytes, bytesToB64url, contentCanon, deriveContentKey, encryptContent } from "collab-core"
import type { ContentSigner, SignedFrame } from "collab-core"
import { fileNotFound, rebuildCanon, toErrorPayload, verifyServe, verifyStore } from "./verify"
import type { MemberKey, SignedContentEnvelope, StorableContentType } from "./verify"

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOM = "relay-room-0001"
const OTHER_ROOM = "relay-room-0002"
/** 32B of ciphertext-ish b64url (opaque to verification — never parsed). */
const C = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
/** 12B nonce b64url. */
const IV = "AQIDBAUGBwgJCgsM"
const FILE_ID = "file-0001"

interface Keypair {
  privateKey: CryptoKey
  publicKeyB64url: string
}

async function makeKeypair(): Promise<Keypair> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyB64url: bytesToB64url(pub) }
}

function member(kp: Keypair, profileId = "member-1"): MemberKey {
  return { profileId, key: kp.publicKeyB64url }
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

interface ErrorPayloadLike {
  code: string
  reason: string
  fatal: false
}

type ServeOutcome = { ok: true; unit: SignedContentEnvelope } | { ok: false; error: ErrorPayloadLike }

/** A minimal room.storage model (what room.ts will do — the consumption
 *  contract this module's tests pin): store only on verifyStore ok, delete
 *  on verifyServe fail, never serve a deleted/missing unit. */
function makeRoom(shareId: string) {
  const room = {
    snapshot: null as SignedContentEnvelope | null,
    files: new Map<string, SignedContentEnvelope>(),
    /** store path: write only when store-verify passes (058 §3.2). */
    async store(unit: SignedContentEnvelope, fileId?: string): Promise<boolean> {
      const res = await verifyStore(unit, memberFor(unit.signer), { shareId, fileId })
      if (!res.ok) return false
      if (unit.t === "file-data") room.files.set(fileId!, unit)
      else room.snapshot = unit
      return true
    },
    /** serve path: verify → serve verbatim | delete + error payload (059 §4). */
    async serveSnapshot(): Promise<ServeOutcome> {
      if (room.snapshot === null) {
        return { ok: false, error: { code: "SEED_REJECTED", reason: "no stored snapshot", fatal: false } }
      }
      const res = await verifyServe(room.snapshot, { shareId })
      if (!res.ok) {
        room.snapshot = null // deterministic failure never recovers — delete (059 §4)
        return { ok: false, error: toErrorPayload(res) }
      }
      return { ok: true, unit: res.unit }
    },
    async serveFile(fileId: string): Promise<ServeOutcome> {
      const unit = room.files.get(fileId)
      if (unit === undefined) {
        return { ok: false, error: fileNotFound(`no blob stored for fileId "${fileId}" (051 §4)`) }
      }
      const res = await verifyServe(unit, { shareId, fileId })
      if (!res.ok) {
        room.files.delete(fileId) // deterministic failure never recovers — delete (059 §4)
        return { ok: false, error: toErrorPayload(res) }
      }
      return { ok: true, unit: res.unit }
    },
  }
  return room
}

function memberFor(signer: { profileId: string; key: string }): MemberKey {
  return { profileId: signer.profileId, key: signer.key }
}

// ─── rebuildCanon (059 §4 — relay's own ids) ─────────────────────────────────

describe("rebuildCanon", () => {
  it("produces the exact collab-core canonical string (zero drift, 058 §2.1)", () => {
    expect(rebuildCanon("scene", ROOM, C, IV)).toBe(contentCanon("scene", ROOM, C, IV))
    expect(rebuildCanon("seed", ROOM, C, IV)).toBe(
      `excali-collab/v1:sign:${JSON.stringify({ t: "seed", room: ROOM, c: C, iv: IV })}`,
    )
    expect(rebuildCanon("file-data", ROOM, C, IV, FILE_ID)).toBe(contentCanon("file-data", ROOM, C, IV, FILE_ID))
    expect(rebuildCanon("file-data", ROOM, C, IV, FILE_ID)).toBe(
      `excali-collab/v1:sign:${JSON.stringify({ t: "file-data", room: ROOM, fileId: FILE_ID, c: C, iv: IV })}`,
    )
  })

  it("uses the relay's OWN shareId even when the payload claims another", () => {
    // a frame signed against OTHER_ROOM must NOT verify under the relay's room
    expect(rebuildCanon("scene", ROOM, C, IV)).not.toBe(contentCanon("scene", OTHER_ROOM, C, IV))
  })
})

// ─── verifyStore (058 §3.2 / 059 §4) ─────────────────────────────────────────

describe("verifyStore", () => {
  it("accepts a scene signed by the member's own key", async () => {
    const alice = await makeKeypair()
    const frame = await signEnvelope("scene", ROOM, C, IV, alice)
    await expect(verifyStore(frame, member(alice), { shareId: ROOM })).resolves.toEqual({ ok: true })
  })

  it("accepts a seed and a file-data frame signed by the member's key", async () => {
    const alice = await makeKeypair()
    const seed = await signEnvelope("seed", ROOM, C, IV, alice)
    await expect(verifyStore(seed, member(alice), { shareId: ROOM })).resolves.toEqual({ ok: true })
    const file = await signEnvelope("file-data", ROOM, C, IV, alice, "member-1", FILE_ID)
    await expect(verifyStore(file, member(alice), { shareId: ROOM, fileId: FILE_ID })).resolves.toEqual({ ok: true })
  })

  it("rejects a frame signed by a DIFFERENT key — never stored", async () => {
    const alice = await makeKeypair()
    const bob = await makeKeypair()
    const frame = await signEnvelope("scene", ROOM, C, IV, alice) // signed by alice
    // bob re-signs the SAME canon; signer still claims alice — sig fails vs member.key
    const bobSig = (await signEnvelope("scene", ROOM, C, IV, bob)).sig
    const forged = { ...frame, sig: bobSig }
    const room = makeRoom(ROOM)
    const res = await verifyStore(forged, member(alice), { shareId: ROOM })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID") // sig does not verify against member.key
      expect(toErrorPayload(res).fatal).toBe(false)
    }
    // the write is skipped: nothing lands in storage
    await expect(room.store(forged)).resolves.toBe(false)
    expect(room.snapshot).toBeNull()
  })

  it("rejects a frame whose signer does not equal the admitted member (ADMISSION_INVALID)", async () => {
    const alice = await makeKeypair()
    const bob = await makeKeypair()
    const frame = await signEnvelope("scene", ROOM, C, IV, bob, "bob-profile") // bob signs as himself
    const res = await verifyStore(frame, member(alice, "alice-profile"), { shareId: ROOM })
    expect(res).toEqual({
      ok: false,
      code: "ADMISSION_INVALID",
      reason: expect.stringContaining("does not equal the admitted member"),
    })
    if (!res.ok) expect(toErrorPayload(res).fatal).toBe(false)
  })

  it("rejects a frame signed for a DIFFERENT room — the relay's own shareId governs", async () => {
    const alice = await makeKeypair()
    // signed against OTHER_ROOM (the claim), the relay's room is ROOM
    const frame = await signEnvelope("scene", OTHER_ROOM, C, IV, alice)
    const res = await verifyStore(frame, member(alice), { shareId: ROOM })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("CHUNK_INVALID")
  })

  it("rejects file-data without the in-flight file-put fileId (CHUNK_INVALID)", async () => {
    const alice = await makeKeypair()
    const frame = await signEnvelope("file-data", ROOM, C, IV, alice, "member-1", FILE_ID)
    const res = await verifyStore(frame, member(alice), { shareId: ROOM }) // no fileId in ctx
    expect(res).toEqual({ ok: false, code: "CHUNK_INVALID", reason: expect.stringContaining("fileId") })
  })

  it("rejects a scene carrying a fileId (CHUNK_INVALID)", async () => {
    const alice = await makeKeypair()
    const frame = await signEnvelope("scene", ROOM, C, IV, alice)
    const res = await verifyStore(frame, member(alice), { shareId: ROOM, fileId: FILE_ID })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("CHUNK_INVALID")
  })

  it("rejects pointer — never stored (058 §3.2)", async () => {
    const alice = await makeKeypair()
    const pointer = {
      v: 1 as const,
      t: "pointer" as unknown as StorableContentType, // runtime shape, not a storable type
      p: { c: C, iv: IV },
      sig: "x".repeat(86),
      signer: { profileId: "member-1", key: alice.publicKeyB64url },
    }
    const res = await verifyStore(pointer, member(alice), { shareId: ROOM })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("CHUNK_INVALID")
  })
})

// ─── verifyServe (059 §4) ────────────────────────────────────────────────────

describe("verifyServe", () => {
  it("serves an intact stored scene (canon rebuilt with the relay's own room id)", async () => {
    const alice = await makeKeypair()
    const unit = await signEnvelope("scene", ROOM, C, IV, alice)
    const res = await verifyServe(unit, { shareId: ROOM })
    expect(res).toEqual({ ok: true, unit })
  })

  it("serves an intact stored file-data (canon rebuilt with the relay's own storage key)", async () => {
    const alice = await makeKeypair()
    const unit = await signEnvelope("file-data", ROOM, C, IV, alice, "member-1", FILE_ID)
    const res = await verifyServe(unit, { shareId: ROOM, fileId: FILE_ID })
    expect(res).toEqual({ ok: true, unit })
  })

  it("fails when the stored frame's room was tampered (cross-room) → deleted, subsequent serve reports missing", async () => {
    const alice = await makeKeypair()
    // a unit signed for OTHER_ROOM that reached storage (post-store tampering)
    const room = makeRoom(ROOM)
    room.snapshot = await signEnvelope("scene", OTHER_ROOM, C, IV, alice)

    const served = await room.serveSnapshot()
    expect(served.ok).toBe(false)
    if (!served.ok) {
      expect(served.error.code).toBe("SEED_REJECTED") // snapshot slot
      expect(served.error.fatal).toBe(false)
    }
    expect(room.snapshot).toBeNull() // deleted — never left in limbo
    // subsequent serve reports the unit missing (room behaves as empty)
    const again = await room.serveSnapshot()
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe("SEED_REJECTED")
  })

  it("fails when the stored frame's fileId was tampered (storage key mismatch) → deleted + FILE_NOT_FOUND", async () => {
    const alice = await makeKeypair()
    // signed for FILE_ID but stored under a different key (canon mismatch)
    const room = makeRoom(ROOM)
    room.files.set("file-0002", await signEnvelope("file-data", ROOM, C, IV, alice, "member-1", FILE_ID))

    const served = await room.serveFile("file-0002") // requester asks under the tampered key
    expect(served.ok).toBe(false)
    if (!served.ok) {
      expect(served.error.code).toBe("FILE_NOT_FOUND")
      expect(served.error.fatal).toBe(false)
    }
    expect(room.files.has("file-0002")).toBe(false) // deleted — never served
    // subsequent serve reports the unit missing (051 §4: placeholder + retry)
    const again = await room.serveFile("file-0002")
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe("FILE_NOT_FOUND")
      expect(again.error.reason).toContain("no blob stored")
    }
  })

  it("fails when the stored unit's ciphertext was tampered → deleted, never served", async () => {
    const alice = await makeKeypair()
    const unit = await signEnvelope("scene", ROOM, C, IV, alice)
    const tampered = { ...unit, p: { c: C.slice(0, 3) + (C[3] === "A" ? "B" : "A") + C.slice(4), iv: IV } }
    const room = makeRoom(ROOM)
    room.snapshot = tampered // storage corruption after store-verify passed

    const served = await room.serveSnapshot()
    expect(served.ok).toBe(false)
    if (!served.ok) expect(served.error.code).toBe("SEED_REJECTED")
    expect(room.snapshot).toBeNull()
  })

  it("fails when the signer key was rotated (sig no longer valid against the attached key) → deleted, never served", async () => {
    const alice = await makeKeypair()
    const bob = await makeKeypair()
    const unit = await signEnvelope("file-data", ROOM, C, IV, alice, "member-1", FILE_ID)
    const rotated = { ...unit, signer: { profileId: "member-1", key: bob.publicKeyB64url } } // key swapped
    const room = makeRoom(ROOM)
    room.files.set(FILE_ID, rotated) // post-store signer-key rotation/corruption

    const served = await room.serveFile(FILE_ID)
    expect(served.ok).toBe(false)
    if (!served.ok) {
      expect(served.error.code).toBe("FILE_NOT_FOUND")
      expect(served.error.reason).toContain("DELETED")
    }
    expect(room.files.has(FILE_ID)).toBe(false) // deleted for good
    const again = await room.serveFile(FILE_ID)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe("FILE_NOT_FOUND")
  })
})

// ─── FILE_NOT_FOUND / error payloads (051 §4) ────────────────────────────────

describe("FILE_NOT_FOUND path", () => {
  it("answers FILE_NOT_FOUND (fatal:false) on a missing unit — never crashes the room", async () => {
    const room = makeRoom(ROOM)
    const res = await room.serveFile("never-stored")
    expect(res).toEqual({
      ok: false,
      error: { code: "FILE_NOT_FOUND", reason: expect.stringContaining("no blob stored"), fatal: false },
    })
  })

  it("fileNotFound builds a wire-ready non-fatal error payload", () => {
    expect(fileNotFound('no blob stored for fileId "F1" (051 §4)')).toEqual({
      code: "FILE_NOT_FOUND",
      reason: 'no blob stored for fileId "F1" (051 §4)',
      fatal: false,
    })
  })

  it("toErrorPayload always carries fatal:false", async () => {
    const alice = await makeKeypair()
    const frame = await signEnvelope("scene", OTHER_ROOM, C, IV, alice)
    const res = await verifyStore(frame, member(alice), { shareId: ROOM })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(toErrorPayload(res).fatal).toBe(false)
      expect(toErrorPayload(res).code).toBe("CHUNK_INVALID")
    }
  })
})

// ─── round-trip with the collab-core signer (058 §3.1) ───────────────────────

describe("round-trip", () => {
  it("sign a scene with collab-core → store-verify OK → serve-verify OK → served bytes equal original", async () => {
    const kp = await makeKeypair()
    const key = await deriveContentKey({
      baseSecret: bytesToB64url(crypto.getRandomValues(new Uint8Array(32))),
      shareId: ROOM,
    })
    const signer: ContentSigner = {
      profileId: "member-1",
      privateKey: kp.privateKey,
      publicKey: b64urlToBytes(kp.publicKeyB64url),
    }
    const plaintext = { elements: [{ type: "rectangle", id: "el-1", x: 0, y: 0 }], seq: 1 }
    const signed: SignedFrame = await encryptContent({
      key,
      t: "scene",
      room: ROOM,
      shareId: ROOM,
      plaintext,
      signer,
    })
    const frame: SignedContentEnvelope = {
      v: 1,
      t: "scene",
      p: { c: signed.c, iv: signed.iv },
      sig: signed.sig,
      signer: signed.signer,
    }
    const memberKey: MemberKey = { profileId: "member-1", key: kp.publicKeyB64url }

    await expect(verifyStore(frame, memberKey, { shareId: ROOM })).resolves.toEqual({ ok: true })
    await expect(verifyServe(frame, { shareId: ROOM })).resolves.toEqual({ ok: true, unit: frame })

    // the served unit is the stored pre-stamp envelope VERBATIM — byte-identical
    expect(JSON.stringify(frame)).toBe(
      JSON.stringify({
        v: 1,
        t: "scene",
        p: { c: signed.c, iv: signed.iv },
        sig: signed.sig,
        signer: signed.signer,
      }),
    )
  })
})
