/**
 * files-client.test.ts — collab-core file client (goal 023 task 051):
 * sha256 fileId derivation, dataURL helpers, encrypted-payload wrapper
 * (050 §8 / 058 §2.1), file-put/file-get over the client, the on-demand
 * fetch policy + offline queue, FILE_NOT_FOUND placeholder + retry-once,
 * and the 20MB client-side cap.
 *
 * TDD marker: unit. The socket is stubbed via the injectable wsFactory; a
 * tiny in-test relay (roster gate + file store, mirroring 052 §3/§4 and the
 * committed relay's files.ts) echoes hello→welcome, reassembles chunked
 * file-put payloads, broadcasts file-available, and serves file-get with
 * `file` + the data frame (chunked over the standard framing) or
 * FILE_NOT_FOUND. Real timers (crypto is exercised by putFile); the retry
 * delay is injected so tests fire the retry deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChunkAssembler, serializeEnvelope } from "./chunk"
import type { ChunkFrame } from "./chunk"
import { CollabClient } from "./client"
import type { CollabClientOptions } from "./client"
import {
  FILE_RETRY_DELAY_MS,
  FileConfigError,
  FileHydrator,
  FileTooLargeError,
  bytesToDataURL,
  dataURLToBytes,
  decryptFile,
  encryptFile,
  fileIdFor,
} from "./files"
import { GcmAuthError, bytesToB64url, deriveContentKey, encryptContent } from "./envelope"
import type { ContentSigner } from "./envelope"

// ---------------------------------------------------------------------------
// Stub socket + in-test relay (052 §3 roster gate, §4 file store)
// ---------------------------------------------------------------------------

class StubSocket {
  readyState = 0 // CONNECTING
  readonly sent: string[] = []
  /** every relay→client frame (message()) delivered to this socket */
  readonly received: string[] = []
  private listeners: Record<string, Set<(ev: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }
  static instances: StubSocket[] = []
  static reset(): void {
    StubSocket.instances = []
  }
  constructor(
    readonly url: string,
    private readonly onFrame?: (raw: string, ws: StubSocket) => void,
  ) {
    StubSocket.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
    this.onFrame?.(data, this)
  }
  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return
    this.readyState = 3
    for (const fn of [...this.listeners.close]) fn({ code, reason })
  }
  open(): void {
    if (this.readyState !== 0) return
    this.readyState = 1
    for (const fn of [...this.listeners.open]) fn({})
  }
  message(data: string): void {
    this.received.push(data)
    for (const fn of [...this.listeners.message]) fn({ data })
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.add(fn)
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.delete(fn)
  }
}

interface RelayState {
  /** every raw frame the relay received, in order (chunk frames included) */
  rawFrames: unknown[]
  /** frames received by the relay, in order (post chunk reassembly) */
  frames: unknown[]
  /** file-put headers received, in order */
  puts: Array<{ fileId: string; mimeType: string; size: number }>
  /** file-get fileIds received, in order */
  gets: string[]
  /** stored blobs: fileId → { mimeType, envelope } */
  files: Map<string, { mimeType: string; envelope: unknown }>
  /** fileIds the relay answers FILE_NOT_FOUND for (mutable per test) */
  notFound: Set<string>
  /** drop file-put payloads (no file-available) */
  dropPuts?: boolean
  /** suppress the file-available broadcast after a stored put */
  quiet?: boolean
}

function makeRelay(): { state: RelayState; wsFactory: (url: string) => StubSocket } {
  const state: RelayState = {
    rawFrames: [],
    frames: [],
    puts: [],
    gets: [],
    files: new Map(),
    notFound: new Set(),
  }
  const assembler = new ChunkAssembler()
  let welcomed = false
  let inflight: { fileId: string; mimeType: string; size: number } | null = null
  let connSeq = 0

  const handle = (env: unknown, ws: StubSocket): void => {
    const e = env as { v: number; t: string; p: Record<string, unknown> }
    state.frames.push(env)
    switch (e.t) {
      case "hello": {
        // roster gate (052 §3): only welcomed connections are routed
        welcomed = true
        const connId = `conn-${++connSeq}`
        ws.message(
          JSON.stringify({
            v: 1,
            t: "welcome",
            p: {
              profileId: e.p.profileId,
              connId,
              room: e.p.room,
              privacy: e.p.privacy,
              snapshotAvailable: false,
              peers: [],
            },
          }),
        )
        return
      }
      case "file-put": {
        if (!welcomed) return
        const header = e.p as { fileId: string; mimeType: string; size: number }
        state.puts.push(header)
        inflight = header
        return
      }
      case "file-data": {
        if (!welcomed || inflight === null || state.dropPuts) {
          inflight = null
          return
        }
        const meta = inflight
        inflight = null
        state.files.set(meta.fileId, { mimeType: meta.mimeType, envelope: env })
        if (!state.quiet) {
          // 051 §2: on put-complete, broadcast file-available to the others
          ws.message(JSON.stringify({ v: 1, t: "file-available", p: meta }))
        }
        return
      }
      case "file-get": {
        if (!welcomed) return
        const fileId = e.p.fileId as string
        state.gets.push(fileId)
        const stored = state.files.get(fileId)
        if (stored === undefined || state.notFound.has(fileId)) {
          // 051 §4 missing-blob path — the committed relay's exact reason shape
          ws.message(
            JSON.stringify({
              v: 1,
              t: "error",
              p: { code: "FILE_NOT_FOUND", reason: `no blob stored for fileId "${fileId}" (051 §4)`, fatal: false },
            }),
          )
          return
        }
        ws.message(JSON.stringify({ v: 1, t: "file", p: { fileId, mimeType: stored.mimeType } }))
        const ser = serializeEnvelope(stored.envelope as never)
        if (ser.chunked) {
          for (const f of ser.frames) ws.message(JSON.stringify(f))
        } else {
          ws.message(JSON.stringify(stored.envelope))
        }
        return
      }
      default:
        return // scene/pointer/unknown — out of this task's scope
    }
  }

  const wsFactory = (url: string) =>
    new StubSocket(url, (raw, ws) => {
      let env: unknown
      try {
        env = JSON.parse(raw)
      } catch {
        return
      }
      state.rawFrames.push(env)
      if ((env as { t?: string }).t === "chunk") {
        const completed = assembler.feed(env as unknown as ChunkFrame)
        if (completed !== null) handle(completed, ws)
        return
      }
      handle(env, ws)
    })
  return { state, wsFactory }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const URL = "ws://127.0.0.1:1999/room/room-1"
const ROOM = "room-1"
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function makeClient(overrides: Partial<CollabClientOptions> = {}) {
  return new CollabClient({
    url: URL,
    profileId: "profile-1",
    name: "Alice",
    color: { background: "hsl(0, 100%, 83%)", stroke: "hsl(0, 100%, 83%)" },
    privacy: "team",
    room: ROOM,
    admit: { org: "dev", sig: "b64sig" },
    key: "b64key",
    reconnectBaseMs: 10,
    ...overrides,
  })
}

function randomSecret(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function makeSigner(profileId: string): Promise<ContentSigner> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))
  return { profileId, privateKey: kp.privateKey, publicKey: pub }
}

/** 051 §4 retry delay injection — tests fire the retry manually. */
function captureTimers() {
  const pending = new Set<{ fn: () => void; ms: number }>()
  return {
    setTimeoutFn: (fn: () => void, ms: number) => {
      const h = { fn, ms }
      pending.add(h)
      return h
    },
    clearTimeoutFn: (h: unknown) => pending.delete(h as { fn: () => void; ms: number }),
    fire: () => {
      for (const h of [...pending]) {
        pending.delete(h)
        h.fn()
      }
    },
    count: () => pending.size,
  }
}

/** Run a team-room (plaintext) client+hydrator against a fresh stub relay. */
function setupTeam(
  overrides: { quiet?: boolean; dropPuts?: boolean } = {},
): { client: CollabClient; hydrator: FileHydrator; state: RelayState; timers: ReturnType<typeof captureTimers> } {
  const { state, wsFactory } = makeRelay()
  state.quiet = overrides.quiet
  state.dropPuts = overrides.dropPuts
  const timers = captureTimers()
  const client = makeClient({ wsFactory, reconnectBaseMs: 10 })
  const hydrator = new FileHydrator({
    client,
    privacy: "team",
    roomId: ROOM,
    key: null,
    retryDelayMs: FILE_RETRY_DELAY_MS,
    ...timers,
  })
  return { client, hydrator, state, timers }
}

const connectAndWelcome = (client: CollabClient) => {
  client.connect()
  const ws = StubSocket.instances[StubSocket.instances.length - 1]
  ws.open()
  return ws
}

const flush = () => sleep(0)

beforeEach(() => {
  StubSocket.reset()
})

afterEach(() => {
  StubSocket.reset()
})

// ---------------------------------------------------------------------------
// fileId derivation (051 §3)
// ---------------------------------------------------------------------------

describe("fileIdFor (051 §3 content addressing)", () => {
  it("is base64url(sha256) — 43 chars, unpadded, deterministic", async () => {
    const bytes = new TextEncoder().encode("hello")
    const id = await fileIdFor(bytes)
    // known vector: sha256("hello") b64url — LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ
    expect(id).toBe("LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ")
    expect(id).toHaveLength(43)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await fileIdFor(bytes)).toBe(id) // deterministic
  })

  it("distinguishes different content and ignores dataURL envelope", async () => {
    const a = await fileIdFor(new TextEncoder().encode("image-a"))
    const b = await fileIdFor(new TextEncoder().encode("image-b"))
    expect(a).not.toBe(b)
    // identical bytes via different dataURL spellings converge (051 §3 dedup)
    const fromData = await fileIdFor(dataURLToBytes(`data:image/png;base64,${btoa("same-bytes")}`))
    expect(fromData).toBe(await fileIdFor(new TextEncoder().encode("same-bytes")))
  })
})

// ---------------------------------------------------------------------------
// dataURL helpers
// ---------------------------------------------------------------------------

describe("dataURL helpers (051 §2: the envelope payload IS the dataURL string)", () => {
  it("round-trips base64 dataURLs", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    const dataURL = bytesToDataURL(bytes, "image/png")
    expect(dataURL).toBe("data:image/png;base64,AAEC+vv8")
    expect(Array.from(dataURLToBytes(dataURL))).toEqual([0, 1, 2, 250, 251, 252])
  })

  it("handles mime params and falls back to UTF-8 for non-base64 dataURLs", () => {
    expect(dataURLToBytes("data:image/svg+xml;charset=utf-8;base64,aGk=")).toEqual(new TextEncoder().encode("hi"))
    const utf8 = "data:image/svg+xml;utf8,<svg/>"
    expect(dataURLToBytes(utf8)).toEqual(new TextEncoder().encode(utf8))
  })
})

// ---------------------------------------------------------------------------
// encrypted payload wrapper (050 §8 / 058 §2.1)
// ---------------------------------------------------------------------------

describe("encryptFile / decryptFile (051 §8 private rooms)", () => {
  it("round-trips a dataURL through the file-data envelope", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    const signer = await makeSigner("u-1")
    const dataURL = "data:image/png;base64,AAEC+v/8"
    const frame = await encryptFile(dataURL, key, ROOM, "f-1", signer)
    // 058 §2.2: a full SignedFrame
    expect(frame.signer.profileId).toBe("u-1")
    expect(await decryptFile(frame, key, ROOM, "f-1")).toBe(dataURL)
    // ciphertext is opaque — the plaintext never leaks into the frame
    expect(JSON.stringify(frame)).not.toContain("AAEC+v/8")
  })

  it("GCM auth failure with the wrong key — the definitive stale-key signal (058 §5)", async () => {
    const keyA = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    const keyB = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    const signer = await makeSigner("u-1")
    const frame = await encryptFile("data:image/png;base64,aGk=", keyA, ROOM, "f-1", signer)
    await expect(decryptFile(frame, keyB, ROOM, "f-1")).rejects.toBeInstanceOf(GcmAuthError)
    // AAD binds the fileId: decrypting under a different fileId also fails GCM
    await expect(decryptFile(frame, keyA, ROOM, "f-2")).rejects.toBeInstanceOf(GcmAuthError)
  })

  it("rejects a non-string plaintext (the file-data payload must be a dataURL)", async () => {
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    const signer = await makeSigner("u-1")
    const frame = await encryptContent({
      key,
      t: "file-data",
      room: ROOM,
      shareId: ROOM,
      plaintext: { bytes: "not-a-dataurl" },
      signer,
      fileId: "f-1",
    })
    await expect(decryptFile(frame, key, ROOM, "f-1")).rejects.toThrow(/dataURL string/)
  })
})

// ---------------------------------------------------------------------------
// put/get happy path over the client (051 §2/§3/§4)
// ---------------------------------------------------------------------------

describe("file-put / file-get over the client (team room, plaintext)", () => {
  it("putFile sends header-then-data, the relay stores, file-available marks known", async () => {
    const { client, hydrator, state } = setupTeam()
    const ws = connectAndWelcome(client)
    expect(ws).toBeDefined()

    const dataURL = bytesToDataURL(new TextEncoder().encode("png-bytes-123"), "image/png")
    const res = await hydrator.putFile({ mimeType: "image/png", dataURL })
    expect(res.fileId).toHaveLength(43)
    expect(res.size).toBe("png-bytes-123".length)
    expect(res.uploaded).toBe(true)

    // header frame first, then the data frame (beginPut contract, 051 §2)
    const types = state.frames.map((f) => (f as { t: string }).t)
    expect(types.indexOf("file-put")).toBeLessThan(types.indexOf("file-data"))
    expect(state.puts).toEqual([{ fileId: res.fileId, mimeType: "image/png", size: "png-bytes-123".length }])
    expect(state.files.has(res.fileId)).toBe(true)

    // the relay broadcast file-available → the hydrator marks it known
    await flush()
    expect(hydrator.knownFileIds().has(res.fileId)).toBe(true)
    client.close()
    hydrator.dispose()
  })

  it("hydrate fetches on demand and serves the second call from cache (no second get)", async () => {
    const { client, hydrator, state } = setupTeam()
    connectAndWelcome(client)
    const dataURL = bytesToDataURL(new TextEncoder().encode("fetch-me"), "image/png")
    const { fileId } = await hydrator.putFile({ mimeType: "image/png", dataURL })
    expect(state.gets).toHaveLength(0) // no eager download

    // putFile cached the blob locally — a FRESH hydrator exercises the fetch
    hydrator.dispose()
    const fresh = new FileHydrator({ client, privacy: "team", roomId: ROOM, key: null })

    const result = await fresh.hydrate(fileId)
    expect(result).toEqual({ status: "ok", fileId, mimeType: "image/png", dataURL })
    expect(state.gets).toEqual([fileId])

    // cached now — a second hydrate resolves instantly without a new file-get
    const again = await fresh.hydrate(fileId)
    expect(again.status).toBe("ok")
    expect(state.gets).toEqual([fileId])
    expect(fresh.needsFile(fileId)).toBe(false)
    client.close()
    fresh.dispose()
  })

  it("observes scene elements, prefetches on demand, and fires onFileReady", async () => {
    const { client, hydrator, state } = setupTeam()
    connectAndWelcome(client)
    const dataURL = bytesToDataURL(new TextEncoder().encode("scene-img"), "image/jpeg")
    const { fileId } = await hydrator.putFile({ mimeType: "image/jpeg", dataURL })

    const onFileReady = vi.fn()
    hydrator.dispose()
    const fresh = new FileHydrator({
      client,
      privacy: "team",
      roomId: ROOM,
      key: null,
      onFileReady,
    })
    // scene elements carry fileId references only (051 §1)
    const added = fresh.observeElements([
      { id: "rect-1", type: "rectangle" },
      { id: "img-1", type: "image", fileId },
      { id: "img-2", type: "image", fileId: "missing-id" },
    ])
    expect(added).toEqual([fileId, "missing-id"])
    expect(fresh.needsFile(fileId)).toBe(true)
    expect(fresh.needsFile("never-seen")).toBe(false)

    const missing = new Set(fresh.knownFileIds())
    fresh.hydrateMissing()
    await flush()
    await sleep(5)
    expect(state.gets).toEqual([fileId, "missing-id"])


    const result = await fresh.hydrate(fileId)
    expect(result.status).toBe("ok")
    expect(onFileReady).toHaveBeenCalledWith({ fileId, mimeType: "image/jpeg", dataURL })
    client.close()
    fresh.dispose()
  })

  it("encrypted private-room round-trip — the relay never sees plaintext", async () => {
    const { state, wsFactory } = makeRelay()
    const timers = captureTimers()
    const client = makeClient({ wsFactory })
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    const signer = await makeSigner("u-1")
    const hydrator = new FileHydrator({
      client,
      privacy: "private",
      roomId: ROOM,
      key,
      signer,
      retryDelayMs: FILE_RETRY_DELAY_MS,
      ...timers,
    })
    connectAndWelcome(client)

    const secret = "top-secret-png-bytes"
    const dataURL = bytesToDataURL(new TextEncoder().encode(secret), "image/png")
    const { fileId } = await hydrator.putFile({ mimeType: "image/png", dataURL })

    // the stored unit is opaque ciphertext — plaintext never reaches the relay
    const stored = state.files.get(fileId)!
    const storedEnv = stored.envelope as { t: string; p: { c: string; iv: string; sig: string; signer: unknown } }
    expect(storedEnv.t).toBe("file-data")
    expect(storedEnv.p).toMatchObject({ c: expect.any(String), iv: expect.any(String), sig: expect.any(String) })
    expect(JSON.stringify(storedEnv.p)).not.toContain(secret)

    // fetch decrypts back to the dataURL
    const result = await hydrator.hydrate(fileId)
    expect(result.status).toBe("ok")
    if (result.status === "ok") expect(result.dataURL).toBe(dataURL)
    client.close()
    hydrator.dispose()
  })

  it("chunked file-put and file-get (>200KB) reassemble on both sides (049 §3 / 051 §2)", async () => {
    const { client, hydrator, state } = setupTeam()
    const ws = connectAndWelcome(client)
    const bytes = new Uint8Array(300 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const dataURL = bytesToDataURL(bytes, "image/png")

    const { fileId, size } = await hydrator.putFile({ mimeType: "image/png", dataURL })
    expect(size).toBe(bytes.length)
    // the client chunked the file-data envelope (serialized > 200KB) — the
    // relay saw raw chunk frames and reassembled before storing
    const rawTypes = state.rawFrames.map((f) => (f as { t: string }).t)
    expect(rawTypes.filter((t) => t === "chunk").length).toBeGreaterThan(1)
    expect(state.frames.some((f) => (f as { t: string }).t === "file-data")).toBe(true)

    // putFile cached locally — a FRESH hydrator exercises the chunked serve
    hydrator.dispose()
    const fresh = new FileHydrator({ client, privacy: "team", roomId: ROOM, key: null })
    const result = await fresh.hydrate(fileId)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.dataURL).toBe(dataURL)
      expect(Array.from(dataURLToBytes(result.dataURL))).toEqual(Array.from(bytes))
    }
    // the relay also chunked its serve (>200KB) — chunk frames reached the
    // client's assembler, which reassembled before the hydrator saw it
    const receivedTypes = ws.received.map((raw) => (JSON.parse(raw) as { t: string }).t)
    expect(receivedTypes.filter((t) => t === "chunk").length).toBeGreaterThan(1)
    client.close()
    fresh.dispose()
  })
})

// ---------------------------------------------------------------------------
// FILE_NOT_FOUND → placeholder + one retry (051 §4)
// ---------------------------------------------------------------------------

describe("FILE_NOT_FOUND (051 §4 placeholder + retry once)", () => {
  it("resolves a placeholder result and retries exactly once, giving up after", async () => {
    const { client, hydrator, state, timers } = setupTeam()
    connectAndWelcome(client)
    state.notFound.add("f-404")

    const result = await hydrator.hydrate("f-404")
    expect(result).toEqual({ status: "not-found", fileId: "f-404", retried: false })
    expect(state.gets).toEqual(["f-404"])
    expect(timers.count()).toBe(1) // one automatic retry scheduled

    timers.fire() // retry #1
    await flush()
    expect(state.gets).toEqual(["f-404", "f-404"])
    expect(timers.count()).toBe(0) // retried once — budget spent

    await sleep(5)
    expect(state.gets).toEqual(["f-404", "f-404"]) // no third request
    expect(hydrator.needsFile("f-404")).toBe(true) // still known + uncached
    client.close()
    hydrator.dispose()
  })

  it("a successful retry replaces the placeholder via onFileReady", async () => {
    const { client, hydrator, state, timers } = setupTeam()
    connectAndWelcome(client)
    const dataURL = bytesToDataURL(new TextEncoder().encode("late-arrival"), "image/png")
    const { fileId } = await hydrator.putFile({ mimeType: "image/png", dataURL })
    state.notFound.add(fileId) // simulate the DO store racing the room

    const onFileReady = vi.fn()
    hydrator.dispose()
    const fresh = new FileHydrator({
      client,
      privacy: "team",
      roomId: ROOM,
      key: null,
      onFileReady,
      retryDelayMs: FILE_RETRY_DELAY_MS,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    })

    const result = await fresh.hydrate(fileId)
    expect(result).toEqual({ status: "not-found", fileId, retried: false })

    state.notFound.delete(fileId) // the blob becomes available
    timers.fire() // the scheduled retry now succeeds
    await flush()
    expect(state.gets).toEqual([fileId, fileId])
    expect(onFileReady).toHaveBeenCalledWith({ fileId, mimeType: "image/png", dataURL })
    expect(fresh.cached(fileId)?.dataURL).toBe(dataURL)
    client.close()
    fresh.dispose()
  })

  it("defers the single retry while offline and sends it after reconnect", async () => {
    const { client, hydrator, state, timers } = setupTeam()
    const ws1 = connectAndWelcome(client)
    const dataURL = bytesToDataURL(new TextEncoder().encode("deferred"), "image/png")
    const { fileId } = await hydrator.putFile({ mimeType: "image/png", dataURL })
    hydrator.dispose()
    const fresh = new FileHydrator({
      client,
      privacy: "team",
      roomId: ROOM,
      key: null,
      retryDelayMs: FILE_RETRY_DELAY_MS,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    })

    state.notFound.add(fileId)
    const result = await fresh.hydrate(fileId)
    expect(result).toEqual({ status: "not-found", fileId, retried: false })
    expect(timers.count()).toBe(1)

    // connection drops before the retry fires → the retry defers, not lost
    ws1.close()
    timers.fire()
    expect(timers.count()).toBe(1) // re-armed, still the SAME single retry
    expect(state.gets).toEqual([fileId]) // nothing sent while offline

    await sleep(30) // reconnect dials a fresh socket
    const ws2 = StubSocket.instances[StubSocket.instances.length - 1]
    state.notFound.delete(fileId) // blob is back when we reconnect
    ws2.open()
    timers.fire() // deferred retry goes out on the live connection
    await flush()
    expect(state.gets).toEqual([fileId, fileId])
    expect(fresh.cached(fileId)?.dataURL).toBe(dataURL)
    client.close()
    fresh.dispose()
  })
})

// ---------------------------------------------------------------------------
// offline queue (051: queued while disconnected, drains on reconnect)
// ---------------------------------------------------------------------------

describe("offline fetch queue", () => {
  it("queues hydrates requested while disconnected and drains on the first open", async () => {
    const { state, wsFactory } = makeRelay()
    // member A: connects and uploads, so the relay holds the blob
    const clientA = makeClient({ wsFactory })
    const hydratorA = new FileHydrator({ client: clientA, privacy: "team", roomId: ROOM, key: null })
    connectAndWelcome(clientA)
    const dataURL = bytesToDataURL(new TextEncoder().encode("queued-img"), "image/png")
    const { fileId } = await hydratorA.putFile({ mimeType: "image/png", dataURL })
    clientA.close()
    hydratorA.dispose()

    // member B: never connected — hydrates get queued, not sent
    const clientB = makeClient({ wsFactory })
    const queued = new FileHydrator({ client: clientB, privacy: "team", roomId: ROOM, key: null })
    const p1 = queued.hydrate(fileId)
    const p2 = queued.hydrate(fileId) // concurrent → one request
    let settled = false
    void p1.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false) // still queued, nothing sent
    expect(state.gets).toHaveLength(0)

    clientB.connect()
    StubSocket.instances[StubSocket.instances.length - 1].open()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.status).toBe("ok")
    expect(r2.status).toBe("ok")
    expect(state.gets).toEqual([fileId]) // drained once, deduped
    clientB.close()
    queued.dispose()
  })

  it("re-queues during a disconnect and drains automatically on reconnect", async () => {
    const { client, hydrator, state } = setupTeam()
    const ws1 = connectAndWelcome(client)
    const dataURL = bytesToDataURL(new TextEncoder().encode("gap-img"), "image/png")
    const { fileId } = await hydrator.putFile({ mimeType: "image/png", dataURL })

    // warm the cache through a REAL fetch (putFile cached locally, so a fresh
    // hydrator is what exercises the wire)
    hydrator.dispose()
    const warm = new FileHydrator({ client, privacy: "team", roomId: ROOM, key: null })
    expect((await warm.hydrate(fileId)).status).toBe("ok")
    expect(state.gets).toEqual([fileId])
    warm.dispose()
    const queued = new FileHydrator({ client, privacy: "team", roomId: ROOM, key: null })

    // simulate a dropped connection; the client schedules a reconnect
    ws1.close()
    await sleep(30) // reconnectBaseMs 10 → fresh dial
    const ws2 = StubSocket.instances[StubSocket.instances.length - 1]
    expect(ws2).not.toBe(ws1)

    // hydrate during the gap — queued, no frame sent
    const p = queued.hydrate(fileId)
    await flush()
    expect(state.gets).toEqual([fileId]) // pre-gap fetch only

    ws2.open() // reconnect: hello → welcome → drain
    const result = await p
    expect(result.status).toBe("ok")
    expect(state.gets).toEqual([fileId, fileId]) // drained on reconnect
    client.close()
    queued.dispose()
  })
})

// ---------------------------------------------------------------------------
// 20MB client-side cap (051 §7)
// ---------------------------------------------------------------------------

describe("20MB v1 cap (051 §7)", () => {
  it("refuses above-cap puts with a typed error before any frame is sent", async () => {
    const { client, hydrator, state } = setupTeam()
    connectAndWelcome(client)
    const big = "x".repeat(20 * 1024 * 1024 + 1)
    const dataURL = `data:image/png;base64,${btoa(big)}`
    await expect(hydrator.putFile({ mimeType: "image/png", dataURL })).rejects.toBeInstanceOf(FileTooLargeError)
    // no file frame ever hit the wire (only the connection's hello did)
    const fileFrames = state.rawFrames.filter((f) => {
      const t = (f as { t: string }).t
      return t === "file-put" || t === "file-data" || t === "file-get"
    })
    expect(fileFrames).toHaveLength(0)
    client.close()
    hydrator.dispose()
  })

  it("accepts an exactly-at-cap blob", async () => {
    const { client, hydrator, state } = setupTeam()
    connectAndWelcome(client)
    const big = "y".repeat(20 * 1024 * 1024)
    const dataURL = `data:image/png;base64,${btoa(big)}`
    const res = await hydrator.putFile({ mimeType: "image/png", dataURL })
    expect(res.size).toBe(20 * 1024 * 1024)
    expect(state.files.has(res.fileId)).toBe(true)
    client.close()
    hydrator.dispose()
  })
})

// ---------------------------------------------------------------------------
// configuration guards
// ---------------------------------------------------------------------------

describe("FileHydrator configuration", () => {
  it("throws FileConfigError when a private room lacks key or signer", async () => {
    const { state, wsFactory } = makeRelay()
    const client = makeClient({ wsFactory })
    expect(() => new FileHydrator({ client, privacy: "private", roomId: ROOM, key: null })).toThrow(FileConfigError)
    const key = await deriveContentKey({ baseSecret: randomSecret(), shareId: ROOM })
    expect(() => new FileHydrator({ client, privacy: "private", roomId: ROOM, key })).toThrow(FileConfigError)
    // team rooms need neither
    expect(() => new FileHydrator({ client, privacy: "team", roomId: ROOM, key: null })).not.toThrow()
    void state
  })
})
