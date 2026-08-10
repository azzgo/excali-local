import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AgentBridgeClient,
  AgentBridgeSession,
  findBridgePort,
  type BridgeWs,
} from "@/features/editor/lib/agent-bridge-client";

/**
 * Scriptable fake WebSocket so tests never touch the network.
 * Mirrors the Browser WebSocket event/readyState contract.
 * IMPORTANT: tests must drive events (open/message/close) AFTER the client has
 * attached its listeners — i.e. after `vi.waitFor(() => sockets.length > 0)`.
 */
class FakeWs implements BridgeWs {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  private listeners: Record<string, Array<(event?: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners[type].push(listener);
  }
  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  // --- test helpers ---
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  message(data: string) {
    this.emit("message", { data });
  }
  error() {
    this.emit("error");
  }
  lastSentJson(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
  protected emit(type: string, event?: unknown) {
    for (const l of [...this.listeners[type]]) l(event);
  }
}

/**
 * FakeWs whose close() does NOT fire the close event until the test drives it
 * (readyState sits at CLOSING) — lets a test hold a socket in the exact
 * "close frame in flight" state the drain gate must wait out.
 */
class FakeWsDeferredClose extends FakeWs {
  override close(): void {
    this.readyState = 2; // CLOSING — close event deferred
  }
  fireClose(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

const origin = "chrome-extension://test-extension-id";
const token = "a".repeat(64); // 256-bit hex
const profileIdA = "11111111-2222-4333-8444-555555555555";
const profileIdB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FAST = { handshakeTimeoutMs: 50, pingTimeoutMs: 50 };

const socketsOf = (sockets: FakeWs[]) => (url: string): BridgeWs => {
  const ws = new FakeWs();
  sockets.push(ws);
  return ws;
};

/**
 * Stub global fetch as the daemon /health endpoint. `healthy` maps port → up
 * (a Set of up ports, or a predicate). Down ports REJECT like ECONNREFUSED —
 * exactly how a dead loopback port behaves for the real fetch. Returns the
 * mock so tests can assert call counts/URLs.
 */
const stubHealth = (
  healthy: ReadonlySet<number> | ((port: number) => boolean),
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : String(input);
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(url)?.[1]);
    const up = typeof healthy === "function" ? healthy(port) : healthy.has(port);
    if (!up) throw new Error(`connect ECONNREFUSED 127.0.0.1:${port}`);
    return { ok: true, json: async () => ({ ok: true, port }) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

describe("AgentBridgeClient", () => {
  test("connect: handshake with token+origin, resolves true on handshake_ok", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
    });
    const promise = client.connect();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    expect(sockets[0].lastSentJson()).toEqual({ type: "handshake", token, origin });
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(true);
  });

  test("connect: resolves false on handshake_error (bad origin/token)", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
    });
    const promise = client.connect();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_error", reason: "origin" }));
    await expect(promise).resolves.toBe(false);
  });

  test("connect: resolves false on handshake timeout (server never replies)", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    const promise = client.connect();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    await expect(promise).resolves.toBe(false);
  });

  test("connect: resolves false immediately when already closed", async () => {
    const client = new AgentBridgeClient({ url: "ws://127.0.0.1:17331", origin, token });
    client.close();
    await expect(client.connect()).resolves.toBe(false);
  });

  test("close() while connecting resolves connect(false) and drops the socket", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
    });
    const promise = client.connect();
    client.close();
    await expect(promise).resolves.toBe(false);
  });

  test("ping: resolves true on pong round-trip", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
    });
    const connected = client.connect();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await connected;

    const pingPromise = client.ping();
    expect(sockets[0].lastSentJson()).toEqual({ type: "ping" });
    sockets[0].message(JSON.stringify({ type: "pong" }));
    await expect(pingPromise).resolves.toBe(true);
  });

  test("ping: resolves false on timeout", async () => {
    const sockets: FakeWs[] = [];
    const client = new AgentBridgeClient({
      url: "ws://127.0.0.1:17331",
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    const connected = client.connect();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await connected;

    const pingPromise = client.ping();
    await expect(pingPromise).resolves.toBe(false);
  });

  test("ping: resolves false when not connected", async () => {
    const client = new AgentBridgeClient({ url: "ws://127.0.0.1:17331", origin, token });
    await expect(client.ping()).resolves.toBe(false);
  });
});

describe("findBridgePort", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("races all health-ok ports in parallel and returns the first port with a successful handshake", async () => {
    const sockets: FakeWs[] = [];
    stubHealth(new Set([17331, 17332, 17333]));
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    // All probes are created in one tick after the /health sweep — no per-port waiting.
    await vi.waitFor(() => expect(sockets.length).toBe(3));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_error" }));
    sockets[2].open();
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    // sockets[1] (17332) stalls and never answers — 17333 wins anyway.
    await expect(promise).resolves.toBe(17333);
    // Every probe ends closed: winner probe by findBridgePort itself, the
    // losers (including the never-opened one) by the cleanup sweep.
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
  });

  test("several ports answer in the same tick — the first in caller order wins", async () => {
    const sockets: FakeWs[] = [];
    stubHealth(new Set([17331, 17332, 17333]));
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(3));
    for (const s of sockets) s.open();
    // Drive handshake_ok in REVERSE order within the same tick — the race
    // must still settle on 17331 (caller port order breaks ties).
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17331);
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
  });

  test("preferred port short-circuits: health-ok preferred → handshake only there", async () => {
    const sockets: FakeWs[] = [];
    const fetchMock = stubHealth(new Set([17332]));
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      preferredPort: 17332,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    sockets[0].open();
    expect(sockets[0].lastSentJson()).toEqual({ type: "handshake", token, origin });
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17332);
    expect(sockets.length).toBe(1); // the parallel scan never started
    expect(fetchMock).toHaveBeenCalledTimes(1); // /health probed ONLY for 17332
    expect(String(fetchMock.mock.calls[0][0])).toContain("17332");
  });

  test("preferred port fails /health → falls through to the parallel race over the rest", async () => {
    const sockets: FakeWs[] = [];
    const fetchMock = stubHealth(new Set([17331, 17333])); // 17332 down
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      preferredPort: 17332,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    // preferred (17332) refused /health instantly → no socket for it; the rest race
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[0].open(); // 17331
    sockets[0].message(JSON.stringify({ type: "handshake_error" }));
    sockets[1].open(); // 17333
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17333);
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3); // preferred probe + the two rest ports
  });

  test("health pre-probe: only health-ok ports get a WS handshake; winner returned, losers closed", async () => {
    const created: Array<{ url: string; ws: FakeWs }> = [];
    const wsFactory = (url: string): BridgeWs => {
      const ws = new FakeWs();
      created.push({ url, ws });
      return ws;
    };
    const fetchMock = stubHealth(new Set([17333])); // only 17333 answers /health
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory,
      ...FAST,
    });
    await vi.waitFor(() => expect(created.length).toBe(1));
    // dead ports were health-probed (rejected instantly) but never touched the WS layer
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(created[0].url).toBe("ws://127.0.0.1:17333");
    created[0].ws.open();
    created[0].ws.message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17333);
    expect(created[0].ws.readyState).toBe(3); // winner probe closed by findBridgePort
  });

  test("all ports unhealthy (health fetch rejects) → null fast, no WS handshake ever", async () => {
    const sockets: FakeWs[] = [];
    stubHealth(new Set()); // every port refuses the connection
    const t0 = Date.now();
    const port = await findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    expect(port).toBeNull();
    expect(sockets.length).toBe(0); // no handshake timeout ever spent
    expect(Date.now() - t0).toBeLessThan(1000); // fast-fail, not 3s × ports
  });

  test("a /health response with ok:false is treated as unhealthy (no WS dial)", async () => {
    const sockets: FakeWs[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const port = Number(/127\.0\.0\.1:(\d+)/.exec(url)?.[1]);
      if (port === 17331) return { ok: true, json: async () => ({ ok: false, reason: "stopping" }) };
      if (port === 17332) return { ok: true, json: async () => ({ ok: true }) };
      throw new Error("connect ECONNREFUSED");
    }));
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(1)); // only 17332 dials
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17332);
    expect(sockets[0].readyState).toBe(3);
  });

  test("a health-ok port whose handshake fails falls through to the next health-ok port", async () => {
    const sockets: FakeWs[] = [];
    stubHealth(new Set([17331, 17332]));
    const promise = findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_error" })); // 17331 rejects (origin/token)
    sockets[1].open();
    sockets[1].message(JSON.stringify({ type: "handshake_ok" })); // 17332 wins
    await expect(promise).resolves.toBe(17332);
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
  });

  test("aborting mid-race closes every probe and resolves null", async () => {
    const abort = new AbortController();
    const sockets: FakeWs[] = [];
    stubHealth(new Set([17331, 17332, 17333]));
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      signal: abort.signal,
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(3));
    abort.abort();
    await expect(promise).resolves.toBeNull();
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
  });

  test("aborting during the health pre-probe resolves null, no WS sockets created", async () => {
    const abort = new AbortController();
    const sockets: FakeWs[] = [];
    // health fetch that never settles on its own — only the abort signal releases it
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    ));
    const promise = findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      signal: abort.signal,
      ...FAST,
    });
    await new Promise((r) => setTimeout(r, 20)); // let the health fetches start
    abort.abort();
    await expect(promise).resolves.toBeNull();
    expect(sockets.length).toBe(0); // the WS phase never started
  });

  test("a pre-aborted signal returns null without creating any sockets", async () => {
    const abort = new AbortController();
    abort.abort();
    const sockets: FakeWs[] = [];
    const fetchMock = stubHealth(new Set([17331, 17332]));
    const port = await findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      signal: abort.signal,
      ...FAST,
    });
    expect(port).toBeNull();
    expect(sockets.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns null when no health-ok port completes a handshake (all probes time out)", async () => {
    const sockets: FakeWs[] = [];
    stubHealth(new Set([17331, 17332]));
    const promise = findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[0].open();
    sockets[1].open();
    // Neither daemon replies → both handshake timers (FAST) fire → null.
    await expect(promise).resolves.toBeNull();
    expect(sockets.every((s) => s.readyState === 3)).toBe(true);
  });
});

describe("AgentBridgeSession", () => {
  // The session uses the REAL findBridgePort → /health pre-probe. Keep the
  // daemon "up" for every existing test (they drive the WS layer with FakeWs);
  // the cold-start test below overrides with a fetch that turns healthy later.
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const port = Number(/127\.0\.0\.1:(\d+)/.exec(url)?.[1]);
      return { ok: true, json: async () => ({ ok: true, port }) };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Drive scan probe + live connection sockets to reach "connected". */
  const driveConnect = async (sockets: FakeWs[]) => {
    // sockets[i]   = scan probe (findBridgePort closes it after ok)
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    // sockets[i+1] = the session's own live connection
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    sockets[1].open();
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
  };

  test("connects, then reconnects after the socket drops, until stopped", async () => {
    const sockets: FakeWs[] = [];
    const statuses: string[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 10,
      reconnectMaxMs: 10,
      ...FAST,
      onStatus: (s) => statuses.push(s),
    });
    session.start();
    await driveConnect(sockets);
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));

    // daemon restarts: drop the LIVE connection → session reconnects
    sockets[1].close();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    sockets[2].open();
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(4));
    sockets[3].open();
    sockets[3].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));

    session.stop();
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");
    expect(statuses).toContain("reconnecting");
    expect(session.currentStatus).toBe("stopped");
  });

  test("retries while the daemon is not yet up, then connects once it appears", async () => {
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 5,
      reconnectMaxMs: 5,
      ...FAST,
    });
    session.start();

    // attempt 1: probe opens but daemon never replies → handshake timeout → retry
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2));
    // attempt 2: daemon is up now
    sockets[1].open();
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    sockets[2].open();
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));
    session.stop();
  });

  test("stop() prevents further connection attempts", async () => {
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 5,
      reconnectMaxMs: 5,
      ...FAST,
    });
    session.start();
    session.stop();
    const countAfter = sockets.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(sockets.length).toBe(countAfter);
    expect(session.currentStatus).toBe("stopped");
  });

  test("ping() routes through the live client", async () => {
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    session.start();
    await driveConnect(sockets);
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));

    const pingPromise = session.ping();
    sockets[1].message(JSON.stringify({ type: "pong" }));
    await expect(pingPromise).resolves.toBe(true);
    session.stop();
  });

  test("keepalive: periodic app-level ping while connected; pong keeps it alive", async () => {
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 10,
      reconnectMaxMs: 10,
      keepaliveMs: 30,
      pingTimeoutMs: 500,
      handshakeTimeoutMs: 50,
    });
    session.start();
    await driveConnect(sockets);
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));
    const live = sockets[1];

    // app-level {type:"ping"} fires periodically (not a protocol frame)
    await vi.waitFor(() =>
      expect(live.sent.some((s) => s.includes('"type":"ping"'))).toBe(true),
    );
    // answer pings for a few cycles — the connection must survive
    for (let i = 0; i < 4; i++) {
      live.message(JSON.stringify({ type: "pong" }));
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(sockets.length).toBe(2); // no reconnect sockets
    expect(session.currentStatus).toBe("connected");
    session.stop();
  });

  test("keepalive: an unanswered ping closes the half-dead connection and reconnects", async () => {
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 10,
      reconnectMaxMs: 10,
      keepaliveMs: 25,
      pingTimeoutMs: 500,
      handshakeTimeoutMs: 500,
    });
    session.start();
    await driveConnect(sockets);
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));

    // never answer the first connection's pings → keepalive detects the dead
    // peer and closes the socket → the reconnect loop re-dials (probe + live)
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    sockets[2].open();
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(4));
    sockets[3].open();
    sockets[3].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));

    // answer keepalive pings on the NEW live connection so it stays up
    const live2 = sockets[3];
    await vi.waitFor(() =>
      expect(live2.sent.some((s) => s.includes('"type":"ping"'))).toBe(true),
    );
    live2.message(JSON.stringify({ type: "pong" }));
    for (let i = 0; i < 3; i++) {
      live2.message(JSON.stringify({ type: "pong" }));
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(session.currentStatus).toBe("connected");

    session.stop();
  });

  /** Drive probe + live sockets for the deferred-close factory (each socket's
   * close event must be fired manually to release the drain gate). */
  const deferredConnect = async (sockets: FakeWs[], from: number) => {
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(from));
    sockets[from].open();
    sockets[from].message(JSON.stringify({ type: "handshake_ok" }));
    (sockets[from] as FakeWsDeferredClose).fireClose(); // probe close → drain → live dial
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(from + 1));
    sockets[from + 1].open();
    sockets[from + 1].message(JSON.stringify({ type: "handshake_ok" }));
  };

  test("drain gate: a same-profile re-dial waits for the previous socket's close event (stop→start)", async () => {
    const sockets: FakeWs[] = [];
    const wsFactory = (url: string): BridgeWs => {
      const ws = new FakeWsDeferredClose();
      sockets.push(ws);
      return ws;
    };
    const opts = {
      ports: [17331],
      origin,
      token,
      profileId: profileIdA,
      wsFactory,
      reconnectBaseMs: 5,
      reconnectMaxMs: 5,
      ...FAST,
    };

    // Session 1 connects (probe s0 + live s1).
    const s1 = new AgentBridgeSession(opts);
    s1.start();
    await deferredConnect(sockets, 0);
    await vi.waitFor(() => expect(s1.currentStatus).toBe("connected"));

    // Drop s1's live socket: it enters CLOSING but its close event has NOT
    // fired yet (close frame in flight). stop() registers the drain gate for
    // the profile.
    sockets[1].close();
    s1.stop();

    // Session 2 (SAME profile) starts immediately — its first dial must wait
    // for the previous socket's close event. No new socket may appear.
    const s2 = new AgentBridgeSession(opts);
    s2.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(sockets.length).toBe(2); // gate holds: no probe before CLOSED

    // Old socket reaches CLOSED → gate releases → session 2 dials (probe + live).
    (sockets[1] as FakeWsDeferredClose).fireClose();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    sockets[2].open();
    sockets[2].message(JSON.stringify({ type: "handshake_ok" }));
    (sockets[2] as FakeWsDeferredClose).fireClose(); // probe close → drain → live
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(4));
    sockets[3].open();
    sockets[3].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(s2.currentStatus).toBe("connected"));

    s1.stop();
    s2.stop();
  });

  test("drain gate: a DIFFERENT profile's dial is not gated (genuine displacement unaffected)", async () => {
    const sockets: FakeWs[] = [];
    const wsFactory = (url: string): BridgeWs => {
      const ws = new FakeWsDeferredClose();
      sockets.push(ws);
      return ws;
    };
    const base = {
      ports: [17331],
      origin,
      token,
      wsFactory,
      reconnectBaseMs: 5,
      reconnectMaxMs: 5,
      ...FAST,
    };

    const s1 = new AgentBridgeSession({ ...base, profileId: profileIdA });
    s1.start();
    await deferredConnect(sockets, 0);
    await vi.waitFor(() => expect(s1.currentStatus).toBe("connected"));

    // s1's live socket enters CLOSING (close event deferred).
    sockets[1].close();

    // A second session for a DIFFERENT profile dials immediately — no gate
    // for profileIdB, so genuine same/different-profile displacement still works.
    const s2 = new AgentBridgeSession({ ...base, profileId: profileIdB });
    s2.start();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    expect(s2.currentStatus).toBe("connecting");

    s1.stop();
    s2.stop();
  });

  test("cold-start: a down daemon is re-probed after the short first backoff (~200ms), not the exponential one", async () => {
    let healthy = false;
    const fetchMock = vi.fn(async () => {
      if (!healthy) throw new Error("connect ECONNREFUSED");
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const sockets: FakeWs[] = [];
    const session = new AgentBridgeSession({
      ports: [17331],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      reconnectBaseMs: 5, // contrast: the pre-007 backoff(1) would sleep only 10ms
      reconnectMaxMs: 5,
      ...FAST,
    });
    session.start();
    const t0 = Date.now();
    // Round 1's /health fails → no WS socket. Flip the daemon up before the
    // 200ms first backoff elapses so round 2 (~t+200ms) connects immediately.
    setTimeout(() => {
      healthy = true;
    }, 100);
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0), { timeout: 2000 });
    const firstProbeAt = Date.now() - t0;
    expect(firstProbeAt).toBeGreaterThanOrEqual(150); // the ~200ms first backoff actually slept
    expect(firstProbeAt).toBeLessThan(1000); // ...and nowhere near backoff(1) with the default 1000ms base

    // Daemon is up: drive the probe + live sockets to "connected".
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    sockets[1].open();
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    await vi.waitFor(() => expect(session.currentStatus).toBe("connected"));
    session.stop();
  });
});
