/**
 * collab-relay verification layer (goal 023 task 039) — store/serve
 * signature verification + storage-integrity rules for the room DO
 * (task 038 consumes this; task 040's files.ts consumes the file half).
 *
 * Authority:
 * - 058 §2.1/§2.3/§3.2 — exact canonical string (contentCanon), self-
 *   contained `signer {profileId, key}`, store/serve verification contract
 * - 059 §4/§5        — canon rebuilt from the relay's OWN shareId/fileId,
 *   never from envelope claims; store-fail ⇒ skip write (frame still
 *   broadcasts; clients verify+drop, 058 §3.3 — no error frame on the
 *   store path); serve-fail ⇒ DELETE the unit, never serve it, respond
 *   SEED_REJECTED (snapshot slot) / FILE_NOT_FOUND (file slot), fatal:false
 * - 051 §2/§4        — file-put/file-get; FILE_NOT_FOUND missing-blob path
 *   (placeholder + retry once)
 *
 * Purity: this module has NO storage, connections, or PartyKit — it
 * decides and reports. The caller (room.ts) owns room.storage and must:
 *
 *   store path:  verifyStore() ok:false ⇒ skip the write, keep the
 *     previous snapshot, log (058 §3.3: store-path failures are silent —
 *     no error frame, no new codes; the frame still broadcasts and every
 *     client drops it). toErrorPayload() exists for logging/diagnostics.
 *   serve path:  verifyServe() ok:false ⇒ DELETE the unit immediately and
 *     NEVER serve it (059 §4: Ed25519 verify is deterministic — a unit
 *     that fails once fails for every joiner and can never recover;
 *     deletion is DoS-equivalent, the room re-seeds from a member's local
 *     gallery), then answer the requester with toErrorPayload() —
 *     SEED_REJECTED for the snapshot slot (client reloads/resyncs),
 *     FILE_NOT_FOUND for the file slot (051 §4 missing-blob path).
 *
 * NOTE — committed wire.ts lags 058: its ClientMessage/RelayMessage
 * seed/scene/pointer variants are still the pre-058 plaintext shapes and
 * wire.Member has no `key` field (058 §6). This module consumes the 058
 * envelope shape from collab-core envelope.ts (committed), NOT wire.ts's
 * content-message variants; `MemberKey` bridges hello.key (057 §3) into
 * the roster member the room DO keeps. Flagged in the task 039 summary.
 */
import { contentCanon, verifyEd25519, verifyFileGet, verifyFrameSig } from "collab-core"
import type { ContentFrame, ContentType, EncryptedPayload, ErrorCode, SignerRef } from "collab-core"

// ─── types ───────────────────────────────────────────────────────────────────

/** Content types the relay ever stores (058 §3.2: pointer is NEVER stored). */
export type StorableContentType = "seed" | "scene" | "file-data"

/**
 * The admitted member's signing identity (058 §3.2): profileId + the
 * member's Ed25519 pubkey as stamped from hello.key (057 §3 — org-sig-
 * pinned at admission; the org key proved membership, the member key
 * proves authorship). Structurally identical to SignerRef; room.ts
 * constructs it from the roster member + hello.
 */
export interface MemberKey {
  profileId: string
  /** member Ed25519 public key, raw 32B, b64url (057 §3 hello.key) */
  key: string
}

/**
 * The pre-stamp signed content envelope (058 §1.3/§2.2) — the store
 * candidate off the wire AND the stored unit in room.storage (the relay
 * never re-signs, never re-mints `t`, never adds `from` to storage):
 * `{ v, t, p: {c, iv}, sig, signer }`. `room`/`fileId` are deliberately
 * absent — they live only in the canon, rebuilt from the relay's own ids.
 */
export interface SignedContentEnvelope {
  v: 1
  t: StorableContentType
  p: EncryptedPayload
  /** b64url Ed25519 (64B) over rebuildCanon(...) — 058 §2.1 */
  sig: string
  /** self-asserted but sig-verified (058 §2.3) — makes stored units self-contained */
  signer: SignerRef
}

/**
 * The ids the canon is rebuilt from — ALWAYS the relay's own state, never
 * client-supplied values (059 §4): shareId is the room the connection was
 * admitted to (059 §3 step 5); fileId is the in-flight `file-put` header
 * at store time (051 §2) / the storage Map key at serve time.
 */
export interface VerifyContext {
  /** the relay's own room id (from conn.uri/route) */
  shareId: string
  /** the relay's own file storage key; required iff t === "file-data" */
  fileId?: string
}

/** A rejected verification — the caller must NOT store (store path) or
 *  MUST delete + never serve (serve path). fatal is always false: these
 *  are data-plane failures, never connection-level refusals (058 §3.3). */
export interface VerifyFailure {
  ok: false
  code: ErrorCode
  reason: string
}

export type StoreVerifyResult = { ok: true } | VerifyFailure
export type ServeVerifyResult = { ok: true; unit: SignedContentEnvelope } | VerifyFailure

/** Wire-ready error payload (049 §1 error frame `p`): fatal:false always. */
export interface ErrorPayload {
  code: ErrorCode
  reason: string
  fatal: false
}

// ─── canon rebuild (059 §4 — relay's own ids, single collab-core impl) ──────

/**
 * The exact canonical signature string, rebuilt from the RELAY's OWN ids
 * (058 §2.1, single implementation = collab-core's contentCanon — zero
 * drift): `excali-collab/v1:sign:{t, room, c, iv}` for messages and
 * `…{t:"file-data", room, fileId, c, iv}` for file bodies.
 *
 * `shareId` MUST be the relay's own room id and `fileId` the relay's own
 * storage key — never values from the frame or its payload. A frame that
 * was signed against a different room/fileId fails every verification
 * that rebuilds the canon from this function (cross-room smuggling fails
 * here by construction, 058 §4.2).
 *
 * Throws collab-core's FrameFormatError on t/fileId misuse (fileId bound
 * iff t === "file-data"); the verify paths below guard before calling.
 */
export function rebuildCanon(
  t: ContentType,
  shareId: string,
  c: string,
  iv: string,
  fileId?: string,
): string {
  return contentCanon(t, shareId, c, iv, fileId)
}

// ─── error payload helpers ───────────────────────────────────────────────────

/** FILE_NOT_FOUND payload for a missing/expired/deleted unit (051 §4): a
 *  `file-get` on a unit the room does not have must answer this — never a
 *  crash, never a fatal code. The client shows a placeholder + retries. */
export function fileNotFound(reason: string): ErrorPayload {
  return { code: "FILE_NOT_FOUND", reason, fatal: false }
}

/** Convert a verification failure into the wire error payload (fatal:false). */
export function toErrorPayload(f: VerifyFailure): ErrorPayload {
  return { code: f.code, reason: f.reason, fatal: false }
}

// ─── shape guard ─────────────────────────────────────────────────────────────

/** Runtime shape guard for a signed content envelope (058 §2.2) — the
 *  relay's codec check before store/serve verification. Structural
 *  failures map to CHUNK_INVALID (058 §3.3: CHUNK_INVALID covers
 *  structurally broken frames). */
export function isSignedContentEnvelope(x: unknown): x is SignedContentEnvelope {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false
  const e = x as Record<string, unknown>
  const p = e.p as Record<string, unknown> | null | undefined
  const s = e.signer as Record<string, unknown> | null | undefined
  return (
    e.v === 1 &&
    (e.t === "seed" || e.t === "scene" || e.t === "file-data") &&
    p !== null &&
    typeof p === "object" &&
    typeof p.c === "string" &&
    p.c !== "" &&
    typeof p.iv === "string" &&
    p.iv !== "" &&
    typeof e.sig === "string" &&
    e.sig !== "" &&
    s !== null &&
    typeof s === "object" &&
    typeof s.profileId === "string" &&
    s.profileId !== "" &&
    typeof s.key === "string" &&
    s.key !== ""
  )
}


/** A plaintext (team-room, honest-relay) file-data unit: `p` is the dataURL
 * string, UNSIGNED (052: team vs private). The store/serve paths treat this
 * as valid-by-construction — no signature, no ciphertext.
 * @see isFileDataUnit for the signed-vs-plaintext disjunction */
export interface PlaintextFileData {
  v: 1
  t: "file-data"
  p: string
}

/** Structural guard: a team/plaintext file-data unit (unsigned, 052). */
export function isPlaintextFileData(x: unknown): x is PlaintextFileData {
  return (
    x !== null &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    (x as Record<string, unknown>).v === 1 &&
    (x as Record<string, unknown>).t === "file-data" &&
    typeof (x as Record<string, unknown>).p === "string" &&
    (x as Record<string, unknown>).p !== ""
  )
}

/** A file-data unit — signed ciphertext (private) OR plaintext (team). */
export type FileDataUnit = SignedContentEnvelope | PlaintextFileData

/** Structural guard: any well-formed file-data unit (signed or plaintext).
 * The store/serve codec check before serving/parsing a stored file. */
export function isFileDataUnit(x: unknown): x is FileDataUnit {
  return isSignedContentEnvelope(x) || isPlaintextFileData(x)
}
function fail(code: ErrorCode, reason: string): VerifyFailure {
  return { ok: false, code, reason }
}

// ─── store-verify (058 §3.2 / 059 §4) ────────────────────────────────────────

/**
 * Store-verify — call BEFORE any write to room.storage (seed/scene →
 * snapshot slot; file-data → files Map). Verifies the frame's Ed25519 sig
 * against the SENDING CONN's OWN admitted `Member.key` (the org-sig-
 * pinned key from hello — never the org key, which proved membership at
 * admission, not authorship), and requires `signer == Member`
 * ({profileId, key} both equal, 058 §3.2). The canon is rebuilt from the
 * relay's OWN shareId/fileId (059 §4).
 *
 * Failures (all fatal:false, none stored):
 * - CHUNK_INVALID      — structurally malformed frame; t/fileId misuse;
 *                        sig does not verify against the member's admitted
 *                        key (tampered frame or buggy sender)
 * - ADMISSION_INVALID  — signer {profileId,key} does not equal the
 *                        admitted member (misattributed frame, 058 §3.2)
 *
 * Per 058 §3.3 the store path sends NO error frame — on ok:false the
 * caller skips the write, keeps the previous snapshot, and logs; the
 * frame still broadcasts (clients verify + drop it).
 */
export async function verifyStore(
  frame: SignedContentEnvelope,
  member: MemberKey,
  ctx: VerifyContext,
): Promise<StoreVerifyResult> {
  if (!isSignedContentEnvelope(frame)) {
    return fail("CHUNK_INVALID", "frame is not a well-formed signed content envelope (058 §2.2)")
  }
  if (frame.t === "file-data" && (ctx.fileId === undefined || ctx.fileId === "")) {
    return fail(
      "CHUNK_INVALID",
      't === "file-data" requires the fileId bound by the preceding file-put header on this connection (051 §2 / 058 §3.2)',
    )
  }
  if (frame.t !== "file-data" && ctx.fileId !== undefined) {
    return fail("CHUNK_INVALID", `fileId is only bound for t === "file-data" (got "${frame.t}", 058 §2.1)`)
  }

  // 058 §3.2: signer must equal the admitted member ({profileId, key} both equal)
  if (frame.signer.profileId !== member.profileId || frame.signer.key !== member.key) {
    return fail(
      "ADMISSION_INVALID",
      `signer {profileId, key} does not equal the admitted member (058 §3.2) — ` +
        `frame from "${frame.signer.profileId}" cannot be attributed to member "${member.profileId}"; not stored`,
    )
  }

  // canon from the relay's own ids; verify against the member's admitted key
  const canon = rebuildCanon(frame.t, ctx.shareId, frame.p.c, frame.p.iv, ctx.fileId)
  const sigOk = await verifyEd25519(canon, frame.sig, member.key)
  if (!sigOk) {
    return fail(
      "CHUNK_INVALID",
      `content signature does not verify against member "${member.profileId}"'s admitted key ` +
        `for room "${ctx.shareId}" (058 §3.2) — tampered frame or buggy sender; not stored`,
    )
  }
  return { ok: true }
}

// ─── serve-verify (059 §4) ───────────────────────────────────────────────────

/**
 * Serve-verify — call BEFORE serving ANY stored unit (snapshot slot:
 * t seed|scene; file slot: t file-data, fileId = the storage Map key).
 * Rebuilds the canon from the relay's OWN shareId/fileId and verifies the
 * sig against the unit's SELF-CONTAINED signer.key (058 §2.3 — no roster
 * exists at serve time; store-time already pinned that signer to an
 * admitted member). Cross-room smuggling fails here by construction: the
 * canon embeds the SERVING room's shareId (058 §4.2).
 *
 * Failure semantics (059 §4 — deterministic failure never recovers): on
 * ok:false the caller MUST delete the unit from room.storage immediately
 * and NEVER serve it — a unit that fails once fails for every joiner and
 * can never recover; leaving it wedges the room between
 * snapshotAvailable:false and SEED_REJECTED with no exit. The error code
 * is slot-driven (never a fatal code):
 * - snapshot slot → SEED_REJECTED   (client reloads/resyncs)
 * - file slot     → FILE_NOT_FOUND  (051 §4: placeholder + retry once)
 */
export async function verifyServe(
  unit: SignedContentEnvelope,
  ctx: VerifyContext,
): Promise<ServeVerifyResult> {
  const fileId = ctx.fileId
  const fileSlot = fileId !== undefined && fileId !== ""
  const code: ErrorCode = fileSlot ? "FILE_NOT_FOUND" : "SEED_REJECTED"

  if (!isSignedContentEnvelope(unit)) {
    return fail(code, "stored unit is not a well-formed signed content envelope (058 §1.3)")
  }
  if (fileSlot && unit.t !== "file-data") {
    return fail(code, `file slot holds a "${unit.t}" unit — storage layout violation (059 §6); deleted, never served`)
  }
  if (!fileSlot && unit.t === "file-data") {
    return fail(
      "FILE_NOT_FOUND",
      "file-data unit has no storage key — cannot rebuild the file canon (059 §4); deleted, never served",
    )
  }

  const frame: ContentFrame = {
    t: unit.t,
    room: ctx.shareId, // the relay's own room id — never a stored claim
    c: unit.p.c,
    iv: unit.p.iv,
    sig: unit.sig,
    signer: unit.signer,
    ...(fileSlot ? { fileId } : {}), // the relay's own storage key — never a stored claim
  }
  const sigOk = await verifyFrameSig(frame)
  if (!sigOk) {
    return fail(
      code,
      `serve-verify failed — stored ${fileSlot ? "file" : "snapshot"} is corrupted, tampered, or signed by a ` +
        `rotated key; DELETED, never served (059 §4)`,
    )
  }
  return { ok: true, unit }
}

// ─── file-get authorization gate (058 §2.5 / file-gate) ─────────────────────

/**
 * Verify a connection's `file-get` authorization before serving (the file-get
 * gate): the request must carry an Ed25519 signature over
 * `excali-collab/v1:sign:{"t":"file-get","room":..,"fileId":..}` rebuilt
 * from the RELAY's OWN shareId + the requested fileId, verified against the
 * requesting connection's ADMITTED member key (`member`, from hello.key — 059
 * §3). A valid sig proves the requester is an admitted member of THIS room:
 * cross-room smuggling fails here by construction (the canon embeds the relay's
 * own room id), so a sig bound to a different room/fileId is refused.
 *
 * Failures are non-fatal — CHUNK_INVALID when the sig is missing/malformed or
 * does not verify. The caller must NOT serve the unit.
 */
export async function verifyFileGetRequest(
  member: MemberKey,
  shareId: string,
  fileId: string,
  sig: unknown,
): Promise<StoreVerifyResult> {
  if (typeof sig !== "string" || sig === "") {
    return fail(
      "CHUNK_INVALID",
      "file-get requires a member signature over {t:file-get, room, fileId} — " +
        "refused (file-get authorization gate)",
    )
  }
  const sigOk = await verifyFileGet(shareId, fileId, sig, member.key)
  if (!sigOk) {
    return fail(
      "CHUNK_INVALID",
      `file-get signature does not verify against member "${member.profileId}"'s ` +
        `admitted key for room "${shareId}" — file ${fileId} not served (file-get gate)`
    )
  }
  return { ok: true }
}
