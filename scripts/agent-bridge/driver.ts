#!/usr/bin/env bun
/**
 * AGENT BRIDGE — driver: exercises the REAL page-side WS client against the
 * stub server (scripts/agent-bridge/stub.ts), exactly as the activated Local
 * editor page does:
 *
 *   scan the fixed port range → token handshake → connected → ping round-trip
 *
 * Run:
 *   bun scripts/agent-bridge/stub.ts     (terminal 1)
 *   bun scripts/agent-bridge/driver.ts   (terminal 2)
 *
 * Exit 0 = PASS (ping/pong round-trip through the page's own client code).
 */

import { mintBridgeToken } from "excali-shared";
import {
  AgentBridgeSession,
  type BridgeConnectionStatus,
  type BridgeWs,
} from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
const token = mintBridgeToken(); // ≥128-bit (256-bit) — never logged
console.log(`[driver] origin=${origin} token=${token.length} hex chars`);

const TIMEOUT_MS = 15000;

let resolveConnected: ((ok: boolean) => void) | null = null;
const connectedPromise = new Promise<boolean>((resolve) => {
  resolveConnected = resolve;
});
const timer = setTimeout(() => resolveConnected?.(false), TIMEOUT_MS);

const session = new AgentBridgeSession({
  origin,
  token,
  // Bun's native WebSocket client sends no Origin by default — the harness
  // injects the extension-page origin explicitly (browsers send it for free).
  wsFactory: (url: string): BridgeWs =>
    new WebSocket(url, { headers: { Origin: origin } }) as unknown as BridgeWs,
  onStatus: (status: BridgeConnectionStatus) => {
    console.log(`[driver] status → ${status}`);
    if (status === "connected") {
      clearTimeout(timer);
      resolveConnected?.(true);
    }
  },
});

session.start();

const connected = await connectedPromise;
if (!connected) {
  console.error("[driver] FAIL — no bridge reachable (is stub.ts running?)");
  process.exit(1);
}

const ok = await session.ping();
session.stop();
console.log(
  ok
    ? "[driver] PASS — ping round-trip through window.excaliAPI client code ✔"
    : "[driver] FAIL — ping did not round-trip",
);
process.exit(ok ? 0 : 1);
