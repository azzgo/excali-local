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
  private emit(type: string, event?: unknown) {
    for (const l of [...this.listeners[type]]) l(event);
  }
}

const origin = "chrome-extension://test-extension-id";
const token = "a".repeat(64); // 256-bit hex
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
});
