/**
 * Agent Bridge — WS client (Leg B: activated Local editor page → local daemon).
 *
 * PURE module: no React, no chrome/browser APIs, no `@/` aliases — so the exact
 * same code is exercised by the page hook AND by the throwaway stub harness
 * (`scripts/agent-bridge/driver.ts`). Transport is injectable (`wsFactory`) for
 * unit tests.
 *
 * Security posture (Ticket 011):
 *  - loopback only (`ws://127.0.0.1:<port>`)
 *  - origin allow-list enforced by the SERVER (page sends its
 *    `chrome-extension://<id>` origin in the handshake)
 *  - ≥128-bit per-activation-session token minted by the PAGE, presented in the
 *    handshake; dropped on teardown (rotation on next activation)
 */

import {
  BRIDGE_PORTS,
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_PING_TIMEOUT_MS,
  BRIDGE_RECONNECT_BASE_MS,
  BRIDGE_RECONNECT_MAX_MS,
  BRIDGE_RECONNECT_FIRST_MS,
  BRIDGE_KEEPALIVE_MS,
  WS_HANDSHAKE,
  WS_HANDSHAKE_OK,
  WS_HANDSHAKE_ERROR,
  WS_PING,
  WS_PONG,
  WS_PROFILE_ID_FIELD,
} from "excali-shared";

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

export interface BridgeWs {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type WsFactory = (url: string) => BridgeWs;

export const defaultWsFactory: WsFactory = (url) => new WebSocket(url);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Per-profile close-drain gate (goal 1, task 008)
// ---------------------------------------------------------------------------
// The daemon unregisters a profile's control connection only after its read
// loop processes the close frame. A re-dial for the SAME profile that wins that
// race makes the daemon treat the fresh handshake as a takeover of the OLD
// (already-closing) connection — registerControl logs "displacing prior control
// page (same profile)" and sends a spurious `displaced` (server.go). The gate
// below serializes dials per profile: a new dial waits for the previous socket
// to reach CLOSED (bounded, so a dead socket can never wedge reconnects) plus a
// small drain delay, guaranteeing the daemon has already processed the old
// close frame. Purely client-side timing — zero protocol change.

/** Extra wait after a socket reaches CLOSED before a replacement dial for the
 * same profile (loopback close-frame processing is microseconds-to-a-few-ms). */
export const BRIDGE_CLOSE_DRAIN_MS = 10;

/** Cap on waiting for the previous socket's close event. On loopback the close
 * handshake completes in µs; the cap only matters for a half-dead socket whose
 * close event may never fire — future dials must not block on it forever. */
const BRIDGE_CLOSE_DRAIN_CAP_MS = 250;

const profileDrains = new Map<string, Promise<void>>();

/** Resolve once `socket` has reached CLOSED (close event fired) or the cap elapsed. */
function waitSocketClosed(socket: BridgeWs, capMs: number): Promise<void> {
  if (socket.readyState === WS_CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, capMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.addEventListener("close", onClose);
  });
}

/** Record that a socket for `profileId` is closing — later dials must drain it. */
function registerProfileDrain(profileId: string | undefined, socket: BridgeWs | null): void {
  if (!profileId || !socket) return;
  const drain = waitSocketClosed(socket, BRIDGE_CLOSE_DRAIN_CAP_MS).then(() =>
    sleep(BRIDGE_CLOSE_DRAIN_MS),
  );
  profileDrains.set(profileId, drain);
  void drain.then(() => {
    // Clear only if still the latest gate (a newer close supersedes it).
    if (profileDrains.get(profileId) === drain) profileDrains.delete(profileId);
  });
}

/** Await the previous socket for `profileId` reaching CLOSED + the drain delay. */
async function awaitProfileDrain(profileId: string | undefined): Promise<void> {
  const drain = profileId ? profileDrains.get(profileId) : undefined;
  if (drain) await drain;
}

// WebSocket readyState values (numeric — avoids depending on the global's constant)
const WS_OPEN = 1;
const WS_CLOSED = 3;
// ---------------------------------------------------------------------------
// Single connection + token handshake
// ---------------------------------------------------------------------------

export interface AgentBridgeClientOptions {
  url: string;
  /** Origin presented in the handshake — `chrome-extension://<id>` for the page. */
  origin: string;
  /** ≥128-bit per-activation-session handshake token. */
  token: string;
  /**
   * Connection role (goal 3): "control-page" for the paired-but-not-activated
   * control connection. Absent/"page" = active-slot page; "agent" = CLI.
   */
  role?: string;
  /** Per-profile uuid — REQUIRED by the daemon for page + control-page roles. */
  profileId?: string;
  wsFactory?: WsFactory;
  handshakeTimeoutMs?: number;
  pingTimeoutMs?: number;
}

export class AgentBridgeClient {
  private ws: BridgeWs | null = null;
  private closed = false;
  private connectResolve: ((ok: boolean) => void) | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private pongWait: {
    timer: ReturnType<typeof setTimeout>;
    resolve: (ok: boolean) => void;
  } | null = null;

  /** Session hooks (set by AgentBridgeSession). */
  onClose: (() => void) | null = null;
  onInbound: ((msg: Record<string, unknown>) => void) | null = null;

  constructor(private opts: AgentBridgeClientOptions) {}
  /**
   * Outstanding JSON-RPC request/response correlations (page-initiated
   * requests like `bridge.stop` — 045). Keyed by the string request id.
   */
  private pending: Map<
    string,
    { resolve: (v: BridgeRequestResult) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private rpcIdCounter = 0;

  /** JSON-RPC round-trip over the live connection (resolves on the matched
   * response, times out, or fails fast when the socket is not open). */
  request(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<BridgeRequestResult> {
    return new Promise((resolve) => {
      if (!this.isOpen || this.closed) {
        resolve({ ok: false, reason: "not-connected" });
        return;
      }
      const id = `req-${(++this.rpcIdCounter).toString(36)}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, reason: "timeout" });
      }, timeoutMs ?? BRIDGE_PING_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.ws!.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
      );
    });
  }

  /** Route an inbound JSON-RPC response to its pending request; returns true
   * when consumed (else the message falls through to onInbound). */
  private matchResponse(msg: Record<string, unknown>): boolean {
    if (msg.jsonrpc !== "2.0" || typeof msg.id !== "string") return false;
    if (typeof msg.method === "string") return false; // a request, not a reply
    const p = this.pending.get(msg.id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    const err = msg.error as { code?: unknown; message?: unknown } | undefined;
    if (err != null) {
      p.resolve({
        ok: false,
        reason: typeof err.message === "string" ? err.message : "daemon-error",
        code: err.code,
      });
    } else {
      p.resolve({ ok: true, result: msg.result });
    }
    return true;
  }

  /** Fail every in-flight page-initiated request (socket closed / stopped). */
  private failAllPending(reason: string) {
    for (const [id, p] of [...this.pending]) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve({ ok: false, reason });
    }
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WS_OPEN;
  }

  /** Open the socket and complete the token handshake. Resolves true on handshake_ok. */
  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(false);
        return;
      }
      this.connectResolve = resolve;
      // connect-level timeout: covers the socket never opening (no open event)
      this.handshakeTimer = setTimeout(
        () => finish(false),
        this.opts.handshakeTimeoutMs ?? BRIDGE_HANDSHAKE_TIMEOUT_MS,
      );
      const ws = (this.opts.wsFactory ?? defaultWsFactory)(this.opts.url);
      this.ws = ws;

      const finish = (ok: boolean) => {
        if (!this.connectResolve) return;
        this.connectResolve = null;
        if (this.handshakeTimer) {
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }
        resolve(ok);
      };

      const onOpen = () => {
        ws.send(
          JSON.stringify({
            type: WS_HANDSHAKE,
            token: this.opts.token,
            origin: this.opts.origin,
            ...(this.opts.role ? { role: this.opts.role } : {}),
            ...(this.opts.profileId ? { [WS_PROFILE_ID_FIELD]: this.opts.profileId } : {}),
          }),
        );
      };
      const onMessage = (event: unknown) => {
        const raw = (event as { data?: unknown })?.data;
        if (typeof raw !== "string") return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.type === WS_HANDSHAKE_OK) {
          finish(true);
        } else if (msg.type === WS_HANDSHAKE_ERROR) {
          finish(false);
        } else if (msg.type === WS_PONG && this.pongWait) {
          clearTimeout(this.pongWait.timer);
          const w = this.pongWait;
          this.pongWait = null;
          w.resolve(true);
        } else if (this.matchResponse(msg)) {
          // A JSON-RPC response for a page-initiated request (bridge.stop — 045)
          // was consumed by the request correlation; do not fan it to onInbound.
        } else {
          this.onInbound?.(msg);
        }
      };
      const onClose = () => {
        this.closed = true;
        finish(false);
        // Any close (ours or the daemon's) must be drained before a same-profile
        // re-dial — see the drain-gate block above.
        registerProfileDrain(this.opts.profileId, ws);
        // Page-initiated JSON-RPC requests in flight (bridge.stop — 045) can
        // never be answered once the socket is gone.
        this.failAllPending("socket-closed");
        this.onClose?.();
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", () => {
        // Errors are followed by close(); the handshake timer covers never-opens.
      });
    });
  }

  /** Ping/echo round-trip over the live connection. */
  ping(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isOpen || this.closed) {
        resolve(false);
        return;
      }
      this.pongWait = {
        timer: setTimeout(
          () => {
            const w = this.pongWait;
            this.pongWait = null;
            w?.resolve(false);
          },
          this.opts.pingTimeoutMs ?? BRIDGE_PING_TIMEOUT_MS,
        ),
        resolve,
      };
      this.ws!.send(JSON.stringify({ type: WS_PING }));
    });
  }

  /** A ping is in flight (sent, pong not yet received). */
  hasPendingPing(): boolean {
    return this.pongWait !== null;
  }
  /** Send a JSON message over the live connection (canvas/v1 responses). */
  sendJSON(obj: unknown): void {
	if (!this.isOpen || this.closed) return;
	this.ws!.send(JSON.stringify(obj));
  }

  close(): void {
    this.closed = true;
    if (this.pongWait) {
      clearTimeout(this.pongWait.timer);
      const w = this.pongWait;
      this.pongWait = null;
      w.resolve(false);
    }
    const resolve = this.connectResolve;
    this.connectResolve = null;
    if (resolve) resolve(false);
    const ws = this.ws;
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    // Retain this.ws (the client is single-use): the drain gate observes the
    // socket actually reaching CLOSED before a replacement dial for this
    // profile. isOpen/sendJSON/ping all guard on this.closed, so a retained
    // closed socket is inert.
    registerProfileDrain(this.opts.profileId, ws);
    // Page-initiated JSON-RPC requests in flight (bridge.stop — 045) can
    // never be answered once the client is stopped.
    this.failAllPending("socket-closed");
  }
}

/**
 * Result of a page-initiated JSON-RPC round-trip (045 — bridge.stop):
 * `ok: true` + the daemon's result, or `ok: false` + reason/code.
 */
export interface BridgeRequestResult {
  ok: boolean;
  result?: unknown;
  reason?: string;
  code?: unknown;
}

// ---------------------------------------------------------------------------
// Port discovery: scan the fixed range, first successful handshake wins
// ---------------------------------------------------------------------------

export interface FindBridgePortOptions {
  ports?: readonly number[];
  origin: string;
  token: string;
  /** Connection role (goal 3: "control-page" for the paired control dial). */
  role?: string;
  /** Per-profile uuid — sent in the handshake (page + control-page roles). */
  profileId?: string;
  wsFactory?: WsFactory;
  handshakeTimeoutMs?: number;
  /** Cached port from the previous connection — tried first, then re-scan. */
  preferredPort?: number | null;
  signal?: AbortSignal;
}

export async function findBridgePort(
  opts: FindBridgePortOptions,
): Promise<number | null> {
  const ports = opts.ports ?? BRIDGE_PORTS;
  const preferred = opts.preferredPort;

  /**
   * Probe `targets` in two phases:
   *   1. HTTP /health pre-probe — parallel `GET http://127.0.0.1:<port>/health`
   *      with the abort signal. Dead loopback ports refuse the connection
   *      instantly, so NO per-port WS handshake timeout (up to
   *      BRIDGE_HANDSHAKE_TIMEOUT_MS) is ever spent on them. A port is
   *      health-ok when the fetch resolves and the JSON body has `ok === true`
   *      (the daemon's handleHealth — server.go).
   *   2. Parallel WS handshake race over the health-ok ports ONLY: fire one
   *      connect() per port, settle on the first successful handshake (caller
   *      order breaks same-tick ties), close every probe client (winner
   *      included — callers dial their own live socket). A health-ok port
   *      whose handshake fails (bad origin/token — /health guarantees nothing
   *      about acceptance) falls through to the remaining health-ok ports
   *      because they are all in flight simultaneously.
   *
   * No health-ok port → resolve null fast (straight into backoff). Abort →
   * close everything, resolve null.
   */
  const race = async (targets: readonly number[]): Promise<number | null> => {
    if (targets.length === 0 || opts.signal?.aborted) return null;

    // Phase 1 — /health pre-probe (parallel; dead ports fail in ms, not 3s).
    const healthResults = await Promise.all(
      targets.map(async (port) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: opts.signal,
          });
          if (!res.ok) return false;
          const body = (await res.json()) as { ok?: unknown };
          return body?.ok === true;
        } catch {
          return false; // connection refused, non-JSON body, or aborted fetch
        }
      }),
    );
    if (opts.signal?.aborted) return null;
    const healthy = targets.filter((_, i) => healthResults[i]);
    if (healthy.length === 0) return null; // no daemon anywhere — fast-fail
    targets = healthy;

    // Phase 2 — the 006 parallel handshake race, now only over health-ok ports.
    const probes: Array<{ port: number; result: Promise<boolean> }> = [];
    const clients: AgentBridgeClient[] = [];
    for (const port of targets) {
      const client = new AgentBridgeClient({
        url: `ws://127.0.0.1:${port}`,
        origin: opts.origin,
        token: opts.token,
        role: opts.role,
        profileId: opts.profileId,
        wsFactory: opts.wsFactory,
        handshakeTimeoutMs: opts.handshakeTimeoutMs,
      });
      clients.push(client);
      probes.push({ port, result: client.connect() });
    }

    let settle: (port: number | null) => void = () => {};
    const settled = new Promise<number | null>((resolve) => {
      settle = resolve;
    });

    const onAbort = () => {
      for (const c of clients) c.close();
      settle(null);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Ports that answered handshake_ok so far (any order).
    const resolved: number[] = [];
    // Deferred decision: queued a microtask after a success so that sibling
    // successes in the same tick are accounted for — the first port in caller
    // order wins ties.
    const decide = () => {
      for (const port of targets) {
        if (resolved.includes(port)) {
          settle(port);
          return;
        }
      }
    };

    let pending = probes.length;
    for (const { port, result } of probes) {
      void result.then((ok) => {
        pending -= 1;
        if (ok) {
          resolved.push(port);
          void Promise.resolve().then(decide);
        } else if (pending === 0) {
          settle(null);
        }
      });
    }

    const winner = await settled;
    opts.signal?.removeEventListener("abort", onAbort);
    for (const c of clients) c.close();
    return winner;
  };

  // Cached path: probe the preferred port alone; fall through on failure.
  if (preferred != null && ports.includes(preferred)) {
    const hit = await race([preferred]);
    if (hit !== null) return hit;
  }

  const rest =
    preferred != null ? ports.filter((p) => p !== preferred) : [...ports];
  return race(rest);
}

// ---------------------------------------------------------------------------
// Session: reconnect/retry loop with capped backoff (daemon-not-yet-up window)
// ---------------------------------------------------------------------------

export type BridgeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped";

export interface AgentBridgeSessionOptions {
  ports?: readonly number[];
  origin: string;
  token: string;
  /** Connection role (goal 3: "control-page" for the paired control dial). */
  role?: string;
  /** Per-profile uuid — sent in the handshake (page + control-page roles). */
  profileId?: string;
  wsFactory?: WsFactory;
  handshakeTimeoutMs?: number;
  pingTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  keepaliveMs?: number;
  onStatus?: (
    status: BridgeConnectionStatus,
    info?: { port?: number; attempt?: number },
  ) => void;
  onInbound?: (msg: Record<string, unknown>) => void;
}

export class AgentBridgeSession {
  private client: AgentBridgeClient | null = null;
  private stopped = false;
  private abort = new AbortController();
  private preferredPort: number | null = null;
  private status: BridgeConnectionStatus = "idle";

  constructor(private opts: AgentBridgeSessionOptions) {}

  get currentStatus(): BridgeConnectionStatus {
    return this.status;
  }

  start(): void {
    this.stopped = false;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    this.client?.close();
    this.client = null;
    this.setStatus("stopped");
  }

  ping(): Promise<boolean> {
	return this.client?.ping() ?? Promise.resolve(false);
  }

  /** Send a JSON message over the live connection (canvas/v1 responses). */
  sendJSON(obj: unknown): void {
	this.client?.sendJSON(obj);
  }

  /**
   * Page-initiated JSON-RPC round-trip (045 — `bridge.stop`): delegates to
   * the live client; resolves {ok:false, reason:"not-connected"} when no
   * socket is up (the page hook replies to the SW accordingly).
   */
  request(method: string, params?: unknown): Promise<BridgeRequestResult> {
    return (
      this.client?.request(method, params) ??
      Promise.resolve({ ok: false, reason: "not-connected" })
    );
  }

  private setStatus(
    s: BridgeConnectionStatus,
    info?: { port?: number; attempt?: number },
  ) {
    this.status = s;
    this.opts.onStatus?.(s, info);
  }

  private backoff(attempt: number): number {
    const base = this.opts.reconnectBaseMs ?? BRIDGE_RECONNECT_BASE_MS;
    const max = this.opts.reconnectMaxMs ?? BRIDGE_RECONNECT_MAX_MS;
    return Math.min(base * 2 ** attempt, max);
  }

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped && !this.abort.signal.aborted) {
      this.setStatus(attempt === 0 ? "connecting" : "reconnecting", {
        attempt,
      });

      // Drain the previous socket for this profile before ANY new dial: the
      // daemon unregisters a profile's control connection only after its read
      // loop processes the close frame, so a re-dial that wins that race would
      // be treated as a same-profile takeover ("displacing prior control page")
      // — self-inflicted displacement. Bounded, so a dead socket can never
      // wedge the reconnect loop.
      await awaitProfileDrain(this.opts.profileId);
      const port = await findBridgePort({
        ports: this.opts.ports,
        origin: this.opts.origin,
        token: this.opts.token,
        role: this.opts.role,
        profileId: this.opts.profileId,
        wsFactory: this.opts.wsFactory,
        handshakeTimeoutMs: this.opts.handshakeTimeoutMs,
        preferredPort: this.preferredPort,
        signal: this.abort.signal,
      });
      if (this.stopped || this.abort.signal.aborted) return;

      if (port === null) {
        // No daemon up yet (lazy-daemon window) — wait and re-scan. The very
        // first scan (attempt 0) is the cold-start window: sleep a short fixed
        // beat so a freshly started daemon is re-detected + auto-activated
        // within ~5s; later rounds keep the capped exponential backoff.
        const first = attempt === 0;
        attempt += 1;
        await sleep(first ? BRIDGE_RECONNECT_FIRST_MS : this.backoff(attempt));
        continue;
      }

      this.preferredPort = port;
      // The scan probe just registered + closed a socket for this profile
      // inside findBridgePort — drain it before the live dial (same race).
      await awaitProfileDrain(this.opts.profileId);
      const client = new AgentBridgeClient({
        url: `ws://127.0.0.1:${port}`,
        origin: this.opts.origin,
        token: this.opts.token,
        role: this.opts.role,
        profileId: this.opts.profileId,
        wsFactory: this.opts.wsFactory,
        handshakeTimeoutMs: this.opts.handshakeTimeoutMs,
        pingTimeoutMs: this.opts.pingTimeoutMs,
      });
      this.client = client;
      client.onInbound = (msg) => this.opts.onInbound?.(msg);
      const ok = await client.connect();
      if (!ok) {
        // Never registered (no handshake_ok) — but close the socket anyway so
        // the drain gate covers it and the daemon does not hold a zombie conn.
        client.close();
        this.client = null;
        const first = attempt === 0;
        attempt += 1;
        await sleep(first ? BRIDGE_RECONNECT_FIRST_MS : this.backoff(attempt));
        continue;
      }

      this.setStatus("connected", { port });
      // Proactive liveness: periodic app-level ping while connected. A JSON-RPC
      // pong proves the daemon's message loop answers (the browser auto-pongs
      // protocol-level pings without JS running, so those prove nothing about
      // a responsive page). A failed ping means the connection is half-dead →
      // close it so the reconnect loop re-dials (possibly a restarted daemon
      // on a new port).
      const keepaliveMs = this.opts.keepaliveMs ?? BRIDGE_KEEPALIVE_MS;
      const keepalive = setInterval(() => {
        // Never stack pings: a pending ping already covers this interval (a
        // fresh ping would refresh the pong timeout and the failure detection
        // could silently never fire when keepaliveMs < pingTimeoutMs).
        if (client.hasPendingPing()) return;
        void client.ping().then((ok) => {
          if (!ok && this.client === client) {
            client.close();
          }
        });
      }, keepaliveMs);
      await new Promise<void>((resolveClose) => {
        client.onClose = () => {
          clearInterval(keepalive);
          resolveClose();
        };
      });
      this.client = null;
      if (this.stopped) return;
      this.setStatus("reconnecting", { port, attempt: 0 });
      attempt = 0;
      await sleep(this.opts.reconnectBaseMs ?? BRIDGE_RECONNECT_BASE_MS);
    }
  }
}
