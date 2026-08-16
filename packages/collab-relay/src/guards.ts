/**
 * collab-relay guards (goal 023 task 041) — per-message size gate + per-conn
 * rate guard for the room DO composition (index.ts) and unit-tested here.
 *
 * Authority:
 * - 049 §1      — MESSAGE_TOO_LARGE is a FATAL error: the relay sends
 *                 error{MESSAGE_TOO_LARGE, fatal:true} and closes.
 * - 049 §3      — transparent chunk framing: serialize first; messages
 *                 > 200KB (CHUNK_THRESHOLD) MUST be split into ≤200KB `d`
 *                 pieces. A single frame in (200KB, 256KB] that is NOT a
 *                 chunk frame (or a chunk piece over 200KB) is a protocol
 *                 violation ⇒ error{CHUNK_INVALID, fatal:false}, drop.
 *                 256KB is the DO hard per-message cap — nothing above it
 *                 is deliverable, hence fatal.
 * - 052 §5      — size guards: reject over-cap frames with CHUNK_INVALID
 *                 (drop + error, never close); chunk reassembly bounded:
 *                 n total chunks ≤ 256 per message. ("4MB per id" was a
 *                 rough sketch in 052 §5 — enforcing it would contradict
 *                 051 §7's 20MB file cap (20MB / 200KB = 100 chunks), so
 *                 the operative bound here is n ≤ 256 = ≤50MB logical.)
 * - 052 §5      — "v1 has NO rate limiting (documented limitation)". Task
 *                 041 adds a FLOOD guard, not a throttle: the limit is
 *                 generous (200 msgs/sec/conn — far above the 100ms scene
 *                 throttle and pointer bursts), trips only on sustained
 *                 flooding, and never closes the connection: the offending
 *                 frame is dropped with error{CHUNK_INVALID, fatal:false}
 *                 and the room (and every other member) survives.
 *
 * Codes: MESSAGE_TOO_LARGE (fatal) and CHUNK_INVALID (non-fatal) are the
 * only ErrorCode values the guards emit — 049 §1's fatal set, and 052 §5's
 * guard code for everything misbehaving-but-deliverable.
 */
import { CHUNK_THRESHOLD } from "collab-core"
import type { ErrorCode } from "collab-core"

/** 049 §3: the DO per-message hard cap — a frame above this is undeliverable (fatal). */
export const MAX_DO_MESSAGE_BYTES = 256 * 1024

/** 049 §3: chunk split threshold (collab-core's constant — single source of truth). */
export const MAX_CHUNK_PIECE_BYTES = CHUNK_THRESHOLD

/** 052 §5: a single logical message may span at most 256 chunk frames (≤ ~50MB logical). */
export const MAX_CHUNKS_PER_MESSAGE = 256

// ─── per-message size gate ───────────────────────────────────────────────────

export type FrameGuardResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; reason: string; fatal: boolean }

/**
 * Size gate for ONE incoming raw frame (049 §3 / 052 §5):
 *
 *   bytes ≤ 200KB                          → ok
 *   bytes in (200KB, 256KB] and a chunk    → ok iff `d` ≤ 200KB
 *   bytes in (200KB, 256KB] and NOT chunk  → CHUNK_INVALID (should have
 *                                            been chunked, 049 §3)
 *   bytes > 256KB (any frame)              → MESSAGE_TOO_LARGE fatal
 *                                            (over the DO cap — 049 §1)
 *
 * The size check runs on the UTF-8 byte length (the same measure the
 * chunker uses), not the JS string length.
 */
export function assertFrameSize(rawFrame: string): FrameGuardResult {
  const bytes = new TextEncoder().encode(rawFrame).length
  if (bytes > MAX_DO_MESSAGE_BYTES) {
    return {
      ok: false,
      code: "MESSAGE_TOO_LARGE",
      fatal: true,
      reason: `frame is ${bytes} bytes — over the ${MAX_DO_MESSAGE_BYTES}-byte per-message cap (049 §3); the relay is closing`,
    }
  }
  if (bytes <= MAX_CHUNK_PIECE_BYTES) return { ok: true }

  // (200KB, 256KB] — only legal as a chunk frame with a ≤200KB piece.
  let parsed: unknown
  try {
    parsed = JSON.parse(rawFrame)
  } catch {
    return {
      ok: false,
      code: "CHUNK_INVALID",
      fatal: false,
      reason: `frame is ${bytes} bytes (> ${MAX_CHUNK_PIECE_BYTES}) but not valid JSON (049 §3)`,
    }
  }
  const env = parsed as { t?: unknown; p?: unknown }
  if (env?.t === "chunk") {
    const d = (env.p as { d?: unknown } | null | undefined)?.d
    if (typeof d !== "string") {
      return {
        ok: false,
        code: "CHUNK_INVALID",
        fatal: false,
        reason: "chunk frame over the 200KB threshold must carry a string p.d (049 §3)",
      }
    }
    const dBytes = new TextEncoder().encode(d).length
    if (dBytes <= MAX_CHUNK_PIECE_BYTES) return { ok: true }
    return {
      ok: false,
      code: "CHUNK_INVALID",
      fatal: false,
      reason: `chunk piece is ${dBytes} bytes — over the ${MAX_CHUNK_PIECE_BYTES}-byte piece cap (049 §3)`,
    }
  }
  return {
    ok: false,
    code: "CHUNK_INVALID",
    fatal: false,
    reason: `frame is ${bytes} bytes (> ${MAX_CHUNK_PIECE_BYTES}) and is not a chunk frame — messages over 200KB must be chunked (049 §3)`,
  }
}

// ─── per-connection rate guard ───────────────────────────────────────────────

/** 052 §5 "no rate limiting" is the documented limitation; this is the task-041 flood guard window. */
export const RATE_WINDOW_MS = 1_000

/**
 * Messages per window per connection. 200/s is far above every legit
 * pattern (scene ≈ 10/s at the 100ms throttle, pointer bursts, a 20MB
 * file-put = ~105 chunk frames) — only a sustained flood trips it.
 */
export const RATE_LIMIT_PER_WINDOW = 200

/** Reason carried by rate-guard trips (052 §5 guard posture: drop + error, keep the conn). */
export const RATE_REJECT_REASON = `message rate exceeds the relay flood guard (${RATE_LIMIT_PER_WINDOW} msgs / ${RATE_WINDOW_MS}ms per connection) — frame dropped, connection kept (052 §5)`

/**
 * Sliding-window per-connection message counter. One instance per room
 * (index.ts composition); buckets keyed by connId. Trips are NON-fatal by
 * design: the frame is dropped, the offending connection stays open, and
 * the room survives (041 spec). Injectable clock for tests.
 */
export class RateGuard {
  private readonly windowMs: number
  private readonly limit: number
  private readonly now: () => number
  /** connId → timestamps of frames admitted inside the current window */
  private readonly stamps = new Map<string, number[]>()

  constructor(options: { windowMs?: number; limit?: number; now?: () => number } = {}) {
    this.windowMs = options.windowMs ?? RATE_WINDOW_MS
    this.limit = options.limit ?? RATE_LIMIT_PER_WINDOW
    this.now = options.now ?? Date.now
  }

  /** True if the frame may proceed; false = flood (caller drops + errors). */
  allow(connId: string): boolean {
    const cutoff = this.now() - this.windowMs
    const stamps = this.stamps.get(connId) ?? []
    // drop stamps outside the window (cheap: window is small and trimmed on every call)
    while (stamps.length > 0 && stamps[0] <= cutoff) stamps.shift()
    if (stamps.length >= this.limit) {
      this.stamps.set(connId, stamps)
      return false
    }
    stamps.push(this.now())
    this.stamps.set(connId, stamps)
    return true
  }

  /** Drop a connection's buckets (connection teardown — keeps the map small). */
  reset(connId: string): void {
    this.stamps.delete(connId)
  }

  /** Number of frames admitted for a conn inside the current window (test aid). */
  count(connId: string): number {
    const cutoff = this.now() - this.windowMs
    const stamps = this.stamps.get(connId) ?? []
    while (stamps.length > 0 && stamps[0] <= cutoff) stamps.shift()
    return stamps.length
  }
}
