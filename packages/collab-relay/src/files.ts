/**
 * collab-relay file store (goal 023 task 040) — content-addressed file
 * put/get for the room DO. Consumed by task 041's room.ts wiring (which
 * owns the ChunkAssembler + roster; this module owns the file domain).
 *
 * Authority:
 * - 051 §2/§4   — file-put/file-get/file/file-available message shapes;
 *                 FILE_NOT_FOUND missing-blob path (placeholder + retry)
 * - 051 §7      — 20MB per-file v1 cap; above-cap refused, never a partial
 *                 relay state
 * - 051 §8      — private rooms: the relay stores/serves OPAQUE ciphertext,
 *                 content-blind (fileId/mimeType/size are plaintext metadata)
 * - 058 §2.1    — file-body canon binds {t:"file-data", room, fileId, c, iv}
 * - 058 §3.2/§3.3 — store-verify vs the SENDING member's key; store-path
 *                 failures are SILENT (no error frame; the frame broadcasts
 *                 and clients verify+drop)
 * - 059 §4/§5   — canon rebuilt from the relay's OWN room id + storage key;
 *                 serve-fail ⇒ DELETE + FILE_NOT_FOUND (deterministic
 *                 failure never recovers); file-data → store → file-available
 * - 059 §6      — exact-duplicate suppression (file slot: byte-identical
 *                 unit under the same fileId ⇒ neither re-stored nor
 *                 re-broadcast)
 * - 052 §4      — files live in room.storage (`file:<fileId>` keys) and
 *                 survive DO hibernation + code deploys
 * - 052 §5      — guard failures (over-cap) are drop + error{CHUNK_INVALID}
 *
 * Content addressing: fileId = base64url(sha256(content bytes)) — the
 * CLIENT derives it (051 §3) and the canon binds it (058 §2.1). This relay
 * is content-blind: it cannot re-derive the hash from what it holds (private
 * rooms store ciphertext, hashed-as-plaintext by the client), so it keys
 * room.storage by the file-put header's claimed fileId — honest clients
 * converge on the same id for the same content, which is what makes dedup
 * free. `deriveFileId` is exported for tests + host-app use.
 *
 * Storage layout (052 §4): room.storage key `file:<fileId>` holds a
 * StoredFileRecord { envelope, mimeType, size } — the pre-stamp signed
 * file-data envelope served VERBATIM (058 §1.3) plus the plaintext
 * metadata needed for `file`/`file-available` after hibernation wakes.
 * The key namespace is per-room (room.storage is the room's own), so the
 * same fileId in two rooms is two independent units.
 *
 * Purity: no PartyKit runtime — storage + hooks are injected like room.ts.
 * In-flight file-put headers are per-connection session state (one in-flight
 * upload per conn, 059 §4), cleared on use and on leave.
 */

import { CHUNK_THRESHOLD, bytesToB64url, serializeEnvelope } from "collab-core"
import type { ErrorCode } from "collab-core"
import { fileNotFound, isFileDataUnit, isPlaintextFileData, isSignedContentEnvelope, toErrorPayload, verifyFileGetRequest, verifyServe, verifyStore } from "./verify"
import type { ErrorPayload, FileDataUnit, MemberKey, SignedContentEnvelope } from "./verify"
import type { RoomHooks, RoomStorage } from "./room"

/** 051 §7: per-file v1 cap, enforced on the REASSEMBLED payload the relay actually holds. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** room.storage key prefix for file units (052 §4 files map → flat keys). */
export const FILE_KEY_PREFIX = "file:"

/** room.storage key for a fileId — the relay's own storage key, room-scoped
 *  by virtue of room.storage being the room's own namespace (052 §4). */
export function fileKey(fileId: string): string {
  return FILE_KEY_PREFIX + fileId
}

/**
 * 051 §3: content address — fileId = base64url(sha256(bytes)), b64url
 * unpadded (43 chars). The relay cannot verify this against what it stores
 * (content-blind in private rooms), so this is the CLIENT's derivation
 * contract; the relay keys by the claimed id and dedup falls out of honest
 * clients converging. Exported for tests + the host-app collab layer.
 */
export async function deriveFileId(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer))
  return bytesToB64url(digest)
}

/** 051 §2 file-put header — the relay's plaintext metadata for a file unit. */
export interface FilePutHeader {
  fileId: string
  mimeType: string
  /** declared size (plaintext bytes, client-side) — rides file-available;
   *  the relay's OWN reassembled-size measurement enforces the cap. */
  size: number
}

/** Shape-guard for the file-put header (052 §5: structural failures are CHUNK_INVALID). */
export function parseFilePutHeader(x: unknown): FilePutHeader | null {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return null
  const p = x as Record<string, unknown>
  if (typeof p.fileId !== "string" || p.fileId === "") return null
  if (typeof p.mimeType !== "string" || p.mimeType === "") return null
  if (typeof p.size !== "number" || !Number.isFinite(p.size) || p.size < 0) return null
  return { fileId: p.fileId, mimeType: p.mimeType, size: p.size }
}

/** The unit stored under `file:<fileId>` (052 §4 / 059 §6). */
export interface StoredFileRecord {
  /** pre-stamp file-data envelope — served verbatim (058 §1.3 / 052): signed
   *  ciphertext in private rooms, plaintext string in team rooms */
  envelope: FileDataUnit
  /** plaintext routing metadata (051 §8: metadata is plaintext by design) */
  mimeType: string
  /** declared size from the file-put header */
  size: number
}

/** Shape-guard for a stored file record (the load path). A corrupt record —
 *  wrong envelope shape, non-file-data envelope, bad metadata — is rejected
 *  so the caller can delete it and answer FILE_NOT_FOUND (059 §4 serve-fail
 *  on the load path). */
export function parseFileRecord(raw: unknown): StoredFileRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (!isFileDataUnit(rec.envelope)) return null
  if (rec.envelope.t !== "file-data") return null
  if (typeof rec.mimeType !== "string" || rec.mimeType === "") return null
  if (typeof rec.size !== "number" || !Number.isFinite(rec.size) || rec.size < 0) return null
  return { envelope: rec.envelope, mimeType: rec.mimeType, size: rec.size }
}

export type PutFileResult =
  | { ok: true; fileId: string; stored: "stored" | "duplicate" }
  | { ok: false; code: ErrorCode; reason: string }

/** Delivery seam — mirrors RoomHooks (send = requester-directed, broadcast = fan-out). */
export interface FileStoreOptions {
  /** the relay's own room id — canon shareId for store/serve-verify (059 §4) */
  roomId: string
  /** the room's own room.storage (052 §4 — per-room namespace) */
  storage: RoomStorage
  hooks: RoomHooks
}

export interface FileStore {
  /**
   * Register a connection's in-flight file-put header (051 §2: one in-flight
   * upload per conn, 059 §4). Structurally malformed headers and declared
   * sizes over the 20MB cap are refused with error{CHUNK_INVALID, fatal:false}
   * (052 §5 guard) and NOT registered — never a partial relay state (051 §7).
   */
  beginPut(connId: string, rawHeader: unknown): void

  /**
   * Store a reassembled file-data envelope (room.ts feeds it after chunk
   * reassembly). Store-verify vs the SENDING member's key (058 §3.2) →
   * 20MB cap on the reassembled payload (051 §7) → store under
   * `file:<fileId>` → broadcast `file-available` to the others (sender
   * excluded, 051 §2/059 §5).
   *
   * Failure modes:
   * - verify failures (missing header, wrong signer, bad sig) are SILENT —
   *   058 §3.3 store path: nothing stored, no error frame, the caller logs.
   * - over-cap is the 052 §5 guard: an error{CHUNK_INVALID, fatal:false}
   *   frame goes to the sender, nothing stored.
   * - a byte-identical unit under the same fileId is neither re-stored nor
   *   re-broadcast (059 §6 exact-duplicate suppression) → stored:"duplicate".
   *   Different bytes under the same fileId overwrite (content-addressed
   *   key; last-write-wins) → stored:"stored".
   */
  putFile(connId: string, unit: FileDataUnit, member: MemberKey): Promise<PutFileResult>

  /**
   * Serve a stored file to a requester whose file-get carries a valid member
   * signature (the file-get authorization gate): `file { fileId, mimeType }`
   * then the stored envelope (chunked over the standard framing when > 200KB).
   * A missing/invalid/misattributed sig is refused with a non-fatal error and
   * the unit is NOT served. Signed records are serve-verified (059 §4);
   * plaintext (team) records are served verbatim (052). On any storage failure
   * — missing, corrupt record, or failed serve-verification — the unit is
   * DELETED (when present) and the requester gets error{FILE_NOT_FOUND,
   * fatal:false} (051 §4: placeholder + retry once). Never crashes the room.
   */
  getFile(connId: string, payload: unknown, member: MemberKey): Promise<void>

  /** Connection teardown — drop any in-flight file-put header (059 §4). */
  leave(connId: string): void

  /** The in-flight header for a connection, if any (test/observability aid). */
  inflight(connId: string): FilePutHeader | undefined
}

export function createFileStore(options: FileStoreOptions): FileStore {
  return new FileStoreImpl(options.roomId, options.storage, options.hooks)
}

class FileStoreImpl implements FileStore {
  private readonly roomId: string
  private readonly storage: RoomStorage
  private readonly hooks: RoomHooks
  /** per-connection in-flight file-put header (session state, never persisted — 052 §4) */
  private readonly inflightHeaders = new Map<string, FilePutHeader>()

  constructor(roomId: string, storage: RoomStorage, hooks: RoomHooks) {
    this.roomId = roomId
    this.storage = storage
    this.hooks = hooks
  }

  beginPut(connId: string, rawHeader: unknown): void {
    const header = parseFilePutHeader(rawHeader)
    if (header === null) {
      this.sendError(
        connId,
        "CHUNK_INVALID",
        "file-put header must be { fileId: string, mimeType: string, size: number } (051 §2)",
      )
      return
    }
    if (header.size > MAX_FILE_BYTES) {
      // 052 §5 guard: refuse before any chunk is accepted — never a partial relay state (051 §7)
      this.sendError(
        connId,
        "CHUNK_INVALID",
        `file-put declares ${header.size} bytes — over the 20MB v1 cap (051 §7); upload refused, nothing stored`,
      )
      return
    }
    this.inflightHeaders.set(connId, header)
  }

  async putFile(connId: string, unit: FileDataUnit, member: MemberKey): Promise<PutFileResult> {
    // one in-flight upload per conn (059 §4) — consumed by this attempt, success or not
    const header = this.inflightHeaders.get(connId)
    this.inflightHeaders.delete(connId)

    if (unit === null || typeof unit !== "object" || Array.isArray(unit)) {
      return { ok: false, code: "CHUNK_INVALID", reason: "file slot requires a well-formed file-data envelope (058 §2.2)" }
    }
    if (unit.t !== "file-data") {
      return { ok: false, code: "CHUNK_INVALID", reason: 'file slot only accepts t === "file-data" envelopes (058 §3.2)' }
    }

    // TEAM rooms ride plaintext file-data: `p` is the dataURL string, unsigned.
    // 052 honest-relay model — there is no signature to verify, so store-verify
    // is SKIPPED (the signed/encrypted store-verify below stays for PRIVATE).
    // A missing file-put header is still a protocol violation (nothing to key by).
    if (isPlaintextFileData(unit)) {
      if (header === undefined) {
        return {
          ok: false,
          code: "CHUNK_INVALID",
          reason: "file-data requires the preceding file-put header on this connection (051 §2)",
        }
      }
    } else if (isSignedContentEnvelope(unit)) {
      // store-verify (058 §3.2 / 059 §4): canon rebuilt from the relay's OWN ids.
      // fileId undefined ⇒ the canonical missing-header rejection (058 §3.2).
      const res = await verifyStore(unit, member, { shareId: this.roomId, fileId: header?.fileId })
      if (!res.ok) {
        // 058 §3.3: store-path failures are silent — no error frame, caller logs
        return { ok: false, code: res.code, reason: res.reason }
      }
    } else {
      return {
        ok: false,
        code: "CHUNK_INVALID",
        reason: "file-data envelope must be a signed/encrypted frame (private, 058 §2.2) or a plaintext string (team, 052)",
      }
    }

    // 20MB v1 cap (051 §7), enforced on the REASSEMBLED payload — the bytes the
    // relay actually holds (ciphertext in private rooms: cap applies to those
    // bytes, 051 §8). The relay measures independently of the client's claim.
    const serialized = new TextEncoder().encode(JSON.stringify(unit))
    if (serialized.length > MAX_FILE_BYTES) {
      // 052 §5 guard: drop + error{CHUNK_INVALID} — refused, never partial relay state (051 §7)
      const reason = `file-put exceeds the 20MB v1 cap (051 §7): reassembled payload ${serialized.length} bytes > ${MAX_FILE_BYTES}; refused, nothing stored`
      this.sendError(connId, "CHUNK_INVALID", reason)
      return { ok: false, code: "CHUNK_INVALID", reason }
    }

    const key = fileKey(header!.fileId)
    const record: StoredFileRecord = { envelope: unit, mimeType: header!.mimeType, size: header!.size }

    // 059 §6 exact-duplicate suppression (file slot): same fileId + byte-identical
    // unit ⇒ neither re-stored nor re-broadcast. Different bytes under the same
    // fileId overwrite (content-addressed key, last-write-wins).
    let existing: StoredFileRecord | null = null
    try {
      existing = parseFileRecord(await this.storage.get(key))
    } catch {
      existing = null // storage read failure ⇒ treat as absent; never crash the room
    }
    if (existing !== null && JSON.stringify(existing.envelope) === JSON.stringify(unit)) {
      return { ok: true, fileId: header!.fileId, stored: "duplicate" }
    }

    try {
      await this.storage.put(key, record)
    } catch {
      // relay-side storage failure — nothing stored, no sender error frame (058 §3.3 spirit)
      return { ok: false, code: "CHUNK_INVALID", reason: "room.storage write failed; file not stored" }
    }

    // 051 §2 / 059 §5: on put-complete, announce to the OTHERS (sender excluded) —
    // peers mark the fileId known and fetch lazily on element render (051 §3).
    this.hooks.broadcast(
      JSON.stringify({
        v: 1,
        t: "file-available",
        p: { fileId: header!.fileId, mimeType: header!.mimeType, size: header!.size },
      }),
      connId,
    )
    return { ok: true, fileId: header!.fileId, stored: "stored" }
  }

  async getFile(connId: string, payload: unknown, member: MemberKey): Promise<void> {
    // file-get authorization gate: the payload must be { fileId, sig }, sig an
    // Ed25519 signature over the relay's own shareId + the requested fileId,
    // verified against the requesting conn's admitted member key. Missing or
    // invalid sig ⇒ non-fatal error, nothing served (fail closed).
    const req = payload as { fileId?: unknown; sig?: unknown } | null
    const fileId = req?.fileId
    if (typeof fileId !== "string" || fileId === "") {
      this.sendError(connId, "CHUNK_INVALID", "file-get payload must be { fileId: string, sig: string } (file-get gate)")
      return
    }
    const gate = await verifyFileGetRequest(member, this.roomId, fileId, req?.sig)
    if (!gate.ok) {
      // refused — never serve, never throw, never crash the room (fatal:false)
      this.sendErrorPayload(connId, toErrorPayload(gate))
      return
    }

    const key = fileKey(fileId)
    let raw: unknown
    try {
      raw = await this.storage.get(key)
    } catch {
      raw = undefined // storage read failure ⇒ treat as missing; never crash the room
    }

    const record = parseFileRecord(raw)
    if (record === null) {
      if (raw !== undefined) {
        // a record exists but fails the shape guard — serve-fail on the load path
        // (059 §4): deterministic failure never recovers — delete, never serve
        try {
          await this.storage.delete(key)
        } catch {
          /* ignore */
        }
        this.sendErrorPayload(
          connId,
          fileNotFound(`stored file record for fileId "${fileId}" is corrupt — deleted, never served (059 §4)`),
        )
      } else {
        // 051 §4: missing blob — placeholder + retry once on the client
        this.sendErrorPayload(connId, fileNotFound(`no blob stored for fileId "${fileId}" (051 §4)`))
      }
      return
    }

    // serve-verify (059 §4 / 052): SIGNED records re-verify the sig with the
    // canon rebuilt from the relay's OWN room id + storage key (cross-room
    // smuggling fails by construction); PLAINTEXT (team) records are served
    // verbatim — there is nothing to verify (052 honest-relay model).
    if (isSignedContentEnvelope(record.envelope)) {
      const served = await verifyServe(record.envelope, { shareId: this.roomId, fileId })
      if (!served.ok) {
        // deterministic failure never recovers — DELETE the unit, never serve it (059 §4)
        try {
          await this.storage.delete(key)
        } catch {
          /* ignore */
        }
        this.sendErrorPayload(connId, toErrorPayload(served))
        return
      }
    }

    // serve: `file { fileId, mimeType }` header, then the stored pre-stamp
    // envelope verbatim (058 §1.3), chunked over the standard framing when
    // large (049 §3 / 051 §2 — same codec as scene)
    this.hooks.send(connId, JSON.stringify({ v: 1, t: "file", p: { fileId, mimeType: record.mimeType } }))
    const ser = serializeEnvelope(record.envelope)
    if (ser.chunked) {
      for (const frame of ser.frames) this.hooks.send(connId, JSON.stringify(frame))
    } else {
      this.hooks.send(connId, JSON.stringify(record.envelope))
    }
  }

  leave(connId: string): void {
    this.inflightHeaders.delete(connId)
  }

  inflight(connId: string): FilePutHeader | undefined {
    return this.inflightHeaders.get(connId)
  }

  private sendError(connId: string, code: ErrorCode, reason: string): void {
    this.hooks.send(connId, JSON.stringify({ v: 1, t: "error", p: { code, reason, fatal: false } }))
  }

  private sendErrorPayload(connId: string, p: ErrorPayload): void {
    this.hooks.send(connId, JSON.stringify({ v: 1, t: "error", p }))
  }
}
