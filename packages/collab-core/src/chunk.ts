/**
 * collab-core transparent chunk framing (Wayfinder 049 §3).
 *
 * Any single logical message (typically `scene`/`snapshot`/`seed`) may exceed
 * the 256KB per-message cap of the relay (Cloudflare DO). Framing is
 * transparent to the message table: a receiver that sees `chunk` frames
 * reassembles and emits the original envelope.
 *
 * Semantics (049 §3, verbatim):
 * - Threshold: serialize first; if length > CHUNK_THRESHOLD (100KB, under
 *   PartyKit's 128KB per-value storage limit) → split into ≤100KB `d` pieces.
 * - Reassembly (client + relay both implement): buffer by `id`, emit original
 *   envelope when all `n` pieces arrived; GC partial buffers after 30s.
 * - Loss handling is by design = self-healing: WS per-connection delivery is
 *   ordered and reliable; the only way to lose chunks is a disconnect, which
 *   triggers the reconnect + `snapshot` resync. No per-chunk ACK/retransmit.
 *   The relay also uses the chunk id as the unit for snapshot storage.
 */

import type { WireEnvelope } from "./wire"

/** Split point: serialize first; only messages longer than this are chunked. */
export const CHUNK_THRESHOLD = 100 * 1024

/** Chunk frame shape (049 §3): d = one fragment of the JSON-serialized envelope. */
export interface ChunkFrame {
  v: 1
  t: "chunk"
  p: { id: string; n: number; i: number; d: string }
}

export type SerializeEnvelopeResult =
  | { chunked: false; frames: [] }
  | { chunked: true; id: string; frames: ChunkFrame[] }

/**
 * Serialize an envelope to wire frames. Messages whose serialized byte length
 * is ≤ CHUNK_THRESHOLD are returned unchunked (empty frames — the caller sends
 * the plain envelope); larger ones are split into ≤ CHUNK_THRESHOLD `d`
 * fragments. All fragments of one logical message share the same random `id`
 * (chunk id = snapshot storage unit, 049 §3); concatenating `d` in `i` order
 * reproduces the original JSON byte-for-byte.
 */
export function serializeEnvelope(env: WireEnvelope): SerializeEnvelopeResult {
  const json = JSON.stringify(env)
  const bytes = new TextEncoder().encode(json)
  if (bytes.length <= CHUNK_THRESHOLD) {
    return { chunked: false, frames: [] }
  }
  const fragments = splitJson(json, CHUNK_THRESHOLD)
  const id = crypto.randomUUID()
  const frames: ChunkFrame[] = fragments.map((d, i) => ({
    v: 1,
    t: "chunk",
    p: { id, n: fragments.length, i, d },
  }))
  return { chunked: true, id, frames }
}

/** Split a string into fragments whose UTF-8 byte length is ≤ maxBytes. */
function splitJson(json: string, maxBytes: number): string[] {
  // Code points keep surrogate pairs together, so a fragment boundary can
  // never land inside a surrogate pair (no replacement-char corruption).
  const points = Array.from(json)
  const fragments: string[] = []
  let start = 0
  let byteLen = 0
  for (let i = 0; i < points.length; i++) {
    const cp = points[i].codePointAt(0)!
    const cpBytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
    if (byteLen + cpBytes > maxBytes && byteLen > 0) {
      fragments.push(points.slice(start, i).join(""))
      start = i
      byteLen = 0
    }
    byteLen += cpBytes
  }
  fragments.push(points.slice(start).join(""))
  return fragments
}

interface BufferState {
  /** received fragments by index; undefined = not yet arrived */
  pieces: (string | undefined)[]
  /** number of distinct fragments received */
  received: number
  /** n declared by the first frame for this id */
  n: number
  /** injected-clock timestamp of the last frame touching this buffer */
  lastTouched: number
}

export interface ChunkAssemblerOptions {
  /** partial-buffer GC timeout in ms (default 30s, 049 §3) */
  gcTimeoutMs?: number
  /** injectable clock (default Date.now) — tests advance it manually */
  now?: () => number
  /** injectable timer scheduling — tests capture callbacks instead of waiting */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/**
 * Reassembles chunk frames into the original envelope (049 §3).
 *
 * - Buffers by `id`; emits the parsed envelope exactly once when all `n`
 *   pieces have arrived (out-of-order arrival is fine, duplicates ignored).
 * - Frames for an unknown id start a fresh buffer; a frame whose declared `n`
 *   conflicts with a live buffer is ignored (ids are random, so this only
 *   happens on a protocol bug — GC cleans up).
 * - Partial buffers are GC'd gcTimeoutMs after their last activity.
 */
export class ChunkAssembler {
  private readonly buffers = new Map<string, BufferState>()
  private readonly gcTimeoutMs: number
  private readonly now: () => number
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown
  private readonly clearTimeoutFn: (handle: unknown) => void
  private sweepTimer: unknown = null

  constructor(options: ChunkAssemblerOptions = {}) {
    this.gcTimeoutMs = options.gcTimeoutMs ?? 30_000
    this.now = options.now ?? Date.now
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  /**
   * Feed one chunk frame. Returns the reassembled envelope when this frame
   * completes a message, otherwise null.
   */
  feed(frame: ChunkFrame): WireEnvelope | null {
    const { id, n, i, d } = frame.p
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(i) || i < 0 || i >= n) {
      return null // malformed frame — ignore
    }
    const state = this.buffers.get(id)
    if (state) {
      if (state.n !== n) return null // conflicting declaration — ignore
      if (state.pieces[i] !== undefined) return null // duplicate — ignore
    } else {
      this.buffers.set(id, {
        pieces: new Array<string | undefined>(n),
        received: 0,
        n,
        lastTouched: this.now(),
      })
    }
    const buf = this.buffers.get(id)!
    buf.pieces[i] = d
    buf.received++
    buf.lastTouched = this.now()
    if (buf.received === n) {
      this.buffers.delete(id)
      this.armSweepIfNeeded()
      try {
        return JSON.parse(buf.pieces.join("")) as WireEnvelope
      } catch {
        return null // corrupted payload — drop rather than crash the relay
      }
    }
    this.armSweepIfNeeded()
    return null
  }

  /** Drop all buffered partial messages and stop the GC timer. */
  dispose(): void {
    this.buffers.clear()
    if (this.sweepTimer !== null) {
      this.clearTimeoutFn(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /** Number of partial messages currently buffered (test/observability aid). */
  get pending(): number {
    return this.buffers.size
  }

  private armSweepIfNeeded(): void {
    if (this.sweepTimer !== null || this.buffers.size === 0) return
    this.sweepTimer = this.setTimeoutFn(() => this.sweep(), this.gcTimeoutMs)
  }

  private sweep(): void {
    this.sweepTimer = null
    const cutoff = this.now() - this.gcTimeoutMs
    for (const [id, state] of this.buffers) {
      if (state.lastTouched <= cutoff) this.buffers.delete(id)
    }
    this.armSweepIfNeeded()
  }
}
