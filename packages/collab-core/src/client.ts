/**
 * collab-core client transport — protocol v1 (Wayfinder 049 §0–§5, 058 §1.3).
 *
 * PURE module: no React or chrome/browser APIs; it uses WebSocket plus a
 * localStorage-gated debug log (`collab-debug=1`). The exact same code is
 * exercised by the page hook (task 042) and by unit tests.
 * Transport is injectable (`wsFactory`) so tests stub the socket.
 *
 * Connection & seeding (049 §2):
 *   C1 ──(WS ws(s)://relay/party/<shareId>)──▶ R
 *   C1 ── hello {profileId,name,color,privacy,room,admit{org,sig},key} ──▶ R
 *   R  ── welcome {connId, privacy, snapshotAvailable, peers} ──▶ C1
 *   if snapshotAvailable: R ── stored signed envelope verbatim, t preserved
 *       ("seed" | "scene", 058 §1.3 — the minted `snapshot` type is retired)
 *       ──▶ C1  (the client applies any full-scene frame as a resync)
 *   else: C1 may send seed (prompted); first seed wins, the loser gets
 *       `error { SEED_REJECTED }` and reloads the scene it saw broadcast.
 *
 * Reconnect (049 §2): on unexpected close, retry with capped exponential
 * backoff (default 1s → 30s); on reconnect re-send hello with the SAME
 * profileId → fresh welcome + snapshot → resync. `reconnectNow()` is the
 * non-terminal forced variant for background recovery (a suspended
 * renderer can leave the socket half-open with no close event ever
 * firing). `onReconnect` fires when a retry is scheduled so the health
 * layer (061) can show "reconnecting, attempt n · every {interval}". Fatal
 * errors (049 §1: ADMISSION_INVALID,
 * — the relay closes after them and the client does not re-dial. Local edits
 * made during a gap are recovered on the reconnect welcome: the client
 * auto-rebroadcasts its last local scene (full-scene, 061 §2); the hook may
 * merge via merge.ts and send a newer scene through sendScene.
 *
 * Data plane (050/058): content frames (seed/scene/pointer) in encrypted
 * rooms arrive with p = {c, iv, sig, signer}; the client decrypts via
 * decryptContent when `baseSecret` is configured (roomSecret for private
 * rooms, org content key ck for team rooms — 057 §1 symmetry rule) and passes
 * plaintext frames through untouched (unencrypted team rooms). Relay-stamped
 * `from` lives at envelope level, never inside p (wire.ts). Decrypt/format
 * failures drop silently (058 §3.3 — the data plane is self-healing); a GCM
 * auth failure is the definitive stale-key signal (058 §5) and stops
 * reconnects (061 §7 stale.gcm).
 *
 * Send path (049 §5): sendScene is a full-scene broadcast with a 100ms
 * trailing-edge throttle (the latest scene wins); sendSeed/sendPointer send
 * immediately. All outbound envelopes go through serializeEnvelope
 * (transparent chunk framing, 049 §3).
 */

import { ChunkAssembler, serializeEnvelope } from "./chunk"
import type { ChunkFrame } from "./chunk"
import { GcmAuthError, decryptContent, deriveContentKey } from "./envelope"
import type { ContentType, EncryptedPayload } from "./envelope"
import { validateRelayUrl } from "./invites"
import { PROTOCOL_VERSION, ROOM_NAME_MAX_LENGTH } from "./wire"
import type {
  ClientMessage,
  ColorPair,
  ErrorCode,
  Member,
  RoomProbePayload,
  WelcomePayload,
  WireEnvelope,
} from "./wire"

// ---------------------------------------------------------------------------
// Transport abstraction (mirrors the agent-bridge pattern — injectable factory)
// ---------------------------------------------------------------------------

/** Minimal WebSocket surface the client drives (mirrors the agent-bridge
 * BridgeWs shape) — browser WebSocket satisfies it structurally. */
export interface CollabWs {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener?(type: string, listener: (event: unknown) => void): void
}

export type WsFactory = (url: string) => CollabWs

/** The production transport — the platform WebSocket. */
export const defaultWsFactory: WsFactory = (url) => {
  if (typeof WebSocket === "undefined") {
    throw new Error("no WebSocket global available — pass a wsFactory")
  }
  return new WebSocket(url)
}

// ---------------------------------------------------------------------------
// Gated milestone logging (live triage aid)
// ---------------------------------------------------------------------------

/** Debug gate: set localStorage.collab-debug = "1" to log connection
 * milestones (dial / open / hello / welcome / scene / close / state).
 * Zero output unless explicitly enabled — nothing ships noisy by default,
 * and the gate never throws (storage can be unavailable). */
const DEBUG_GATE_KEY = "collab-debug"

export function collabDebugLog(...args: unknown[]): void {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_GATE_KEY) === "1") {
      console.log("[collab]", ...args)
    }
  } catch {
    /* storage unavailable — no debug output */
  }
}

// WebSocket readyState values (numeric — avoids depending on the global's constants)
const WS_OPEN = 1

/**
 * Build the room WS URL `ws(s)://relay/party/<shareId>` (049 §2; the
 * /party/ main-route is what partykit 0.0.115 actually maps to the room
 * DO — /room/ is 404'd by the platform router before the DO ever runs)
 * from a stored relay URL (`http(s)://` or `ws(s)://`). Accepts the loopback
 * dev relay `http://127.0.0.1:1999` (ticket 060) — scheme-only rewrite, no
 * validation of what may be stored (that is the invites module's job).
 * relay URL (`http(s)://` or `ws(s)://`). Accepts the loopback dev relay
 * `http://127.0.0.1:1999` (ticket 060) — scheme-only rewrite, no validation
 * of what may be stored (that is the invites module's job).
 */
export function buildRoomUrl(relay: string, shareId: string): string {
  if (
    !relay.startsWith("http://") &&
    !relay.startsWith("https://") &&
    !relay.startsWith("ws://") &&
    !relay.startsWith("wss://")
  ) {
    throw new Error(`relay must be http(s):// or ws(s):// (got "${relay}")`)
  }
  if (shareId === "") throw new Error("shareId must not be empty")
  const wsRelay = relay.startsWith("http") ? relay.replace(/^http/, "ws") : relay
  return `${wsRelay.replace(/\/+$/, "")}/party/${shareId}`
}

// ---------------------------------------------------------------------------
// Reconnect / throttle policy
// ---------------------------------------------------------------------------

export const RECONNECT_BASE_MS = 1000
export const RECONNECT_MAX_MS = 30_000
export const SCENE_THROTTLE_MS = 100
/** Max wait for a dial to reach OPEN before closing it and retrying. */
export const DIAL_TIMEOUT_MS = 10_000

/**
 * 049 §1 — errors followed by a relay-initiated close; the client never
 * reconnects after them. SEED_REJECTED / CHUNK_INVALID / FILE_NOT_FOUND are
 * non-fatal and stay out of this set.
 */
export const FATAL_ERROR_CODES: readonly ErrorCode[] = [
  "ADMISSION_INVALID",
  "PROTOCOL_VERSION",
  "ROOM_CLAIM_MISMATCH",
  "MESSAGE_TOO_LARGE",
]

// ---------------------------------------------------------------------------
// Inbound message shapes
// ---------------------------------------------------------------------------

/**
 * A full-scene apply (058 §1.3): the relay serves the stored signed envelope
 * verbatim with `t` preserved, so an incoming `seed` and an incoming `scene`
 * are the same resync path for the receiver. `from` is the relay-stamped
 * connId on live relays; relay-SERVED snapshots carry none (058 §1.3 — `from`
 * is per-connection state and meaningless in storage).
 */
export type IncomingScene =
  | { t: "scene"; elements: unknown[]; seq: number; from?: string }
  | { t: "seed"; scene: unknown[]; seq: number; from?: string }

/** Wire pointer payload (049 §1) — what sendPointer emits and remote
 * pointers carry after decryption. */
export interface PointerPayload {
  x: number
  y: number
  tool: "pointer" | "laser"
  button?: "up" | "down"
}

export interface IncomingPointer extends PointerPayload {
  /** relay-stamped connId — always present on live pointers (wire.ts) */
  from: string
}

/**
 * Client-side error codes (NOT on the wire — the wire ErrorCode union is
 * closed). E2E_AUTH_FAILED = the definitive stale-key signal (058 §5): GCM
 * auth failure on a decrypted frame.
 */
export type ClientErrorCode = "E2E_AUTH_FAILED"

export interface CollabError {
  code: ErrorCode | ClientErrorCode
  reason: string
  /** true → reconnecting has stopped (fatal wire error or stale room key). */
  fatal?: boolean
}

/**
 * Connection lifecycle state (061 conn-dot vocabulary): blue pulse on the
 * first connect, amber pulse while retrying, green when live, red steady
 * when rejected (fatal — retrying stopped). Read via `client.state`.
 */
export type CollabClientState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "rejected"

/**
 * Reconnect policy — partysocket-style capped exponential backoff (049 §2,
 * 061 Q6): retries forever after unexpected closes; a fresh welcome
 * restarts the ladder. delay = min(baseMs * 2^attempt, maxMs).
 */
export interface CollabBackoffOptions {
  /** retry after unexpected closes (default true) */
  reconnect?: boolean
  /** first reconnect delay in ms (default 1000) */
  reconnectBaseMs?: number
  /** backoff ceiling in ms (default 30000) */
  reconnectMaxMs?: number
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CollabClientOptions extends CollabBackoffOptions {
  /** Full room WS URL — `buildRoomUrl(relay, shareId)` produces it. */
  url: string
  wsFactory?: WsFactory

  // --- identity (hello, 057 §3) -------------------------------------------
  /** install-uuid, mint-once per install — SAME value on every reconnect. */
  profileId: string
  /** self-chosen display name */
  name: string
  /** uuid-derived color pair (055 native rule) */
  color: ColorPair
  /** room tier — carried in hello; the relay echoes it in welcome */
  privacy: "team" | "private"
  /** asserted shareId — must match the `/party/<shareId>` path */
  room: string
  /** admission proof: org label + b64url Ed25519 sig over the 057 §3 canon */
  admit: { org: string; sig: string }
  /** member Ed25519 public key, b64url (mint-once per install) */
  key: string

  /**
   * Room content-key material, 32B b64url — roomSecret for private rooms, the
   * org content key ck for team rooms (057 §1 symmetry rule, ONE code path).
   * When set, incoming seed/scene/pointer frames whose payload is an
   * EncryptedPayload {c, iv} are decrypted via decryptContent; plaintext
   * frames (unencrypted team rooms) pass through untouched. Absent → the
   * client is a plaintext member and drops encrypted frames silently.
   */
  baseSecret?: string

  /** sendScene trailing-edge throttle window, 049 §5 ~100ms (default 100ms) */
  sceneThrottleMs?: number
  /** max wait for a dial to open before closing it and retrying (default 10s) */
  dialTimeoutMs?: number

  // --- callbacks -----------------------------------------------------------
  /** fires on every socket open (initial dial AND reconnects) */
  onOpen?: () => void
  /** fires for every decoded wire envelope (post chunk reassembly, pre typed
   * dispatch) — the raw envelope as received, p NOT decrypted */
  onMessage?: (env: WireEnvelope & { from?: string }) => void
  /** admission OK + room state summary; also fires on reconnect-welcome */
  onWelcome?: (welcome: WelcomePayload) => void
  /** roster delta (join/leave) */
  onPeer?: (peer: { kind: "join" | "leave"; member?: Member }) => void
  /** full-scene apply — live relays AND relay-served resyncs (058 §1.3) */
  onScene?: (scene: IncomingScene) => void
  /** remote cursor/laser update */
  onPointer?: (pointer: IncomingPointer) => void
  /** wire error frame, or the client-side E2E_AUTH_FAILED stale-key signal */
  onError?: (error: CollabError) => void
  /** fires on every socket close; fatal=true → no reconnect will follow
   * (user close, fatal error, or reconnect disabled) */
  onClose?: (info: { code?: number; reason?: string; fatal: boolean }) => void
  /** 061 §1 conn-dot states — mirrors `client.state` transitions: connecting /
   * connected (≈ live) / reconnecting / rejected / idle (explicit close) */
  onStateChange?: (state: CollabClientState) => void
  /** welcome with snapshotAvailable:false → this client is in the first-seed
   * position (049 §2); call sendSeed(scene, seq) to offer. Losers get
   * SEED_REJECTED (non-fatal) and apply the winner's broadcast scene. */
  onSeedOffer?: () => void
  /** fires when a reconnect attempt is scheduled (health layer, 061) */
  onReconnect?: (info: { attempt: number; delayMs: number }) => void
  /** relay-stamped room-rename broadcast (ADR 0004) — `from` is the renamer's connId */
  onRoomName?: (info: { name: string; from: string }) => void
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class CollabClient {
  private ws: CollabWs | null = null
  private stopped = false
  private fatal = false
  private authFailed = false
  /** backoff ladder position — reset to 0 on every welcome */
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private dialTimer: ReturnType<typeof setTimeout> | null = null
  private sceneTimer: ReturnType<typeof setTimeout> | null = null
  private pendingScene: { elements: unknown[]; seq: number } | null = null
  /** the latest local full scene — rebroadcast after a reconnect welcome
   * (061 §2 offline-edits-sync; the hook may still merge first via merge.ts
   * and send a newer scene — full-scene LWW is self-healing) */
  private lastScene: { elements: unknown[]; seq: number } | null = null
  /** has welcome ever arrived? (first connect vs reconnect) */
  private hadWelcome = false
  private assembler: ChunkAssembler
  private connIdValue: string | null = null
  private stateValue: CollabClientState = "idle"
  /** wire-envelope listeners (task 051 file layer) — fire in registration order */
  private readonly messageListeners = new Set<(env: WireEnvelope & { from?: string }) => void>()
  /** socket-open listeners (task 051 offline queue drain) — fire after opts.onOpen */
  private readonly openListeners = new Set<() => void>()

  constructor(private readonly opts: CollabClientOptions) {
    this.assembler = new ChunkAssembler()
    // 060 §1: https:/wss: any host; http:/ws: loopback IP literals only, plus
    // the /party/<shareId> path (049 §2 — partykit main-route; /room/ is
    // 404'd by the platform router) — validated at construction time
    const urlErr = validateRelayUrl(opts.url)
    if (urlErr !== null) {
      throw new Error(`CollabClient: invalid relay URL: ${urlErr}`)
    }
    const path = new URL(opts.url).pathname
    if (!/^\/party\/[^/]+$/.test(path)) {
      throw new Error(
        `CollabClient: url must be ws(s)://relay/party/<shareId> — got "${opts.url}"`,
      )
    }
  }

  /** A live socket is up (readyState OPEN). */
  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN
  }

  /** connId of the latest welcome (relay-stamped; null before the first). */
  get connId(): string | null {
    return this.connIdValue
  }

  /** Connection lifecycle state (061) — see CollabClientState. */
  get state(): CollabClientState {
    return this.stateValue
  }

  private setState(state: CollabClientState): void {
    if (this.stateValue === state) return
    collabDebugLog("state", { from: this.stateValue, to: state })
    this.stateValue = state
    this.opts.onStateChange?.(state)
  }

  /** Dial (or start the first dial). No-op once stopped or already dialing. */
  connect(): void {
    if (this.stopped || this.fatal || this.ws !== null || this.reconnectTimer !== null) return
    this.dial()
  }

  /** Clean teardown: close the socket, cancel every timer, drop buffers. */
  close(): void {
    if (this.stopped) return
    this.stopped = true
    this.setState(this.fatal ? "rejected" : "idle")
    this.clearTimers()
    this.pendingScene = null
    this.assembler.dispose()
    const ws = this.ws
    try {
      ws?.close()
    } catch {
      /* already closed */
    }
  }

  /**
   * Non-terminal resume: replace the current socket with a fresh dial NOW.
   *
   * Background signal/threshold policy lives in the page's
   * `use-background-resume.ts`; that policy calls this method.
   *
   * Safe by construction: the old socket is DETACHED (this.ws = null)
   * before close(), so its late close event hits the `this.ws !== ws`
   * guard in handleSocketClose and can neither schedule a competing
   * reconnect nor corrupt the new connection's state. lastScene,
   * hadWelcome and the backoff ladder are preserved — the fresh welcome
   * takes the normal reconnect path (snapshot serve + lastScene rebroadcast,
   * 061 §2). No-op once stopped or fatally rejected. `connId` resets to
   * null — the stale welcome's id is meaningless until the fresh welcome
   * re-stamps it, so consumers can detect not-yet-re-admitted.
   */
  reconnectNow(): void {
    if (this.stopped || this.fatal) {
      // Terminal clients are never resurrected (explicit close()/leave()
      // or a fatal admission/stale-key rejection). The hook's resume path
      // filters idle/rejected BEFORE calling — a terminal state here means
      // the caller holds a stale instance (e.g. hot-reload module skew),
      // so make the silent no-op observable instead of guesswork.
      console.warn(
        `[collab] reconnectNow ignored on terminal client (stopped=${this.stopped} fatal=${this.fatal} state=${this.stateValue} ws.readyState=${this.ws?.readyState ?? "none"})`,
      )
      return
    }
    // a pending retry is superseded by this immediate dial
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const stale = this.ws
    if (stale !== null) {
      this.ws = null // detach FIRST — the stale close event must be inert
      this.clearDialTimer()
      this.resetAssembler()
      try {
        stale.close()
      } catch {
        /* already closed */
      }
    }
    this.connIdValue = null // fresh welcome re-stamps it
    collabDebugLog("resume: forced redial", {
      attempt: this.attempt,
      hadWelcome: this.hadWelcome,
      replacedStaleSocket: stale !== null,
    })
    this.dial()
  }

  // --- send path (049 §5) ----------------------------------------------------

  /**
   * Full-scene broadcast with a trailing-edge throttle (~100ms, 049 §5):
   * rapid calls coalesce — the LAST elements/seq wins and is sent once when
   * the window elapses. Dropped silently while disconnected (the reconnect
   * snapshot + the hook's rebroadcast cover the gap, 049 §2).
   */
  sendScene(elements: unknown[], seq: number): void {
    this.lastScene = { elements, seq }
    this.pendingScene = { elements, seq }
    if (this.sceneTimer !== null) return
    const throttle = this.opts.sceneThrottleMs ?? SCENE_THROTTLE_MS
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = null
      const pending = this.pendingScene
      this.pendingScene = null
      if (pending) this.sendEnvelope({ v: PROTOCOL_VERSION, t: "scene", p: pending })
    }, throttle)
  }

  /** First-scene upload for an empty room (049 §2 — first seed wins). Immediate. */
  sendSeed(scene: unknown[], seq: number): void {
    this.lastScene = { elements: scene, seq }
    this.sendEnvelope({ v: PROTOCOL_VERSION, t: "seed", p: { scene, seq } })
  }

  /** Cursor/laser position (onPointerUpdate). Immediate, no throttle. */
  sendPointer(x: number, y: number, tool: "pointer" | "laser", button?: "up" | "down"): void {
    this.sendEnvelope({
      v: PROTOCOL_VERSION,
      t: "pointer",
      p: button === undefined ? { x, y, tool } : { x, y, tool, button },
    })
  }

  /**
   * Offer a new shared room name (ADR 0004): the client-side guard mirrors the
   * relay's validation (trim, non-empty, ≤ 100 chars) so a bad rename is
   * never even put on the wire. Immediate, no throttle — renames are discrete
   * user actions. Dropped silently while disconnected.
   */
  sendRoomName(name: string): void {
    const trimmed = name.trim()
    if (trimmed === "" || trimmed.length > ROOM_NAME_MAX_LENGTH) return
    this.sendEnvelope({ v: PROTOCOL_VERSION, t: "room-name", p: { name: trimmed } })
  }

  /**
   * Generic send seam (task 051): file-put/file-get/file-data envelopes from
   * the file layer. Behaves exactly like the typed senders — transparent
   * chunk framing, dropped silently while disconnected (the file layer
   * queues offline fetches; scene loss is covered by the reconnect resync).
   */
  send(env: WireEnvelope): void {
    this.sendEnvelope(env)
  }

  /**
   * Register a listener for every decoded wire envelope (post chunk
   * reassembly, pre typed dispatch) — the seam the file layer uses to see
   * file-available / file / file-data / error frames. Returns an unsubscribe
   * function.
   */
  addMessageListener(fn: (env: WireEnvelope & { from?: string }) => void): () => void {
    this.messageListeners.add(fn)
    return () => this.messageListeners.delete(fn)
  }

  /**
   * Register a listener that fires on every socket open — the INITIAL dial
   * and every reconnect. Fires AFTER hello has been sent on the same ordered
   * channel, so the relay (roster gate, 052 §3) admits any frames the
   * listener sends (the file layer's offline-queue drain). Returns an
   * unsubscribe function.
   */
  addOpenListener(fn: () => void): () => void {
    this.openListeners.add(fn)
    return () => this.openListeners.delete(fn)
  }

  // --- connection lifecycle --------------------------------------------------

  private dial(): void {
    if (this.stopped || this.fatal || this.ws !== null || this.reconnectTimer !== null) return
    collabDebugLog("dial", {
      url: this.opts.url,
      attempt: this.attempt,
      hadWelcome: this.hadWelcome,
      stopped: this.stopped,
      fatal: this.fatal,
    })
    this.setState("connecting")
    let ws: CollabWs
    try {
      ws = (this.opts.wsFactory ?? defaultWsFactory)(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    collabDebugLog("dial: socket created", { readyState: ws.readyState })
    // A dial that never opens (server unreachable) must not wedge the client:
    // close it after the timeout so the close handler schedules the retry.
    this.dialTimer = setTimeout(() => {
      this.dialTimer = null
      if (this.ws === ws) {
        try {
          ws.close()
        } catch {
          /* already closed */
        }
      }
    }, this.opts.dialTimeoutMs ?? DIAL_TIMEOUT_MS)
    const onOpen = () => {
      if (this.ws !== ws) return
      this.clearDialTimer()
      collabDebugLog("open: transport up, sending hello")
      this.setState("connected")
      this.opts.onOpen?.()
      this.sendHello(ws) // hello FIRST on the ordered channel — open listeners
      // (file-layer queue drain) fire after it, so the relay admits their
      // frames before they arrive (roster gate, 052 §3)
      for (const fn of this.openListeners) fn()
    }
    const onMessage = (event: unknown) => {
      if (this.ws !== ws) return
      this.handleRaw(event)
    }
    const onClose = (event: unknown) => {
      this.handleSocketClose(ws, event)
    }
    ws.addEventListener("open", onOpen)
    ws.addEventListener("message", onMessage)
    ws.addEventListener("close", onClose)
    ws.addEventListener("error", () => {
      // Errors are followed by close(); the dial timer covers never-opens.
    })
  }

  private sendHello(ws: CollabWs): void {
    const hello: ClientMessage = {
      v: PROTOCOL_VERSION,
      t: "hello",
      p: {
        profileId: this.opts.profileId,
        name: this.opts.name,
        color: this.opts.color,
        privacy: this.opts.privacy,
        room: this.opts.room,
        admit: this.opts.admit,
        key: this.opts.key,
      },
    }
    collabDebugLog("hello sent", { profileId: this.opts.profileId, room: this.opts.room, org: this.opts.admit.org })
    this.sendEnvelope(hello)
  }

  private handleSocketClose(ws: CollabWs, event: unknown): void {
    if (this.ws !== ws) return
    this.ws = null
    this.clearDialTimer()
    this.resetAssembler()
    const ev = (event ?? {}) as { code?: unknown; reason?: unknown }
    const code = typeof ev.code === "number" ? ev.code : undefined
    const reason = typeof ev.reason === "string" ? ev.reason : undefined
    // 1008 = policy violation (057 §5: admission sig rejected etc.) — fatal
    if (code === 1008) this.fatal = true
    const fatal = this.stopped || this.fatal || this.opts.reconnect === false
    collabDebugLog("close", { code, reason, fatal, willReconnect: !fatal })
    if (fatal && !this.stopped) this.setState("rejected") // user close keeps "idle"
    this.opts.onClose?.({ code, reason, fatal })
    if (!fatal) this.scheduleReconnect()
  }

  /** partysocket-style capped exponential backoff (049 §2, 061 Q6). */
  private scheduleReconnect(): void {
    if (this.stopped || this.fatal || this.opts.reconnect === false) return
    this.setState("reconnecting")
    const base = this.opts.reconnectBaseMs ?? RECONNECT_BASE_MS
    const max = this.opts.reconnectMaxMs ?? RECONNECT_MAX_MS
    const delay = Math.min(base * 2 ** this.attempt, max)
    this.opts.onReconnect?.({ attempt: this.attempt, delayMs: delay })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.attempt += 1
      this.dial()
    }, delay)
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearDialTimer()
    if (this.sceneTimer !== null) {
      clearTimeout(this.sceneTimer)
      this.sceneTimer = null
    }
  }

  private clearDialTimer(): void {
    if (this.dialTimer !== null) {
      clearTimeout(this.dialTimer)
      this.dialTimer = null
    }
  }

  /** Reset per-connection chunk state (049 §3); partial frames cannot cross a reconnect. */
  private resetAssembler(): void {
    this.assembler.dispose()
    this.assembler = new ChunkAssembler()
  }

  /** Send one wire envelope; transparent chunk framing (049 §3). */
  private sendEnvelope(env: WireEnvelope): void {
    const ws = this.ws
    if (ws === null || ws.readyState !== WS_OPEN) return // drop — resync covers loss
    const res = serializeEnvelope(env)
    if (res.chunked) {
      for (const frame of res.frames) ws.send(JSON.stringify(frame))
    } else {
      ws.send(JSON.stringify(env))
    }
  }

  // --- receive path ----------------------------------------------------------

  private handleRaw(event: unknown): void {
    const raw = (event as { data?: unknown })?.data
    if (typeof raw !== "string") return
    let env: WireEnvelope
    try {
      env = JSON.parse(raw) as WireEnvelope
    } catch {
      return // non-JSON frame — drop (049 §0: every frame is JSON text)
    }
    if (env?.t === "chunk") {
      const completed = this.assembler.feed(env as unknown as ChunkFrame)
      if (completed === null) return // partial set or malformed frame — wait for more
      env = completed
    }
    this.handleEnvelope(env)
  }

  private handleEnvelope(env: WireEnvelope): void {
    if (env.v !== PROTOCOL_VERSION) return // future protocol / relay bug — drop
    this.opts.onMessage?.(env as WireEnvelope & { from?: string })
    for (const fn of this.messageListeners) fn(env as WireEnvelope & { from?: string })
    switch (env.t) {
      case "welcome": {
        const welcome = env.p as WelcomePayload
        collabDebugLog("welcome", {
          connId: welcome.connId,
          snapshotAvailable: welcome.snapshotAvailable,
          peers: welcome.peers?.length ?? 0,
          isReconnect: this.hadWelcome,
        })
        this.connIdValue = welcome.connId
        this.attempt = 0 // healthy session — restart the backoff ladder
        const isReconnect = this.hadWelcome
        this.hadWelcome = true
        this.opts.onWelcome?.(welcome)
        if (welcome.snapshotAvailable !== true) {
          // empty room — first-seed position (049 §2 race rule: first stored
          // wins; losers get SEED_REJECTED and apply the winner's broadcast)
          this.opts.onSeedOffer?.()
        }
        if (isReconnect && this.lastScene !== null) {
          // recovery: rebroadcast local state so peers converge (061 §2
          // offline-edits-sync); the hook may merge + send newer
          this.sendEnvelope({ v: PROTOCOL_VERSION, t: "scene", p: this.lastScene })
        }
        return
      }
      case "peer": {
        const peer = env.p as { kind: "join" | "leave"; member?: Member }
        collabDebugLog("peer", { kind: peer.kind, connId: peer.member?.connId, profileId: peer.member?.profileId })
        this.opts.onPeer?.(peer)
        return
      }
      case "scene":
      case "seed":
        collabDebugLog(env.t, { from: (env as WireEnvelope & { from?: string }).from ?? "snapshot", seq: (env.p as { seq?: unknown }).seq })
        void this.handleContentFrame(env as WireEnvelope<"scene" | "seed">)
        return
      case "pointer":
        void this.handleContentFrame(env as WireEnvelope<"pointer">)
        return
      case "error":
        collabDebugLog("error", env.p as { code?: unknown; reason?: unknown })
        this.handleError(env.p as { code?: unknown; reason?: unknown; fatal?: unknown })
        return
      case "room-name": {
        // relay-stamped rename broadcast (ADR 0004) — a missing `from` is a relay bug (wire.ts)
        const from = (env as WireEnvelope & { from?: string }).from
        const name = (env.p as { name?: unknown }).name
        if (typeof from !== "string" || typeof name !== "string") return
        collabDebugLog("room-name", { name, from })
        this.opts.onRoomName?.({ name, from })
        return
      }
      default:
        return // file / file-available / chunk / unknown — out of this task's scope
    }
  }

  private async handleContentFrame(
    env: WireEnvelope<"scene" | "seed" | "pointer">,
  ): Promise<void> {
    const from = (env as WireEnvelope & { from?: string }).from
    if (env.t === "pointer" && typeof from !== "string") {
      return // live pointers are always relay-stamped (wire.ts) — missing from = relay bug
    }
    const payload = await this.contentPayload(env)
    if (payload === null) return // dropped (decrypt failure / malformed / undecryptable)
    if (env.t === "scene") {
      const p = payload as { elements?: unknown; seq?: unknown }
      if (!Array.isArray(p.elements) || typeof p.seq !== "number") return
      this.opts.onScene?.({ t: "scene", elements: p.elements, seq: p.seq, ...(from ? { from } : {}) })
      return
    }
    if (env.t === "seed") {
      const p = payload as { scene?: unknown; seq?: unknown }
      if (!Array.isArray(p.scene) || typeof p.seq !== "number") return
      this.opts.onScene?.({ t: "seed", scene: p.scene, seq: p.seq, ...(from ? { from } : {}) })
      return
    }
    const p = payload as { x?: unknown; y?: unknown; tool?: unknown; button?: unknown }
    if (typeof p.x !== "number" || typeof p.y !== "number" || (p.tool !== "pointer" && p.tool !== "laser")) {
      return
    }
    const pointer: IncomingPointer = { x: p.x, y: p.y, tool: p.tool, from: from as string }
    if (p.button === "up" || p.button === "down") pointer.button = p.button
    this.opts.onPointer?.(pointer)
  }

  /**
   * Content frames (seed/scene/pointer) carry the plaintext payload directly
   * in unencrypted rooms; in encrypted rooms (050/058) p is a SignedFrame
   * {c, iv, sig, signer} and is decrypted with the content key derived from
   * baseSecret (057 §1 symmetry rule — one code path for both tiers).
   * Returns null when the frame must be dropped:
   *  - encrypted frame in a room without a base secret (undecryptable)
   *  - GCM auth failure — the definitive stale-key signal (058 §5): reported
   *    ONCE via onError({code: "E2E_AUTH_FAILED", fatal: true}) and reconnects
   *    stop (061 §7 stale.gcm); later frames drop silently
   *  - any other decrypt/format failure — silent (058 §3.3: the data plane is
   *    self-healing, zero new wire error codes)
   */
  private async contentPayload(
    env: WireEnvelope<"scene" | "seed" | "pointer">,
  ): Promise<unknown | null> {
    if (!isEncryptedPayload(env.p)) return env.p // plaintext room (or mixed-mode frame)
    if (this.opts.baseSecret === undefined) return null // cannot decrypt — drop
    try {
      const key = await deriveContentKey({ baseSecret: this.opts.baseSecret, shareId: this.opts.room })
      return await decryptContent({
        key,
        t: env.t as ContentType,
        room: this.opts.room,
        shareId: this.opts.room,
        frame: env.p,
      })
    } catch (e) {
      if (e instanceof GcmAuthError && !this.authFailed) {
        this.authFailed = true
        this.fatal = true // a reconnect cannot fix a wrong room key
        this.setState("rejected")
        this.opts.onError?.({ code: "E2E_AUTH_FAILED", reason: e.message, fatal: true })
      }
      return null
    }
  }

  private handleError(p: { code?: unknown; reason?: unknown; fatal?: unknown }): void {
    if (typeof p.code !== "string") return
    const code = p.code as ErrorCode
    const reason = typeof p.reason === "string" ? p.reason : ""
    const fatal = p.fatal === true || FATAL_ERROR_CODES.includes(code)
    this.opts.onError?.({ code, reason, fatal })
    if (fatal) {
      // The relay closes after fatal errors (049 §1) — close proactively so
      // the close handler sees this.fatal and never schedules a reconnect.
      this.fatal = true
      this.setState("rejected")
      try {
        this.ws?.close()
      } catch {
        /* already closed */
      }
    }
  }
}

function isEncryptedPayload(p: unknown): p is EncryptedPayload {
  const r = p as Record<string, unknown> | null
  return r !== null && typeof r.c === "string" && typeof r.iv === "string"
}

// ---------------------------------------------------------------------------
// Room probe (ADR 0004) — the shareId-keyed cheap read path
// ---------------------------------------------------------------------------

export interface RoomProbeOptions {
  /** max wait for the probe answer (default 5000ms) */
  timeoutMs?: number
  /** transport seam (tests inject a stub socket) */
  wsFactory?: WsFactory
}

/**
 * Pre-join room probe (ADR 0004): dial `ws(s)://relay/party/<shareId>`, send
 * a `room-probe` frame as the FIRST message (no hello — no admission, no
 * roster side effect), await the relay's `room-probe` answer and close. The
 * relay answers from the room DO's storage, so a hibernated room is woken
 * for the probe and sleeps again afterwards.
 *
 * Returns the room facts, or null when the probe could not be answered:
 * relay unreachable, no answer within `timeoutMs`, or a legacy relay that
 * rejects unknown first messages. The caller treats null as "state unknown".
 */
export async function probeRoom(
  relay: string,
  shareId: string,
  opts: RoomProbeOptions = {},
): Promise<RoomProbePayload | null> {
  let url: string
  let factory: WsFactory
  try {
    url = buildRoomUrl(relay, shareId)
    factory = opts.wsFactory ?? defaultWsFactory
  } catch {
    return null
  }
  const timeoutMs = opts.timeoutMs ?? 5000
  return new Promise<RoomProbePayload | null>((resolve) => {
    let done = false
    let ws: CollabWs
    try {
      ws = factory(url)
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const finish = (result: RoomProbePayload | null): void => {
      if (done) return
      done = true
      // the probe answered (or failed) — the timeout must not fire later;
      // clearing it here leaves no dangling handle even after finish completes
      // (the `done` guard above still covers re-entry).
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      resolve(result)
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "room-probe", p: {} }))
    })
    ws.addEventListener("message", (event) => {
      const raw = (event as { data?: unknown })?.data
      if (typeof raw !== "string") return
      let env: unknown
      try {
        env = JSON.parse(raw)
      } catch {
        return
      }
      if (env === null || typeof env !== "object" || Array.isArray(env)) return
      const e = env as Record<string, unknown>
      if (e.v !== PROTOCOL_VERSION || e.t !== "room-probe") return
      const p = e.p as Record<string, unknown> | null
      if (p === null || typeof p !== "object") return
      finish({
        roomName: typeof p.roomName === "string" ? p.roomName : null,
        snapshotAvailable: p.snapshotAvailable === true,
        peerCount: typeof p.peerCount === "number" ? p.peerCount : 0,
      })
    })
    ws.addEventListener("close", () => finish(null))
    ws.addEventListener("error", () => finish(null))
  })
}
