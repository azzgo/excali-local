#!/usr/bin/env bun
/**
 * AGENT BRIDGE — driver: exercises the REAL page-side WS client
 * (`packages/excali-page/src/features/editor/lib/agent-bridge-client.ts`)
 * against the Go bridge daemon (`packages/excali-bridge`), exactly as
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
 *   bun run bridge:build                          (once: builds the Go daemon)
 *   bun scripts/agent-bridge/driver.ts            (spawns the daemon lazily)
 */

import { join } from "node:path";
import { mintBridgeToken } from "excali-shared";
import {
  AgentBridgeSession,
  type BridgeConnectionStatus,
  type BridgeWs,
} from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
const bin =
  process.env.EXCALI_BRIDGE_BIN ??
  join(import.meta.dir, "../../packages/excali-bridge/bin/excali-bridge");

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
if (!Bun.spawnSync(["test", "-x", bin]).success) {
  console.error(`[driver] bridge binary not found at ${bin} — run \`bun run bridge:build\` first`);
  process.exit(1);
}
const boot = Bun.spawnSync([bin, "ping"], { env: { ...process.env, EXCALI_BRIDGE_BIN: bin } });
if (boot.exitCode !== 0) {
  console.error(`[driver] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
console.log(`[driver] daemon up (CLI ping: ${boot.stdout.toString().trim()})`);

// --- Phase 1: ping round-trip through the page's own client code -----------
const token1 = mintBridgeToken(); // ≥128-bit (256-bit) — never logged
let port1: number | null = null;
let session1: AgentBridgeSession | null = null;
const phase1 = new Promise<boolean>((resolve) => {
  const session = new AgentBridgeSession({
    origin,
    token: token1,
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
  wsFactory,
  onStatus: (status) => console.log(`[driver] page B status → ${status}`),
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

// --- verdict ----------------------------------------------------------------
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
process.exit(failures > 0 || !ok1 || !okB || !displacedA ? 1 : 0);
