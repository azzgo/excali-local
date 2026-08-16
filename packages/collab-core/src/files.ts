/**
 * collab-core file client (goal 023 task 051) — content-addressed file
 * put/get over the CollabClient transport, with an on-demand fetch policy,
 * an offline queue, and the private-room ciphertext wrapper.
 *
 * Authoritative sources:
 * - 051 §2     — file-put/file-get/file/file-available message shapes;
 *                FILE_NOT_FOUND missing-blob path (placeholder + retry once);
 *                the file-data envelope payload IS the dataURL string
 * - 051 §3     — fileId = base64url(sha256(content bytes)), 43 chars;
 *                content addressing ⇒ dedup for free in cache and relay store
 * - 051 §4     — lazy on-demand fetch: file-get on render/load, placeholder +
 *                ONE automatic retry on FILE_NOT_FOUND, addFiles on arrival
 * - 051 §6     — in-session LRU cache (budget e.g. 64MB), keyed by fileId
 * - 051 §7     — 20MB per-file v1 cap; above-cap puts refused BEFORE upload
 *                (the relay enforces the same cap independently)
 * - 051 §8     — private rooms: blob encrypted with the 050 content key,
 *                AAD `excali-collab/v1|file|<fileId>`; the relay stores and
 *                serves opaque ciphertext; metadata is plaintext by design.
 *                TEAM rooms ride plaintext dataURLs (052: "team vs private
 *                rooms (plaintext vs E2E — honest-relay model)")
 * - 058 §2.1   — file-body canon binds {t:"file-data", room, fileId, c, iv}
 * - 058 §3.1   — send-path self-verify (encryptContent never emits a frame
 *                that fails its own signature)
 *
 * Tier rule (051 §8 / 052): `privacy: "team"` ⇒ file-data p = the plaintext
 * dataURL string; `privacy: "private"` ⇒ p = a SignedFrame {c, iv, sig,
 * signer} produced by encryptFile. The client transport never sees the file
 * domain — files.ts rides the client's generic `send` seam + the
 * addMessageListener/addOpenListener seams (task 051 client extension).
 *
 * Offline queue (051: no user action): hydrate() while disconnected keeps
 * the promise pending and queues the request; on the next socket open
 * (initial dial OR reconnect, after hello on the ordered channel) the queue
 * drains automatically.
 *
 * Purity: WebCrypto only — dependency-free (collab-core constraint).
 */

import type { CollabClient } from "./client"
import {
  FrameFormatError,
  GcmAuthError,
  bytesToB64url,
  decryptContent,
  encryptContent,
} from "./envelope"
import type { ContentSigner, SignedFrame } from "./envelope"
import { PROTOCOL_VERSION } from "./wire"
import type { WireEnvelope } from "./wire"

// ─── constants (051 §6/§7 — mirror the relay's own enforcement) ──────────────

/** 051 §7: per-file v1 cap. The client refuses above-cap puts BEFORE any
 *  frame goes out — never a partial relay state; the relay enforces the same
 *  cap independently on the reassembled payload it actually holds. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** 051 §6: in-session LRU cache budget (session-scoped; rooms are ephemeral). */
export const FILE_CACHE_BUDGET_BYTES = 64 * 1024 * 1024

/** 051 §4: delay before the single automatic FILE_NOT_FOUND retry. */
export const FILE_RETRY_DELAY_MS = 2_000

// ─── named errors ────────────────────────────────────────────────────────────

/** 051 §7: above-cap put refused before upload — a clear typed error. */
export class FileTooLargeError extends Error {
  readonly size: number
  readonly cap: number
  constructor(size: number, cap: number) {
    super(`file is ${size} bytes — over the ${cap}-byte (20MB) v1 cap (051 §7); upload refused before any frame is sent`)
    this.name = "FileTooLargeError"
    this.size = size
    this.cap = cap
  }
}

/** File-layer misconfiguration: private room without the content key/signer. */
export class FileConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FileConfigError"
  }
}

// ─── fileId derivation (051 §3) ──────────────────────────────────────────────

/**
 * Content address: fileId = base64url(sha256(content bytes)), unpadded, 43
 * chars (051 §3). Deterministic ⇒ two members inserting the same blob
 * converge on the same fileId ⇒ dedup for free in the cache and the relay
 * store. Mirrors the relay's deriveFileId (the relay is content-blind and
 * keys by this claimed id — honest clients converging is what makes dedup
 * work).
 */
export async function fileIdFor(bytes: Uint8Array): Promise<string> {
  // copy into an ArrayBuffer-backed view (TS 7 lib: BufferSource needs one)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
  return bytesToB64url(digest)
}

// ─── dataURL helpers (051 §2: the envelope payload IS the dataURL string) ────

/**
 * Decode a dataURL to its content bytes. Base64 dataURLs
 * (`data:<mime>[;params];base64,...`) decode to the raw bytes — the content
 * that fileIdFor hashes; anything else (e.g. utf8-encoded SVG dataURLs) falls
 * back to the UTF-8 bytes of the whole string, so the id stays deterministic
 * for whatever the editor produced.
 */
export function dataURLToBytes(dataURL: string): Uint8Array {
  const m = /^data:.*?;base64,(.*)$/s.exec(dataURL)
  if (m !== null) {
    const bin = atob(m[1])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(dataURL)
}

/** Encode content bytes as a base64 dataURL (the inverse of dataURLToBytes). */
export function bytesToDataURL(bytes: Uint8Array, mimeType: string): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return `data:${mimeType};base64,${btoa(bin)}`
}

// ─── encrypted payload wrapper (050 §8 / 051 §8 / 058 §2.1) ──────────────────

/**
 * Encrypt a blob for the wire (PRIVATE rooms only — team rooms ride the
 * plaintext dataURL, 051 §8 / 052): the dataURL string is the file-data
 * plaintext (051 §2) and is AES-GCM-256 encrypted with the 050 content key,
 * AAD `excali-collab/v1|file|<fileId>` (050 §8 — file-scoped ciphertext),
 * plus the Ed25519 file-body signature over the 058 §2.1 canon binding
 * {t:"file-data", room, fileId, c, iv}. The returned SignedFrame is what
 * rides as `file-data` p — opaque to the relay, which never sees plaintext
 * in private rooms.
 */
export async function encryptFile(
  dataURL: string,
  key: CryptoKey,
  roomId: string,
  fileId: string,
  signer: ContentSigner,
): Promise<SignedFrame> {
  return encryptContent({
    key,
    t: "file-data",
    room: roomId,
    shareId: roomId,
    plaintext: dataURL,
    signer,
    fileId,
  })
}

/**
 * Decrypt a file-data SignedFrame back to the dataURL string. A GCM auth
 * failure throws GcmAuthError — the DEFINITIVE stale-key signal (050 §6 /
 * 057 §5 / 058 §5, the 054 stale.gcm path), never a corruption message.
 * Structurally malformed frames throw FrameFormatError.
 */
export async function decryptFile(
  frame: SignedFrame,
  key: CryptoKey,
  roomId: string,
  fileId: string,
): Promise<string> {
  const plaintext = await decryptContent({
    key,
    t: "file-data",
    room: roomId,
    shareId: roomId,
    frame,
    fileId,
  })
  if (typeof plaintext !== "string") {
    throw new FrameFormatError("file-data payload must be a dataURL string (051 §2)")
  }
  return plaintext
}

// ─── put/get over the client (051 §2) ────────────────────────────────────────

/** 051 §2 file-put header — plaintext routing metadata (051 §8). */
export interface FilePutMeta {
  fileId: string
  mimeType: string
  /** declared size in PLAINTEXT content bytes (the relay measures its own
   *  reassembled payload independently and enforces the cap there) */
  size: number
}

/** 051 §2/§8 + 058 §2.2: the file-data body envelope — plaintext dataURL in
 *  team rooms, SignedFrame ciphertext in private rooms. */
export type FileDataEnvelope = { v: 1; t: "file-data"; p: string | SignedFrame }

/**
 * Send a file-put: the header frame FIRST, then the data frame (051 §2 —
 * mirrors the relay's beginPut contract: header first, then the blob). The
 * client applies transparent chunk framing to the data frame when its
 * serialized length exceeds the 200KB threshold (049 §3 / 051 §2 — the same
 * codec as scene). Dropped silently while disconnected (client.send
 * semantics) — the hydrator's putFile reports `uploaded: false` then.
 * Above-cap puts are refused HERE too, before any frame goes out (051 §7).
 */
export function sendFilePut(client: CollabClient, meta: FilePutMeta, dataFrame: FileDataEnvelope): void {
  if (meta.size > MAX_FILE_BYTES) throw new FileTooLargeError(meta.size, MAX_FILE_BYTES)
  client.send({ v: PROTOCOL_VERSION, t: "file-put", p: meta })
  client.send(dataFrame)
}

/** 051 §2: request a stored blob. The relay answers `file` + the data frame,
 *  or `error { code: FILE_NOT_FOUND, fatal: false }` (051 §4: placeholder +
 *  one retry on the client). */
export function requestFileGet(client: CollabClient, fileId: string): void {
  client.send({ v: PROTOCOL_VERSION, t: "file-get", p: { fileId } })
}

// ─── in-session LRU cache (051 §6) ───────────────────────────────────────────

/** 051 §6: a cached blob — the dataURL the page feeds to addFiles (051 §4). */
export interface FileCacheEntry {
  dataURL: string
  mimeType: string
  /** plaintext content bytes */
  size: number
  lastRetrieved: number
}

export interface FileCache {
  get(fileId: string): FileCacheEntry | undefined
  has(fileId: string): boolean
  put(fileId: string, entry: FileCacheEntry): void
  delete(fileId: string): void
  clear(): void
  /** number of cached files */
  readonly size: number
  /** total cached bytes (tracked — eviction uses it) */
  readonly bytes: number
}

/**
 * 051 §6: in-memory LRU by lastRetrieved, evicting the least-recently-used
 * entry when the budget is exceeded. Session-scoped only — rooms are
 * ephemeral and the gallery is the durable record.
 */
export function createFileCache(budgetBytes: number = FILE_CACHE_BUDGET_BYTES): FileCache {
  const map = new Map<string, FileCacheEntry>()
  let bytes = 0
  return {
    get(fileId) {
      return map.get(fileId)
    },
    has(fileId) {
      return map.has(fileId)
    },
    put(fileId, entry) {
      const prev = map.get(fileId)
      bytes += entry.size - (prev?.size ?? 0)
      map.set(fileId, entry)
      // LRU eviction: drop the oldest lastRetrieved until under budget
      while (bytes > budgetBytes && map.size > 0) {
        let oldest: string | null = null
        let oldestAt = Infinity
        for (const [id, e] of map) {
          if (e.lastRetrieved < oldestAt) {
            oldestAt = e.lastRetrieved
            oldest = id
          }
        }
        if (oldest === null) break
        bytes -= map.get(oldest)!.size
        map.delete(oldest)
      }
    },
    delete(fileId) {
      const prev = map.get(fileId)
      if (prev !== undefined) {
        bytes -= prev.size
        map.delete(fileId)
      }
    },
    clear() {
      map.clear()
      bytes = 0
    },
    get size() {
      return map.size
    },
    get bytes() {
      return bytes
    },
  }
}

// ─── on-demand fetch policy + offline queue (051 §4) ─────────────────────────

/** 051 §4 fetch result — the page shows a placeholder for `not-found`. */
export type FileFetchResult =
  | { status: "ok"; fileId: string; mimeType: string; dataURL: string }
  | {
      /** 051 §4: relay answered FILE_NOT_FOUND — show the placeholder.
       *  `retried` is false on the first miss (ONE automatic retry is
       *  scheduled); true once the retry budget for this fileId is spent. */
      status: "not-found"
      fileId: string
      retried: boolean
    }
  | { status: "error"; fileId: string; reason: string }

/** 051 §2 file-available broadcast (relay-originated). */
export interface FileAvailableInfo {
  fileId: string
  mimeType: string
  size: number
}

/** A blob became available from the relay (first fetch or a retry) — the
 *  page re-renders via addFiles (051 §4). */
export interface FileReadyInfo {
  fileId: string
  mimeType: string
  dataURL: string
}

export interface FileHydratorOptions {
  client: CollabClient
  /** room tier — private rooms encrypt with the content key (051 §8); team
   *  rooms ride plaintext dataURLs (052: team vs private) */
  privacy: "team" | "private"
  /** asserted shareId — the canon room for encrypted frames (058 §2.1) */
  roomId: string
  /** AES-GCM-256 content key (deriveContentKey({baseSecret, shareId})).
   *  REQUIRED for private rooms — the constructor throws FileConfigError. */
  key: CryptoKey | null
  /** member signing identity for file-put — REQUIRED for private rooms. */
  signer?: ContentSigner
  /** 051 §6 LRU budget (default FILE_CACHE_BUDGET_BYTES) */
  budgetBytes?: number
  /** 051 §4 automatic-retry delay (default FILE_RETRY_DELAY_MS) */
  retryDelayMs?: number
  /** fired whenever a blob arrives from the relay (first fetch or retry) */
  onFileReady?: (file: FileReadyInfo) => void
  /** fired on fetch-side decrypt failures (a GcmAuthError is the stale-key
   *  signal — the page wires the 054 stale.gcm flow from it) */
  onError?: (error: Error) => void
  /** injectable timers — tests capture the retry callback instead of waiting */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/**
 * The on-demand file fetch policy + offline queue (051 §4). Wires itself to
 * the client:
 * - `file-available` broadcasts mark fileIds known (no auto-download);
 * - `file` header + `file-data` envelope complete a hydrate (decrypt in
 *   private rooms → cache → onFileReady);
 * - `error { FILE_NOT_FOUND }` resolves the oldest outstanding file-get with
 *   a placeholder result and schedules the single automatic retry (051 §4);
 * - every socket open (initial dial AND reconnect, after hello) drains the
 *   offline queue — fetches requested while disconnected go out automatically
 *   (051: no user action).
 *
 * The page drives the lazy triggers (task 052): observeElements on scene
 * apply, hydrateMissing on scene load, hydrate when an element with a
 * missing fileId enters the viewport.
 */
export class FileHydrator {
  private readonly cache: FileCache
  private readonly known = new Set<string>()
  private readonly pending = new Map<
    string,
    { resolve: (result: FileFetchResult) => void; promise: Promise<FileFetchResult> }
  >()
  /** FIFO of fileIds requested on the LIVE connection, not yet answered —
   *  FILE_NOT_FOUND errors carry no fileId, so the relay's in-order responses
   *  correlate positionally (051 §2) */
  private readonly outstanding: string[] = []
  /** the single automatic-retry budget per fileId (051 §4: "retries once") */
  private readonly retried = new Set<string>()
  private readonly retryTimers = new Set<unknown>()
  /** the relay's `file` header awaiting its file-data body (single in-flight
   *  file response per connection, in order) */
  private fileHeader: { fileId: string; mimeType: string } | null = null
  private readonly unsubMessage: () => void
  private readonly unsubOpen: () => void

  constructor(private readonly opts: FileHydratorOptions) {
    if (opts.privacy === "private" && (opts.key === null || opts.signer === undefined)) {
      throw new FileConfigError(
        "private rooms require key + signer — the file layer cannot encrypt (051 §8); " +
          "pass deriveContentKey({baseSecret, shareId}) and the member ContentSigner",
      )
    }
    this.cache = createFileCache(opts.budgetBytes)
    this.unsubMessage = opts.client.addMessageListener((env) => this.handleWire(env))
    this.unsubOpen = opts.client.addOpenListener(() => this.drain())
  }

  /** Unsubscribe from the client and drop retry timers. Pending hydrates
   *  resolve `not-found` (teardown — the caller is leaving the room). */
  dispose(): void {
    this.unsubMessage()
    this.unsubOpen()
    for (const handle of this.retryTimers) {
      const clear = this.opts.clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
      clear(handle)
    }
    this.retryTimers.clear()
    for (const [fileId, entry] of this.pending) {
      entry.resolve({ status: "not-found", fileId, retried: this.retried.has(fileId) })
    }
    this.pending.clear()
    this.outstanding.length = 0
    this.fileHeader = null
  }

  // --- query surface (the page's lazy triggers) -----------------------------

  /** All fileIds seen so far: file-available broadcasts + observeElements. */
  knownFileIds(): ReadonlySet<string> {
    return new Set(this.known)
  }

  /** True when the fileId is known (referenced somewhere) but not cached and
   *  not already being fetched — the page's "should I hydrate on view?" test. */
  needsFile(fileId: string): boolean {
    return this.known.has(fileId) && !this.cache.has(fileId) && !this.pending.has(fileId)
  }

  /** Register the fileIds referenced by scene elements (image elements carry
   *  `fileId`). Returns the newly-known ids. Called by the page on every
   *  scene apply — snapshot AND live (051 §1: scenes carry references only). */
  observeElements(elements: unknown[]): string[] {
    const added: string[] = []
    for (const el of elements) {
      const fileId = (el as { fileId?: unknown } | null)?.fileId
      if (typeof fileId === "string" && fileId !== "" && !this.known.has(fileId)) {
        this.known.add(fileId)
        added.push(fileId)
      }
    }
    return added
  }

  /** Cached blob, or undefined. Touches lastRetrieved (LRU). */
  cached(fileId: string): FileCacheEntry | undefined {
    const entry = this.cache.get(fileId)
    if (entry !== undefined) entry.lastRetrieved = Date.now()
    return entry
  }

  // --- fetch (051 §4) --------------------------------------------------------

  /**
   * Lazy on-demand fetch. Resolves with the cached blob when present; else
   * sends file-get (or queues the request when disconnected — the offline
   * queue drains automatically on the next socket open). FILE_NOT_FOUND
   * resolves `not-found` and schedules the single automatic retry (051 §4);
   * a retry that then succeeds lands in the cache and fires onFileReady.
   * Concurrent hydrates of the same fileId share one request.
   */
  hydrate(fileId: string): Promise<FileFetchResult> {
    const hit = this.cache.get(fileId)
    if (hit !== undefined) {
      hit.lastRetrieved = Date.now()
      return Promise.resolve({ status: "ok", fileId, mimeType: hit.mimeType, dataURL: hit.dataURL })
    }
    const existing = this.pending.get(fileId)
    if (existing !== undefined) return existing.promise // dedup concurrent hydrates
    this.known.add(fileId)
    let resolveFn!: (result: FileFetchResult) => void
    const promise = new Promise<FileFetchResult>((resolve) => {
      resolveFn = resolve
    })
    this.pending.set(fileId, { resolve: resolveFn, promise })
    if (this.opts.client.isOpen) this.sendGet(fileId)
    // else: queued — drain() sends it on the next open (051: no user action)
    return promise
  }

  /** Prefetch on scene load / welcome (051 §4): hydrate every known,
   *  uncached, not-in-flight fileId. Fire-and-forget. */
  hydrateMissing(): void {
    for (const fileId of this.known) {
      if (!this.cache.has(fileId) && !this.pending.has(fileId)) void this.hydrate(fileId)
    }
  }

  // --- upload (051 §3) -------------------------------------------------------

  /**
   * Full upload flow for a locally-inserted blob (051 §3): derive the
   * content-addressed fileId, encrypt for private rooms, then send the
   * file-put header + data frame (chunked by the client when > 200KB).
   * Above-cap blobs throw FileTooLargeError BEFORE any frame goes out
   * (051 §7 — never a partial relay state). Already-cached content is
   * skipped (content addressing ⇒ dedup for free, 051 §3). The blob is
   * registered locally (known + cache) so the inserting member never
   * re-fetches it. `uploaded: false` means the client was disconnected — the
   * page should retry on reconnect (the offline queue covers FETCH only).
   */
  async putFile(input: { mimeType: string; dataURL: string }): Promise<{
    fileId: string
    size: number
    uploaded: boolean
  }> {
    const bytes = dataURLToBytes(input.dataURL)
    if (bytes.length > MAX_FILE_BYTES) throw new FileTooLargeError(bytes.length, MAX_FILE_BYTES)
    const fileId = await fileIdFor(bytes)
    if (this.cache.has(fileId)) {
      return { fileId, size: bytes.length, uploaded: false } // dedup — already here
    }
    const meta: FilePutMeta = { fileId, mimeType: input.mimeType, size: bytes.length }
    const dataFrame: FileDataEnvelope =
      this.opts.privacy === "private"
        ? {
            v: 1,
            t: "file-data",
            // constructor guarantees key + signer for private rooms
            p: await encryptFile(input.dataURL, this.opts.key!, this.opts.roomId, fileId, this.opts.signer!),
          }
        : { v: 1, t: "file-data", p: input.dataURL }
    const wasOpen = this.opts.client.isOpen
    sendFilePut(this.opts.client, meta, dataFrame)
    this.known.add(fileId)
    this.cache.put(fileId, { dataURL: input.dataURL, mimeType: input.mimeType, size: bytes.length, lastRetrieved: Date.now() })
    return { fileId, size: bytes.length, uploaded: wasOpen }
  }

  // --- wire handling ---------------------------------------------------------

  private handleWire(env: WireEnvelope & { from?: string }): void {
    switch (env.t) {
      case "file-available": {
        const p = env.p as Partial<FileAvailableInfo>
        if (typeof p.fileId === "string" && p.fileId !== "") this.known.add(p.fileId)
        return
      }
      case "file": {
        // 051 §2: `file {fileId, mimeType}` header, then the data frame
        const p = env.p as { fileId?: unknown; mimeType?: unknown }
        if (typeof p.fileId === "string" && p.fileId !== "" && typeof p.mimeType === "string") {
          this.removeOutstanding(p.fileId) // the header IS this request's response
          this.fileHeader = { fileId: p.fileId, mimeType: p.mimeType }
        }
        return
      }
      case "file-data":
        void this.handleFileData(env.p)
        return
      case "error": {
        const p = env.p as { code?: unknown }
        if (p?.code === "FILE_NOT_FOUND") {
          // errors carry no fileId — relay responses are in-order per
          // connection, so the oldest outstanding get is the one that missed
          const fileId = this.outstanding.shift()
          if (fileId !== undefined) this.handleNotFound(fileId)
        }
        return
      }
    }
  }

  private async handleFileData(payload: unknown): Promise<void> {
    const header = this.fileHeader
    this.fileHeader = null
    if (header === null) return // no pending file response — ignore
    const { fileId, mimeType } = header
    let dataURL: string
    if (this.opts.privacy === "private") {
      try {
        dataURL = await decryptFile(payload as SignedFrame, this.opts.key!, this.opts.roomId, fileId)
      } catch (e) {
        // GcmAuthError = the definitive stale-key signal (058 §5); anything
        // else is a malformed frame — drop silently (058 §3.3 self-healing)
        this.opts.onError?.(e instanceof Error ? e : new Error(String(e)))
        this.resolve(fileId, { status: "error", fileId, reason: e instanceof Error ? e.message : String(e) })
        return
      }
    } else {
      if (typeof payload !== "string") {
        this.resolve(fileId, { status: "error", fileId, reason: "file-data payload must be a dataURL string (051 §2)" })
        return
      }
      dataURL = payload
    }
    const size = dataURLToBytes(dataURL).length
    this.cache.put(fileId, { dataURL, mimeType, size, lastRetrieved: Date.now() })
    this.known.add(fileId)
    this.resolve(fileId, { status: "ok", fileId, mimeType, dataURL })
    this.opts.onFileReady?.({ fileId, mimeType, dataURL })
  }

  private handleNotFound(fileId: string): void {
    // 051 §4: placeholder + ONE automatic retry
    const retried = this.retried.has(fileId)
    if (!retried) {
      this.retried.add(fileId)
      this.armRetry(fileId)
    }
    this.resolve(fileId, { status: "not-found", fileId, retried })
  }

  /**
   * The single automatic retry (051 §4). If the connection is down when it
   * fires, the retry is DEFERRED — it re-arms until the socket is back, so
   * the retry budget is spent on a request that can actually go out (the
   * offline-queue spirit: fetches wait for the connection, 051).
   */
  private armRetry(fileId: string): void {
    const schedule = this.opts.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    let handle: unknown
    const tick = (): void => {
      if (this.opts.client.isOpen) {
        this.retryTimers.delete(handle)
        this.sendGet(fileId)
      } else {
        // still offline — defer; still the SAME single retry, just waiting
        handle = schedule(tick, this.opts.retryDelayMs ?? FILE_RETRY_DELAY_MS)
      }
    }
    handle = schedule(tick, this.opts.retryDelayMs ?? FILE_RETRY_DELAY_MS)
    this.retryTimers.add(handle)
  }

  private sendGet(fileId: string): void {
    if (!this.opts.client.isOpen) return // dropped — drain/deferred retry re-request
    this.outstanding.push(fileId)
    requestFileGet(this.opts.client, fileId)
  }

  private resolve(fileId: string, result: FileFetchResult): void {
    const entry = this.pending.get(fileId)
    if (entry !== undefined) {
      this.pending.delete(fileId)
      entry.resolve(result)
    }
  }

  private removeOutstanding(fileId: string): void {
    const i = this.outstanding.indexOf(fileId)
    if (i !== -1) this.outstanding.splice(i, 1)
  }

  /** Socket open (initial dial or reconnect): correlation state from the dead
   *  connection is stale — clear it and re-request every still-pending file
   *  (the offline queue drain, 051: no user action). */
  private drain(): void {
    this.fileHeader = null
    this.outstanding.length = 0
    for (const fileId of this.pending.keys()) this.sendGet(fileId)
  }
}
