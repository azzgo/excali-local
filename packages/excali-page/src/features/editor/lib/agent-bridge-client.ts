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
  WS_HANDSHAKE,
  WS_HANDSHAKE_OK,
  WS_HANDSHAKE_ERROR,
  WS_PING,
  WS_PONG,
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

// WebSocket readyState values (numeric — avoids depending on the global's constant)
const WS_OPEN = 1;

// ---------------------------------------------------------------------------
// Single connection + token handshake
// ---------------------------------------------------------------------------

export interface AgentBridgeClientOptions {
  url: string;
  /** Origin presented in the handshake — `chrome-extension://<id>` for the page. */
  origin: string;
  /** ≥128-bit per-activation-session handshake token. */
  token: string;
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
        } else {
          this.onInbound?.(msg);
        }
      };
      const onClose = () => {
        this.closed = true;
        finish(false);
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
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Port discovery: scan the fixed range, first successful handshake wins
// ---------------------------------------------------------------------------

export interface FindBridgePortOptions {
  ports?: readonly number[];
  origin: string;
  token: string;
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
  const order =
    opts.preferredPort != null
      ? [opts.preferredPort, ...ports.filter((p) => p !== opts.preferredPort)]
      : [...ports];
  for (const port of order) {
    if (opts.signal?.aborted) return null;
    const client = new AgentBridgeClient({
      url: `ws://127.0.0.1:${port}`,
      origin: opts.origin,
      token: opts.token,
      wsFactory: opts.wsFactory,
      handshakeTimeoutMs: opts.handshakeTimeoutMs,
    });
    const ok = await client.connect();
    if (opts.signal?.aborted) {
      client.close();
      return null;
    }
    if (ok) {
      client.close();
      return port;
    }
  }
  return null;
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
  wsFactory?: WsFactory;
  handshakeTimeoutMs?: number;
  pingTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
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

      const port = await findBridgePort({
        ports: this.opts.ports,
        origin: this.opts.origin,
        token: this.opts.token,
        wsFactory: this.opts.wsFactory,
        handshakeTimeoutMs: this.opts.handshakeTimeoutMs,
        preferredPort: this.preferredPort,
        signal: this.abort.signal,
      });
      if (this.stopped || this.abort.signal.aborted) return;

      if (port === null) {
        // No daemon up yet (lazy-daemon window) — wait and re-scan.
        attempt += 1;
        await sleep(this.backoff(attempt));
        continue;
      }

      this.preferredPort = port;
      const client = new AgentBridgeClient({
        url: `ws://127.0.0.1:${port}`,
        origin: this.opts.origin,
        token: this.opts.token,
        wsFactory: this.opts.wsFactory,
        handshakeTimeoutMs: this.opts.handshakeTimeoutMs,
        pingTimeoutMs: this.opts.pingTimeoutMs,
      });
      this.client = client;
      client.onInbound = (msg) => this.opts.onInbound?.(msg);
      const ok = await client.connect();
      if (!ok) {
        this.client = null;
        attempt += 1;
        await sleep(this.backoff(attempt));
        continue;
      }

      this.setStatus("connected", { port });
      await new Promise<void>((resolveClose) => {
        client.onClose = () => resolveClose();
      });
      this.client = null;
      if (this.stopped) return;
      this.setStatus("reconnecting", { port, attempt: 0 });
      attempt = 0;
      await sleep(this.opts.reconnectBaseMs ?? BRIDGE_RECONNECT_BASE_MS);
    }
  }
}
