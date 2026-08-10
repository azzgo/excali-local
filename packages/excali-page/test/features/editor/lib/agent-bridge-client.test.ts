import { describe, expect, test, vi } from "vitest";
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
  test("scans the range in order and returns the first port with a successful handshake", async () => {
    const sockets: FakeWs[] = [];
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: "handshake_error" }));
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    sockets[1].open();
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17332);
  });

  test("preferred (cached) port is tried first", async () => {
    const order: string[] = [];
    const abort = new AbortController();
    const promise = findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      preferredPort: 17332,
      wsFactory: (url) => {
        const ws = new FakeWs();
        order.push(url);
        return ws;
      },
      signal: abort.signal,
      ...FAST,
    });
    await vi.waitFor(() => expect(order.length).toBeGreaterThan(0));
    expect(order[0]).toContain(":17332");
    abort.abort();
    await expect(promise).resolves.toBeNull();
  });

  test("returns null when no port answers", async () => {
    const sockets: FakeWs[] = [];
    const promise = findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    // sockets[0] opens but server never replies → handshake timeout per port
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    sockets[0].open();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    sockets[1].open();
    await expect(promise).resolves.toBeNull();
  });

  test("aborts the scan and returns null", async () => {
    const abort = new AbortController();
    abort.abort();
    const port = await findBridgePort({
      ports: [17331, 17332],
      origin,
      token,
      wsFactory: () => new FakeWs(),
      signal: abort.signal,
    });
    expect(port).toBeNull();
  });
});

describe("AgentBridgeSession", () => {
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
});
