/**
 * client.test.ts — collab-core client transport (task 034): hello/welcome
 * handshake, capped-backoff reconnect + resync, fatal-error stop, 100ms scene
 * throttle, chunked receive, plaintext + encrypted content frames.
 *
 * TDD marker: unit. The socket is stubbed via the injectable wsFactory; timers
 * are vitest fake timers (except the crypto tests, which use real timers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CollabClient,
  DIAL_TIMEOUT_MS,
  FATAL_ERROR_CODES,
  SCENE_THROTTLE_MS,
  buildRoomUrl,
} from "./client"
import type { CollabClientOptions } from "./client"
import { serializeEnvelope } from "./chunk"
import { bytesToB64url, deriveContentKey, encryptContent } from "./envelope"

// ---------------------------------------------------------------------------
// Stub socket
// ---------------------------------------------------------------------------

class StubSocket {
  readyState = 0 // CONNECTING
  readonly sent: string[] = []
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
  constructor(readonly url: string) {
    StubSocket.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
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
    for (const fn of [...this.listeners.message]) fn({ data })
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.add(fn)
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.delete(fn)
  }
}

const URL = "ws://127.0.0.1:1999/party/room-1" // loopback dev relay (060 §1), partykit main-route

function makeClient(overrides: Partial<CollabClientOptions> = {}) {
  const wsFactory = (url: string) => new StubSocket(url)
  const client = new CollabClient({
    url: URL,
    wsFactory,
    profileId: "profile-1",
    name: "Alice",
    color: { background: "hsl(0, 100%, 83%)", stroke: "hsl(0, 100%, 83%)" },
    privacy: "team",
    room: "room-1",
    admit: { org: "dev", sig: "b64sig" },
    key: "b64key",
    ...overrides,
  })
  return { client, socket: () => StubSocket.instances[StubSocket.instances.length - 1] }
}

function welcomeMessage(connId = "conn-1", snapshotAvailable = true): string {
  return JSON.stringify({
    v: 1,
    t: "welcome",
    p: { profileId: "profile-1", connId, room: "room-1", privacy: "team", snapshotAvailable, peers: [] },
  })
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.useFakeTimers()
  StubSocket.reset()
})

afterEach(() => {
  vi.useRealTimers()
  StubSocket.reset()
})

// ---------------------------------------------------------------------------
// Dial + handshake
// ---------------------------------------------------------------------------

describe("dial + hello handshake", () => {
  it("sends hello with the correct payload shape on open (and only on open)", () => {
    const onOpen = vi.fn()
    const { client, socket } = makeClient({ onOpen })
    client.connect()
    const ws = socket()
    expect(ws.sent).toEqual([]) // nothing before open
    ws.open()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(ws.sent).toHaveLength(1)
    const hello = JSON.parse(ws.sent[0])
    expect(hello.v).toBe(1)
    expect(hello.t).toBe("hello")
    expect(hello.p).toEqual({
      profileId: "profile-1",
      name: "Alice",
      color: { background: "hsl(0, 100%, 83%)", stroke: "hsl(0, 100%, 83%)" },
      privacy: "team",
      room: "room-1",
      admit: { org: "dev", sig: "b64sig" },
      key: "b64key",
    })
  })

  it("fires onWelcome with snapshotAvailable and peers, and exposes connId", () => {
    const onWelcome = vi.fn()
    const onMessage = vi.fn()
    const { client, socket } = makeClient({ onWelcome, onMessage })
    client.connect()
    socket().open()
    socket().message(welcomeMessage("conn-1", true))
    expect(onWelcome).toHaveBeenCalledTimes(1)
    expect(onWelcome.mock.calls[0][0]).toEqual({
      profileId: "profile-1",
      connId: "conn-1",
      room: "room-1",
      privacy: "team",
      snapshotAvailable: true,
      peers: [],
    })
    expect(client.connId).toBe("conn-1")
    // onMessage sees the raw decoded envelope (pre typed dispatch)
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0][0]).toMatchObject({ v: 1, t: "welcome" })
  })

  it("dispatches peer join/leave roster deltas", () => {
    const onPeer = vi.fn()
    const { client, socket } = makeClient({ onPeer })
    client.connect()
    socket().open()
    socket().message(
      JSON.stringify({
        v: 1,
        t: "peer",
        p: {
          kind: "join",
          member: { profileId: "p2", name: "Bob", color: { background: "hsl(10, 100%, 83%)", stroke: "hsl(10, 100%, 83%)" }, connId: "c2" },
        },
      }),
    )
    expect(onPeer).toHaveBeenCalledTimes(1)
    expect(onPeer.mock.calls[0][0].kind).toBe("join")
    expect(onPeer.mock.calls[0][0].member.profileId).toBe("p2")
  })

  it("drops malformed and unknown frames without crashing", () => {
    const onScene = vi.fn()
    const { client, socket } = makeClient({ onScene })
    client.connect()
    socket().open()
    socket().message("not json")
    socket().message(JSON.stringify({ v: 99, t: "scene", p: { elements: [], seq: 1 } }))
    socket().message(JSON.stringify({ v: 1, t: "bogus", p: {} }))
    expect(onScene).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Reconnect
// ---------------------------------------------------------------------------

describe("capped-backoff reconnect", () => {
  it("re-hellos with the SAME profileId after an unexpected close, gets a fresh welcome, and fires onReconnect", () => {
    const onReconnect = vi.fn()
    const onWelcome = vi.fn()
    const { client, socket } = makeClient({ onReconnect, onWelcome })
    client.connect()
    const ws1 = socket()
    ws1.open()
    ws1.message(welcomeMessage("conn-1"))
    expect(client.connId).toBe("conn-1")

    // server drops
    ws1.close(1006, "gone")
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onReconnect.mock.calls[0][0]).toEqual({ attempt: 0, delayMs: 1000 })
    expect(StubSocket.instances).toHaveLength(1) // not yet re-dialed

    vi.advanceTimersByTime(999)
    expect(StubSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(StubSocket.instances).toHaveLength(2) // backoff timer fired → new dial

    const ws2 = socket()
    expect(ws2.url).toBe(URL)
    ws2.open()
    const hello2 = JSON.parse(ws2.sent[0])
    expect(hello2.t).toBe("hello")
    expect(hello2.p.profileId).toBe("profile-1") // SAME profileId on reconnect

    // fresh welcome + snapshot (relay pushes it; we request nothing) → resync
    ws2.message(welcomeMessage("conn-2", true))
    expect(onWelcome).toHaveBeenCalledTimes(2)
    expect(onWelcome.mock.calls[1][0].connId).toBe("conn-2")
    expect(client.connId).toBe("conn-2")

    // a healthy welcome restarts the backoff ladder
    ws2.close()
    expect(onReconnect.mock.calls[1][0]).toEqual({ attempt: 0, delayMs: 1000 })
    client.close()
  })

  it("grows backoff exponentially and caps at reconnectMaxMs", () => {
    const onReconnect = vi.fn()
    const { client, socket } = makeClient({ onReconnect, reconnectBaseMs: 100, reconnectMaxMs: 1000 })
    client.connect()
    socket().open()
    for (let i = 0; i < 6; i++) {
      socket().close() // no welcome → attempt keeps climbing
      vi.advanceTimersByTime(100 * 2 ** Math.min(i, 4))
      socket().open()
    }
    expect(onReconnect.mock.calls.map((c) => c[0])).toEqual([
      { attempt: 0, delayMs: 100 },
      { attempt: 1, delayMs: 200 },
      { attempt: 2, delayMs: 400 },
      { attempt: 3, delayMs: 800 },
      { attempt: 4, delayMs: 1000 }, // capped
      { attempt: 5, delayMs: 1000 }, // stays capped
    ])
    client.close()
  })

  it("closes a dial that never opens and retries (dial timeout)", () => {
    const onReconnect = vi.fn()
    const { client, socket } = makeClient({ onReconnect })
    client.connect()
    const ws = socket()
    expect(ws.readyState).toBe(0) // CONNECTING — never opens
    vi.advanceTimersByTime(DIAL_TIMEOUT_MS - 1)
    expect(ws.readyState).toBe(0)
    vi.advanceTimersByTime(1)
    expect(ws.readyState).toBe(3) // dial timeout closed it
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(StubSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1000) // backoff → dial #2
    expect(StubSocket.instances).toHaveLength(2)
    client.close()
  })

  it("does NOT reconnect after a fatal wire error", () => {
    const onError = vi.fn()
    const onClose = vi.fn()
    const onReconnect = vi.fn()
    const { client, socket } = makeClient({ onError, onClose, onReconnect })
    client.connect()
    const ws = socket()
    ws.open()
    ws.message(
      JSON.stringify({ v: 1, t: "error", p: { code: "ADMISSION_INVALID", reason: "bad org", fatal: true } }),
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "ADMISSION_INVALID", fatal: true })
    // the client closes proactively (049 §1: relay closes after fatal errors)
    expect(ws.readyState).toBe(3)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose.mock.calls[0][0]).toMatchObject({ fatal: true })
    vi.advanceTimersByTime(60_000)
    expect(StubSocket.instances).toHaveLength(1) // no reconnect
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it("treats fatal codes as fatal even without the flag", () => {
    const onError = vi.fn()
    const { client, socket } = makeClient({ onError })
    client.connect()
    const ws = socket()
    ws.open()
    ws.message(JSON.stringify({ v: 1, t: "error", p: { code: "MESSAGE_TOO_LARGE", reason: "frame exceeds cap" } }))
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "MESSAGE_TOO_LARGE", fatal: true })
    expect(ws.readyState).toBe(3)
    vi.advanceTimersByTime(60_000)
    expect(StubSocket.instances).toHaveLength(1)
  })

  it("reconnects after a NON-fatal error (SEED_REJECTED)", () => {
    const onError = vi.fn()
    const { client, socket } = makeClient({ onError })
    client.connect()
    socket().open()
    socket().message(
      JSON.stringify({ v: 1, t: "error", p: { code: "SEED_REJECTED", reason: "snapshot exists" } }),
    )
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "SEED_REJECTED", fatal: false })
    expect(StubSocket.instances[0].readyState).toBe(1) // socket stays up
    StubSocket.instances[0].close() // unrelated later drop
    vi.advanceTimersByTime(1000)
    expect(StubSocket.instances).toHaveLength(2)
    client.close()
  })

  it("close() tears down: no reconnect, timers cancelled", () => {
    const onReconnect = vi.fn()
    const onClose = vi.fn()
    const { client, socket } = makeClient({ onReconnect, onClose })
    client.connect()
    const ws = socket()
    ws.open()
    client.sendScene([{ id: "x" }], 1) // pending throttle flush
    client.close()
    expect(ws.readyState).toBe(3)
    expect(onClose.mock.calls[0][0]).toMatchObject({ fatal: true }) // user close → no reconnect
    vi.advanceTimersByTime(200)
    expect(ws.sent).toHaveLength(1) // hello only — the pending scene was cancelled
    expect(onReconnect).not.toHaveBeenCalled()
    expect(StubSocket.instances).toHaveLength(1)
  })

  it("exposes the 061 connection state machine", () => {
    const { client, socket } = makeClient()
    expect(client.state).toBe("idle")
    client.connect()
    expect(client.state).toBe("connecting")
    socket().open()
    expect(client.state).toBe("connected")
    socket().close()
    expect(client.state).toBe("reconnecting")
    vi.advanceTimersByTime(1000)
    expect(client.state).toBe("connecting") // re-dial
    socket().open()
    expect(client.state).toBe("connected")
    socket().message(welcomeMessage())
    socket().close()
    expect(client.state).toBe("reconnecting")
    client.close()
    expect(client.state).toBe("idle")
  })

  it("state becomes rejected on a fatal error and stays there", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    socket().message(
      JSON.stringify({ v: 1, t: "error", p: { code: "ROOM_CLAIM_MISMATCH", reason: "wrong room", fatal: true } }),
    )
    expect(client.state).toBe("rejected")
    vi.advanceTimersByTime(60_000)
    expect(StubSocket.instances).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Send path
// ---------------------------------------------------------------------------

describe("send path", () => {
  it("coalesces rapid sendScene calls into one broadcast (100ms throttle, latest wins)", () => {
    const { client, socket } = makeClient({ sceneThrottleMs: SCENE_THROTTLE_MS })
    client.connect()
    socket().open()
    for (let i = 1; i <= 5; i++) client.sendScene([{ id: `e${i}` }], i)
    expect(socket().sent).toHaveLength(1) // hello only
    vi.advanceTimersByTime(SCENE_THROTTLE_MS - 1)
    expect(socket().sent).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(socket().sent).toHaveLength(2)
    const scene = JSON.parse(socket().sent[1])
    expect(scene.t).toBe("scene")
    expect(scene.p).toEqual({ elements: [{ id: "e5" }], seq: 5 })
  })

  it("sends again once the throttle window elapses", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    client.sendScene([{ id: "a" }], 1)
    vi.advanceTimersByTime(100)
    client.sendScene([{ id: "b" }], 2)
    vi.advanceTimersByTime(100)
    expect(socket().sent).toHaveLength(3) // hello + scene(1) + scene(2)
    expect(JSON.parse(socket().sent[2]).p.seq).toBe(2)
  })

  it("sendSeed sends {scene, seq} immediately (no throttle)", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    client.sendSeed([{ id: "s1" }], 1)
    expect(JSON.parse(socket().sent[1])).toEqual({ v: 1, t: "seed", p: { scene: [{ id: "s1" }], seq: 1 } })
  })

  it("sendPointer sends {x, y, tool, button?} immediately", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    client.sendPointer(10, 20, "pointer")
    client.sendPointer(30, 40, "laser", "down")
    expect(JSON.parse(socket().sent[1]).p).toEqual({ x: 10, y: 20, tool: "pointer" })
    expect(JSON.parse(socket().sent[2]).p).toEqual({ x: 30, y: 40, tool: "laser", button: "down" })
  })

  it("drops sends while disconnected (resync covers the gap)", () => {
    const { client, socket } = makeClient()
    client.connect()
    const ws = socket()
    client.sendScene([{ id: "x" }], 1) // socket never opened
    vi.advanceTimersByTime(200)
    expect(ws.sent).toEqual([])
    client.close()
  })

  it("chunks an oversized sendScene into chunk frames", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    client.sendScene([{ id: "big", text: "x".repeat(250 * 1024) }], 1)
    vi.advanceTimersByTime(100)
    const frames = socket().sent.slice(1)
    expect(frames.length).toBeGreaterThan(1)
    for (const f of frames) {
      const parsed = JSON.parse(f)
      expect(parsed.t).toBe("chunk")
      expect(parsed.p.d.length).toBeLessThanOrEqual(200 * 1024)
    }
  })
})

// ---------------------------------------------------------------------------
// Receive path
// ---------------------------------------------------------------------------

describe("receive path", () => {
  it("passes plaintext content frames through in team rooms", async () => {
    const onScene = vi.fn()
    const { client, socket } = makeClient({ onScene })
    client.connect()
    socket().open()
    socket().message(
      JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "e1" }], seq: 5 }, from: "conn-1" }),
    )
    await Promise.resolve() // flush the async decrypt-check continuation (fake timers: no setTimeout)
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0]).toEqual({ t: "scene", elements: [{ id: "e1" }], seq: 5, from: "conn-1" })
  })

  it("treats an incoming seed as a full-scene resync (058 §1.3 — served snapshot has no from)", async () => {
    const onScene = vi.fn()
    const { client, socket } = makeClient({ onScene })
    client.connect()
    socket().open()
    socket().message(JSON.stringify({ v: 1, t: "seed", p: { scene: [{ id: "s1" }], seq: 9 } }))
    await Promise.resolve()
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0]).toEqual({ t: "seed", scene: [{ id: "s1" }], seq: 9 })
  })

  it("dispatches relayed pointers; drops from-less pointers (relay bug)", async () => {
    const onPointer = vi.fn()
    const { client, socket } = makeClient({ onPointer })
    client.connect()
    socket().open()
    socket().message(JSON.stringify({ v: 1, t: "pointer", p: { x: 1, y: 2, tool: "laser" }, from: "conn-1" }))
    await Promise.resolve()
    expect(onPointer).toHaveBeenCalledTimes(1)
    expect(onPointer.mock.calls[0][0]).toEqual({ x: 1, y: 2, tool: "laser", from: "conn-1" })
    socket().message(JSON.stringify({ v: 1, t: "pointer", p: { x: 3, y: 4, tool: "pointer" } }))
    await Promise.resolve()
    expect(onPointer).toHaveBeenCalledTimes(1) // missing from — dropped
  })

  it("reassembles a >200KB chunked scene and dispatches it ONCE", async () => {
    const onScene = vi.fn()
    const onMessage = vi.fn()
    const { client, socket } = makeClient({ onScene, onMessage })
    client.connect()
    socket().open()
    const env = {
      v: 1 as const,
      t: "scene" as const,
      p: { elements: [{ id: "big", text: "x".repeat(250 * 1024) }], seq: 7 },
      from: "conn-9",
    }
    const res = serializeEnvelope(env)
    expect(res.chunked).toBe(true)
    expect(res.frames.length).toBeGreaterThan(1)
    for (const f of res.frames) socket().message(JSON.stringify(f))
    await Promise.resolve()
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0]).toMatchObject({ t: "scene", seq: 7, from: "conn-9" })
    expect(onScene.mock.calls[0][0].elements[0].id).toBe("big")
    // onMessage sees the completed envelope, not the individual chunk frames
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0][0]).toMatchObject({ v: 1, t: "scene" })
  })

  it("round-trips: sendScene → wire JSON → receive path → onScene", async () => {
    const onScene = vi.fn()
    const { client, socket } = makeClient({ onScene })
    client.connect()
    socket().open()
    client.sendScene([{ id: "a", type: "rectangle" }], 3)
    vi.advanceTimersByTime(100)
    const sent = JSON.parse(socket().sent[1])
    expect(sent.t).toBe("scene")
    // the relay would echo the frame to other members with `from` stamped
    socket().message(JSON.stringify({ ...sent, from: "conn-other" }))
    await Promise.resolve()
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0]).toEqual({
      t: "scene",
      elements: [{ id: "a", type: "rectangle" }],
      seq: 3,
      from: "conn-other",
    })
  })
})

// ---------------------------------------------------------------------------
// Encrypted rooms (050/058)
// ---------------------------------------------------------------------------

describe("encrypted content frames", () => {
  const secretA = bytesToB64url(new Uint8Array(32).fill(7))
  const secretB = bytesToB64url(new Uint8Array(32).fill(9))

  async function signer() {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    return {
      profileId: "profile-other",
      privateKey: kp.privateKey,
      publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)),
    }
  }

  it("decrypts an incoming encrypted scene and dispatches the plaintext", async () => {
    vi.useRealTimers()
    const onScene = vi.fn()
    const { client, socket } = makeClient({ privacy: "private", baseSecret: secretA, onScene })
    client.connect()
    socket().open()
    const key = await deriveContentKey({ baseSecret: secretA, shareId: "room-1" })
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: { elements: [{ id: "secret-rect", type: "rectangle" }], seq: 2 },
      signer: await signer(),
    })
    socket().message(JSON.stringify({ v: 1, t: "scene", p: frame, from: "conn-other" }))
    await vi.waitFor(() => expect(onScene).toHaveBeenCalledTimes(1)) // real WebCrypto — poll
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0]).toEqual({
      t: "scene",
      elements: [{ id: "secret-rect", type: "rectangle" }],
      seq: 2,
      from: "conn-other",
    })
    client.close()
  })

  it("treats a GCM auth failure as the stale-key signal: onError E2E_AUTH_FAILED, no reconnect", async () => {
    vi.useRealTimers()
    const onError = vi.fn()
    const onReconnect = vi.fn()
    const onClose = vi.fn()
    const { client, socket } = makeClient({
      privacy: "private",
      baseSecret: secretA, // room secret A
      onError,
      onReconnect,
      onClose,
    })
    client.connect()
    socket().open()
    // frame encrypted under room secret B — wrong key for this client
    const keyB = await deriveContentKey({ baseSecret: secretB, shareId: "room-1" })
    const frame = await encryptContent({
      key: keyB,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: { elements: [], seq: 1 },
      signer: await signer(),
    })
    socket().message(JSON.stringify({ v: 1, t: "scene", p: frame, from: "conn-x" }))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1)) // real WebCrypto — poll
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "E2E_AUTH_FAILED", fatal: true })
    // connection drops later → NO reconnect (061 §7: retrying stops)
    socket().close(1006, "server restart")
    expect(onClose.mock.calls[0][0]).toMatchObject({ fatal: true })
    expect(onReconnect).not.toHaveBeenCalled()
    expect(StubSocket.instances).toHaveLength(1)
    client.close()
  })

  it("drops encrypted frames silently when no base secret is configured", async () => {
    vi.useRealTimers()
    const onScene = vi.fn()
    const { client, socket } = makeClient({ privacy: "team", onScene })
    client.connect()
    socket().open()
    const key = await deriveContentKey({ baseSecret: secretA, shareId: "room-1" })
    const frame = await encryptContent({
      key,
      t: "scene",
      room: "room-1",
      shareId: "room-1",
      plaintext: { elements: [{ id: "x" }], seq: 1 },
      signer: await signer(),
    })
    socket().message(JSON.stringify({ v: 1, t: "scene", p: frame, from: "conn-x" }))
    await flushMicrotasks()
    expect(onScene).not.toHaveBeenCalled()
    client.close()
  })
})

// ---------------------------------------------------------------------------
// URL helper
// ---------------------------------------------------------------------------

describe("buildRoomUrl", () => {
  it("rewrites http(s) relay URLs to ws(s) room URLs", () => {
    expect(buildRoomUrl("http://127.0.0.1:1999", "room-abc")).toBe("ws://127.0.0.1:1999/party/room-abc")
    expect(buildRoomUrl("https://relay.example.com", "room-abc")).toBe("wss://relay.example.com/party/room-abc")
    expect(buildRoomUrl("wss://relay.example.com/", "room-abc")).toBe("wss://relay.example.com/party/room-abc")
    expect(buildRoomUrl("ws://relay.example.com", "room-abc")).toBe("ws://relay.example.com/party/room-abc")
  })

  it("rejects non-ws schemes and empty shareIds", () => {
    expect(() => buildRoomUrl("ftp://x", "r")).toThrow()
    expect(() => buildRoomUrl("https://relay.example.com", "")).toThrow()
  })
})

describe("policy exports", () => {
  it("lists the 049 §1 fatal error codes", () => {
    expect(FATAL_ERROR_CODES).toEqual([
      "ADMISSION_INVALID",
      "PROTOCOL_VERSION",
      "ROOM_CLAIM_MISMATCH",
      "MESSAGE_TOO_LARGE",
    ])
  })
})

describe("061 health surface (onStateChange, 1008, rebroadcast, seed offer)", () => {
  it("emits onStateChange transitions mirroring client.state", () => {
    const onStateChange = vi.fn()
    const { client, socket } = makeClient({ onStateChange })
    expect(onStateChange).not.toHaveBeenCalled()
    client.connect()
    expect(onStateChange).toHaveBeenLastCalledWith("connecting")
    socket().open()
    expect(onStateChange).toHaveBeenLastCalledWith("connected")
    socket().message(welcomeMessage())
    socket().close()
    expect(onStateChange).toHaveBeenLastCalledWith("reconnecting")
    vi.advanceTimersByTime(1000)
    socket().open()
    socket().message(welcomeMessage("conn-2"))
    expect(client.state).toBe("connected")
    client.close()
    expect(onStateChange).toHaveBeenLastCalledWith("idle")
    expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connecting",
      "connected",
      "idle",
    ])
  })

  it("close code 1008 → state rejected, retries stop (policy violation, 057 §5)", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().close(1008, "admission signature rejected")
    expect(client.state).toBe("rejected")
    vi.advanceTimersByTime(300_000)
    expect(StubSocket.instances).toHaveLength(1) // no retries
  })

  it("rebroadcasts the last local full scene after a reconnect welcome (061 §2)", () => {
    const { client, socket } = makeClient()
    client.connect()
    socket().open()
    socket().message(welcomeMessage())
    expect(socket().sent).toHaveLength(1) // hello only — no rebroadcast on FIRST connect
    client.sendScene([{ id: "a", type: "rectangle" }], 7)
    vi.advanceTimersByTime(100)
    socket().close(1006)
    vi.advanceTimersByTime(1000)
    socket().open()
    socket().message(welcomeMessage("conn-2"))
    const resent = socket().sent.slice(1).map((s) => JSON.parse(s))
    expect(resent).toHaveLength(1) // hello + rebroadcast
    expect(resent[0]).toMatchObject({ t: "scene", p: { elements: [{ id: "a", type: "rectangle" }], seq: 7 } })
    client.close()
  })

  it("offers the seed path on welcome with snapshotAvailable:false; stays live on SEED_REJECTED", async () => {
    const onSeedOffer = vi.fn()
    const onScene = vi.fn()
    const { client, socket } = makeClient({ onSeedOffer, onScene })
    client.connect()
    socket().open()
    socket().message(welcomeMessage("conn-1", false))
    expect(onSeedOffer).toHaveBeenCalledTimes(1)
    expect(client.state).toBe("connected")
    client.sendSeed([{ id: "mine" }], 1)
    expect(JSON.parse(socket().sent[1])).toMatchObject({ t: "seed", p: { scene: [{ id: "mine" }], seq: 1 } })
    // race rule (049 §2): another member's seed was stored first
    socket().message(JSON.stringify({ v: 1, t: "error", p: { code: "SEED_REJECTED", reason: "first seed wins" } }))
    expect(socket().readyState).toBe(1) // non-fatal — socket stays up
    // the relay broadcasts the winning scene to all (incl. us) — apply it
    socket().message(JSON.stringify({ v: 1, t: "scene", p: { elements: [{ id: "winner" }], seq: 1 }, from: "conn-other" }))
    await Promise.resolve()
    expect(onScene).toHaveBeenCalledTimes(1)
    expect(onScene.mock.calls[0][0].elements).toEqual([{ id: "winner" }])
    client.close()
  })

  it("constructs only for valid relay URLs (060 §1 + /party/<shareId> partykit main-route)", () => {
    const base = {
      profileId: "profile-1",
      name: "Alice",
      color: { background: "b", stroke: "s" },
      privacy: "team" as const,
      room: "room-1",
      admit: { org: "dev", sig: "s" },
      key: "k",
    }
    expect(() => new CollabClient({ ...base, url: "wss://relay.example.com/party/room-1" })).not.toThrow()
    expect(() => new CollabClient({ ...base, url: "ws://127.0.0.1:1999/party/room-1" })).not.toThrow()
    expect(() => new CollabClient({ ...base, url: "http://relay.example.com/party/room-1" })).toThrow()
    expect(() => new CollabClient({ ...base, url: "ws://localhost:1999/party/room-1" })).toThrow()
    expect(() => new CollabClient({ ...base, url: "wss://relay.example.com/room/room-1" })).toThrow()
    expect(() => new CollabClient({ ...base, url: "wss://relay.example.com/party/" })).toThrow()
  })
})
