/**
 * collab-relay guard tests (task 041): per-message size gate (049 §1/§3,
 * 052 §5 codes) + per-conn rate flood guard (041 spec: trips → non-fatal
 * error frame, connection + room survive).
 */
import { describe, expect, it } from "vitest"
import {
  MAX_CHUNK_PIECE_BYTES,
  MAX_DO_MESSAGE_BYTES,
  RateGuard,
  assertFrameSize,
} from "./guards"

// ─── assertFrameSize ─────────────────────────────────────────────────────────

/** Byte-accurate frame builder: pad a JSON frame to an exact UTF-8 byte length. */
function frameOfByteLength(targetBytes: number, t: string, payload: unknown = {}): string {
  const head = JSON.stringify({ v: 1, t, p: payload })
  const headBytes = new TextEncoder().encode(head).length
  if (headBytes > targetBytes) throw new Error(`head already ${headBytes} bytes`)
  const pad = " ".repeat(targetBytes - headBytes)
  return head.slice(0, head.length - 1) + pad + "}"
}

describe("assertFrameSize — per-message size gate (049 §1/§3, 052 §5)", () => {
  it("accepts frames at or under the 200KB chunk threshold", () => {
    expect(assertFrameSize(JSON.stringify({ v: 1, t: "scene", p: { elements: [], seq: 1 } }))).toEqual({ ok: true })
    const atThreshold = frameOfByteLength(MAX_CHUNK_PIECE_BYTES, "scene", { elements: [], seq: 1 })
    expect(assertFrameSize(atThreshold)).toEqual({ ok: true })
  })

  it("rejects a >200KB non-chunk frame with CHUNK_INVALID, non-fatal (049 §3: must be chunked)", () => {
    const big = frameOfByteLength(MAX_CHUNK_PIECE_BYTES + 1, "scene", { elements: [], seq: 1 })
    const res = assertFrameSize(big)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID")
      expect(res.fatal).toBe(false)
      expect(res.reason).toContain("must be chunked")
    }
  })

  it("accepts a chunk frame whose total size exceeds 200KB when d stays ≤ 200KB (049 §3 headroom)", () => {
    const d = "x".repeat(MAX_CHUNK_PIECE_BYTES) // exactly 200KB of piece data
    const frame = JSON.stringify({ v: 1, t: "chunk", p: { id: "abc", n: 2, i: 0, d } })
    // the frame itself is > 200KB (piece + envelope overhead) but the piece is legal
    expect(new TextEncoder().encode(frame).length).toBeGreaterThan(MAX_CHUNK_PIECE_BYTES)
    expect(assertFrameSize(frame)).toEqual({ ok: true })
  })

  it("rejects a chunk frame with d > 200KB as CHUNK_INVALID, non-fatal", () => {
    const d = "x".repeat(MAX_CHUNK_PIECE_BYTES + 1)
    const res = assertFrameSize(JSON.stringify({ v: 1, t: "chunk", p: { id: "abc", n: 1, i: 0, d } }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID")
      expect(res.fatal).toBe(false)
      expect(res.reason).toContain("piece cap")
    }
  })

  it("rejects a >200KB non-JSON frame as CHUNK_INVALID, non-fatal", () => {
    const raw = "a".repeat(MAX_CHUNK_PIECE_BYTES + 1)
    const res = assertFrameSize(raw)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID")
      expect(res.fatal).toBe(false)
      expect(res.reason).toContain("not valid JSON")
    }
  })

  it("rejects ANY frame over 256KB with MESSAGE_TOO_LARGE, fatal (049 §1 fatal set — over the DO cap)", () => {
    for (const t of ["scene", "chunk"]) {
      const frame = frameOfByteLength(MAX_DO_MESSAGE_BYTES + 1, t, { elements: [], seq: 1 })
      const res = assertFrameSize(frame)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.code).toBe("MESSAGE_TOO_LARGE")
        expect(res.fatal).toBe(true)
        expect(res.reason).toContain(String(MAX_DO_MESSAGE_BYTES))
      }
    }
  })

  it("the 256KB boundary itself is deliverable (fatal only strictly above)", () => {
    // a 256KB chunk frame with an oversized d is CHUNK_INVALID, not MESSAGE_TOO_LARGE
    const d = "x".repeat(MAX_DO_MESSAGE_BYTES - 200)
    const res = assertFrameSize(JSON.stringify({ v: 1, t: "chunk", p: { id: "abc", n: 1, i: 0, d } }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("CHUNK_INVALID")
      expect(res.fatal).toBe(false)
    }
  })
})

// ─── RateGuard ───────────────────────────────────────────────────────────────

describe("RateGuard — per-conn flood guard (041: trips → error frame, room survives)", () => {
  it("admits frames under the limit and trips beyond it, per connection", () => {
    let now = 0
    const guard = new RateGuard({ windowMs: 1000, limit: 3, now: () => now })
    expect(guard.allow("a")).toBe(true)
    expect(guard.allow("a")).toBe(true)
    expect(guard.allow("a")).toBe(true)
    expect(guard.allow("a")).toBe(false) // 4th frame in the window trips
    expect(guard.count("a")).toBe(3)
  })

  it("isolates connections — one conn flooding does not trip another", () => {
    let now = 0
    const guard = new RateGuard({ windowMs: 1000, limit: 2, now: () => now })
    guard.allow("flooder")
    guard.allow("flooder")
    expect(guard.allow("flooder")).toBe(false)
    expect(guard.allow("quiet")).toBe(true)
    expect(guard.allow("quiet")).toBe(true)
  })

  it("expires the window — the limit resets after windowMs", () => {
    let now = 0
    const guard = new RateGuard({ windowMs: 1000, limit: 2, now: () => now })
    guard.allow("a")
    guard.allow("a")
    expect(guard.allow("a")).toBe(false)
    now = 1001
    expect(guard.allow("a")).toBe(true) // fresh window
    expect(guard.count("a")).toBe(1)
  })

  it("drops stale stamps on access (sliding window: old frames stop counting)", () => {
    let now = 0
    const guard = new RateGuard({ windowMs: 1000, limit: 2, now: () => now })
    guard.allow("a") // t=0
    now = 600
    guard.allow("a") // t=600
    now = 1599 // cutoff = 599: t=0 stale, t=600 still inside
    expect(guard.allow("a")).toBe(true) // only the t=600 stamp counts → 2nd slot free
    expect(guard.count("a")).toBe(2)
  })

  it("reset drops a connection's buckets (teardown cleanup)", () => {
    let now = 0
    const guard = new RateGuard({ windowMs: 1000, limit: 1, now: () => now })
    guard.allow("a")
    expect(guard.allow("a")).toBe(false)
    guard.reset("a")
    expect(guard.allow("a")).toBe(true)
  })

  it("uses the documented defaults (200 msgs / 1s window) — far above legit traffic", () => {
    const guard = new RateGuard()
    for (let i = 0; i < 200; i++) expect(guard.allow("a")).toBe(true)
    expect(guard.allow("a")).toBe(false)
  })
})
