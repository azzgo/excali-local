/**
 * AGENT BRIDGE — goal-5 smoke test: run the HOST platform's daemon binary
 * from the SOURCE skill (skills/excali-local/bin/) end-to-end, exactly as the
 * skill's consumers will.
 *
 *   - binary = bin/excali-bridge-<os>-<arch>[.exe] inside the skill dir
 *     (the naming convention SKILL.md teaches agents to pick);
 *   - lazy daemon: first CLI call spawns `serve` automatically;
 *   - daemon-local round-trip: ping → pong;
 *   - canvas/v1 round-trip against a page-sim running the REAL page
 *     dispatcher (handleCanvasV1Request over a stub excaliAPI): scene.get →
 *     elements.add → scene.get reflects → scene.exportPng returns a base64
 *     dataURL;
 *   - exit 0 = pass.
 *
 * Modeled on driver-fonts.ts / driver-canvas.ts. Requires the pack to have
 * been run first: `pnpm skill:pack`.
 *
 * Run:
 *   pnpm skill:pack                # refresh skills/excali-local/bin/
 *   tsx scripts/agent-bridge/driver-skill.ts
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { mintBridgeToken } from "excali-shared";
import { run, runAsync, hereDir } from "../_run";
import { AgentBridgeSession, type BridgeWs } from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";
import {
  blobToDataURL,
  handleCanvasV1Request,
  type CanvasV1Api,
  type CanvasV1Helpers,
  type CanvasV1Request,
} from "../../packages/excali-page/src/features/editor/lib/canvas-v1";

// ---- pick the HOST platform's bundled binary (the skill's naming rule) -----
const HOST_BIN_NAMES: Record<string, Record<string, string>> = {
  darwin: { arm64: "excali-bridge-darwin-arm64", x64: "excali-bridge-darwin-amd64" },
  linux: { x64: "excali-bridge-linux-amd64" },
  win32: { x64: "excali-bridge-windows-amd64.exe" },
};
const hostName = HOST_BIN_NAMES[process.platform]?.[process.arch];
if (!hostName) {
  console.error(`[driver-skill] no bundled binary for host ${process.platform}/${process.arch} — expected one of the 4 targets`);
  process.exit(2);
}
const bin = process.env.EXCALI_BRIDGE_BIN ?? join(hereDir(import.meta.url), "../../skills/excali-local/bin", hostName);
if (!existsSync(bin)) {
  console.error(`[driver-skill] bundled binary not found: ${bin} — run \`pnpm skill:pack\` first`);
  process.exit(1);
}
console.log(`[driver-skill] binary: ${bin}`);

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
const profileId = "11111111-2222-4333-8444-555555555555";
const wsFactory = (url: string): BridgeWs =>
  new WebSocket(url, { headers: { Origin: origin } }) as unknown as BridgeWs;

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[driver-skill] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[driver-skill] ✓ ${msg}`);

// ---- CLI helper: subcommand == method ---------------------------------------
const cli = async (method: string, params?: unknown): Promise<{ code: number; stdout: string; stderr: string }> => {
  const args = [bin, method];
  if (params !== undefined) args.push(JSON.stringify(params));
  // async spawn: node's spawnSync would freeze the event loop and starve the
  // page-sim's WebSocket delivery (bun's spawnSync did not)
  const r = await runAsync(args, { env: process.env });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
};
const cliResult = async (method: string, params?: unknown): Promise<unknown> => {
  const r = await cli(method, params);
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

// ---- page-sim: REAL canvas dispatcher over a stub excaliAPI ----------------
const sceneState: { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> } = {
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
    for (const f of files) sceneState.files[f.id] = { mimeType: f.mimeType, dataURL: f.dataURL, created: f.created ?? Date.now() };
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
const helpers: CanvasV1Helpers = {
  // Stub the canvas-bound helpers (real ones need a DOM canvas; the real
  // patched-tgz normalize path is covered by the page test suite).
  convertToExcalidrawElements: (data) =>
    (data as Array<Record<string, unknown>>).map((el, i) => ({
      id: `norm-${i}`,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ...el,
    })),
  getCommonBounds: () => [0, 0, 100, 50],
  exportPng: async () => {
    const dataURL = await blobToDataURL(new Blob([new Uint8Array([137, 80, 78, 71])]), "image/png");
    return { dataURL, width: 100, height: 50 };
  },
  exportSvg: async () => "<svg xmlns='http://www.w3.org/2000/svg'/>",
};
let pageSession: AgentBridgeSession | null = null;
const page = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId,
  wsFactory,
  onInbound: (msg) => {
    const m = msg as { jsonrpc?: string; method?: string; id?: unknown };
    if (m?.jsonrpc === "2.0" && typeof m.method === "string") {
      void handleCanvasV1Request(m as CanvasV1Request, { api: stubApi, helpers }).then((resp) =>
        pageSession?.sendJSON(resp),
      );
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

// ---- bootstrap: lazy daemon via the assembled binary -----------------------
const boot = run([bin, "ping"], { env: process.env });
if (boot.code !== 0) {
  console.error(`[driver-skill] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
ok(`lazy daemon up — ping → ${boot.stdout.trim()}`);

// ---- daemon-local meta from the assembled binary ---------------------------
const list = await cliResult("commands.list");
if (!Array.isArray(list) || !list.includes("scene.get")) {
  fail(`commands.list = ${JSON.stringify(list)}`);
} else {
  ok(`commands.list → ${list.length} methods`);
}
const proto = await cliResult("protocol.version");
if (proto !== "canvas/v1") {
  fail(`protocol.version = ${JSON.stringify(proto)}`);
} else {
  ok(`protocol.version → "canvas/v1"`);
}

// ---- no-active guard --------------------------------------------------------
const guard = await cli("scene.get");
if (guard.code === 0 || !guard.stderr.includes("-32001")) {
  fail(`no-active guard: expected -32001, got code=${guard.code} ${guard.stderr.trim()}`);
} else {
  ok("scene.get with no active canvas → -32001");
}

// ---- canvas round-trip via the page-sim ------------------------------------
page.start();
if (!(await waitForConnected())) {
  fail("page-sim never connected");
  process.exit(1);
}
ok("page-sim connected (active slot)");

const empty = await cliResult("scene.get") as { elements?: unknown[] };
if (!empty || !Array.isArray(empty.elements) || empty.elements.length !== 0) {
  fail(`scene.get initial = ${JSON.stringify(empty)}`);
} else {
  ok("scene.get → empty scene");
}

const rect = {
  type: "rectangle",
  x: 100,
  y: 100,
  width: 180,
  height: 90,
  strokeColor: "#020817",
  backgroundColor: "#f1f5f9",
  strokeWidth: 2,
  roughness: 0,
  opacity: 100,
};
const add = await cli("elements.add", { elements: [rect] });
if (add.code !== 0) {
  fail(`elements.add exited ${add.code}: ${add.stderr}`);
} else {
  ok("elements.add accepted (skill template shape)");
}
const after = await cliResult("scene.get") as { elements?: Array<Record<string, unknown>> };
const elBack = Array.isArray(after?.elements) ? after.elements[0] : undefined;
if (!elBack || elBack.type !== "rectangle" || elBack.width !== 180) {
  fail(`scene.get after add = ${JSON.stringify(elBack)}`);
} else {
  ok("scene.get reflects the added element");
}

const png = await cliResult("scene.exportPng", { mimeType: "image/png" }) as { dataURL?: string; width?: number };
if (!png || typeof png.dataURL !== "string" || !png.dataURL.startsWith("data:image/png;base64,")) {
  fail(`scene.exportPng = ${JSON.stringify(png)?.slice(0, 120)}`);
} else {
  ok(`scene.exportPng → base64 dataURL (${png.dataURL.length} chars)`);
}

// ---- teardown ---------------------------------------------------------------
page.stop();
await new Promise((r) => setTimeout(r, 300));
console.log(
  failures === 0
    ? "[driver-skill] PASS — assembled-skill binary round-trip ✔"
    : `[driver-skill] FAIL — ${failures} assertion(s)`,
);
process.exit(failures > 0 ? 1 : 0);
