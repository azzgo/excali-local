import { describe, expect, it } from "vitest"
import { CHUNK_THRESHOLD, ChunkAssembler, serializeEnvelope } from "./chunk"
import type { ChunkFrame } from "./chunk"

/** Fake clock + captured timers: advance() fires due sweeps synchronously. */
function fakeTimers() {
  let t = 0
  let nextId = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  return {
    now: () => t,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const id = nextId++
      timers.set(id, { fn, at: t + ms })
      return id
    },
    clearTimeoutFn: (handle: unknown) => {
      timers.delete(handle as number)
    },
    advance: (ms: number) => {
      t += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(id)
          timer.fn()
        }
      }
    },
  }
}

function bigEnvelope(approxBytes: number) {
  // scene payload dominated by a single string of ~approxBytes
  const probe = { v: 1 as const, t: "scene" as const, p: { elements: [{ text: "" }], seq: 1 } }
  const overhead = new TextEncoder().encode(JSON.stringify(probe)).length
  return {
    v: 1 as const,
    t: "scene" as const,
    p: { elements: [{ text: "x".repeat(Math.max(0, approxBytes - overhead)) }], seq: 1 },
  }
}

const KIB = 1024
const MIB = 1024 * 1024

describe("serializeEnvelope", () => {
  it("exports CHUNK_THRESHOLD = 200 * 1024 (headroom under the 256KB cap)", () => {
    expect(CHUNK_THRESHOLD).toBe(200 * 1024)
  })

  it("small envelope (≤ 200KB) is NOT chunked", () => {
    const env = { v: 1 as const, t: "pointer" as const, p: { x: 1, y: 2, tool: "laser" as const } }
    const res = serializeEnvelope(env)
    expect(res.chunked).toBe(false)
    expect(res.frames).toEqual([])
  })

  it("an envelope of exactly CHUNK_THRESHOLD bytes is NOT chunked (≤, not <)", () => {
    const probe = { v: 1 as const, t: "seed" as const, p: { scene: [""], seq: 1 } }
    const overhead = new TextEncoder().encode(JSON.stringify(probe)).length
    const env = {
      v: 1 as const,
      t: "seed" as const,
      p: { scene: ["x".repeat(CHUNK_THRESHOLD - overhead)], seq: 1 },
    }
    expect(new TextEncoder().encode(JSON.stringify(env)).length).toBe(CHUNK_THRESHOLD)
    expect(serializeEnvelope(env).chunked).toBe(false)
    // one byte over the threshold and it flips
    const over = { ...env, p: { ...env.p, scene: ["x".repeat(CHUNK_THRESHOLD - overhead + 1)] } }
    expect(serializeEnvelope(over).chunked).toBe(true)
  })

  it("250KB envelope splits into ≤200KB fragments whose concat is byte-identical", () => {
    const env = bigEnvelope(250 * KIB)
    const json = JSON.stringify(env)
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(CHUNK_THRESHOLD)
    const res = serializeEnvelope(env)
    expect(res.chunked).toBe(true)
    expect(res.frames.length).toBeGreaterThan(1)
    for (const f of res.frames) {
      expect(f.v).toBe(1)
      expect(f.t).toBe("chunk")
      expect(new TextEncoder().encode(f.p.d).length).toBeLessThanOrEqual(CHUNK_THRESHOLD)
    }
    // string concat of d in i order reproduces the serialization byte-for-byte
    const ordered = [...res.frames].sort((a, b) => a.p.i - b.p.i)
    expect(ordered.map((f) => f.p.d).join("")).toBe(json)
    // indices are a dense 0..n-1 sequence
    expect(ordered.map((f) => f.p.i)).toEqual(ordered.map((_, i) => i))
    expect(ordered[0].p.n).toBe(ordered.length)
  })

  it("chunk id is stable per logical message (all frames share one random id)", () => {
    const env = bigEnvelope(250 * KIB)
    const res = serializeEnvelope(env)
    if (!res.chunked) throw new Error("expected chunked")
    expect(res.id.length).toBeGreaterThan(0)
    const ids = new Set(res.frames.map((f) => f.p.id))
    expect(ids.size).toBe(1)
    expect(res.id).toBe(res.frames[0].p.id)
    // two logical messages get distinct ids
    const other = serializeEnvelope(bigEnvelope(250 * KIB))
    expect(other.chunked).toBe(true)
    if (!other.chunked) throw new Error("expected chunked")
    expect(other.id).not.toBe(res.id)
  })
})

describe("ChunkAssembler", () => {
  it("reassembles a chunked envelope back to the original (byte-identical)", () => {
    const env = bigEnvelope(250 * KIB)
    const { frames } = serializeEnvelope(env)
    const a = new ChunkAssembler()
    let emitted: unknown = null
    for (const f of frames) {
      const out = a.feed(f)
      if (out) emitted = out
    }
    expect(emitted).toEqual(env)
    expect(JSON.stringify(emitted)).toBe(JSON.stringify(env))
    expect(a.pending).toBe(0)
  })

  it("handles out-of-order arrival", () => {
    const env = bigEnvelope(250 * KIB)
    const { frames } = serializeEnvelope(env)
    const a = new ChunkAssembler()
    // reverse order: last fragment first, first fragment last
    const shuffled = [...frames].sort((x, y) => y.p.i - x.p.i)
    let emitted: unknown = null
    for (const f of shuffled) {
      const out = a.feed(f)
      if (out) emitted = out
    }
    expect(emitted).toEqual(env)
    expect(a.pending).toBe(0)
  })

  it("ignores duplicate frames (same i twice) and emits exactly once", () => {
    const env = bigEnvelope(250 * KIB)
    const { frames } = serializeEnvelope(env)
    const a = new ChunkAssembler()
    const outs: unknown[] = []
    outs.push(a.feed(frames[0]))
    // duplicate of fragment 0 — ignored, must not corrupt or complete
    expect(a.feed({ ...frames[0], p: { ...frames[0].p, d: "corrupted" } })).toBeNull()
    expect(a.feed({ ...frames[0] })).toBeNull()
    for (const f of frames.slice(1)) {
      const out = a.feed(f)
      if (out) outs.push(out)
    }
    // a dup arriving after completion starts a fresh (partial) buffer, never completes
    expect(a.feed(frames[0])).toBeNull()
    expect(outs.filter((o) => o !== null)).toEqual([env])
    expect(a.pending).toBe(1)
    a.dispose()
  })

  it("ignores malformed frames (i out of range) and n-conflicting frames", () => {
    const env = bigEnvelope(250 * KIB)
    const { frames } = serializeEnvelope(env)
    const a = new ChunkAssembler()
    expect(a.feed({ v: 1, t: "chunk", p: { id: "x", n: 1, i: 5, d: "bad" } })).toBeNull()
    expect(a.feed({ v: 1, t: "chunk", p: { id: "x", n: 0, i: 0, d: "bad" } })).toBeNull()
    expect(a.pending).toBe(0)
    // conflicting n for a live id is ignored
    a.feed(frames[0])
    expect(a.feed({ v: 1, t: "chunk", p: { id: frames[0].p.id, n: frames.length + 1, i: 0, d: "bad" } })).toBeNull()
    expect(a.pending).toBe(1)
    a.dispose()
  })

  it("a frame for an unknown id starts a fresh buffer", () => {
    const a = new ChunkAssembler()
    expect(a.pending).toBe(0)
    const f: ChunkFrame = { v: 1, t: "chunk", p: { id: "fresh-id", n: 2, i: 0, d: "part-a" } }
    expect(a.feed(f)).toBeNull()
    expect(a.pending).toBe(1)
    a.dispose()
  })

  it("GC drops partial buffers after 30s (injectable clock)", () => {
    const clock = fakeTimers()
    const a = new ChunkAssembler({
      gcTimeoutMs: 30_000,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    })
    const env = bigEnvelope(250 * KIB)
    const { frames } = serializeEnvelope(env)
    a.feed(frames[0]) // only 1 of 2 pieces — partial
    expect(a.pending).toBe(1)

    clock.advance(29_999)
    expect(a.pending).toBe(1) // still inside the window

    clock.advance(1) // 30s elapsed → sweep fires
    expect(a.pending).toBe(0)

    // the late second piece can no longer complete the message
    expect(a.feed(frames[1])).toBeNull()
    expect(a.pending).toBe(1) // it starts a fresh (now partial) buffer
    a.dispose()
  })

  it("GC only drops partial buffers — completed messages are freed immediately", () => {
    const clock = fakeTimers()
    const a = new ChunkAssembler({
      gcTimeoutMs: 30_000,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    })
    const small: ChunkFrame = { v: 1, t: "chunk", p: { id: "done", n: 1, i: 0, d: '{"v":1,"t":"seed","p":{"scene":[],"seq":1}}' } }
    const partial: ChunkFrame = { v: 1, t: "chunk", p: { id: "partial", n: 2, i: 0, d: "x" } }
    expect(a.feed(small)).toEqual({ v: 1, t: "seed", p: { scene: [], seq: 1 } })
    expect(a.pending).toBe(0)
    a.feed(partial)
    expect(a.pending).toBe(1)
    clock.advance(30_000)
    expect(a.pending).toBe(0)
    a.dispose()
  })

  it("two interleaved chunked messages reassemble independently", () => {
    const envA = bigEnvelope(250 * KIB)
    const envB = bigEnvelope(220 * KIB) // also > threshold so it chunk-frames
    const { frames: aFrames } = serializeEnvelope(envA)
    const { frames: bFrames } = serializeEnvelope(envB)
    expect(aFrames.length).toBeGreaterThan(1)
    expect(bFrames.length).toBeGreaterThan(1)
    const a = new ChunkAssembler()
    const seen: unknown[] = []
    const interleaved: ChunkFrame[] = []
    for (let k = 0; k < Math.max(aFrames.length, bFrames.length); k++) {
      if (k < aFrames.length) interleaved.push(aFrames[k])
      if (k < bFrames.length) interleaved.push(bFrames[k])
    }
    for (const f of interleaved) {
      const out = a.feed(f)
      if (out) seen.push(out)
    }
    expect(seen).toHaveLength(2)
    expect(seen).toContainEqual(envA)
    expect(seen).toContainEqual(envB)
    expect(a.pending).toBe(0)
  })
})
