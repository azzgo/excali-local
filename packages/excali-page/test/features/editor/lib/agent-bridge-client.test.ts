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
  test("races all ports in parallel and returns the first port with a successful handshake", async () => {
    const sockets: FakeWs[] = [];
    const promise = findBridgePort({
      ports: [17331, 17332, 17333],
      origin,
      token,
      wsFactory: socketsOf(sockets),
      ...FAST,
    });
    // All probes are created in the same tick — no per-port waiting.
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

  test("preferred port short-circuits: answers ok → returned, no other sockets created", async () => {
    const sockets: FakeWs[] = [];
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
  });

  test("preferred port fails → falls through to the full parallel race", async () => {
    const sockets: FakeWs[] = [];
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
    sockets[0].message(JSON.stringify({ type: "handshake_error" }));
    // preferred failed → the remaining ports race in parallel
    await vi.waitFor(() => expect(sockets.length).toBe(3));
    sockets[1].open(); // 17331
    sockets[1].message(JSON.stringify({ type: "handshake_ok" }));
    await expect(promise).resolves.toBe(17331);
    expect(sockets[2].readyState).toBe(3); // 17333 loser closed mid-handshake
  });

  test("aborting mid-race closes every probe and resolves null", async () => {
    const abort = new AbortController();
    const sockets: FakeWs[] = [];
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

  test("a pre-aborted signal returns null without creating any sockets", async () => {
    const abort = new AbortController();
    abort.abort();
    const sockets: FakeWs[] = [];
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
  });

  test("returns null when no port answers (all probes time out)", async () => {
    const sockets: FakeWs[] = [];
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
});
