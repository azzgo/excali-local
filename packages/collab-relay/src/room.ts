/**
 * collab-relay room DO — the post-admission room behavior (goal 023 task 038).
 *
 * Owns: the in-memory roster, `welcome` + `peer{join|leave}` deltas, the
 * first-seed-wins snapshot (room.storage-backed), `scene` relay with
 * envelope-level `from` stamping + exact-duplicate suppression, and the
 * transparent chunk-reassembly receive path.
 *
 * Authority: 049 §1/§2 (message table; seeding sequence + first-seed-wins race
 * rule), 052 §3/§4 (post-admission lifecycle; room.storage snapshot + DO
 * hibernation semantics), 058 §1.3/§2.2/§3.2 (stored unit = pre-stamp
 * envelope; envelope-level `from`; serve = stored envelope verbatim), 059 §5/§6
 * (routing deltas; exact-duplicate suppression).
 *
 * Scope notes — conflicts between the sealed specs and the committed wire:
 * - The COMMITTED collab-core wire is the plaintext form (`seed`/`scene`
 *   `p = {elements, seq}`). 059 §4's store/serve Ed25519 verification and 059
 *   §5's verbatim-`t` seed broadcast belong to the encrypted signed-envelope
 *   contract (058 §6 types — not yet in committed collab-core) and cannot be
 *   implemented here. This module follows 049 §1/§2 + the task spec: the
 *   winning seed is re-minted as `scene` — the only full-scene relay type in
 *   the committed wire (clients apply seed/scene identically, 058 §1.3).
 * - 058 §1.3 supersedes 049 §3's "stored as its chunk set": room.storage has
 *   no 256KB cap, so the relay stores the REASSEMBLED pre-stamp envelope and
 *   re-chunks with the standard framing at store time. The resulting chunk
 *   set is kept in the stored record, so every serve reuses the same frames
 *   and chunk id.
 * - Live chunk broadcasts now carry the optional relay-stamped `from` on each
 *   chunk frame; the assembler restores it after reassembly. Stored snapshot
 *   chunks remain pre-stamp and are served without `from`.
 *
 * PartyKit seam: this class never imports the PartyKit runtime. The host
 * (task 041's party.config wiring) injects `send`/`broadcast`/`storage` and
 * drives `join` (post-admission), `message` (post-welcome routing), `leave`.
 */
import { CHUNK_THRESHOLD, ChunkAssembler, serializeEnvelope } from "collab-core"
import type { ChunkFrame, ErrorCode, HelloPayload, Member, WireEnvelope } from "collab-core"
import type { FileStore } from "./files"
import { MAX_CHUNKS_PER_MESSAGE } from "./guards"
import type { MemberKey, SignedContentEnvelope } from "./verify"

/** room.storage key holding the room's snapshot record (052 §4). */
export const SNAPSHOT_KEY = "snapshot"

/** 052 §5: single frames above this serialized byte size are dropped with CHUNK_INVALID. */
export const MAX_FRAME_BYTES = 1024 * 1024

/** 049 §2: the reason carried by the non-fatal SEED_REJECTED error. */
export const SEED_REJECT_REASON =
  "room already has a snapshot — first seed wins (049 §2); reload the scene you just saw broadcast"

/** Delivery seam — implemented by the PartyKit host (task 041). */
export interface RoomHooks {
  /** Deliver one serialized frame to a single connection. */
  send(connId: string, frame: string): void
  /** Deliver one serialized frame to every member except `exceptConnId` (omitted = everyone). */
  broadcast(frame: string, exceptConnId?: string): void
}

/** Minimal room.storage surface (a subset of PartyKit's RoomStorage). */
export interface RoomStorage {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface RoomStateOptions {
  roomId: string
  hooks: RoomHooks
  storage: RoomStorage
  /**
   * Optional file-domain wiring (task 041 — files.ts's documented consumer):
   * when present, file-put / file-get / file-data messages route into the
   * FileStore instead of being dropped (051).
   */
  fileStore?: FileStore
  /**
   * connId → admitted member key (058 §3.2 store-verify identity): populated
   * by join() from hello.key when a fileStore is wired.
   */
  memberKeys?: Map<string, MemberKey>
}

/** Pre-stamp full-scene envelope stored by the relay (058 §1.3: `t` preserved, no `from`). */
export interface SnapshotEnvelope {
  v: 1
  /** always "scene" today — the winning seed is re-minted as scene (049 §1); "seed" reserved for the 058 verbatim-`t` future */
  t: "seed" | "scene"
  p: { elements: unknown[]; seq: number }
}

/** room.storage record under SNAPSHOT_KEY: the reassembled envelope plus the chunk set when chunked. */
export interface RoomSnapshotRecord {
  /** null when chunked — envelope is reconstructed from frames on serve (058 §1.3) */
  envelope: SnapshotEnvelope | null
  /** chunk id of the stored chunk set — present iff `frames` is (049 §3 / 058 §1.3) */
  chunkId?: string
  /** the stored chunk set — re-served verbatim to joiners */
  frames?: ChunkFrame[]
}

function isChunkFrame(x: unknown): x is ChunkFrame {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false
  const rec = x as Record<string, unknown>
  const p = rec.p
  if (p === null || typeof p !== "object" || Array.isArray(p)) return false
  const f = p as Record<string, unknown>
  return (
    rec.v === 1 &&
    rec.t === "chunk" &&
    (rec.from === undefined || typeof rec.from === "string") &&
    typeof f.id === "string" &&
    typeof f.n === "number" &&
    Number.isInteger(f.n) &&
    f.n > 0 &&
    typeof f.i === "number" &&
    Number.isInteger(f.i) &&
    f.i >= 0 &&
    typeof f.d === "string"
  )
}

/**
 * Shape-guard for a stored snapshot record (the load path). A corrupt record —
 * including a partial/invalid chunk set — is rejected so the caller can delete
 * it and treat the room as empty (059 §4 serve-fail semantics).
 */
export function parseSnapshotRecord(raw: unknown): RoomSnapshotRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const env = rec.envelope
  const hasChunkId = typeof rec.chunkId === "string" && rec.chunkId !== ""
  const frames = rec.frames

  // Chunked record: envelope may be absent (storage optimization — 058 §1.3)
  // Reconstruct from frames when serving.
  if (hasChunkId || frames !== undefined) {
    if (!hasChunkId || !Array.isArray(frames) || frames.length === 0 || !frames.every(isChunkFrame)) return null
    const record: RoomSnapshotRecord = {
      envelope: null as unknown as SnapshotEnvelope, // reconstructed from frames on serve
      chunkId: rec.chunkId as string,
      frames: frames as ChunkFrame[],
    }
    return record
  }

  // Unchunked record: envelope is required
  if (env === null || typeof env !== "object" || Array.isArray(env)) return null
  const e = env as Record<string, unknown>
  if (e.v !== 1 || (e.t !== "seed" && e.t !== "scene")) return null
  const p = e.p
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null
  const payload = p as Record<string, unknown>
  if (!Array.isArray(payload.elements) || typeof payload.seq !== "number" || !Number.isFinite(payload.seq)) {
    return null
  }
  const record: RoomSnapshotRecord = {
    envelope: { v: 1, t: e.t, p: { elements: payload.elements, seq: payload.seq } },
  }
  return record
}

/** 049 §1 pointer payload (mirrors the committed ClientMessage pointer shape). */
interface PointerPayload {
  x: number
  y: number
  tool: "pointer" | "laser"
  button?: "up" | "down"
}

/**
 * The room DO as a pure state machine — no PartyKit runtime dependency.
 *
 * Testable seam for task 041: construct with injected hooks + storage, drive
 * with `join`/`message`/`leave`; the host wires these to conn.send /
 * room.broadcast / room.storage.
 */
export class RoomState {
  readonly roomId: string
  private readonly hooks: RoomHooks
  private readonly storage: RoomStorage
  private readonly fileStore?: FileStore
  private readonly memberKeys?: Map<string, MemberKey>
  /** Transparent chunk reassembly (049 §3) — one assembler per room. */
  private readonly assembler = new ChunkAssembler()
  /** In-memory roster — session state only, never persisted (052 §4). */
  private readonly roster = new Map<string, Member>()
  /** Highest scene sequence accepted from each connection. `seq` is a
   * per-sender counter, so ordering must never be compared across peers. */
  private readonly lastSeqByConn = new Map<string, number>()
  private snap: RoomSnapshotRecord | null = null

  constructor(options: RoomStateOptions) {
    this.roomId = options.roomId
    this.hooks = options.hooks
    this.storage = options.storage
    this.fileStore = options.fileStore
    this.memberKeys = options.memberKeys
  }

  /** Current roster (connId → Member) — empty after a DO wake (052 §4). */
  get members(): ReadonlyMap<string, Member> {
    return this.roster
  }

  /** The current snapshot record, or null (test/observability aid). */
  get snapshot(): RoomSnapshotRecord | null {
    return this.snap
  }

  /**
   * Post-admission join (052 §3): rehydrate the snapshot from room.storage
   * (hibernation wake), register the member, send `welcome`, serve the stored
   * snapshot when available, then broadcast `peer{join}` to the others
   * (sender excluded, 049 §1).
   */
  async join(connId: string, hello: HelloPayload): Promise<void> {
    this.snap = await this.loadSnapshot()
    const member: Member = {
      profileId: hello.profileId,
      name: hello.name,
      color: hello.color,
      connId, // relay-stamped — never taken from client data (049 §1)
    }
    this.roster.set(connId, member)
    if (this.fileStore !== undefined && this.memberKeys !== undefined) {
      // 058 §3.2 store-verify identity — hello.key is org-sig-pinned (057 §3)
      this.memberKeys.set(connId, { profileId: hello.profileId, key: hello.key })
    }
    this.hooks.send(
      connId,
      JSON.stringify({
        v: 1,
        t: "welcome",
        p: {
          profileId: hello.profileId,
          connId,
          room: this.roomId,
          privacy: hello.privacy,
          snapshotAvailable: this.snap !== null,
          peers: [...this.roster.values()],
        },
      }),
    )
    if (this.snap !== null) this.serveSnapshot(connId)
    this.hooks.broadcast(JSON.stringify({ v: 1, t: "peer", p: { kind: "join", member } }), connId)
  }

  /**
   * Disconnect (052 §3): remove from the roster and broadcast `peer{leave}`.
   * room.storage is deliberately NOT cleared — an empty room keeps its
   * snapshot until DO eviction (empty + inactivity) deletes it.
   */
  leave(connId: string): void {
    const member = this.roster.get(connId)
    if (member === undefined) return
    this.roster.delete(connId)
    this.memberKeys?.delete(connId)
    this.fileStore?.leave(connId)
    this.hooks.broadcast(JSON.stringify({ v: 1, t: "peer", p: { kind: "leave", member } }))
    this.lastSeqByConn.delete(connId)
  }

  /**
   * Post-welcome routing for one raw frame (052 §3 / 059 §5). Chunk frames go
   * through the ChunkAssembler first; the reassembled envelope is then routed
   * like any other message (transparent framing, 049 §3).
   */
  async message(connId: string, frame: string): Promise<void> {
    if (!this.roster.has(connId)) return // unknown connection
    if (typeof frame !== "string" || new TextEncoder().encode(frame).length > MAX_FRAME_BYTES) {
      // 052 §5: an oversized single frame is misbehavior — drop + CHUNK_INVALID (non-fatal)
      this.sendError(connId, "CHUNK_INVALID", `frame exceeds the ${MAX_FRAME_BYTES}-byte single-frame cap (052 §5)`)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(frame)
    } catch {
      this.sendError(connId, "CHUNK_INVALID", "frame is not valid JSON")
      return
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.sendError(connId, "CHUNK_INVALID", "frame is not a JSON object")
      return
    }
    const env = parsed as Partial<WireEnvelope>
    if (env.v !== 1) {
      this.sendError(connId, "CHUNK_INVALID", `unsupported protocol version ${JSON.stringify(env.v)}`)
      return
    }
    if (env.t === "chunk") {
      // 052 §5: n total chunks per logical message is bounded (≤ 256). A
      // frame declaring more is a protocol violation — drop + CHUNK_INVALID
      // (the partial buffer ages out via the assembler's 30s GC).
      const n = (env.p as { n?: unknown }).n
      if (typeof n === "number" && n > MAX_CHUNKS_PER_MESSAGE) {
        this.sendError(
          connId,
          "CHUNK_INVALID",
          `chunk message declares ${n} chunks — over the ${MAX_CHUNKS_PER_MESSAGE}-chunk cap (052 §5)`,
        )
        return
      }
      const out = this.assembler.feed(env as unknown as ChunkFrame)
      if (out === null) return // partial / duplicate / malformed — wait for the rest, or drop
      await this.route(connId, out)
      return
    }
    await this.route(connId, env as WireEnvelope)
  }

  private async route(connId: string, env: WireEnvelope): Promise<void> {
    switch (env.t) {
      case "hello":
        return // already welcomed — drop (059 §5)
      case "seed":
        await this.handleSeed(connId, env.p as { scene: unknown[]; seq: number })
        return
      case "scene":
        await this.handleScene(connId, env.p as { elements: unknown[]; seq: number })
        return
      case "pointer":
        this.relayPointer(connId, env.p as PointerPayload)
        return
      case "file-put":
        // 051 §2: register the in-flight upload header (one per conn, 059 §4)
        this.fileStore?.beginPut(connId, env.p)
        return
      case "file-get": {
        const fileId = (env.p as { fileId?: unknown }).fileId
        if (this.fileStore !== undefined && typeof fileId === "string") {
          void this.fileStore.getFile(fileId, connId)
        }
        return
      }
      case "file-data": {
        // 058 §3.2 store-verify vs the SENDING member's key; pointer is never stored
        const member = this.memberKeys?.get(connId)
        if (this.fileStore !== undefined && member !== undefined) {
          await this.fileStore.putFile(connId, env as unknown as SignedContentEnvelope, member)
        }
        return
      }
      default:
        return // unknown type — drop (052 §3)
    }
  }

  /**
   * 049 §2 first-seed-wins: no snapshot → store + broadcast as `scene` to ALL
   * (the sender's fresh view comes from this broadcast); snapshot exists →
   * non-fatal SEED_REJECTED (the late member joins live instead).
   */
  private async handleSeed(connId: string, p: { scene: unknown[]; seq: number }): Promise<void> {
    if (!Array.isArray(p.scene) || typeof p.seq !== "number" || !Number.isFinite(p.seq)) {
      this.sendError(connId, "CHUNK_INVALID", "seed payload must be { scene: unknown[], seq: number }")
      return
    }
    if (this.snap !== null) {
      this.sendError(connId, "SEED_REJECTED", SEED_REJECT_REASON)
      return
    }
    const previousSeq = this.lastSeqByConn.get(connId)
    if (previousSeq !== undefined && p.seq <= previousSeq) return
    this.lastSeqByConn.set(connId, p.seq)
    const envelope: SnapshotEnvelope = { v: 1, t: "scene", p: { elements: p.scene, seq: p.seq } }
    await this.acceptSnapshot(envelope, connId, true)
  }

  /**
   * 049 §1 scene relay: in-memory snapshot updates (latest wins); relayed to
   * the others with envelope-level `from`. Exact-duplicate suppression (059 §6
   * / 058 §5): a scene byte-identical to the last stored/broadcast snapshot
   * (same seq + same payload) is neither re-stored nor re-broadcast.
   */
  private async handleScene(connId: string, p: { elements: unknown[]; seq: number }): Promise<void> {
    if (!Array.isArray(p.elements) || typeof p.seq !== "number" || !Number.isFinite(p.seq)) {
      this.sendError(connId, "CHUNK_INVALID", "scene payload must be { elements: unknown[], seq: number }")
      return
    }
    const previousSeq = this.lastSeqByConn.get(connId)
    if (previousSeq !== undefined && p.seq <= previousSeq) return
    this.lastSeqByConn.set(connId, p.seq)
    const envelope: SnapshotEnvelope = { v: 1, t: "scene", p }
    if (this.snap !== null && this.snap.envelope !== null && JSON.stringify(envelope) === JSON.stringify(this.snap.envelope)) {
      return // byte-identical duplicate — skip store AND broadcast
    }
    await this.acceptSnapshot(envelope, connId, false)
  }

  /**
   * Store the snapshot (as its chunk set when over the chunk threshold) and
   * broadcast the scene, `from`-stamped at envelope level (049 §0 / 058 §2.2).
   */
  private async acceptSnapshot(envelope: SnapshotEnvelope, connId: string, includeSender: boolean): Promise<void> {
    const serialized = serializeEnvelope(envelope)
    if (serialized.chunked) {
      // 058 §1.3 storage: store each chunk frame as a separate key to stay
      // under PartyKit's 128KB per-value limit. Store metadata separately.
      const metaKey = `${SNAPSHOT_KEY}:meta`
      const meta = { chunkId: serialized.id, frameCount: serialized.frames.length }
      await this.storage.put(metaKey, meta)
      for (let i = 0; i < serialized.frames.length; i++) {
        await this.storage.put(`${SNAPSHOT_KEY}:frame:${i}`, serialized.frames[i])
      }
      // Delete old envelope key if it exists (transition from unchunked to chunked)
      await this.storage.delete(SNAPSHOT_KEY).catch(() => {})
      const record: RoomSnapshotRecord = { envelope: null, chunkId: serialized.id, frames: serialized.frames }
      this.snap = record
      // Broadcast live chunk frames with the same relay source stamp as
      // unchunked scenes. Stored frames remain pre-stamp and are served
      // without `from` to preserve the snapshot record verbatim.
      const except = includeSender ? undefined : connId
      for (const frame of serialized.frames) {
        this.hooks.broadcast(JSON.stringify({ ...frame, from: connId }), except)
      }
    } else {
      // Unchunked: store envelope directly (under 100KB, fits in 128KB limit)
      // Delete old chunk keys if they exist (transition from chunked to unchunked)
      await this.deleteChunkKeys().catch(() => {})
      const record: RoomSnapshotRecord = { envelope }
      await this.storage.put(SNAPSHOT_KEY, record)
      this.snap = record
      this.hooks.broadcast(JSON.stringify({ ...envelope, from: connId }), includeSender ? undefined : connId)
    }
  }

  /** Delete chunk frame keys from storage (used when transitioning chunked ↔ unchunked). */
  private async deleteChunkKeys(): Promise<void> {
    await this.storage.delete(`${SNAPSHOT_KEY}:meta`).catch(() => {})
    // Delete up to 10 frames (max for a 1MB scene at 100KB chunks)
    for (let i = 0; i < 10; i++) {
      await this.storage.delete(`${SNAPSHOT_KEY}:frame:${i}`).catch(() => {})
    }
  }

  /** 049 §1 pointer pass-through — relayed with `from`, never stored (058 §2.5). */
  private relayPointer(connId: string, p: PointerPayload): void {
    this.hooks.broadcast(JSON.stringify({ v: 1, t: "pointer", p, from: connId }), connId)
  }

  /**
   * Serve the stored snapshot to a joiner: its stored chunk set when chunked,
   * else the single pre-stamp frame (058 §1.3 — serve verbatim, no `from`).
   */
  private serveSnapshot(connId: string): void {
    const snap = this.snap
    if (snap === null) return
    // Chunked record: serve the stored frames (envelope was omitted for storage, 058 §1.3)
    if (snap.frames !== undefined) {
      for (const frame of snap.frames) this.hooks.send(connId, JSON.stringify(frame))
      return
    }
    // Unchunked record: serve the envelope directly (or re-chunk if over threshold)
    if (snap.envelope === null) return // corrupt state — no envelope and no frames
    const json = JSON.stringify(snap.envelope)
    if (new TextEncoder().encode(json).length <= CHUNK_THRESHOLD) {
      this.hooks.send(connId, json)
      return
    }
    // defensive: an unchunked record over threshold cannot be produced by acceptSnapshot;
    // re-chunk rather than risk a >256KB single frame on the DO (058 §1.3 re-chunk rule)
    for (const frame of serializeEnvelope(snap.envelope).frames) {
      this.hooks.send(connId, JSON.stringify(frame))
    }
  }

  /**
   * Rehydrate the snapshot from room.storage (052 §4 — it survives DO
   * hibernation and code deploys). A corrupt record is deleted and treated as
   * absent (059 §4 serve-fail semantics: a deterministic failure never
   * recovers; the room re-seeds from members' local galleries instead).
   */
  private async loadSnapshot(): Promise<RoomSnapshotRecord | null> {
    // Try new format first: meta key + individual frame keys (058 §1.3 storage optimization)
    const metaRaw = await this.storage.get(`${SNAPSHOT_KEY}:meta`).catch(() => undefined)
    if (metaRaw !== undefined && typeof metaRaw === 'object' && metaRaw !== null) {
      const meta = metaRaw as { chunkId?: string; frameCount?: number }
      if (typeof meta.chunkId === 'string' && typeof meta.frameCount === 'number' && meta.frameCount > 0) {
        const frames: ChunkFrame[] = []
        for (let i = 0; i < meta.frameCount; i++) {
          const frame = await this.storage.get(`${SNAPSHOT_KEY}:frame:${i}`).catch(() => undefined)
          if (frame === undefined || !isChunkFrame(frame)) return null // corrupt chunk set
          frames.push(frame)
        }
        return { envelope: null, chunkId: meta.chunkId, frames }
      }
    }
    // Fall back to old format: single envelope key
    let raw: unknown
    try {
      raw = await this.storage.get(SNAPSHOT_KEY)
    } catch {
      return null
    }
    const record = parseSnapshotRecord(raw)
    if (record === null) {
      if (raw !== undefined) {
        try {
          await this.storage.delete(SNAPSHOT_KEY)
        } catch {
          /* ignore */
        }
      }
      return null
    }
    return record
  }

  private sendError(connId: string, code: ErrorCode, reason: string): void {
    this.hooks.send(connId, JSON.stringify({ v: 1, t: "error", p: { code, reason, fatal: false } }))
  }
}
