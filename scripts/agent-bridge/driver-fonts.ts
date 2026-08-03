#!/usr/bin/env bun
/**
 * AGENT BRIDGE — fonts/v1 e2e driver (Wayfinder Ticket 015, refined — goal 4).
 *
 * Proves the full agent → daemon → (control page) → fonts dispatcher → daemon
 * → agent round-trip against the REAL Go daemon:
 *
 *   agent side  — the CLI (`excali-bridge <method> '<json>'`, subcommand ==
 *                 method) drives every request
 *   daemon side — fonts.system.list resolves DAEMON-LOCAL (Go OS-font
 *                 enumeration, no page needed); get/assign/install/clear route
 *                 via routeToPaired to the control page (paired, no canvas)
 *   page side   — a control page-sim running the REAL fonts dispatcher
 *                 (lib/fonts-v1.ts) over an in-memory excali-fonts config
 *
 * Loop exercised:
 *   - fonts.system.list from the daemon with NOTHING connected (daemon-local)
 *   - gate: fonts.get/assign/install/clear work via a control connection with
 *     NO canvas (paired)
 *   - get → assign (requiresReload) → install (BLOCKING auto-approve, magic
 *     validation) → get (trimmed) → clear (BLOCKING)
 *   - cancel path → -32005; invalid font → -32602 BEFORE the confirm
 *   - wire trimming: custom slot has NO data bytes
 *
 * Run:
 *   bun run bridge:build
 *   bun scripts/agent-bridge/driver-fonts.ts
 */

import { join } from "node:path";
import { mintBridgeToken, WS_ROLE_CONTROL_PAGE } from "excali-shared";
import {
  AgentBridgeSession,
  type BridgeWs,
} from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";
import {
  handleFontsV1Request,
  type FontsV1Deps,
  type FontsV1Request,
} from "../../packages/excali-page/src/lib/fonts-v1";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
const profileId = "11111111-2222-4333-8444-555555555555";
const bin =
  process.env.EXCALI_BRIDGE_BIN ??
  join(import.meta.dir, "../../packages/excali-bridge/bin/excali-bridge");

const wsFactory = (url: string): BridgeWs =>
  new WebSocket(url, { headers: { Origin: origin } }) as unknown as BridgeWs;

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[driver-fonts] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[driver-fonts] ✓ ${msg}`);

// --- CLI helper: subcommand == method ---------------------------------------
const cli = (method: string, params?: unknown): { code: number; stdout: string; stderr: string } => {
  const args = [bin, method];
  if (params !== undefined) args.push(JSON.stringify(params));
  const res = Bun.spawnSync(args, { env: process.env });
  return { code: res.exitCode ?? -1, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
};

const cliResult = (method: string, params?: unknown): unknown => {
  const r = cli(method, params);
  if (r.code !== 0) {
    fail(`${method} exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
    return undefined;
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    fail(`${method} stdout not JSON: ${r.stdout.slice(0, 200)}`);
    return undefined;
  }
};

const cliError = (method: string, params?: unknown): number | null => {
  const r = cli(method, params);
  const m = r.stderr.match(/rpc error (-?\d+)/);
  return m ? Number(m[1]) : null;
};

// --- in-memory excali-fonts config (stands in for the FontConfig record) -----
const config = {
  handwriting: null as unknown,
  normal: null as unknown,
  code: null as unknown,
};
const fontsDb: FontsV1Deps["db"] = {
  getFontConfig: async () => ({ ...config }),
  updateFontSlot: async (slot, source) => {
    (config as Record<string, unknown>)[slot] = source;
  },
  clearFontSlot: async (slot) => {
    (config as Record<string, unknown>)[slot] = null;
  },
};

// A minimal valid TTF (magic 0x00010000) base64 payload for install.
const TTF_B64 = btoa(String.fromCharCode(0x00, 0x01, 0x00, 0x00, 0x50, 0x41, 0x42, 0x43));

// --- control page-sim: REAL dispatcher, scriptable confirm gate --------------
let confirmMode: "approve" | "reject" = "approve";
let controlSession: AgentBridgeSession | null = null;
const deps: FontsV1Deps = {
  db: fontsDb,
  onConfirm: async () => confirmMode === "approve",
};
controlSession = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  role: WS_ROLE_CONTROL_PAGE,
  profileId,
  wsFactory,
  onInbound: (msg) => {
    const m = msg as { type?: string; jsonrpc?: string; method?: string };
    if (m.type === "displaced") {
      controlSession?.stop();
      return;
    }
    if (m?.jsonrpc === "2.0" && typeof m.method === "string") {
      void handleFontsV1Request(m as FontsV1Request, deps).then((resp) =>
        controlSession?.sendJSON(resp),
      );
    }
  },
});

const waitForConnected = (s: AgentBridgeSession) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    const check = () => {
      if (s.currentStatus === "connected") {
        clearTimeout(timer);
        resolve(true);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

// --- bootstrap ---------------------------------------------------------------
console.log(`[driver-fonts] binary: ${bin}`);
if (!Bun.spawnSync(["test", "-x", bin]).success) {
  console.error(`[driver-fonts] bridge binary not found — run \`bun run bridge:build\` first`);
  process.exit(1);
}
const boot = Bun.spawnSync([bin, "ping"], { env: process.env });
if (boot.exitCode !== 0) {
  console.error(`[driver-fonts] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
ok(`daemon up (${boot.stdout.toString().trim()})`);

// --- fonts.system.list is DAEMON-LOCAL: works with NOTHING connected ---------
const sysList = cliResult("fonts.system.list") as Array<{ family: string; postscriptName: string }>;
if (!Array.isArray(sysList) || sysList.length === 0) {
  fail(`fonts.system.list = ${JSON.stringify(sysList)?.slice(0, 200)} — expected OS fonts`);
} else {
  let shapeOk = true;
  for (const f of sysList) {
    if (typeof f?.family !== "string" || typeof f?.postscriptName !== "string") shapeOk = false;
  }
  if (!shapeOk) {
    fail("fonts.system.list entries must be {family, postscriptName}");
  } else {
    ok(`fonts.system.list → ${sysList.length} OS fonts from the DAEMON (no page, no canvas, no permission prompt)`);
    console.log(`   e.g. ${sysList[0].family} / ${sysList[0].postscriptName}`);
  }
}

// --- paired-only ops with NO canvas (control connection) ----------------------
controlSession.start();
if (!(await waitForConnected(controlSession))) {
  fail("control page-sim never connected");
  process.exit(1);
}
ok("control page-sim connected (paired, NOT activated)");

const empty = cliResult("fonts.get") as { handwriting: unknown; normal: unknown; code: unknown };
if (!empty || empty.handwriting !== null || empty.normal !== null || empty.code !== null) {
  fail(`fonts.get initial = ${JSON.stringify(empty)}`);
} else {
  ok("fonts.get → all slots null (trimmed, via CONTROL connection with NO canvas)");
}

// --- fonts.assign (non-blocking) ----------------------------------------------
const assigned = cliResult("fonts.assign", { slot: "normal", postscriptName: "SFNS-Regular" }) as {
  config: { normal: unknown };
  requiresReload: boolean;
};
if (assigned?.requiresReload !== true || (assigned.config?.normal as { postscriptName?: string })?.postscriptName !== "SFNS-Regular") {
  fail(`fonts.assign = ${JSON.stringify(assigned)}`);
} else {
  ok("fonts.assign → {config, requiresReload:true} (non-blocking, no confirm)");
}

// --- fonts.install (BLOCKING confirm, auto-approve) ---------------------------
const installed = cliResult("fonts.install", { slot: "code", family: "My Code Font", data: TTF_B64 }) as {
  config: { code: unknown };
  requiresReload: boolean;
};
if (installed?.requiresReload !== true || (installed.config?.code as { family?: string })?.family !== "My Code Font") {
  fail(`fonts.install = ${JSON.stringify(installed)}`);
} else {
  const wire = JSON.stringify(installed.config.code);
  if (wire.includes("data") || wire.includes("80,66,67") /* raw bytes leak */) {
    fail("fonts.install response leaked font bytes on the wire");
  } else {
    ok("fonts.install → BLOCKING confirm auto-approved; custom slot trimmed to {type,family}; requiresReload:true");
  }
}

// --- fonts.get confirms the install persisted (trimmed) -----------------------
const after = cliResult("fonts.get") as { code: { type: string; family: string; data?: unknown } };
if (after?.code?.family !== "My Code Font" || after.code.data !== undefined) {
  fail(`fonts.get after install = ${JSON.stringify(after)}`);
} else {
  ok("fonts.get reflects the install: custom slot has family, NO data bytes");
}

// --- install validation: bad magic → -32602 BEFORE the confirm gate -----------
const badMagic = cliError("fonts.install", { slot: "code", family: "X", data: btoa("notafont") });
if (badMagic !== -32602) {
  fail(`install bad-magic = ${badMagic}, want -32602`);
} else {
  ok("fonts.install bad magic → -32602 (validated before the blocking modal)");
}

// --- fonts.clear cancel path → -32005 ------------------------------------------
confirmMode = "reject";
const cancelled = cli("fonts.clear", { slot: "code" });
if (cancelled.code === 0 || !cancelled.stderr.includes("-32005")) {
  fail(`fonts.clear with user reject = code=${cancelled.code} ${cancelled.stderr.trim()}`);
} else {
  ok("fonts.clear rejected on the confirm modal → -32005 'cancelled by user'");
}
const stillThere = cliResult("fonts.get") as { code: { family?: string } };
if (stillThere?.code?.family !== "My Code Font") {
  fail(`cancelled clear should not touch the slot: ${JSON.stringify(stillThere)}`);
} else {
  ok("cancelled clear did not clear the slot");
}

// --- fonts.clear (BLOCKING, auto-approve) --------------------------------------
confirmMode = "approve";
const cleared = cliResult("fonts.clear", { slot: "code" }) as {
  config: { code: unknown };
  requiresReload: boolean;
};
if (cleared?.requiresReload !== true || cleared.config?.code !== null) {
  fail(`fonts.clear = ${JSON.stringify(cleared)}`);
} else {
  ok("fonts.clear → BLOCKING confirm auto-approved; slot null; requiresReload:true");
}

// --- teardown ------------------------------------------------------------------
controlSession.stop();
await new Promise((r) => setTimeout(r, 300));

console.log(
  failures === 0
    ? "[driver-fonts] PASS — fonts/v1 round-trip ✔"
    : `[driver-fonts] FAIL — ${failures} assertion(s)`,
);
process.exit(failures > 0 ? 1 : 0);
