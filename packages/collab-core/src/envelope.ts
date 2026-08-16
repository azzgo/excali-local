/**
 * collab-core E2E envelope — AES-GCM-256 content encryption + Ed25519 frame
 * signatures (Wayfinder 050 / 057 / 058, task 031).
 *
 * Authoritative sources:
 * - 050 §2   — room secret (32B b64url) + HKDF content key (salt=shareId,
 *              info="excali-collab/v1/content-key", AES-GCM-256)
 * - 050 §3/§5/§8 — envelope {c, iv}, 96-bit random nonces, AAD
 *              `excali-collab/v1|${t}|${shareId}` (messages) /
 *              `excali-collab/v1|file|<fileId>` (file blobs)
 * - 057 §1   — symmetry rule: team rooms feed the org content key `ck` through
 *              the IDENTICAL code path; only base-secret provenance differs
 * - 058 §2.1 — exact canonical signature string over (t, room, c, iv[, fileId])
 * - 058 §5 / 057 §5 — GCM auth failure is the definitive stale-key signal
 *              (sig-OK + GCM-fail ⇒ wrong key, never corruption)
 *
 * The canonical string is 058 §2.1 VERBATIM (NOT the pipe-joined fallback —
 * 058 does not leave the template open):
 *
 *   `excali-collab/v1:sign:${JSON.stringify({ t, room, c, iv })}`           // messages
 *   `excali-collab/v1:sign:${JSON.stringify({ t: "file-data", room, fileId, c, iv })}` // file bodies
 *
 * `room` (canon) and `shareId` (AAD salt) are the same asserted shareId — both
 * are accepted and enforced equal so a frame can never sig-bind one room and
 * GCM-bind another. Plain `JSON.stringify` with fixed property order is safe:
 * signer and verifier are the same package, so no RFC 8785 is needed (057 §3
 * precedent). `|` and `"` cannot occur in any component (`t` is a closed enum;
 * room/c/iv/fileId are base64url or room ids).
 *
 * Both tiers sign (058 §2.5): encrypted ⇒ signed, one envelope shape, no
 * tier branch anywhere in this module.
 *
 * WebCrypto only — dependency-free (collab-core constraint).
 */

// ─── protocol constants ──────────────────────────────────────────────────────

/** Domain-separating HKDF info string (050 §2, verbatim). */
export const CONTENT_KEY_INFO = "excali-collab/v1/content-key"

/** HKDF salt: the room-scoped shareId — same secret in two rooms ⇒ two keys. */
function hkdfSalt(shareId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(shareId)
}

// ─── types ───────────────────────────────────────────────────────────────────

/** Closed enum of encrypted+signed content message types (058 §1.2/§2.5). */
export type ContentType = "seed" | "scene" | "pointer" | "file-data"

/** 050 §3 EncryptedPayload — UNCHANGED by 058: p stays {c, iv}. */
export interface EncryptedPayload {
  /** AES-GCM-256 ciphertext (JSON-serialized plaintext || 16B tag), b64url */
  c: string
  /** 96-bit random nonce, b64url — fresh per message, never reused */
  iv: string
}

/** 058 §2.3 — self-asserted but sig-verified member identity. */
export interface SignerRef {
  profileId: string
  /** member Ed25519 public key, raw 32B, b64url */
  key: string
}

/** 058 §2.2 — encrypted frame plus envelope-level detached sig + signer. */
export interface SignedFrame extends EncryptedPayload {
  /** b64url Ed25519 (64B) over contentCanon(t, room, c, iv[, fileId]) */
  sig: string
  signer: SignerRef
}

/** Self-contained frame for verifyFrameSig (058 §2.3: stored units verify
 *  with zero session state — sig binds t/room/c/iv and the attached key). */
export interface ContentFrame extends SignedFrame {
  t: ContentType
  /** asserted shareId — the value the canon binds as `room` */
  room: string
  /** required iff t === "file-data" (058 §2.1 file-body canon) */
  fileId?: string
}

/** Member signing identity for the send path (058 §3.1). */
export interface ContentSigner {
  profileId: string
  /** Ed25519 private key (WebCrypto, usages: ["sign"]) */
  privateKey: CryptoKey
  /** matching Ed25519 public key — raw 32B, or an extractable CryptoKey */
  publicKey: Uint8Array | CryptoKey
}

export interface DeriveContentKeyInput {
  /** 32B base secret, b64url — bytes(roomSecret) for private tier,
   *  bytes(ck) for team tier. ONE code path (057 §1 symmetry rule). */
  baseSecret: string
  /** room-scoped HKDF salt (050 §2) */
  shareId: string
}

export interface EncryptContentInput {
  /** AES-GCM-256 content key from deriveContentKey */
  key: CryptoKey
  t: ContentType
  /** asserted shareId — canon field name is `room` (058 §2.1) */
  room: string
  /** asserted shareId — AAD salt (050 §5); MUST equal `room` */
  shareId: string
  /** the message payload p (049), JSON-serialized before encryption */
  plaintext: unknown
  signer: ContentSigner
  /** required iff t === "file-data" (050 §8 / 058 §2.1) */
  fileId?: string
}

export interface DecryptContentInput {
  key: CryptoKey
  t: ContentType
  room: string
  shareId: string
  frame: EncryptedPayload
  /** required iff t === "file-data" */
  fileId?: string
}

// ─── named errors ────────────────────────────────────────────────────────────

/** Base class for every envelope-level failure. */
export class EnvelopeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** Malformed base secret (wrong encoding/length) — fails at derive time (058 §1.1). */
export class KeyFormatError extends EnvelopeError {
  constructor(message: string) {
    super("E2E_KEY_FORMAT", message)
  }
}

/** AES-GCM auth failure — the DEFINITIVE stale-key signal (050 §6, 057 §5,
 *  058 §5): wrong key, tampered ciphertext, or AAD mismatch. */
export class GcmAuthError extends EnvelopeError {
  constructor(message: string) {
    super("E2E_AUTH_FAILED", message)
  }
}

/** Structurally malformed frame (undecodable b64, bad iv length, room≠shareId,
 *  missing fileId, non-JSON plaintext). NOT the stale-key signal. */
export class FrameFormatError extends EnvelopeError {
  constructor(message: string) {
    super("E2E_FRAME_FORMAT", message)
  }
}

/** Signer misuse: bad public key material, or self-verify failure (the private
 *  key does not match the supplied public key — 058 §3.1 send-path check). */
export class SignerError extends EnvelopeError {
  constructor(message: string) {
    super("E2E_SIGNER", message)
  }
}

// ─── base64url (strict, dependency-free) ─────────────────────────────────────

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

const B64URL_LOOKUP: number[] = (() => {
  const t = new Array<number>(128).fill(-1)
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    t[B64URL_ALPHABET.charCodeAt(i)] = i
  }
  return t
})()

/** Bytes → unpadded base64url (050 §2 roomSecret format). */
export function bytesToB64url(bytes: Uint8Array): string {
  let out = ""
  const n = bytes.length
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < n ? bytes[i + 1] : 0
    const b2 = i + 2 < n ? bytes[i + 2] : 0
    out += B64URL_ALPHABET[b0 >> 2]
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
    if (i + 1 < n) out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]
    if (i + 2 < n) out += B64URL_ALPHABET[b2 & 0x3f]
  }
  return out
}

/** Strict base64url → bytes. Accepts optional `=` padding; rejects any
 *  character outside [A-Za-z0-9_-] (including `+`/`/`/whitespace) and
 *  non-canonical padding. */
export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (s.length === 0) return new Uint8Array(0)
  let pad = 0
  if (s.endsWith("=")) pad = s.endsWith("==") ? 2 : 1
  const bodyLen = s.length - pad
  // structural rule: 1 pad char follows a 3-char body, 2 pads a 2-char body
  if (
    bodyLen % 4 === 1 ||
    (pad === 1 && bodyLen % 4 !== 3) ||
    (pad === 2 && bodyLen % 4 !== 2)
  ) {
    throw new Error(`invalid base64url length ${s.length}`)
  }
  for (let i = 0; i < bodyLen; i++) {
    const code = s.charCodeAt(i)
    if (code >= 128 || B64URL_LOOKUP[code] === -1) {
      throw new Error(`invalid base64url character at index ${i}`)
    }
  }
  // canonical padding: leftover bits past the byte boundary must be zero
  // (pad=1 ⇒ last char's low 2 bits are pad; pad=2 ⇒ low 4 bits are pad)
  if (pad === 1 && (B64URL_LOOKUP[s.charCodeAt(bodyLen - 1)] & 0x03) !== 0) {
    throw new Error("non-canonical base64url padding")
  }
  if (pad === 2 && (B64URL_LOOKUP[s.charCodeAt(bodyLen - 1)] & 0x0f) !== 0) {
    throw new Error("non-canonical base64url padding")
  }
  const out = new Uint8Array(Math.floor((bodyLen * 3) / 4))
  let o = 0
  for (let i = 0; i < bodyLen; i += 4) {
    const a = B64URL_LOOKUP[s.charCodeAt(i)]
    const b = B64URL_LOOKUP[s.charCodeAt(i + 1)]
    const c = i + 2 < bodyLen ? B64URL_LOOKUP[s.charCodeAt(i + 2)] : 0
    const d = i + 3 < bodyLen ? B64URL_LOOKUP[s.charCodeAt(i + 3)] : 0
    out[o++] = (a << 2) | (b >> 4)
    if (i + 2 < bodyLen) out[o++] = ((b & 0x0f) << 4) | (c >> 2)
    if (i + 3 < bodyLen) out[o++] = ((c & 0x03) << 6) | d
  }
  return out
}

// ─── AAD (050 §5 / §8, verbatim) ─────────────────────────────────────────────

/** Message AAD: binds type + room inside GCM (050 §5). */
export function aad(t: string, shareId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`excali-collab/v1|${t}|${shareId}`)
}

/** File-blob AAD: file-scoped ciphertext (050 §8 / 051 §8). */
export function aadFile(fileId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`excali-collab/v1|file|${fileId}`)
}

// ─── canonical signature string (058 §2.1, exact) ────────────────────────────

/**
 * The exact signed bytes, UTF-8 encoded: ciphertext + binding metadata only,
 * so the relay can verify without ever decrypting (058 §2.1). Plain
 * `JSON.stringify` with fixed property order — signer and verifier are the
 * same package, no RFC 8785 needed (057 §3 precedent).
 *
 *   messages:  excali-collab/v1:sign:{"t":..,"room":..,"c":..,"iv":..}
 *   file-data: excali-collab/v1:sign:{"t":"file-data","room":..,"fileId":..,"c":..,"iv":..}
 */
export function contentCanon(
  t: ContentType,
  room: string,
  c: string,
  iv: string,
  fileId?: string,
): string {
  if (t === "file-data") {
    if (fileId === undefined) {
      throw new FrameFormatError('t === "file-data" requires fileId in the canon')
    }
    return `excali-collab/v1:sign:${JSON.stringify({ t, room, fileId, c, iv })}`
  }
  if (fileId !== undefined) {
    throw new FrameFormatError(`fileId is only bound for t === "file-data" (got "${t}")`)
  }
  return `excali-collab/v1:sign:${JSON.stringify({ t, room, c, iv })}`
}

// ─── content key derivation (050 §2 / 057 §1 / 058 §1.1) ─────────────────────

const keyCache = new Map<string, Promise<CryptoKey>>()

function parseBaseSecret(baseSecret: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = b64urlToBytes(baseSecret)
  } catch (e) {
    throw new KeyFormatError(
      `baseSecret is not valid base64url: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (bytes.length !== 32) {
    throw new KeyFormatError(
      `baseSecret must decode to exactly 32 bytes (got ${bytes.length}) — ` +
        `roomSecret/ck are 32 random bytes, b64url (050 §2 / 057 §1)`,
    )
  }
  return bytes
}

/**
 * Derive the AES-GCM-256 content key: HKDF-SHA-256, salt = bytes(shareId),
 * info = bytes("excali-collab/v1/content-key") (050 §2 verbatim). ONE code
 * path for both tiers (057 §1 symmetry rule): private rooms feed
 * bytes(roomSecret), team rooms feed bytes(ck) — the caller's union
 * `{tier:"private"; roomSecret} | {tier:"team"; ck}` is the only place the
 * tier appears. Derived once per session per (baseSecret, shareId), cached.
 * Malformed baseSecret fails HERE with a KeyFormatError (058 §1.1).
 */
export async function deriveContentKey(input: DeriveContentKeyInput): Promise<CryptoKey> {
  const { baseSecret, shareId } = input
  const cacheKey = `${baseSecret}\u0000${shareId}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit

  const secretBytes = parseBaseSecret(baseSecret) // throws KeyFormatError
  const baseKey = await crypto.subtle.importKey("raw", secretBytes, "HKDF", false, [
    "deriveKey",
  ])
  const derived = crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: hkdfSalt(shareId), info: new TextEncoder().encode(CONTENT_KEY_INFO) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  keyCache.set(cacheKey, derived)
  derived.catch(() => keyCache.delete(cacheKey)) // never cache a failure
  return derived
}

/** Drop all cached content keys (session teardown / sign-out). */
export function clearContentKeyCache(): void {
  keyCache.clear()
}

// ─── signing helpers ─────────────────────────────────────────────────────────

async function signerPublicBytes(signer: ContentSigner): Promise<Uint8Array<ArrayBuffer>> {
  if (signer.publicKey instanceof CryptoKey) {
    try {
      return new Uint8Array(await crypto.subtle.exportKey("raw", signer.publicKey))
    } catch (e) {
      throw new SignerError(
        `signer.publicKey CryptoKey is not exportable raw: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  if (signer.publicKey.length !== 32) {
    throw new SignerError(`signer.publicKey must be 32 raw bytes (got ${signer.publicKey.length})`)
  }
  return Uint8Array.from(signer.publicKey) // copy into an ArrayBuffer-backed view (32B)
}

function assertRoomMatches(room: string, shareId: string): void {
  if (room !== shareId) {
    throw new FrameFormatError(
      `room ("${room}") must equal shareId ("${shareId}") — the canon binds \`room\` and ` +
        `the AAD binds shareId to the same asserted shareId`,
    )
  }
}

function requireFileId(t: ContentType, fileId: string | undefined): string {
  if (t === "file-data") {
    if (fileId === undefined || fileId === "") {
      throw new FrameFormatError('t === "file-data" requires a non-empty fileId')
    }
    return fileId
  }
  if (fileId !== undefined) {
    throw new FrameFormatError(`fileId is only valid for t === "file-data" (got "${t}")`)
  }
  return ""
}

// ─── encrypt / decrypt / verify ──────────────────────────────────────────────

/**
 * Encrypt a message payload for the wire (058 §3.1 send path): AES-GCM-256
 * with a fresh 96-bit random nonce and AAD bound to t+room (or fileId for
 * file-data), then an Ed25519 detached sig over contentCanon(t, room, c, iv,
 * fileId) with the member key, attached as `signer {profileId, key}`.
 *
 * The sig is self-verified before returning (058 §3.1: "self-verify the sig
 * before sending") — encryptContent never emits a frame that fails its own
 * signature, so a mismatched privateKey/publicKey pair fails locally with a
 * SignerError instead of producing frames every receiver drops.
 */
export async function encryptContent(input: EncryptContentInput): Promise<SignedFrame> {
  const { key, t, room, shareId, plaintext, signer, fileId } = input
  assertRoomMatches(room, shareId)

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aadBytes = t === "file-data" ? aadFile(requireFileId(t, fileId)) : aad(t, shareId)
  const data = new TextEncoder().encode(JSON.stringify(plaintext))

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadBytes, tagLength: 128 }, key, data),
  )
  const c = bytesToB64url(ciphertext)
  const ivB64 = bytesToB64url(iv)

  const canon = contentCanon(t, room, c, ivB64, fileId)
  const canonBytes = new TextEncoder().encode(canon)
  const sigBytes = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signer.privateKey, canonBytes))
  const publicBytes = await signerPublicBytes(signer)

  const pubKey = await crypto.subtle.importKey("raw", publicBytes, { name: "Ed25519" }, false, [
    "verify",
  ])
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canonBytes)
  if (!ok) {
    throw new SignerError(
      "self-verify failed: signer.privateKey does not match signer.publicKey — " +
        "the frame would be dropped by every receiver (058 §3.1)",
    )
  }

  return {
    c,
    iv: ivB64,
    sig: bytesToB64url(sigBytes),
    signer: { profileId: signer.profileId, key: bytesToB64url(publicBytes) },
  }
}

function decodeIv(ivB64: string): Uint8Array<ArrayBuffer> {
  let iv: Uint8Array<ArrayBuffer>
  try {
    iv = b64urlToBytes(ivB64)
  } catch (e) {
    throw new FrameFormatError(`frame.iv is not valid base64url: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (iv.length !== 12) {
    throw new FrameFormatError(`frame.iv must be a 96-bit nonce (12 bytes, got ${iv.length}) — 050 §3`)
  }
  return iv
}

function decodeCiphertext(cB64: string): Uint8Array<ArrayBuffer> {
  try {
    return b64urlToBytes(cB64)
  } catch (e) {
    throw new FrameFormatError(`frame.c is not valid base64url: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Decrypt a frame to its message payload. GCM auth failure (wrong key,
 * tampered ciphertext, AAD mismatch) throws a GcmAuthError — the typed
 * STALE-KEY signal (050 §6 / 057 §5 signal 2 / 058 §5): after a passing
 * verifyFrameSig, a GCM failure unambiguously means the room key does not
 * match. Structurally malformed frames throw FrameFormatError instead.
 */
export async function decryptContent(input: DecryptContentInput): Promise<unknown> {
  const { key, t, room, shareId, frame, fileId } = input
  assertRoomMatches(room, shareId)

  const iv = decodeIv(frame.iv)
  const ciphertext = decodeCiphertext(frame.c)
  const aadBytes = t === "file-data" ? aadFile(requireFileId(t, fileId)) : aad(t, shareId)

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aadBytes, tagLength: 128 },
      key,
      ciphertext,
    )
  } catch (e) {
    throw new GcmAuthError(
      `GCM auth failure for t="${t}" — stale/wrong room key, tampered ciphertext, or AAD mismatch ` +
        `(${e instanceof Error ? e.name : String(e)})`,
    )
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new FrameFormatError("decrypted payload is not valid JSON")
  }
}

/**
 * Verify a frame's detached Ed25519 sig against its self-attached
 * signer.key (058 §3.1 step 2 / §2.3). Returns false — never throws — on
 * any failure (bad sig/key b64, wrong length, verify failure, malformed
 * canon), so receivers drop silently (058 §3.3: no new error codes, data
 * plane is self-healing). A lying `signer` fails immediately: the sig must
 * verify against the attached key.
 */
export async function verifyFrameSig(frame: ContentFrame): Promise<boolean> {
  try {
    const canon = new TextEncoder().encode(contentCanon(frame.t, frame.room, frame.c, frame.iv, frame.fileId))
    const sigBytes = b64urlToBytes(frame.sig)
    if (sigBytes.length !== 64) return false // Ed25519 sigs are 64 bytes
    const keyBytes = b64urlToBytes(frame.signer.key)
    if (keyBytes.length !== 32) return false // Ed25519 pubkeys are 32 bytes
    const pubKey = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, [
      "verify",
    ])
    return crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canon)
  } catch {
    return false
  }
}
