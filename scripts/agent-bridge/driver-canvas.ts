#!/usr/bin/env bun
/**
 * AGENT BRIDGE — canvas/v1 e2e driver (Wayfinder Ticket 007).
 *
 * Proves the full agent → daemon → active page → window.excaliAPI → daemon →
 * agent round-trip against the REAL Go daemon:
 *
 *   agent side   — the CLI (`excali-bridge <method> '<json>'`, subcommand ==
 *                  method) drives every request
 *   daemon side  — real routing (forward to the active page, correlate by
 *                  JSON-RPC id, no-active guard, local meta methods)
 *   page side    — a page-sim WS session running the REAL page dispatcher
 *                  (lib/canvas-v1.ts) over a stub excaliAPI + stub canvas
 *                  helpers (the real helpers need a DOM canvas — covered by
 *                  vitest in happy-dom for the pure parts)
 *
 * Loop exercised: read → write → read → export, plus the destructive subset
 * (fires the page's onDestructive → non-blocking indicator) and the
 * no-active-canvas guard.
 *
 * Run:
 *   bun run bridge:build
 *   bun scripts/agent-bridge/driver-canvas.ts        (spawns the daemon lazily)
 */

import { join } from "node:path";
import { mintBridgeToken } from "excali-shared";
import { AgentBridgeSession, type BridgeWs } from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";
import {
  blobToDataURL,
  handleCanvasV1Request,
  type CanvasV1Api,
  type CanvasV1Helpers,
  type CanvasV1Request,
} from "../../packages/excali-page/src/features/editor/lib/canvas-v1";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
// Per-profile identity uuid (goal 3) — REQUIRED by the daemon for page roles.
const profileId = "11111111-2222-4333-8444-555555555555";
const bin =
  process.env.EXCALI_BRIDGE_BIN ??
  join(import.meta.dir, "../../packages/excali-bridge/bin/excali-bridge");

const wsFactory = (url: string): BridgeWs =>
  new WebSocket(url, { headers: { Origin: origin } }) as unknown as BridgeWs;

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[driver-canvas] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[driver-canvas] ✓ ${msg}`);

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

// --- page-sim: real dispatcher over a stub excaliAPI -------------------------
const sceneState: {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
} = {
  elements: [],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: 20,
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
    viewModeEnabled: false,
    activeTool: { type: "selection" },
  },
  files: {},
};

const stubApi: CanvasV1Api = {
  getSceneElements: () => sceneState.elements,
  getAppState: () => sceneState.appState,
  getFiles: () => sceneState.files,
  updateScene: (patch) => {
    if (patch.elements !== undefined) sceneState.elements = [...patch.elements];
    if (patch.appState) Object.assign(sceneState.appState, patch.appState);
  },
  addFiles: (files) => {
    for (const f of files) {
      sceneState.files[f.id] = { mimeType: f.mimeType, dataURL: f.dataURL, created: f.created ?? Date.now() };
    }
  },
  setActiveTool: (tool) => {
    sceneState.appState.activeTool = { ...tool, customType: null };
  },
  scrollToContent: () => {},
  resetScene: () => {
    sceneState.elements = [];
  },
  history: { clear: () => {} },
};

// Canvas-bound helpers are stubbed (real ones need a DOM canvas; pure parts
// convertToExcalidrawElements/getCommonBounds are covered in vitest with the
// real tgz under happy-dom). exportPng still produces a REAL base64 dataURL
// via the dispatcher's own pure blobToDataURL + Bun's Blob.
const helpers: CanvasV1Helpers = {
  convertToExcalidrawElements: (data) =>
    data.map((el, i) => ({
      id: `norm-${i}`,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ...(el as Record<string, unknown>),
    })),
  getCommonBounds: () => [0, 0, 100, 50],
  exportPng: async () => {
    const dataURL = await blobToDataURL(new Blob([new Uint8Array([137, 80, 78, 71])]), "image/png");
    return { dataURL, width: 100, height: 50 };
  },
  exportSvg: async () => "<svg xmlns='http://www.w3.org/2000/svg'/>",
};

const destructiveOps: string[] = [];
let pageSession: AgentBridgeSession | null = null;

const page = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId,
  wsFactory,
  onInbound: (msg) => {
    const m = msg as { jsonrpc?: string; method?: string; id?: unknown };
    if (m?.jsonrpc === "2.0" && typeof m.method === "string") {
      void handleCanvasV1Request(m as CanvasV1Request, {
        api: stubApi,
        helpers,
        onDestructive: (method) => {
          console.log(`[driver-canvas] page-sim destructive op: ${method}`);
          destructiveOps.push(method);
        },
      }).then((resp) => pageSession?.sendJSON(resp));
    }
  },
});
pageSession = page;

const waitForConnected = () =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    const check = () => {
      if (page.currentStatus === "connected") {
        clearTimeout(timer);
        resolve(true);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

// --- bootstrap ---------------------------------------------------------------
console.log(`[driver-canvas] binary: ${bin}`);
if (!Bun.spawnSync(["test", "-x", bin]).success) {
  console.error(`[driver-canvas] bridge binary not found at ${bin} — run \`bun run bridge:build\` first`);
  process.exit(1);
}
const boot = Bun.spawnSync([bin, "ping"], { env: process.env });
if (boot.exitCode !== 0) {
  console.error(`[driver-canvas] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
ok(`daemon up (${boot.stdout.toString().trim()})`);

// --- META (daemon-local, no page needed) --------------------------------------
const list = cliResult("commands.list");
if (!Array.isArray(list) || !list.includes("scene.get") || !list.includes("protocol.version")) {
  fail(`commands.list missing canvas/v1 methods: ${JSON.stringify(list)}`);
} else {
  ok(`commands.list returns ${list.length} canvas/v1 methods`);
}
const proto = cliResult("protocol.version");
if (proto !== "canvas/v1") {
  fail(`protocol.version = ${JSON.stringify(proto)}, want "canvas/v1"`);
} else {
  ok(`protocol.version = "canvas/v1"`);
}

// --- no-active guard (page not yet connected) ---------------------------------
const guard = cli("scene.get");
if (guard.code === 0 || !guard.stderr.includes("-32001")) {
  fail(`no-active guard: expected -32001, got code=${guard.code} ${guard.stderr.trim()}`);
} else {
  ok("scene.get with no active canvas → -32001 'no active canvas'");
}

// --- page connects; read → write → read → export loop -------------------------
page.start();
if (!(await waitForConnected())) {
  fail("page-sim never connected");
  process.exit(failures > 0 ? 1 : 1);
}
ok("page-sim connected (holds the active slot)");

// READ
const empty = cliResult("scene.get");
if (!empty || !Array.isArray(empty.elements) || empty.elements.length !== 0) {
  fail(`scene.get initial = ${JSON.stringify(empty)}`);
} else {
  ok("scene.get → empty scene {elements, appState, files}");
}

// WRITE (scene.update — passthrough, ids preserved)
const el = {
  id: "rect-1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version: 3,
  versionNonce: 1,
  isDeleted: false,
};
const up = cli("scene.update", { elements: [el], appState: { viewBackgroundColor: "#000000" } });
if (up.code !== 0) {
  fail(`scene.update exited ${up.code}: ${up.stderr}`);
} else {
  ok("scene.update accepted");
}

// READ back
const after = cliResult("scene.get");
const elBack = Array.isArray(after?.elements) ? after.elements[0] : undefined;
if (!elBack || (elBack as { id?: string }).id !== "rect-1" || (elBack as { version?: number }).version !== 3) {
  fail(`scene.update did not preserve id/version: ${JSON.stringify(elBack)}`);
} else {
  ok("scene.get reflects scene.update with id/version preserved (no id-merge)");
}
const bg = (after?.appState as { viewBackgroundColor?: string })?.viewBackgroundColor;
if (bg !== "#000000") {
  fail(`appState write-subset not applied: ${JSON.stringify(after?.appState)}`);
} else {
  ok("scene.update appState write-subset applied (viewBackgroundColor)");
}

// WRITE (elements.add — normalize partials + concat)
const add = cli("elements.add", {
  elements: [{ type: "rectangle", x: 200, y: 0, width: 10, height: 10 }],
});
if (add.code !== 0) {
  fail(`elements.add exited ${add.code}: ${add.stderr}`);
} else {
  ok("elements.add accepted (partial normalized + concat)");
}
const added = cliResult("scene.elements");
if (!Array.isArray(added) || added.length !== 2) {
  fail(`scene.elements after add = ${JSON.stringify(added)}`);
} else {
  ok("scene.elements → 2 elements after elements.add");
}

// READ (bounds)
const bounds = cliResult("scene.bounds");
if (!bounds || typeof bounds.width !== "number" || bounds.width <= 0) {
  fail(`scene.bounds = ${JSON.stringify(bounds)}`);
} else {
  ok(`scene.bounds → {x,y,width,height} (${JSON.stringify(bounds)})`);
}

// READ (exportPng — base64)
const png = cliResult("scene.exportPng", { mimeType: "image/png" });
if (!png || typeof png.dataURL !== "string" || !png.dataURL.startsWith("data:image/png;base64,") || typeof png.width !== "number") {
  fail(`scene.exportPng = ${JSON.stringify(png)?.slice(0, 120)}`);
} else {
  ok(`scene.exportPng → base64 dataURL (${png.dataURL.length} chars) + width/height`);
}

// READ (exportSvg)
const svg = cliResult("scene.exportSvg");
if (!svg || typeof svg.svg !== "string" || !svg.svg.includes("<svg")) {
  fail(`scene.exportSvg = ${JSON.stringify(svg)}`);
} else {
  ok("scene.exportSvg → svg string");
}

// WRITE (tool.setActive + scene.state read-back)
const tool = cli("tool.setActive", { type: "arrow", locked: false });
if (tool.code !== 0) {
  fail(`tool.setActive exited ${tool.code}`);
} else {
  ok("tool.setActive accepted");
}
const state = cliResult("scene.state");
if ((state as { activeTool?: { type?: string } })?.activeTool?.type !== "arrow") {
  fail(`scene.state activeTool = ${JSON.stringify(state?.activeTool)}`);
} else {
  ok("scene.state reflects tool.setActive (curated subset, no collaborators leak)");
}

// WRITE (view.scrollTo — no error)
const scroll = cli("view.scrollTo", { fitToContent: true });
if (scroll.code !== 0) fail(`view.scrollTo exited ${scroll.code}`);
else ok("view.scrollTo accepted");

// WRITE (files.add new id — non-destructive)
const files = cli("files.add", {
  files: [{ id: "img-new", mimeType: "image/png", dataURL: "data:image/png;base64,AA==" }],
});
if (files.code !== 0) fail(`files.add exited ${files.code}`);
else ok("files.add accepted (new id, non-destructive)");

// WRITE (history.clear — destructive)
const hist = cli("history.clear");
if (hist.code !== 0) fail(`history.clear exited ${hist.code}`);
else ok("history.clear accepted");

// WRITE (elements.clear — destructive)
const clear = cli("elements.clear");
if (clear.code !== 0) fail(`elements.clear exited ${clear.code}`);
else ok("elements.clear accepted");
const cleared = cliResult("scene.elements");
if (!Array.isArray(cleared) || cleared.length !== 0) {
  fail(`scene.elements after clear = ${JSON.stringify(cleared)}`);
} else {
  ok("scene.elements → [] after elements.clear");
}

// Destructive indicator fired for the destructive subset
if (!destructiveOps.includes("history.clear") || !destructiveOps.includes("elements.clear")) {
  fail(`destructive indicator not fired for the destructive subset: ${destructiveOps.join(",")}`);
} else {
  ok(`non-blocking destructive indicator fired for: ${destructiveOps.join(", ")}`);
}

// WRITE (files.add overwrite — destructive)
const filesOverwrite = cli("files.add", {
  files: [{ id: "img-new", mimeType: "image/png", dataURL: "data:image/png;base64,BB==" }],
});
if (filesOverwrite.code !== 0) fail(`files.add overwrite exited ${filesOverwrite.code}`);
if (!destructiveOps.includes("files.add")) {
  fail("files.add overwrite should fire the destructive indicator");
} else {
  ok("files.add overwrite → destructive indicator");
}

// --- no-active guard after page disconnect ------------------------------------
page.stop();
await new Promise((r) => setTimeout(r, 300)); // let the daemon clear the slot
const guard2 = cli("scene.get");
if (guard2.code === 0 || !guard2.stderr.includes("-32001")) {
  fail(`post-disconnect guard: expected -32001, got code=${guard2.code}`);
} else {
  ok("scene.get after page disconnect → -32001 (never hangs)");
}

console.log(failures === 0 ? "[driver-canvas] PASS — canvas/v1 round-trip ✔" : `[driver-canvas] FAIL — ${failures} assertion(s)`);
process.exit(failures > 0 ? 1 : 0);
