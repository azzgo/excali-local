/**
 * AGENT BRIDGE — driver: exercises the REAL page-side WS client
 * (`packages/page/src/features/editor/lib/agent-bridge-client.ts`)
 * against the Go bridge daemon (`packages/bridge`), exactly as
 * activated Local editor pages do: scan the fixed port range → token
 * handshake → connected → ping round-trip.
 *
 * Phase 1 — Leg-B ping round-trip through the Go daemon.
 * Phase 2 — two-page displacement proof (Tickets 016/017): two
 *   AgentBridgeSession instances stand in for two browser profiles. Page B
 *   activating displaces page A: A receives the `displaced` control message
 *   and stops its session (the page hook does the same), and the daemon never
 *   holds more than one active page (/health).
 *
 * The daemon is bootstrapped lazily via the agent CLI (`excali-bridge ping`),
 * which also proves the Leg-A JSON-RPC path. Exit 0 = all phases pass.
 *
 * Run:
 *   pnpm bridge:build                          (once: builds the Go daemon)
 *   tsx scripts/agent-bridge/driver.ts         (spawns the daemon lazily)
 *
 * NOTE: the driver's page sessions claim the active slot — running it while a
 * real canvas is active will displace that canvas (the intended daemon
 * behavior). Run it when no real activation is live.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { mintBridgeToken } from "excali-shared";
import { run, hereDir } from "../_run";
import {
  AgentBridgeSession,
  type BridgeConnectionStatus,
  type BridgeWs,
} from "../../packages/page/src/features/editor/lib/agent-bridge-client";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
const profileA = "11111111-2222-4333-8444-555555555555";
const profileB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const profileStorm = "dddddddd-eeee-4fff-8000-111111111111";
const profileStop = "99999999-8888-4777-8000-222222222222";
const bin =
  process.env.EXCALI_BRIDGE_BIN ??
  join(hereDir(import.meta.url), "../../packages/bridge/bin/excali-bridge");

const TIMEOUT_MS = 15000;

const wsFactory = (url: string): BridgeWs =>
  new WebSocket(url, {
    headers: { Origin: origin }, // browsers send the Origin header for free
  }) as unknown as BridgeWs;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};

const waitFor = async (fn: () => boolean, ms: number, label: string) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
};

const health = async (port: number) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (!res.ok) return null;
    return (await res.json()) as {
      ok: boolean;
      active: boolean;
      pageConnections: number;
      agentConnections: number;
    };
  } catch {
    return null;
  }
};

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[driver] FAIL — ${msg}`);
};

// --- bootstrap: ensure the Go daemon is up via the agent CLI (lazy spawn) ---
console.log(`[driver] binary: ${bin}`);
if (!run(["test", "-x", bin]).ok) {
  console.error(`[driver] bridge binary not found at ${bin} — run \`pnpm bridge:build\` first`);
  process.exit(1);
}
const boot = run([bin, "ping"], { env: { ...process.env, EXCALI_BRIDGE_BIN: bin } });
if (boot.code !== 0) {
  console.error(`[driver] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
console.log(`[driver] daemon up (CLI ping: ${boot.stdout.trim()})`);

// --- Phase 1: ping round-trip through the page's own client code -----------
const token1 = mintBridgeToken(); // ≥128-bit (256-bit) — never logged
let port1: number | null = null;
let session1: AgentBridgeSession | null = null;
const phase1 = new Promise<boolean>((resolve) => {
  const session = new AgentBridgeSession({
    origin,
    token: token1,
    profileId: profileA,
    wsFactory,
    onStatus: (status: BridgeConnectionStatus, info) => {
      console.log(
        `[driver] phase1 status → ${status}${info?.port ? ` (port ${info.port})` : ""}`,
      );
      if (status === "connected") {
        port1 = info?.port ?? null;
        resolve(true);
      }
    },
  });
  session1 = session;
  session.start();
});
const connected1 = await withTimeout(phase1, TIMEOUT_MS, "phase-1 connect");
if (!connected1) {
  console.error("[driver] FAIL — no bridge reachable (is the daemon up?)");
  process.exit(1);
}
const ok1 = (await session1?.ping()) ?? false;
session1?.stop();
console.log(ok1 ? "[driver] phase1 ping → pong ✔" : "[driver] phase1 ping FAILED");

// --- Phase 2: two-page displacement ----------------------------------------
const tokenA = mintBridgeToken();
const tokenB = mintBridgeToken();

let displacedA = false;
let sessionA: AgentBridgeSession | null = null;
let portA: number | null = null;

const a = new AgentBridgeSession({
  origin,
  token: tokenA,
  profileId: profileA,
  wsFactory,
  onStatus: (status, info) => {
    console.log(`[driver] page A status → ${status}`);
    if (status === "connected") portA = info?.port ?? null;
  },
  onInbound: (msg) => {
    if ((msg as { type?: string })?.type === "displaced") {
      console.log("[driver] page A received `displaced` — stopping session (hook behavior)");
      displacedA = true;
      sessionA?.stop();
    }
  },
});
sessionA = a;

const b = new AgentBridgeSession({
  origin,
  token: tokenB,
  profileId: profileB,
  wsFactory,
});

a.start();
await withTimeout(waitFor(() => portA != null, 8000, "page A connected"), TIMEOUT_MS, "page A up");
const h1 = await health(portA!);
console.log(`[driver] health after A: ${JSON.stringify(h1)}`);
if (!h1?.ok || !h1.active || h1.pageConnections !== 1) {
  fail(`after A: expected active with 1 page connection, got ${JSON.stringify(h1)}`);
}

b.start();
await withTimeout(waitFor(() => displacedA, 8000, "page A displaced"), TIMEOUT_MS, "displacement");
await sleep(300); // let B settle into the slot

const h2 = await health(portA!);
console.log(`[driver] health after B: ${JSON.stringify(h2)}`);
if (!h2?.ok || !h2.active || h2.pageConnections !== 1) {
  fail(`after B: daemon must never hold >1 active page, got ${JSON.stringify(h2)}`);
}
if (a.currentStatus !== "stopped") {
  fail(`page A session should be stopped after displacement, got ${a.currentStatus}`);
}
const okB = await b.ping();
b.stop();

// --- Phase 3: CONTROL-role reconnect storm — no self-displacement ----------
// A control-page session for ONE profile is dropped and re-dialed rapidly.
// Two shapes of the same race: the NEW handshake arriving while the daemon is
// still processing the OLD socket's close frame. registerControl (server.go:325)
// then treats the re-dial as a same-profile takeover and logs "displacing prior
// control page (same profile)" + sends a spurious `displaced` — self-inflicted.
//   3a stop → immediate re-start cycles: each new session dials with the old
//      close frame still in flight (the exact drop → re-dial window);
//   3b forced drops inside one session: run()'s drop → re-dial loop.
// The daemon log delta over both must contain ZERO displacement lines, and the
// session must settle healthy (pings round-trip).
const logPath = join(homedir(), ".excali-local", "bridge.log");
const logBefore = statSync(logPath).size;
const STORM_CYCLES = 30;

// --- 3a: stop → immediate re-start cycles (same profile) -------------------
let stopStartCycles = 0;
for (let i = 0; i < STORM_CYCLES; i++) {
  await withTimeout(
    new Promise<void>((resolve) => {
      const s = new AgentBridgeSession({
        origin,
        token: mintBridgeToken(),
        profileId: profileStorm,
        role: "control-page",
        wsFactory,
        reconnectBaseMs: 0,
        reconnectMaxMs: 0,
        handshakeTimeoutMs: 500,
        onStatus: (status) => {
          if (status === "connected") {
            stopStartCycles += 1;
            s.stop(); // close frame in flight — the next cycle dials immediately
            resolve();
          }
        },
      });
      s.start();
    }),
    TIMEOUT_MS,
    `storm-3a cycle ${i}`,
  );
}
console.log(`[driver] storm 3a: ${stopStartCycles} stop→re-dial cycles (same profile)`);

// --- 3b: forced-drop reconnects inside one session -------------------------
let stormConnects = 0;
let stormDone = false;
const stormSockets: BridgeWs[] = [];
const stormWsFactory = (url: string): BridgeWs => {
  const ws = new WebSocket(url, {
    headers: { Origin: origin },
  }) as unknown as BridgeWs;
  stormSockets.push(ws);
  return ws;
};
const storm = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId: profileStorm,
  role: "control-page",
  wsFactory: stormWsFactory,
  reconnectBaseMs: 0,
  reconnectMaxMs: 0,
  handshakeTimeoutMs: 500,
  onStatus: (status) => {
    if (status === "connected" && !stormDone) {
      stormConnects += 1;
      // Force an immediate drop: run() re-dials right away, exercising the
      // drop → re-dial race against the real daemon (the daemon answers app
      // pings, so keepalive alone can't drop a healthy connection).
      const live = [...stormSockets].reverse().find((s) => s.readyState === 1);
      live?.close();
    }
  },
});
storm.start();
await withTimeout(
  waitFor(() => stormConnects >= STORM_CYCLES, 20000, "storm 3b rapid reconnects"),
  TIMEOUT_MS + 10000,
  "storm-3b",
);
stormDone = true;
await withTimeout(
  waitFor(() => storm.currentStatus === "connected", 8000, "storm 3b settles connected"),
  TIMEOUT_MS,
  "storm-3b settle",
);
const stormPings: boolean[] = [];
for (let i = 0; i < 3; i++) stormPings.push((await storm.ping()) ?? false);
storm.stop();

const logDelta = readFileSync(logPath, "utf8").slice(logBefore);
const selfDisplacements = (logDelta.match(/displacing prior control page/g) ?? []).length;
console.log(
  `[driver] storm: ${stopStartCycles} stop→re-dial + ${stormConnects} forced-drop reconnects, ${selfDisplacements} self-displacement line(s) in daemon log delta`,
);
if (selfDisplacements > 0) {
  fail(`storm: daemon logged ${selfDisplacements} self-inflicted control displacement(s)`);
}
if (stormPings.some((p) => !p)) {
	fail("storm: pings did not round-trip after the storm settled");
} else {
	console.log("[driver] storm: pings round-trip after the storm settled ✔");
}
// --- verdict ---

// --- Phase 4: extension-initiated daemon stop (045) ------------------------
// The active page calls the daemon-local `bridge.stop` exactly like the
// Options pill's relay does: response {stopped:true} arrives FIRST, then the
// daemon shuts down (socket closes), and the pidfile is removed (cmdServe).
// A subsequent CLI `status` proves the daemon is gone; a fresh session's
// reconnect loop then re-boots it lazily — the reconnect closed loop.
let stopOk = false;
const stopSession = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId: profileStop,
  wsFactory,
  reconnectBaseMs: 200,
  reconnectMaxMs: 1000,
  handshakeTimeoutMs: 500,
});
stopSession.start();
await withTimeout(
  waitFor(() => stopSession.currentStatus === "connected", 8000, "stop phase connects"),
  TIMEOUT_MS,
  "stop-phase connect",
);
const stopResp = await stopSession.request("bridge.stop", {});
if (stopResp.ok && (stopResp.result as { stopped?: unknown })?.stopped === true) {
  console.log("[driver] bridge.stop → {stopped:true} ✔");
} else {
  fail(`bridge.stop reply = ${JSON.stringify(stopResp)}`);
}
// The daemon's flush window closes the socket; the session sees the drop.
await withTimeout(
  waitFor(() => stopSession.currentStatus !== "connected", 8000, "socket drops after stop"),
  TIMEOUT_MS,
  "stop-phase socket close",
);
stopSession.stop();
// pidfile removed → CLI status reports not running (exit 1).
const statusAfter = run([bin, "status"], { env: { ...process.env, EXCALI_BRIDGE_BIN: bin } });
if (statusAfter.code === 1 && statusAfter.stdout.includes("not running")) {
  console.log("[driver] daemon pidfile removed after bridge.stop ✔");
  stopOk = true;
} else {
  fail(`daemon status after stop = exit ${statusAfter.code}: ${statusAfter.stdout.trim()}`);
}
// Reconnect closed loop: the daemon is down, so the session's dial backoffs
// (never connects). The user restarts it via the CLI (`excali-bridge <method>`
// lazily spawns the daemon) → the SAME session reconnects without any
// page-side change — the closed loop 045 requires.
const relive = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId: profileStop,
  wsFactory,
  reconnectBaseMs: 200,
  reconnectMaxMs: 1000,
  handshakeTimeoutMs: 500,
});
relive.start();
await sleep(1000); // let the reconnect loop observe the daemon is down
const bootAgain = run([bin, "ping"], { env: { ...process.env, EXCALI_BRIDGE_BIN: bin } });
if (bootAgain.code !== 0) {
  fail(`daemon re-boot after bridge.stop failed:\n${bootAgain.stdout}\n${bootAgain.stderr}`);
}
await withTimeout(
  waitFor(() => relive.currentStatus === "connected", 15000, "session reconnects after daemon re-boot"),
  TIMEOUT_MS + 5000,
  "stop-phase relive",
);
console.log("[driver] reconnect: same session reconnects after daemon re-boot ✔");
relive.stop();

// --- verdict ---
console.log(
  ok1
    ? "[driver] PASS — ping round-trip through window.excaliAPI client code ✔"
    : "[driver] FAIL — ping did not round-trip",
);
console.log(
  displacedA && failures === 0
    ? "[driver] PASS — displacement: B displaced A, daemon held ≤1 active page ✔"
    : "[driver] FAIL — displacement proof broken",
);
process.exit(failures > 0 || !ok1 || !okB || !displacedA || !stopOk ? 1 : 0);
