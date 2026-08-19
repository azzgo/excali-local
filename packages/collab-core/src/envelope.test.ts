/**
 * envelope.test.ts — E2E envelope (task 031): HKDF content key, AES-GCM-256
 * with AAD, Ed25519 canon sig + signer attachment. TDD marker: unit.
 *
 * Documented HKDF known-answer vector (050 §2 / 058 §1.1, verbatim params):
 *   ikm  = bytes 0x00..0x1f (32B), b64url "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
 *   salt = UTF-8("room-kat-0001")          (the shareId)
 *   info = UTF-8("excali-collab/v1/content-key")
 *   HKDF-SHA-256, 32-byte output (hex):
 *     f1739d17edc0694f821544eb42eebe6dfdd21476d0436b77c07724f365e052ac
 *   (generated with node:crypto hkdfSync; cross-checked byte-identical via
 *   WebCrypto subtle.deriveKey + exportKey.)
 */
import { describe, expect, it, beforeEach } from "vitest"
import {
  CONTENT_KEY_INFO,
  EnvelopeError,
  FrameFormatError,
  GcmAuthError,
  KeyFormatError,
  SignerError,
  aad,
  aadFile,
  b64urlToBytes,
  bytesToB64url,
  clearContentKeyCache,
  contentCanon,
  decryptContent,
  deriveContentKey,
  fileGetCanon,
  encryptContent,
  signFileGet,
  signHello,
  verifyEd25519,
  verifyFileGet,
  verifyFrameSig,
} from "./envelope"
import type { ContentFrame, ContentSigner, ContentType, SignedFrame } from "./envelope"
import { helloCanon, seedToPkcs8, type HelloPayload } from "./wire"

// ─── documented KAT vector ───────────────────────────────────────────────────

const KAT_BASE_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" // 0x00..0x1f
const KAT_SHARE_ID = "room-kat-0001"
const KAT_KEY_HEX = "f1739d17edc0694f821544eb42eebe6dfdd21476d0436b77c07724f365e052ac"

// ─── helpers ─────────────────────────────────────────────────────────────────

function randomSecret(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function makeSigner(profileId: string): Promise<ContentSigner> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  return {
    profileId,
    privateKey: kp.privateKey,
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)),
  }
}

function asFrame(t: ContentType, room: string, f: SignedFrame, fileId?: string): ContentFrame {
  return { t, room, ...f, ...(fileId !== undefined ? { fileId } : {}) }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

const scenePayload = { elements: [{ id: "e1", type: "rectangle" }], seq: 7 }

beforeEach(() => {
  clearContentKeyCache()
})

// ─── base64url helpers ───────────────────────────────────────────────────────

describe("base64url", () => {
  it("bytesToB64url encodes known bytes unpadded", () => {
    expect(bytesToB64url(new Uint8Array([0x00, 0x01, 0x02]))).toBe("AAEC")
    expect(bytesToB64url(new Uint8Array([0xfb, 0xff, 0xff]))).toBe("-___")
  })

  it("round-trips arbitrary bytes", () => {
    for (let len = 0; len <= 64; len++) {
      const bytes = crypto.getRandomValues(new Uint8Array(len))
      expect(b64urlToBytes(bytesToB64url(bytes))).toEqual(bytes)
    }
  })

  it("accepts canonical `=` padding", () => {
    const padded = `${KAT_BASE_SECRET}=` // 32B, 43 chars + 1 pad
    expect(b64urlToBytes(padded)).toEqual(b64urlToBytes(KAT_BASE_SECRET))
  })

  it("rejects non-base64url characters (+ / ! space)", () => {
    expect(() => b64urlToBytes("AAEC+")).toThrow()
    expect(() => b64urlToBytes("AAEC/")).toThrow()
    expect(() => b64urlToBytes("AAEC!")).toThrow()
    expect(() => b64urlToBytes("AAEC ")).toThrow()
  })

  it("rejects non-canonical padding", () => {
    // 2-byte [0x00, 0x01] canonically is "AAE="; 1-byte [0x00] is "AA=="
    expect(b64urlToBytes("AAE=")).toEqual(new Uint8Array([0x00, 0x01]))
    expect(b64urlToBytes("AA==")).toEqual(new Uint8Array([0x00]))
    expect(() => b64urlToBytes("AAB=")).toThrow() // leftover pad bits ≠ 0
    expect(() => b64urlToBytes("ABA==")).toThrow() // leftover pad bits ≠ 0
  })
})

// ─── AAD + canon exact strings ───────────────────────────────────────────────

describe("AAD (050 §5 / §8)", () => {
  it("message AAD binds t + shareId with pipe separators", () => {
    expect(new TextDecoder().decode(aad("scene", "room-1"))).toBe("excali-collab/v1|scene|room-1")
    expect(new TextDecoder().decode(aad("file-data", "room-1"))).toBe(
      "excali-collab/v1|file-data|room-1",
    )
  })

  it("file AAD is file-scoped", () => {
    expect(new TextDecoder().decode(aadFile("f-abc"))).toBe("excali-collab/v1|file|f-abc")
  })
})

describe("contentCanon (058 §2.1 exact template)", () => {
  it("messages: excali-collab/v1:sign:{\"t\",\"room\",\"c\",\"iv\"} in fixed order", () => {
    expect(contentCanon("scene", "room-x", "c0", "iv0")).toBe(
      'excali-collab/v1:sign:{"t":"scene","room":"room-x","c":"c0","iv":"iv0"}',
    )
    expect(contentCanon("pointer", "room-x", "c1", "iv1")).toBe(
      'excali-collab/v1:sign:{"t":"pointer","room":"room-x","c":"c1","iv":"iv1"}',
    )
  })

  it("file bodies additionally bind fileId (after room, before c)", () => {
    expect(contentCanon("file-data", "room-x", "c0", "iv0", "f-1")).toBe(
      'excali-collab/v1:sign:{"t":"file-data","room":"room-x","fileId":"f-1","c":"c0","iv":"iv0"}',
    )
  })

  it("file-data without fileId is malformed; fileId on non-file-data is malformed", () => {
    expect(() => contentCanon("file-data", "room-x", "c0", "iv0")).toThrow(FrameFormatError)
    expect(() => contentCanon("scene", "room-x", "c0", "iv0", "f-1")).toThrow(FrameFormatError)
  })
})

// ─── deriveContentKey ────────────────────────────────────────────────────────

describe("deriveContentKey (050 §2 / 057 §1 / 058 §1.1)", () => {
  it("KAT: manual HKDF with the documented vector matches; derived key is AES-GCM-256", async () => {
    const baseKey = await crypto.subtle.importKey("raw", b64urlToBytes(KAT_BASE_SECRET), "HKDF", false, ["deriveKey"])
    const manual = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(KAT_SHARE_ID),
        info: new TextEncoder().encode(CONTENT_KEY_INFO),
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", manual))
    expect(bytesToHex(raw)).toBe(KAT_KEY_HEX) // documented vector

    const derived = await deriveContentKey({ baseSecret: KAT_BASE_SECRET, shareId: KAT_SHARE_ID })
    expect(derived.algorithm).toMatchObject({ name: "AES-GCM", length: 256 })
    expect(derived.extractable).toBe(false)
    expect(derived.usages.sort()).toEqual(["decrypt", "encrypt"])
  })

  it("KAT: key derived by deriveContentKey cross-decrypts content encrypted with the manual vector key (same material)", async () => {
    const baseKey = await crypto.subtle.importKey("raw", b64urlToBytes(KAT_BASE_SECRET), "HKDF", false, ["deriveKey"])
    const manual = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(KAT_SHARE_ID),
        info: new TextEncoder().encode(CONTENT_KEY_INFO),
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
    const signer = await makeSigner("u-kat")
    const frame = await encryptContent({
      key: manual,
      t: "scene",
      room: KAT_SHARE_ID,
      shareId: KAT_SHARE_ID,
      plaintext: scenePayload,
      signer,
    })
    const derived = await deriveContentKey({ baseSecret: KAT_BASE_SECRET, shareId: KAT_SHARE_ID })
    await expect(
      decryptContent({ key: derived, t: "scene", room: KAT_SHARE_ID, shareId: KAT_SHARE_ID, frame }),
    ).resolves.toEqual(scenePayload)
  })

  it("one code path for both tiers: same shape for roomSecret (private) and ck (team)", async () => {
    const roomSecret = randomSecret() // private tier
    const ck = randomSecret() // team tier
    for (const baseSecret of [roomSecret, ck]) {
      const key = await deriveContentKey({ baseSecret, shareId: "room-1" })
      expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 })
    }
  })

  it("is cached per session: same (baseSecret, shareId) returns the same CryptoKey", async () => {
    const secret = randomSecret()
    const a = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    const b = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    expect(a).toBe(b)
  })

  it("clearContentKeyCache forces re-derivation", async () => {
    const secret = randomSecret()
    const a = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    clearContentKeyCache()
    const b = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    expect(a).not.toBe(b)
  })

  it("salt = shareId: same secret in two rooms derives different keys", async () => {
    const secret = randomSecret()
    const keyA = await deriveContentKey({ baseSecret: secret, shareId: "room-a" })
    const keyB = await deriveContentKey({ baseSecret: secret, shareId: "room-b" })
    expect(keyA).not.toBe(keyB)

    // room-a content is undecryptable with room-b's key
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key: keyA,
      t: "scene",
      room: "room-a",
      shareId: "room-a",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key: keyB, t: "scene", room: "room-a", shareId: "room-a", frame }),
    ).rejects.toBeInstanceOf(GcmAuthError)
    // and fine with the right key
    await expect(
      decryptContent({ key: keyA, t: "scene", room: "room-a", shareId: "room-a", frame }),
    ).resolves.toEqual(scenePayload)
  })

  it("malformed baseSecret (wrong length) fails at derive time with KeyFormatError", async () => {
    const short16 = bytesToB64url(new Uint8Array(16))
    const long48 = bytesToB64url(new Uint8Array(48))
    for (const bad of [short16, long48, "AAEC", "", "A".repeat(64)]) {
      await expect(deriveContentKey({ baseSecret: bad, shareId: "room-1" })).rejects.toBeInstanceOf(
        KeyFormatError,
      )
    }
  })

  it("malformed baseSecret (bad encoding) fails with KeyFormatError, not a raw b64 error", async () => {
    for (const bad of ["AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh+", "AAEC!!", "not a secret"]) {
      await expect(
        deriveContentKey({ baseSecret: bad, shareId: "room-1" }),
      ).rejects.toBeInstanceOf(KeyFormatError)
    }
  })

  it("KeyFormatError is a named EnvelopeError with code E2E_KEY_FORMAT", async () => {
    try {
      await deriveContentKey({ baseSecret: "AAEC", shareId: "room-1" })
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(EnvelopeError)
      expect(e).toBeInstanceOf(KeyFormatError)
      expect((e as EnvelopeError).code).toBe("E2E_KEY_FORMAT")
      expect((e as Error).name).toBe("KeyFormatError")
    }
  })

  it("a failed derivation does not poison the cache", async () => {
    await expect(deriveContentKey({ baseSecret: "AAEC", shareId: "room-1" })).rejects.toBeInstanceOf(
      KeyFormatError,
    )
    const secret = randomSecret()
    const key = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    expect(key.algorithm).toMatchObject({ name: "AES-GCM" })
  })

  it("accepts canonical padded b64url and derives the same key", async () => {
    const secret = randomSecret()
    const padded = `${secret}=`
    const a = await deriveContentKey({ baseSecret: secret, shareId: "room-1" })
    const b = await deriveContentKey({ baseSecret: padded, shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key: a,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key: b, t: "scene", room: "room-1", shareId: "room-1", frame }),
    ).resolves.toEqual(scenePayload)
  })
})

// ─── encrypt/decrypt round-trip (team + private tiers) ───────────────────────

describe("encryptContent / decryptContent", () => {
  it("round-trips scene payloads for both tiers (private roomSecret + team ck)", async () => {
    for (const baseSecret of [randomSecret(), randomSecret()]) {
      const key = await deriveContentKey({ baseSecret, shareId: "room-1" })
      const signer = await makeSigner("u-1")
      const frame = await encryptContent({
        key,
        t: "scene",
        room: "room-1",
        shareId: "room-1",
        plaintext: scenePayload,
        signer,
      })
      await expect(
        decryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", frame }),
      ).resolves.toEqual(scenePayload)
    }
  })

  it("round-trips every content type (seed/scene/pointer/file-data)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const cases: Array<{ t: ContentType; plaintext: unknown; fileId?: string }> = [
      { t: "seed", plaintext: { scene: [{ id: "a" }], seq: 1 } },
      { t: "scene", plaintext: { elements: [{ id: "b" }], seq: 2 } },
      { t: "pointer", plaintext: { x: 1.5, y: -2, tool: "laser" } },
      { t: "file-data", plaintext: { bytes: "opaque-blob", size: 42 }, fileId: "f-1" },
    ]
    for (const { t, plaintext, fileId } of cases) {
      const frame = await encryptContent({ key, t, room: "room-1", shareId: "room-1", plaintext, signer, fileId })
      await expect(
        decryptContent({ key, t, room: "room-1", shareId: "room-1", frame, fileId }),
      ).resolves.toEqual(plaintext)
    }
  })

  it("emits a full SignedFrame: 96-bit nonce, 64B sig, signer {profileId, key}", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    expect(b64urlToBytes(frame.iv)).toHaveLength(12)
    expect(b64urlToBytes(frame.sig)).toHaveLength(64)
    expect(b64urlToBytes(frame.signer.key)).toHaveLength(32)
    expect(frame.signer.profileId).toBe("u-1")
    expect(frame.signer.key).toBe(bytesToB64url(signer.publicKey as Uint8Array))
    // ciphertext is opaque: plaintext length + 16B GCM tag
    const pt = new TextEncoder().encode(JSON.stringify(scenePayload))
    expect(b64urlToBytes(frame.c)).toHaveLength(pt.length + 16)
    expect(frame.c).not.toContain(JSON.stringify(scenePayload))
  })

  it("uses a fresh random nonce per message", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const opts = {
      key,
      t: "scene" as ContentType,
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    }
    const f1 = await encryptContent(opts)
    const f2 = await encryptContent(opts)
    expect(f1.iv).not.toBe(f2.iv)
    expect(f1.c).not.toBe(f2.c)
  })

  it("accepts signer.publicKey as an extractable CryptoKey too", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer: { profileId: "u-1", privateKey: kp.privateKey, publicKey: kp.publicKey },
    })
    expect(frame.signer.key).toBe(bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))))
    await expect(verifyFrameSig(asFrame("scene", "room-1", frame))).resolves.toBe(true)
  })

  it("self-verify catches a mismatched privateKey/publicKey pair (SignerError)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const a = await makeSigner("u-a")
    const b = await makeSigner("u-b")
    await expect(
      encryptContent({
        key,
        t: "scene",
        room: "room-1",
        shareId: "room-1",
        plaintext: scenePayload,
        signer: { profileId: "u-a", privateKey: a.privateKey, publicKey: b.publicKey },
      }),
    ).rejects.toBeInstanceOf(SignerError)
  })

  it("rejects a bad publicKey length with SignerError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const a = await makeSigner("u-a")
    await expect(
      encryptContent({
        key,
        t: "scene",
        room: "room-1",
        shareId: "room-1",
        plaintext: scenePayload,
        signer: { profileId: "u-a", privateKey: a.privateKey, publicKey: new Uint8Array(31) },
      }),
    ).rejects.toBeInstanceOf(SignerError)
  })

  it("room must equal shareId (canon room and AAD shareId are the same asserted shareId)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    await expect(
      encryptContent({ key, t: "scene", room: "room-2", shareId: "room-1", plaintext: scenePayload, signer }),
    ).rejects.toBeInstanceOf(FrameFormatError)

    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key, t: "scene", room: "room-2", shareId: "room-1", frame }),
    ).rejects.toBeInstanceOf(FrameFormatError)
  })

  it("file-data requires a non-empty fileId; fileId is rejected on non-file-data", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    await expect(
      encryptContent({ key, t: "file-data", room: "room-1", shareId: "room-1", plaintext: "x", signer }),
    ).rejects.toBeInstanceOf(FrameFormatError)
    await expect(
      encryptContent({ key, t: "file-data", room: "room-1", shareId: "room-1", plaintext: "x", signer, fileId: "" }),
    ).rejects.toBeInstanceOf(FrameFormatError)
    await expect(
      encryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", plaintext: scenePayload, signer, fileId: "f-1" }),
    ).rejects.toBeInstanceOf(FrameFormatError)
  })
})

// ─── GCM auth failure = the STALE-KEY signal ─────────────────────────────────

describe("GCM auth failure (050 §6 / 057 §5 signal 2 / 058 §5)", () => {
  it("wrong key → typed GcmAuthError with code E2E_AUTH_FAILED", async () => {
    const keyA = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const keyB = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key: keyA,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    try {
      await decryptContent({ key: keyB, t: "scene", room: "room-1", shareId: "room-1", frame })
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(EnvelopeError)
      expect(e).toBeInstanceOf(GcmAuthError)
      expect(e).not.toBeInstanceOf(FrameFormatError)
      expect((e as EnvelopeError).code).toBe("E2E_AUTH_FAILED")
      expect((e as Error).name).toBe("GcmAuthError")
    }
  })

  it("tampered ciphertext → GcmAuthError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    const flipped = frame.c[frame.c.length - 1] === "A" ? "B" : "A"
    await expect(
      decryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", frame: { ...frame, c: frame.c.slice(0, -1) + flipped } }),
    ).rejects.toBeInstanceOf(GcmAuthError)
  })

  it("tampered nonce → GcmAuthError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    const flipped = frame.iv[frame.iv.length - 1] === "A" ? "B" : "A"
    await expect(
      decryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", frame: { ...frame, iv: frame.iv.slice(0, -1) + flipped } }),
    ).rejects.toBeInstanceOf(GcmAuthError)
  })

  it("AAD mismatch fails: type swap (scene → seed) → GcmAuthError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key, t: "seed", room: "room-1", shareId: "room-1", frame }),
    ).rejects.toBeInstanceOf(GcmAuthError)
  })

  it("AAD mismatch fails: room swap (shareId) → GcmAuthError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key, t: "scene", room: "room-2", shareId: "room-2", frame }),
    ).rejects.toBeInstanceOf(GcmAuthError)
  })

  it("AAD mismatch fails: wrong fileId on a file blob → GcmAuthError", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "file-data",
      room: "room-1",
      shareId: "room-1",
      plaintext: { bytes: "blob" },
      signer,
      fileId: "f-1",
    })
    await expect(
      decryptContent({ key, t: "file-data", room: "room-1", shareId: "room-1", frame, fileId: "f-2" }),
    ).rejects.toBeInstanceOf(GcmAuthError)
    await expect(
      decryptContent({ key, t: "file-data", room: "room-1", shareId: "room-1", frame, fileId: "f-1" }),
    ).resolves.toEqual({ bytes: "blob" })
  })

  it("malformed frame b64/iv-length are FrameFormatError, NOT the stale-key signal", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(
      decryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", frame: { ...frame, c: "!!!not-b64!!!" } }),
    ).rejects.toBeInstanceOf(FrameFormatError)
    await expect(
      decryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", frame: { ...frame, iv: "AAAA" } }),
    ).rejects.toBeInstanceOf(FrameFormatError) // 3 bytes ≠ 12
  })
})

// ─── verifyFrameSig ──────────────────────────────────────────────────────────

describe("verifyFrameSig (058 §2.1/§2.3, §3.1 step 2)", () => {
  it("accepts a validly signed frame", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    await expect(verifyFrameSig(asFrame("scene", "room-1", frame))).resolves.toBe(true)
  })

  it("accepts a validly signed file-data frame (canon binds fileId)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "file-data",
      room: "room-1",
      shareId: "room-1",
      plaintext: { bytes: "blob" },
      signer,
      fileId: "f-1",
    })
    await expect(verifyFrameSig(asFrame("file-data", "room-1", frame, "f-1"))).resolves.toBe(true)
    // wrong fileId changes the canon ⇒ false
    await expect(verifyFrameSig(asFrame("file-data", "room-1", frame, "f-2"))).resolves.toBe(false)
    // missing fileId is malformed ⇒ false, not a throw
    await expect(verifyFrameSig(asFrame("file-data", "room-1", frame))).resolves.toBe(false)
  })

  it("rejects a sig from a different member key", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const alice = await makeSigner("u-alice")
    const bob = await makeSigner("u-bob")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer: alice,
    })
    await expect(verifyFrameSig(asFrame("scene", "room-1", frame))).resolves.toBe(true)
    // a lying signer attachment fails immediately (058 §2.3)
    const spoofed: ContentFrame = { ...asFrame("scene", "room-1", frame), signer: { profileId: "u-alice", key: bytesToB64url(bob.publicKey as Uint8Array) } }
    await expect(verifyFrameSig(spoofed)).resolves.toBe(false)
  })

  it("rejects tampered ciphertext, nonce, sig, and room", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    // flip the FIRST char: base64url has no leading pad, so the first char
    // always encodes 6 data bits (the last char can carry only pad bits,
    // e.g. an 86-char Ed25519 sig has 4 trailing pad bits — flipping those
    // would decode to the same bytes and verify true)
    const flip = (s: string) => (s[0] === "A" ? "B" + s.slice(1) : "A" + s.slice(1))

    await expect(verifyFrameSig({ ...asFrame("scene", "room-1", frame), c: flip(frame.c) })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...asFrame("scene", "room-1", frame), iv: flip(frame.iv) })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...asFrame("scene", "room-1", frame), sig: flip(frame.sig) })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...asFrame("scene", "room-2", frame) })).resolves.toBe(false)
    // cross-type replay fails the canon
    await expect(verifyFrameSig({ ...asFrame("seed", "room-1", frame) })).resolves.toBe(false)
  })

  it("rejects a sig replayed onto different ciphertext (same signer, different message)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const f1 = await encryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", plaintext: scenePayload, signer })
    const f2 = await encryptContent({ key, t: "scene", room: "room-1", shareId: "room-1", plaintext: { elements: [], seq: 8 }, signer })
    await expect(verifyFrameSig({ t: "scene", room: "room-1", c: f1.c, iv: f1.iv, sig: f2.sig, signer: f2.signer })).resolves.toBe(false)
  })

  it("signer.profileId is not part of the canon — sig binds the key, roster cross-check is the client's job (058 §3.1 step 3)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    const relabeled: ContentFrame = { ...asFrame("scene", "room-1", frame), signer: { ...frame.signer, profileId: "u-renamed" } }
    await expect(verifyFrameSig(relabeled)).resolves.toBe(true)
  })

  it("drops silently (false, never throws) on garbage input", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    const bad: ContentFrame = asFrame("scene", "room-1", frame)
    await expect(verifyFrameSig({ ...bad, sig: "!!!not-b64!!!" })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...bad, sig: "aGVsbG8" })).resolves.toBe(false) // 5 bytes ≠ 64
    await expect(verifyFrameSig({ ...bad, signer: { ...bad.signer, key: "!!!not-b64!!!" } })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...bad, signer: { ...bad.signer, key: "aGVsbG8" } })).resolves.toBe(false) // 5 bytes ≠ 32
    await expect(verifyFrameSig({ ...bad, c: "" })).resolves.toBe(false)
    await expect(verifyFrameSig({ ...bad, room: "" })).resolves.toBe(false)
  })

  it("sig+signer survive re-encryption across sessions: verify needs zero session state (058 §2.3)", async () => {
    // the stored-unit property: a frame verifies from its fields alone, with
    // no roster and no memory of the sender
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: scenePayload,
      signer,
    })
    clearContentKeyCache() // session teardown — storage/roster state is gone
    await expect(verifyFrameSig(asFrame("scene", "room-1", frame))).resolves.toBe(true)
    const key2 = await deriveContentKey({ baseSecret: randomSecret(), shareId: "room-1" })
    await expect(
      decryptContent({ key: key2, t: "scene", room: "room-1", shareId: "room-1", frame }),
    ).rejects.toBeInstanceOf(GcmAuthError) // old key is gone ⇒ stale-key signal
  })
})

describe("verifyEd25519 (detached sig vs raw b64url pubkey)", () => {
  const canon = 'excali-collab/v1:hello:{"v":1,"t":"hello","p":{}}'

  async function rawPk(kp: CryptoKeyPair): Promise<string> {
    return bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)))
  }

  async function signWith(kp: CryptoKeyPair): Promise<string> {
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(canon)),
    )
    return bytesToB64url(sig)
  }

  it("passes a valid detached sig against the matching raw pubkey", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    await expect(verifyEd25519(canon, await signWith(kp), await rawPk(kp))).resolves.toBe(true)
  })

  it("fails when the signed bytes differ (tampered canon)", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    await expect(verifyEd25519(canon + "tampered", await signWith(kp), await rawPk(kp))).resolves.toBe(false)
  })

  it("fails for a different public key (rotation cutover)", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    await expect(verifyEd25519(canon, await signWith(kp), await rawPk(other))).resolves.toBe(false)
  })

  it("returns false — never throws — on malformed input", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const pk = await rawPk(kp)
    const sig = await signWith(kp)
    await expect(verifyEd25519(canon, "!!!not-b64!!!", pk)).resolves.toBe(false) // bad sig b64
    await expect(verifyEd25519(canon, bytesToB64url(new Uint8Array(32)), pk)).resolves.toBe(false) // sig ≠ 64B
    await expect(verifyEd25519(canon, sig, "!!!not-b64!!!")).resolves.toBe(false) // bad key b64
    await expect(verifyEd25519(canon, sig, bytesToB64url(new Uint8Array(31)))).resolves.toBe(false) // key ≠ 32B
  })

  it("round-trips through the 057 §1 seed path (pkcs8 export → seedToPkcs8 → import → sign)", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey))
    const seed = pkcs8.slice(16) // fixed 16-byte DER prefix (057 §1)
    expect(seed).toHaveLength(32)
    const orgKey = await crypto.subtle.importKey(
      "pkcs8",
      seedToPkcs8(seed),
      { name: "Ed25519" },
      false,
      ["sign"],
    )
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, orgKey, new TextEncoder().encode(canon)),
    )
    await expect(verifyEd25519(canon, bytesToB64url(sig), await rawPk(kp))).resolves.toBe(true)
  })
})

describe("hello admission signature (057 §3)", () => {
  function makeHello(overrides: Partial<HelloPayload> = {}): HelloPayload {
    return {
      profileId: "prof-0001",
      name: "Ada",
      color: { background: "hsl(10, 100%, 83%)", stroke: "hsl(10, 100%, 50%)" },
      privacy: "team",
      room: "share-123",
      admit: { org: "acme", sig: "" },
      key: "pubkey-b64",
      ...overrides,
    }
  }

  it("helloCanon is the verbatim 057 §3 canonical string (fixed order, org hoisted, sig excluded)", () => {
    expect(helloCanon(makeHello())).toBe(
      "excali-collab/v1:hello:{\"v\":1,\"t\":\"hello\",\"p\":{\"profileId\":\"prof-0001\",\"name\":\"Ada\"," +
      "\"color\":{\"background\":\"hsl(10, 100%, 83%)\",\"stroke\":\"hsl(10, 100%, 50%)\"},\"privacy\":\"team\"," +
      "\"room\":\"share-123\",\"org\":\"acme\",\"key\":\"pubkey-b64\"}}",
    )
    const canon = helloCanon(makeHello())
    // the signature is NOT part of the canon — a filled sig changes nothing
    expect(helloCanon(makeHello({ admit: { org: "acme", sig: "FILLED-SIG" } }))).toBe(canon)
    expect(canon).not.toContain("admit") // org is hoisted, admit object is gone
    expect(canon).not.toContain("sig")
    // order-sensitive check: org sits between room and key (fixed property order)
    expect(canon.indexOf("\"room\":\"share-123\",\"org\":\"acme\",\"key\":\"pubkey-b64\"")).toBeGreaterThan(-1)
  })

  it("signHello produces an 86-char b64url Ed25519 sig that verifies against the org pk", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const hello = makeHello()
    const sig = await signHello(hello, kp.privateKey)
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/) // 64B ⇒ 86 chars, unpadded b64url
    const pk = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)))
    await expect(verifyEd25519(helloCanon(hello), sig, pk)).resolves.toBe(true)
  })

  it("the sig binds the whole payload — any field change breaks verification", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const pk = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)))
    const hello = makeHello()
    const sig = await signHello(hello, kp.privateKey)
    await expect(verifyEd25519(helloCanon(hello), sig, pk)).resolves.toBe(true)
    const tampered: Array<Partial<HelloPayload>> = [
      { name: "Eve" }, // display name
      { profileId: "prof-0002" }, // identity
      { room: "share-456" }, // room claim
      { key: "other-pubkey" }, // pinned member key
      { privacy: "private" },
      { admit: { org: "other-org", sig: "" } }, // org label
    ]
    for (const patch of tampered) {
      const t = { ...hello, ...patch }
      await expect(verifyEd25519(helloCanon(t), sig, pk)).resolves.toBe(false)
    }
  })

  it("round-trips through the 057 §1 seed path (pkcs8 → seedToPkcs8 → import → signHello)", async () => {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey))
    const seed = pkcs8.slice(16) // fixed 16-byte DER prefix (057 §1)
    const orgKey = await crypto.subtle.importKey("pkcs8", seedToPkcs8(seed), { name: "Ed25519" }, false, ["sign"])
    const hello = makeHello()
    const sig = await signHello(hello, orgKey)
    const pk = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)))
    await expect(verifyEd25519(helloCanon(hello), sig, pk)).resolves.toBe(true)
  })
})

// ─── file-get authorization signature ────────────────────────────────────────

describe("file-get authorization (fileGetCanon / signFileGet / verifyFileGet)", () => {
  it("fileGetCanon is the exact dedicated canonical string (no c/iv)", () => {
    expect(fileGetCanon("room-x", "f-1")).toBe(
      `excali-collab/v1:sign:${JSON.stringify({ t: "file-get", room: "room-x", fileId: "f-1" })}`
    )
  })

  it("signFileGet/verifyFileGet round-trip for the member key", async () => {
    const signer = await makeSigner("u-1")
    const pk = bytesToB64url(signer.publicKey as Uint8Array) // makeSigner already returns raw pub bytes
    const frame = await signFileGet(signer, "room-x", "f-1")
    expect(frame.fileId).toBe("f-1")
    expect(frame.sig).toMatch(/^[A-Za-z0-9_-]{86}$/) // 64B Ed25519 ⇒ 86 b64url chars
    await expect(verifyFileGet("room-x", "f-1", frame.sig, pk)).resolves.toBe(true)
  })

  it("a sig bound to a DIFFERENT room/fileId fails verification (cross-room smuggling)", async () => {
    const signer = await makeSigner("u-1")
    const pk = bytesToB64url(signer.publicKey as Uint8Array)
    const frame = await signFileGet(signer, "room-x", "f-1")
    // verifier rebuilds the canon from ITS OWN ids — these differ
    await expect(verifyFileGet("room-y", "f-1", frame.sig, pk)).resolves.toBe(false)
    await expect(verifyFileGet("room-x", "f-9", frame.sig, pk)).resolves.toBe(false)
  })

  it("a sig from a different member key fails verification", async () => {
    const signer = await makeSigner("u-1")
    const other = await makeSigner("u-2")
    const pk = bytesToB64url(other.publicKey as Uint8Array)
    const frame = await signFileGet(signer, "room-x", "f-1")
    await expect(verifyFileGet("room-x", "f-1", frame.sig, pk)).resolves.toBe(false)
  })
})
